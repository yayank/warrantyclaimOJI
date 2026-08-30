/**
 * verify-payload.js — checks that nothing the browser cannot receive ever
 * leaves the API.
 *
 * google.script.run accepts primitives, arrays and plain objects. A Date
 * anywhere inside a return value fails the whole call, and the page is handed
 * null with no error to show — the claims list then dies on `data.rows` of
 * null, and every screen behind it is blank.
 *
 * That is not a hypothetical: the portal writes its timestamps as text like
 * "2026-08-30T11:53:50", which Sheets is entitled to store as a real date-time
 * and read back as a Date. So this puts a Claims sheet holding Dates behind the
 * real Repo.gs and Claims.gs and checks what listClaims_ would actually hand
 * over, and that timestamps still sort as text.
 *
 *   node tools/verify-payload.js
 */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ------------------------------------------------------ a fake spreadsheet */

function Sheet(name, grid) {
  this.name = name;
  this.grid = (grid || []).map(function (r) { return r.slice(); });
}
Sheet.prototype.getName = function () { return this.name; };
Sheet.prototype.getLastRow = function () { return this.grid.length; };
Sheet.prototype.getLastColumn = function () {
  return this.grid.reduce(function (w, r) { return Math.max(w, r.length); }, 0);
};
Sheet.prototype.getRange = function (row, col, numRows, numCols) {
  const s = this;
  const r0 = row - 1;
  const c0 = col - 1;
  const rows = numRows === undefined ? 1 : numRows;
  const cols = numCols === undefined ? 1 : numCols;
  return {
    getValues: function () {
      const out = [];
      for (let r = 0; r < rows; r++) {
        const line = [];
        for (let c = 0; c < cols; c++) {
          const v = (s.grid[r0 + r] || [])[c0 + c];
          line.push(v === undefined ? '' : v);
        }
        out.push(line);
      }
      return out;
    }
  };
};

function Book(sheets) { this.sheets = sheets; }
Book.prototype.getSheetByName = function (n) { return this.sheets[n] || null; };

/* ---------------------------------------------------------- loading the app */

function pad(n) { return (n < 10 ? '0' : '') + n; }

const sandbox = {
  console: console,
  SpreadsheetApp: { getActive: function () { return sandbox.__book; }, openById: function () { return sandbox.__book; } },
  PropertiesService: { getScriptProperties: function () { return { getProperty: function () { return ''; } }; } },
  CacheService: {
    getScriptCache: function () {
      return { get: function () { return null; }, put: function () {}, remove: function () {}, removeAll: function () {} };
    }
  },
  LockService: {
    getDocumentLock: function () {
      return { tryLock: function () { return true; }, releaseLock: function () {} };
    }
  },
  UrlFetchApp: { fetch: function () { throw new Error('not used'); } },
  MailApp: {}, DriveApp: {}, Drive: {}, HtmlService: {}, Session: {},
  Utilities: {
    // Only the one pattern the code under test asks for.
    formatDate: function (d, tz, fmt) {
      const iso = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
      if (fmt === 'yyyy-MM-dd') return iso;
      return iso + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }
  }
};
vm.createContext(sandbox);

// Dates for the fixture must come from inside the context. Apps Script has one
// realm, so `v instanceof Date` there is exactly this check; a Date built out
// here would fail it for a reason the real code never meets, and the test would
// pass or fail on nothing.
const SandboxDate = vm.runInContext('Date', sandbox);

