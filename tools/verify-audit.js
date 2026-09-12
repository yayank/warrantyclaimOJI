/**
 * verify-audit.js — the trail moves aside without ever losing a line.
 *
 * Two things are checked here, both of which fail quietly if they are wrong.
 *
 * The audit sheet grew forever, so a finished year is moved to a sheet of its
 * own. That move is the dangerous part: this is the document the business
 * falls back on when a claim is disputed, and a row dropped between the copy
 * and the delete would never be noticed. So the archive is written first and
 * the working sheet trimmed second, and the run is proved safe to repeat —
 * including from the half-finished state a crash would leave.
 *
 * And an attachment had no size limit at all, so a 12MB photo straight off a
 * phone went into Drive as it stood. It is refused in the browser for speed
 * and on the server because that is the one that binds; both are checked here,
 * against the same number.
 *
 *   node tools/verify-audit.js
 */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

/* ------------------------------------------------ a spreadsheet that writes */

const AUDIT_COLS = ['LogID', 'Timestamp', 'Actor', 'ActorRole', 'SimulatedRole',
  'ClaimID', 'ItemID', 'Action', 'Field', 'OldValue', 'NewValue', 'Reason', 'IsTest'];

const SEP = String.fromCharCode(0);

function Sheet(name, rows) {
  const s = {
    rows: rows,
    getName: function () { return name; },
    getLastRow: function () { return s.rows.length; },
    getLastColumn: function () { return s.rows.length ? s.rows[0].length : 0; },
    setFrozenRows: function () {},
    appendRow: function (row) { s.rows.push(row.slice()); },
    deleteRows: function (start, count) { s.rows.splice(start - 1, count); },
    getDataRange: function () { return s.getRange(1, 1, s.rows.length, s.getLastColumn()); },
    getRange: function (r, c, nr, nc) {
      return {
        getValues: function () {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = s.rows[r - 1 + i] || [];
            const line = [];
            for (let j = 0; j < nc; j++) {
              line.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]);
            }
            out.push(line);
          }
          return out;
        },
        setValues: function (values) {
          values.forEach(function (line, i) {
            const at = r - 1 + i;
            if (!s.rows[at]) s.rows[at] = [];
            line.forEach(function (v, j) { s.rows[at][c - 1 + j] = v; });
          });
        },
        setFontWeight: function () {}
      };
    }
  };
  return s;
}

let SHEETS = {};
const book = {
  getSheetByName: function (n) { return SHEETS[n] || null; },
  getSheets: function () { return Object.keys(SHEETS).map(function (n) { return SHEETS[n]; }); },
  insertSheet: function (n) { SHEETS[n] = new Sheet(n, []); return SHEETS[n]; },
  getId: function () { return 'book'; }
};

/* -------------------------------------------------------------- the fixture */

// Pinned, so "the current year" does not depend on when the suite is run and a
// checked-in expectation does not start failing on a January morning.
const NOW = new Date('2026-09-12T08:00:00Z');

function pad(n, w) { return String(n).padStart(w, '0'); }

function auditRow(logId, stamp, claimId, extra) {
  const o = Object.assign({
    LogID: logId, Timestamp: stamp, Actor: 'sri@oji.co.id', ActorRole: 'Administrator',
    SimulatedRole: '', ClaimID: claimId, ItemID: '', Action: 'claim.update',
    Field: 'Status', OldValue: 'Draft', NewValue: 'In Review', Reason: '', IsTest: false
  }, extra || {});
  return AUDIT_COLS.map(function (h) { return o[h]; });
}

const PLAN = { 2024: 30, 2025: 40, 2026: 20 };

