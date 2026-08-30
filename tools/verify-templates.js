/**
 * verify-templates.js — checks the email template engine.
 *
 * These messages are the audit record, so two things have to hold: the renderer
 * must reproduce the data faithfully, and the guard must refuse to save a
 * template that has dropped the placeholders the record depends on.
 *
 *   node tools/verify-templates.js
 */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { console: console };
vm.createContext(sandbox);

const source = ['Config.gs', 'Mailer.gs']
  .map(function (file) { return fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8'); })
  .concat(['globalThis.__api = { renderTemplate_, missingPlaceholders_, escapeHtml_, ' +
    'defaultTemplate_, DEFAULT_TEMPLATES, TEMPLATE };'])
  .join('\n');
vm.runInContext(source, sandbox, { filename: 'template-engine' });

const { renderTemplate_, missingPlaceholders_, escapeHtml_, defaultTemplate_,
  DEFAULT_TEMPLATES, TEMPLATE } = sandbox.__api;

let pass = 0;
let fail = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) { pass++; return; }
  fail++;
  failures.push(name + (detail ? ' — ' + detail : ''));
}

/* ------------------------------------------------------------- rendering */

check('a plain placeholder is substituted',
  renderTemplate_('Claim {{ClaimID}}', { ClaimID: 'CLM-1' }) === 'Claim CLM-1');

check('an absent value renders as nothing rather than the literal token',
  renderTemplate_('Claim {{ClaimID}}', {}) === 'Claim ');

check('a section repeats once per row',
  renderTemplate_('{{#Items}}{{PartName}};{{/Items}}', {
    Items: [{ PartName: 'Mainboard' }, { PartName: 'Power supply' }]
  }) === 'Mainboard;Power supply;');

check('an empty section renders nothing',
  renderTemplate_('a{{#Items}}x{{/Items}}b', { Items: [] }) === 'ab');

check('a missing section renders nothing',
  renderTemplate_('a{{#Items}}x{{/Items}}b', {}) === 'ab');

check('sections nest one level, as the digest needs',
  renderTemplate_('{{#Claims}}{{ClaimID}}:{{#Items}}{{PartName}},{{/Items}}|{{/Claims}}', {
    Claims: [
      { ClaimID: 'A', Items: [{ PartName: 'p1' }, { PartName: 'p2' }] },
      { ClaimID: 'B', Items: [{ PartName: 'p3' }] }
    ]
  }) === 'A:p1,p2,|B:p3,|');

check('a zero quantity survives rather than vanishing',
  renderTemplate_('{{Qty}}', { Qty: 0 }) === '0');

check('text the user typed is not treated as markup',
  escapeHtml_('<script>alert(1)</script>') === '&lt;script&gt;alert(1)&lt;/script&gt;');

/* ----------------------------------------------- required placeholder guard */

const digest = defaultTemplate_(TEMPLATE.DAILY_DIGEST);

check('every built-in template satisfies its own requirements',
  DEFAULT_TEMPLATES.every(function (t) {
    return missingPlaceholders_(t.code, t.subject + '\n' + t.body).length === 0;
  }));

check('dropping a required placeholder is reported',
  missingPlaceholders_(TEMPLATE.DAILY_DIGEST, 'nothing useful here')
    .indexOf('{{ClaimID}}') !== -1);

check('the warranty basis is required on the digest — it is what an auditor checks',
  digest.required.indexOf('{{WarrantyBasis}}') !== -1);

check('a template keeping only some required tokens still fails',
  missingPlaceholders_(TEMPLATE.DAILY_DIGEST, '{{ClaimID}} {{RefNo}}').length === 1,
  JSON.stringify(missingPlaceholders_(TEMPLATE.DAILY_DIGEST, '{{ClaimID}} {{RefNo}}')));

check('the amendment template requires the change list, not just the claim id',
  defaultTemplate_(TEMPLATE.CLAIM_AMEND).required.indexOf('{{#Changes}}') !== -1);

check('all seven templates are defined', DEFAULT_TEMPLATES.length === 7,
  String(DEFAULT_TEMPLATES.length));

/* -------------------------------------- a realistic digest renders in full */

const rendered = renderTemplate_(digest.body, {
  RefNo: 'CW300826', ClaimCount: 2, PartCount: 3, VerifiedBy: 'admin@example.com',
  Claims: [
    { ClaimID: 'CLM-260826-0004', Customer: 'RSUD Koja', SerialNumber: 'XT2410090',
      WarrantyBasis: 'assembled Oct 2024 + 22 months = valid until Aug 2026',
      WorkOrder: 'WO-2608-0041', Problem: 'Machine does not power on',
      Items: [{ PartName: 'Electrical Mainboard', Qty: 1 }, { PartName: 'Power supply', Qty: 1 }] },
    { ClaimID: 'CLM-260826-0005', Customer: 'Mitra Kasih Cimahi', SerialNumber: 'XT2411194',
      WarrantyBasis: 'assembled Nov 2024 + 22 months = valid until Sep 2026',
      WorkOrder: 'WO-2608-0042', Problem: 'Blood pump alarm',
      Items: [{ PartName: 'Blood pump rotor', Qty: 2 }] }
  ]
});

check('both claims appear in the rendered digest',
  rendered.indexOf('CLM-260826-0004') !== -1 && rendered.indexOf('CLM-260826-0005') !== -1);
check('every part appears',
  rendered.indexOf('Electrical Mainboard') !== -1 &&
  rendered.indexOf('Power supply') !== -1 &&
  rendered.indexOf('Blood pump rotor') !== -1);
check('the warranty working is printed, not just the verdict',
  rendered.indexOf('assembled Oct 2024 + 22 months') !== -1);
check('no unresolved token is left in the output',
  rendered.indexOf('{{') === -1, rendered.slice(0, 160));

console.log('');
console.log('  ' + pass + ' passed, ' + fail + ' failed');
failures.forEach(function (f) { console.log('    ✗ ' + f); });
console.log('');

process.exit(fail ? 1 : 0);