const source = ['Config.gs', 'Repo.gs', 'Auth.gs', 'Warranty.gs', 'Claims.gs', 'Code.gs']
  .map(function (f) { return fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'); })
  .concat(['globalThis.__api = { listClaims_, jsonSafe_, readAll_, formatDate_ };'])
  .join('\n');
vm.runInContext(source, sandbox, { filename: 'payload' });

const { listClaims_, jsonSafe_, readAll_, formatDate_ } = sandbox.__api;

/* ------------------------------------------------------------------ fixture */

const CLAIM_HEAD = ['ClaimID', 'RefNo', 'IsTest', 'CustomerID', 'CustomerName',
  'SerialNumber', 'ProductName', 'AssemblyMonth', 'Principal',
  'WarrantyType', 'WarrantyExpiry', 'WarrantyBasis',
  'WarrantyOverridden', 'WarrantyOverrideReason',
  'ProblemDescription', 'WorkOrderNo', 'Status',
  'RequesterEmail', 'RequesterName',
  'CreatedAt', 'SubmittedAt', 'ForwardedAt', 'PrincipalNotifiedAt', 'ClosedAt',
  'ReturnReason', 'DriveFolderId',
  'Deleted', 'DeletedBy', 'DeletedAt',
  'UpdatedAt', 'UpdatedBy', 'RowVersion'];

const ITEM_HEAD = ['ItemID', 'ClaimID', 'PartID', 'PartName', 'Qty', 'ItemStatus',
  'AdvanceIssued', 'AdvanceIssuedAt', 'AdvanceIssuedBy', 'AdvanceNote',
  'DecisionBy', 'DecisionAt', 'DecisionReason',
  'AvailabilityDate', 'DocumentRefNo',
  'ForwardedAt', 'ForwardedTo', 'ShippedAt', 'ShippedBy',
  'PartReturnNote', 'PartReturnAt',
  'Deleted', 'UpdatedAt', 'UpdatedBy', 'RowVersion'];

function claimRow(id, createdAt, submittedAt, status) {
  const row = CLAIM_HEAD.map(function () { return ''; });
  const set = function (f, v) { row[CLAIM_HEAD.indexOf(f)] = v; };
  set('ClaimID', id);
  set('IsTest', true);
  set('CustomerID', 'CUS-001');
  set('CustomerName', 'RSUD Koja');
  set('SerialNumber', 'XT2410090');
  set('Status', status);
  set('RequesterEmail', 'tester@example.com');
  set('RequesterName', 'Tester');
  set('CreatedAt', createdAt);
  set('SubmittedAt', submittedAt);
  set('UpdatedAt', createdAt);
  set('RowVersion', 1);
  set('Deleted', false);
  return row;
}

function itemRow(id, claimId, availability) {
  const row = ITEM_HEAD.map(function () { return ''; });
  const set = function (f, v) { row[ITEM_HEAD.indexOf(f)] = v; };
  set('ItemID', id);
  set('ClaimID', claimId);
  set('PartID', 'PART-001');
  set('PartName', 'Blood pump rotor');
  set('Qty', 1);
  set('ItemStatus', 'Pending');
  set('AdvanceIssued', false);
  set('AvailabilityDate', availability);
  set('Deleted', false);
  set('RowVersion', 1);
  return row;
}

// The sheet as Sheets leaves it once it has decided the ISO timestamps this
// application wrote are date-times: real Date objects in the cells.
const D1 = new SandboxDate(2026, 7, 30, 11, 53, 50);
const D2 = new SandboxDate(2026, 7, 29, 8, 5, 0);

sandbox.__book = new Book({
  Claims: new Sheet('Claims', [
    CLAIM_HEAD,
    claimRow('TEST-260830-0001', D1, '', 'Draft'),
    claimRow('TEST-260829-0001', D2, D2, 'Submitted')
  ]),
  ClaimItems: new Sheet('ClaimItems', [
    ITEM_HEAD,
    itemRow('ITM-260830-0001-01', 'TEST-260830-0001', ''),
    itemRow('ITM-260829-0001-01', 'TEST-260829-0001', new SandboxDate(2026, 8, 15))
  ])
});

const session = {
  email: 'tester@example.com', name: 'Tester', role: 'Requester',
  actualRole: 'Tester', principal: '', isTester: true, simulatedRole: 'Requester'
};

/* -------------------------------------------------------------------- checks */

let pass = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

/** Every Date and non-finite number reachable from a value, by path. */
function offenders(value, at, found) {
  found = found || [];
  at = at || '$';
  if (value instanceof Date || value instanceof SandboxDate) {
    found.push(at + ' (Date)'); return found;
  }
  if (typeof value === 'number' && !isFinite(value)) { found.push(at + ' (' + value + ')'); return found; }
  if (Array.isArray(value)) {
    value.forEach(function (v, i) { offenders(v, at + '[' + i + ']', found); });
  } else if (value && typeof value === 'object') {
    Object.keys(value).forEach(function (k) { offenders(value[k], at + '.' + k, found); });
  }
  return found;
}

const raw = listClaims_(session, { tab: 'all' });
const sent = jsonSafe_(raw);

check('the fixture really does hold Dates, or this test proves nothing',
  sandbox.__book.getSheetByName('Claims').getRange(2, 20, 1, 1).getValues()[0][0] instanceof SandboxDate);

const leaked = offenders(raw);
check('reading a sheet never yields a Date, so the payload carries none',
  leaked.length === 0, leaked.join(', '));

check('the payload survives the boundary guard as well',
  offenders(sent).length === 0, offenders(sent).join(', '));

check('the payload is JSON, and survives the trip unchanged',
  JSON.stringify(sent) === JSON.stringify(JSON.parse(JSON.stringify(sent))));

check('a coerced timestamp still reads as the ISO text the rest of the code compares',
  sent.rows[0].createdAt === '2026-08-30T11:53:50', String(sent.rows[0].createdAt));

check('both claims are returned', sent.rows.length === 2, String(sent.rows.length));

check('newest first — timestamps still sort as text, not as "Sat Aug 30 2026"',
  sent.rows[0].claimId === 'TEST-260830-0001', sent.rows.map(function (r) { return r.claimId; }).join(', '));

check('a date-only cell is still shown as a plain date',
  sent.rows[1].items[0].availabilityDate === '2026-09-15',
  String(sent.rows[1].items[0].availabilityDate));

check('an empty date cell stays empty rather than becoming a date',
  sent.rows[0].items[0].availabilityDate === '', String(sent.rows[0].items[0].availabilityDate));

/* --------------------------------------------- the guard on its own account */

check('the guard converts a Date built in code',
  jsonSafe_({ at: new SandboxDate(2026, 7, 30, 11, 53, 50) }).at === '2026-08-30T11:53:50');

check('the guard turns NaN into null rather than losing the call',
  jsonSafe_({ n: NaN }).n === null);

check('the guard leaves ordinary values alone',
  JSON.stringify(jsonSafe_({ a: [1, 'x', true, null], b: { c: 0 } })) ===
  JSON.stringify({ a: [1, 'x', true, null], b: { c: 0 } }));

check('an invalid date does not become the string "Invalid Date"',
  jsonSafe_({ at: new SandboxDate('nonsense') }).at === '');

/* -------------------------------------------------------------------- report */

console.log('');
failures.forEach(function (f) { console.log('  ✗ ' + f); });
console.log('  ' + pass + ' passed, ' + failures.length + ' failed');
console.log('');
process.exit(failures.length ? 1 : 0);