function buildFixture() {
  const rows = [AUDIT_COLS.slice()];
  Object.keys(PLAN).forEach(function (year) {
    for (let i = 0; i < PLAN[year]; i++) {
      const month = pad((i % 12) + 1, 2);
      rows.push(auditRow('LOG-' + year + '-' + pad(i, 4),
        year + '-' + month + '-05T09:' + pad(i % 60, 2) + ':00',
        'CLM-' + year + '-' + (i % 5)));
    }
  });

  // Two entries from before the LogID column was filled, written in the same
  // second with the same content. They are two events, not one, and a dedupe
  // that reasoned by content alone would archive one and drop the other.
  rows.push(auditRow('', '2025-03-01T07:00:00', 'CLM-OLD'));
  rows.push(auditRow('', '2025-03-01T07:00:00', 'CLM-OLD'));

  // A claim worked across the new year: half its trail archives, half stays.
  rows.push(auditRow('LOG-SPAN-1', '2025-12-30T16:00:00', 'CLM-SPAN'));
  rows.push(auditRow('LOG-SPAN-2', '2026-01-04T08:00:00', 'CLM-SPAN',
    { OldValue: 'In Review', NewValue: 'Closed' }));

  SHEETS = {
    AuditLog: new Sheet('AuditLog', rows),
    // Empty, but present: the attachment checks below need somewhere for the
    // claim lookup to come back from, and coming back with nothing is the point.
    Claims: new Sheet('Claims', [['ClaimID', 'Status', 'RequesterEmail', 'IsTest']])
  };
}

const TOTAL = PLAN[2024] + PLAN[2025] + PLAN[2026] + 4;

/* ---------------------------------------------------- the script, as it runs */

const sandbox = {
  console: console,
  SpreadsheetApp: {
    getActive: function () { return book; },
    openById: function () { return book; },
    flush: function () {}
  },
  PropertiesService: {
    getScriptProperties: function () { return { getProperty: function () { return ''; } }; }
  },
  CacheService: {
    getScriptCache: function () {
      return { get: function () { return null; }, put: function () {}, remove: function () {} };
    }
  },
  LockService: {
    getDocumentLock: function () {
      return { tryLock: function () { return true; }, releaseLock: function () {} };
    }
  },
  Utilities: {
    formatDate: function (date, tz, fmt) {
      const d = date instanceof Date ? date : NOW;
      const y = d.getUTCFullYear();
      if (fmt === 'yyyy') return String(y);
      if (fmt === 'yyMMdd') {
        return String(y).slice(2) + pad(d.getUTCMonth() + 1, 2) + pad(d.getUTCDate(), 2);
      }
      return y + '-' + pad(d.getUTCMonth() + 1, 2) + '-' + pad(d.getUTCDate(), 2) +
        'T' + pad(d.getUTCHours(), 2) + ':' + pad(d.getUTCMinutes(), 2) +
        ':' + pad(d.getUTCSeconds(), 2);
    }
  }
};
// Everything that asks what year it is gets the pinned one.
sandbox.Date = function (a, b, c, d, e, f, g) {
  if (!(this instanceof sandbox.Date)) return new Date(NOW).toString();
  return arguments.length ? new Date(a, b, c, d, e, f, g) : new Date(NOW);
};
sandbox.Date.now = function () { return NOW.getTime(); };
sandbox.Date.prototype = Date.prototype;

vm.createContext(sandbox);
['Config.gs', 'Repo.gs', 'Auth.gs', 'Claims.gs', 'Audit.gs'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'),
    sandbox, { filename: f });
});
vm.runInContext('globalThis.__api = { archiveAudit_, listAudit_, auditForClaim_, ' +
  'auditYears_, uploadAttachment_, base64Bytes_, MAX_UPLOAD_BYTES };',
  sandbox, { filename: 'exports' });

const api = sandbox.__api;
const ADMIN = {
  email: 'sri@oji.co.id', role: 'Administrator', actualRole: 'Administrator',
  simulatedRole: null, isTester: false, principal: ''
};

/* ------------------------------------- what is on the sheets, as a multiset */

/** Every audit line the spreadsheet holds anywhere, as comparable strings. */
function everyLine() {
  const out = [];
  Object.keys(SHEETS).forEach(function (name) {
    if (name !== 'AuditLog' && name.indexOf('AuditLog-') !== 0) return;
    const rows = SHEETS[name].rows;
    for (let i = 1; i < rows.length; i++) out.push(rows[i].join(SEP));
  });
  return out.sort();
}

function countIn(name) {
  return SHEETS[name] ? Math.max(0, SHEETS[name].rows.length - 1) : 0;
}

buildFixture();
const ORIGINAL = everyLine();
check('the fixture is the size the rest of this file assumes',
  ORIGINAL.length === TOTAL, ORIGINAL.length + ' of ' + TOTAL);

