/**
 * verify-warranty.js — checks the warranty engine against the real unit data.
 *
 * Warranty.gs is loaded as-is, with only its two sheet-backed lookups stubbed,
 * so what runs here is the code the portal runs. The expectations come from the
 * source workbook rather than from the implementation.
 *
 *   node tools/verify-warranty.js path/to/units.json
 *
 * units.json is [{ sn, expired }] taken from the warranty sheet, where `expired`
 * is its MM/YYYY column.
 */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const unitsPath = process.argv[2];
if (!unitsPath) {
  console.error('usage: node tools/verify-warranty.js <units.json>');
  process.exit(2);
}
const units = JSON.parse(fs.readFileSync(unitsPath, 'utf8'));

/* Load Config.gs and Warranty.gs into a sandbox with the sheet layer stubbed. */
const sandbox = {
  console: console,
  CacheService: { getScriptCache: function () { return { get: function () { return null; }, put: function () {} }; } },
  Utilities: { formatDate: function () { return ''; } },
  padLeft_: function (n, w) { let s = String(n); while (s.length < w) s = '0' + s; return s; },
  // Exercised separately below; the default run keeps the table out of the way
  // so the formula itself is what is being measured.
  readAll_: function () { return []; }
};
vm.createContext(sandbox);

// Both files are run as one script: a top-level `const` in a vm script stays in
// that script's own scope, so loading them separately would hide Config's
// constants from Warranty.
const source = ['Config.gs', 'Warranty.gs']
  .map(function (file) { return fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8'); })
  .concat(['globalThis.__api = { parseSerial_, determineWarranty_, WARRANTY_TYPE, SHEET };'])
  .join('\n');
vm.runInContext(source, sandbox, { filename: 'warranty-engine' });

const { parseSerial_, determineWarranty_, WARRANTY_TYPE, SHEET } = sandbox.__api;

let pass = 0;
let fail = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) { pass++; return; }
  fail++;
  failures.push(name + (detail ? ' — ' + detail : ''));
}

/* ------------------------------------------------- serial number parsing */

check('XT serial parses to its assembly month',
  (function () {
    const p = parseSerial_('XT2305083');
    return p && p.family === 'XT' && p.year === 2023 && p.month === 5;
  })());

check('C serial reads its month letter (G = July)',
  (function () {
    const p = parseSerial_('C25GPA011');
    return p && p.family === 'C' && p.year === 2025 && p.month === 7;
  })());

check('C serial with a different product code still parses',
  (function () {
    const p = parseSerial_('C25IPC002');
    return p && p.family === 'C' && p.month === 9;
  })());

check('serial with an impossible month is rejected', parseSerial_('XT2313001') === null);
check('empty serial is rejected', parseSerial_('') === null);
check('nonsense is rejected', parseSerial_('hello') === null);

/* ----------------------------------------------------- warranty verdicts */

const may2026 = new Date(2026, 4, 15);
const xtActive = determineWarranty_('XT2410090', may2026);
check('XT2410090 is under principal warranty in May 2026',
  xtActive.type === WARRANTY_TYPE.PRINCIPAL, xtActive.type);
check('its expiry is Aug 2026 (Oct 2024 + 22 months)',
  xtActive.expiry === '2026-08', xtActive.expiry);
check('the basis is stated in full, not just the verdict',
  /assembled Oct 2024 \+ 22 months/.test(xtActive.basis), xtActive.basis);

const xtExpired = determineWarranty_('XT2305083', may2026);
check('XT2305083 expired in Mar 2025 and reads as out of warranty',
  xtExpired.type === WARRANTY_TYPE.OUT, xtExpired.type);

// A warranty running to a month covers the whole of that month.
check('cover lasts to the last day of the expiry month',
  determineWarranty_('XT2410090', new Date(2026, 7, 31, 23, 0)).type === WARRANTY_TYPE.PRINCIPAL);
check('and lapses the following day',
  determineWarranty_('XT2410090', new Date(2026, 8, 1, 1, 0)).type === WARRANTY_TYPE.OUT);