/* -------------------------------------- before the trigger has ever run */

const beforeAll = api.listAudit_(ADMIN, { limit: 500 });
check('the screen opens on the current year',
  beforeAll.year === '2026', 'year ' + beforeAll.year);
check('and shows only that year, though the older rows are still on the same sheet',
  beforeAll.total === PLAN[2026] + 1, 'total ' + beforeAll.total);
check('a year still awaiting the move is offered all the same',
  beforeAll.years.join(',') === '2026,2025,2024', beforeAll.years.join(','));
check('and can be read before it has been moved',
  api.listAudit_(ADMIN, { year: '2024', limit: 500 }).total === PLAN[2024],
  'got ' + api.listAudit_(ADMIN, { year: '2024', limit: 500 }).total);

/* --------------------------------------------------------- the move itself */

const first = api.archiveAudit_();
check('the run reports what it moved',
  first.moved === PLAN[2024] + PLAN[2025] + 3, 'moved ' + first.moved);

check('the working sheet is left holding the current year alone',
  countIn('AuditLog') === PLAN[2026] + 1, 'AuditLog holds ' + countIn('AuditLog'));
check('2024 went to its own sheet', countIn('AuditLog-2024') === PLAN[2024],
  'holds ' + countIn('AuditLog-2024'));
check('2025 went to its own sheet', countIn('AuditLog-2025') === PLAN[2025] + 3,
  'holds ' + countIn('AuditLog-2025'));

// The check the whole exercise exists for.
check('not one line was lost, and not one was invented',
  everyLine().join('|') === ORIGINAL.join('|'),
  everyLine().length + ' lines afterwards against ' + ORIGINAL.length + ' before');

check('the two identical entries from before LogID both survived',
  everyLine().filter(function (l) { return l.indexOf('CLM-OLD') !== -1; }).length === 2,
  'found ' + everyLine().filter(function (l) { return l.indexOf('CLM-OLD') !== -1; }).length);

/* ------------------------------------------------------------ run it twice */

const second = api.archiveAudit_();
check('a second run finds nothing left to move', second.moved === 0, 'moved ' + second.moved);
check('and the sheets are untouched by it',
  everyLine().join('|') === ORIGINAL.join('|'),
  everyLine().length + ' lines after the second run');

/* ----------------------------- the state a crash between copy and delete leaves */

// The rows reached the archive and the delete never happened. Put the sheet
// back into exactly that state and run again: the archive must not gain a
// second copy, and the working sheet must end up clean.
const archived2025 = SHEETS['AuditLog-2025'].rows.slice(1);
archived2025.forEach(function (r) { SHEETS.AuditLog.rows.push(r.slice()); });
check('the half-finished state is set up as intended',
  everyLine().length === ORIGINAL.length + archived2025.length,
  everyLine().length + ' lines');

const third = api.archiveAudit_();
check('the interrupted run is finished off', third.moved === archived2025.length,
  'moved ' + third.moved);
check('without duplicating a single line into the archive',
  everyLine().join('|') === ORIGINAL.join('|'),
  everyLine().length + ' lines against ' + ORIGINAL.length);

/* -------------------- a half-made copy of a line that was written twice over */

// One of the two identical entries reached the archive and both are still on
// the working sheet. Whether the archived one is one of these two or a third
// event that read the same cannot be known from the sheet, so the safe reading
// is that one of them is still to be moved. Calling them "already there"
// because something matching is on the archive leaves the trail an entry short.
const twins = SHEETS['AuditLog-2025'].rows.filter(function (r) {
  return r.join(SEP).indexOf('CLM-OLD') !== -1;
});
check('the fixture still has the pair to work with', twins.length === 2,
  'found ' + twins.length);
SHEETS['AuditLog-2025'].rows.splice(SHEETS['AuditLog-2025'].rows.indexOf(twins[0]), 1);
twins.forEach(function (r) { SHEETS.AuditLog.rows.push(r.slice()); });

api.archiveAudit_();
check('the entry the interrupted copy did not reach is moved, not written off',
  everyLine().filter(function (l) { return l.indexOf('CLM-OLD') !== -1; }).length === 2,
  'the pair now numbers ' +
  everyLine().filter(function (l) { return l.indexOf('CLM-OLD') !== -1; }).length);
check('leaving the trail exactly as it started',
  everyLine().join('|') === ORIGINAL.join('|'),
  everyLine().length + ' lines against ' + ORIGINAL.length);

/* ------------------------------------------------ reading it back afterwards */

const y2024 = api.listAudit_(ADMIN, { year: '2024', limit: 500 });
check('an archived year reads back whole', y2024.total === PLAN[2024], 'total ' + y2024.total);
check('and every row in it belongs to that year',
  y2024.rows.every(function (r) { return String(r.timestamp).substring(0, 4) === '2024'; }));

check('the current year is unaffected',
  api.listAudit_(ADMIN, { year: '2026', limit: 500 }).total === PLAN[2026] + 1);

check('an unknown year falls back to the current one rather than showing nothing',
  api.listAudit_(ADMIN, { year: '1999', limit: 500 }).year === '2026');

check('the years on offer still cover the archives',
  api.auditYears_().join(',') === '2026,2025,2024', api.auditYears_().join(','));

const span = api.auditForClaim_('CLM-SPAN');
check('a claim worked across the new year still shows both halves of its trail',
  span.length === 2, 'got ' + span.length);
check('newest first, as the panel draws it',
  span.length === 2 && span[0].timestamp > span[1].timestamp);

check('and a filter still narrows within a year',
  api.listAudit_(ADMIN, { year: '2024', claimId: 'CLM-2024-1', limit: 500 }).total ===
  api.listAudit_(ADMIN, { year: '2024', limit: 500 })
    .rows.filter(function (r) { return r.claimId === 'CLM-2024-1'; }).length);

/* --------------------------------------------------- the attachment limit */

const MB = 1048576;
check('the server limit is the ten megabytes the screens promise',
  api.MAX_UPLOAD_BYTES === 10 * MB, 'limit ' + api.MAX_UPLOAD_BYTES);

/** base64 whose decoded size is the number asked for, to within a character. */
function payloadOf(bytes) { return 'A'.repeat(Math.ceil(bytes / 3) * 4); }

check('base64 is measured by what it decodes to, not by its own length',
  api.base64Bytes_(payloadOf(3 * MB)) >= 3 * MB &&
  api.base64Bytes_(payloadOf(3 * MB)) < 3 * MB + 4,
  'read ' + api.base64Bytes_(payloadOf(3 * MB)) + ' bytes');
check('and padding is not counted as content',
  api.base64Bytes_('AAAA') === 3 && api.base64Bytes_('AAA=') === 2 &&
  api.base64Bytes_('AA==') === 1 && api.base64Bytes_('') === 0);

let refused = '';
try {
  api.uploadAttachment_(ADMIN, {
    claimId: 'CLM-1', kind: 'FAULT', fileName: 'IMG_20260912.jpg',
    data: payloadOf(12 * MB), mimeType: 'image/jpeg'
  });
} catch (e) { refused = String(e.message || e); }

check('a twelve megabyte photo is refused for its size, not for something else',
  refused !== '' && refused !== 'Claim not found.', refused || 'nothing was thrown');
check('by name, so the person knows which file to replace',
  refused.indexOf('IMG_20260912.jpg') !== -1, refused);
check('with its size and the limit, so the message is actionable',
  /12\.0MB/.test(refused) && /10MB/.test(refused), refused);

// Under the limit the guard must let the call through to the work it guards.
// The claim does not exist, so reaching a different complaint is the proof.
let allowed = '';
try {
  api.uploadAttachment_(ADMIN, {
    claimId: 'CLM-NONE', kind: 'FAULT', fileName: 'small.jpg',
    data: payloadOf(2 * MB), mimeType: 'image/jpeg'
  });
} catch (e) { allowed = String(e.message || e); }
check('a two megabyte photo is not stopped by the size guard',
  allowed === 'Claim not found.', allowed);

/* ------------------------------------------ and the browser's own check */