const local = determineWarranty_('C25GPA011', may2026);
check('locally assembled units are never decided automatically',
  local.type === WARRANTY_TYPE.MANUAL, local.type);
check('and say why, naming the assembly month',
  /Locally assembled/.test(local.basis) && /Jul 2025/.test(local.basis), local.basis);

const unknown = determineWarranty_('ZZ9999999', may2026);
check('an unknown prefix is referred to the administrator, not guessed',
  unknown.type === WARRANTY_TYPE.MANUAL, unknown.type);
check('an unreadable serial is referred as well',
  determineWarranty_('not-a-serial', may2026).type === WARRANTY_TYPE.MANUAL);

/* ------------------------------------------- the whole population on file */

const stats = { xt: 0, xtMatch: 0, c: 0, cManual: 0, other: 0, otherManual: 0 };
const mismatches = [];

units.forEach(function (u) {
  const w = determineWarranty_(u.sn, may2026);
  const parsed = parseSerial_(u.sn);

  if (parsed && parsed.family === 'XT') {
    stats.xt++;
    const m = /^(\d{1,2})\/(\d{4})$/.exec(u.expired);
    if (!m) return;
    const expected = m[2] + '-' + String(m[1]).padStart(2, '0');
    if (w.expiry === expected) stats.xtMatch++;
    else mismatches.push(u.sn + ': computed ' + w.expiry + ', sheet says ' + expected);
  } else if (parsed && parsed.family === 'C') {
    stats.c++;
    if (w.type === WARRANTY_TYPE.MANUAL) stats.cManual++;
  } else {
    stats.other++;
    if (w.type === WARRANTY_TYPE.MANUAL) stats.otherManual++;
  }
});

check('every XT unit on file is recognised', stats.xt === 1112, 'saw ' + stats.xt);
check('the 22 month rule reproduces the sheet for every one of them',
  stats.xtMatch === stats.xt, stats.xtMatch + ' of ' + stats.xt + ' matched');
check('every locally assembled unit is referred for manual checking',
  stats.c === 1497 && stats.cManual === 1497, stats.cManual + ' of ' + stats.c);

// XF2407094 is the lone oddity in the source data — a mistyped prefix. It is not
// claimed by the XT rule at all, which is the point: an unrecognised prefix goes
// to the administrator rather than being decided on a guess.
check('the one malformed serial on file is referred, not guessed at',
  stats.other === 1 && stats.otherManual === 1,
  stats.otherManual + ' of ' + stats.other);

/* ------------------------------------- the reference table wins on conflict */

sandbox.readAll_ = function (name) {
  if (name !== SHEET.WARRANTY) return [];
  return [{ Batch: 'XT2410090', Expired: '12/2026' }];
};
const overridden = determineWarranty_('XT2410090', may2026);
check('a table entry overrules the formula',
  overridden.expiry === '2026-12', overridden.expiry);
check('and the basis says so, quoting what the formula would have given',
  /warranty table exception/.test(overridden.basis) && /Aug 2026/.test(overridden.basis),
  overridden.basis);

/* ------------------------------------------------------------------ report */

console.log('');
console.log('  XT units          ' + stats.xt + ', formula matches the sheet on ' + stats.xtMatch +
  ' (' + (100 * stats.xtMatch / stats.xt).toFixed(2) + '%)');
console.log('  C units           ' + stats.c + ', all referred for manual checking: ' +
  (stats.c === stats.cManual));
console.log('  other formats     ' + stats.other + ', all referred: ' +
  (stats.other === stats.otherManual));
if (mismatches.length) {
  console.log('  disagreements with the sheet');
  mismatches.slice(0, 5).forEach(function (m) { console.log('    ' + m); });
}
console.log('');
console.log('  ' + pass + ' passed, ' + fail + ' failed');
failures.forEach(function (f) { console.log('    ✗ ' + f); });
console.log('');

process.exit(fail ? 1 : 0);