const clientBox = {
  console: console,
  document: {
    getElementById: function () {
      return {
        innerHTML: '', hidden: false, children: [], value: '',
        addEventListener: function () {}, querySelectorAll: function () { return []; }
      };
    },
    createElement: function (tag) {
      if (tag === 'canvas') {
        return {
          width: 0, height: 0,
          getContext: function () { return { drawImage: function () {} }; },
          // Whatever it is handed, the JPEG that comes back is still over the
          // limit: a very large scan does not always shrink below it.
          toDataURL: function () {
            return 'data:image/jpeg;base64,' + 'A'.repeat(16 * MB);
          }
        };
      }
      return {
        dataset: {}, children: [], style: {},
        appendChild: function () {}, addEventListener: function () {}
      };
    },
    body: { appendChild: function () {} },
    querySelectorAll: function () { return []; },
    addEventListener: function () {}
  },
  window: { APP_CLIENT_ID: 'stub.apps.googleusercontent.com' },
  google: { script: { run: {} } },
  setTimeout: setTimeout,
  clearTimeout: clearTimeout
};
clientBox.FileReader = function () {
  const r = this;
  r.readAsDataURL = function (file) {
    r.result = 'data:' + (file.type || 'application/octet-stream') + ';base64,' +
      'A'.repeat(Math.ceil(file.size / 3) * 4);
    r.onload();
  };
};
clientBox.Image = function () {
  const img = this;
  img.width = 4000;
  img.height = 3000;
  Object.defineProperty(img, 'src', { set: function () { img.onload(); } });
};
vm.createContext(clientBox);
const clientSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'Script.html'), 'utf8')
  .replace(/^[\s\S]*?<script>/, '')
  .replace(/<\/script>\s*$/, '');
vm.runInContext(clientSrc +
  '\nglobalThis.__client = { prepareFile, base64Bytes, MAX_UPLOAD_BYTES, MAX_IMPORT_BYTES };',
  clientBox, { filename: 'client' });
const client = clientBox.__client;

check('the browser is working to the same limit as the server',
  client.MAX_UPLOAD_BYTES === api.MAX_UPLOAD_BYTES,
  client.MAX_UPLOAD_BYTES + ' against ' + api.MAX_UPLOAD_BYTES);

check('and measures base64 the same way',
  client.base64Bytes(payloadOf(5 * MB)) === api.base64Bytes_(payloadOf(5 * MB)));

const results = {};
function attempt(label, file, maxBytes) {
  return client.prepareFile(file, null, maxBytes)
    .then(function () { results[label] = ['accepted', '']; })
    .catch(function (e) { results[label] = ['refused', String(e.message || e)]; });
}

Promise.all([
  attempt('big-pdf', { name: 'scan.pdf', type: 'application/pdf', size: 12 * MB }),
  attempt('small-pdf', { name: 'note.pdf', type: 'application/pdf', size: 2 * MB }),
  attempt('big-photo', { name: 'IMG_9001.jpg', type: 'image/jpeg', size: 14 * MB }),
  attempt('workbook', {
    name: 'population.xlsx', size: 18 * MB,
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }, client.MAX_IMPORT_BYTES)
]).then(function () {
  check('the browser refuses an oversized document before it reads it',
    results['big-pdf'][0] === 'refused', results['big-pdf'][1]);
  check('naming the file and its size',
    /scan\.pdf/.test(results['big-pdf'][1]) && /12/.test(results['big-pdf'][1]),
    results['big-pdf'][1]);

  check('a document under the limit goes through',
    results['small-pdf'][0] === 'accepted', results['small-pdf'][1]);

  // The one a check on file.size alone would miss: a photo is resized before it
  // is sent, so the only size that matters is the one it ends up at.
  check('a photo still over the limit after resizing is refused',
    results['big-photo'][0] === 'refused', results['big-photo'][1]);
  check('and named, though resizing had renamed it',
    /IMG_9001/.test(results['big-photo'][1]), results['big-photo'][1]);

  // The principal's workbook comes through the same reader and is legitimately
  // larger than any attachment; the attachment limit must not reach it.
  check('the unit import is not held to the attachment limit',
    results['workbook'][0] === 'accepted', results['workbook'][1]);

  console.log('verify-audit: ' + pass + ' checks passed' +
    (failures.length ? ', ' + failures.length + ' FAILED' : ''));
  failures.forEach(function (f) { console.log('  FAIL  ' + f); });
  process.exit(failures.length ? 1 : 0);
});
