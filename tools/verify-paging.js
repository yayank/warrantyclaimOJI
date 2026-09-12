/**
 * verify-paging.js — the claim list crosses a page at a time.
 *
 * Every claim the filter matched used to cross to the browser and be drawn,
 * however many there were. Only a page crosses now, and the screen says how
 * much of the set it is showing.
 *
 * The trap this guards is the Excel export, which runs through the same
 * listClaims_. A default page size would have quietly turned a report of four
 * hundred claims into a report of fifty that looked complete. So paging is
 * opt-in: a caller that does not ask still gets everything.
 *
 *   node tools/verify-paging.js
 */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ---------------------------------------------------------- the fixture */

const CLAIM_COLS = ['ClaimID', 'RefNo', 'IsTest', 'CustomerID', 'CustomerName',
  'SerialNumber', 'ProductName', 'AssemblyMonth', 'Principal', 'WarrantyType',
  'WarrantyExpiry', 'WarrantyBasis', 'WarrantyOverridden', 'WarrantyOverrideReason',
  'ProblemDescription', 'WorkOrderNo', 'Status', 'RequesterEmail', 'RequesterName',
  'CreatedAt', 'SubmittedAt', 'ForwardedAt', 'PrincipalNotifiedAt', 'ClosedAt'];

const ITEM_COLS = ['ItemID', 'ClaimID', 'PartID', 'PartName', 'Qty', 'ItemStatus',
  'AdvanceIssued', 'AdvanceIssuedAt', 'AdvanceIssuedBy', 'AdvanceNote', 'DecisionBy',
  'DecisionAt', 'DecisionReason', 'AvailabilityDate', 'DocumentRefNo', 'FulfilmentRoute',
  'ForwardedAt', 'ForwardedTo', 'ShippedAt', 'ShippedBy', 'PartReturnNote', 'PartReturnAt',
  'Deleted', 'UpdatedAt', 'UpdatedBy', 'RowVersion'];

const TOTAL = 412;
const CLAIMS = [CLAIM_COLS];
const ITEMS = [ITEM_COLS];

function col(cols, values) {
  return cols.map(function (c) { return values[c] === undefined ? '' : values[c]; });
}

for (let i = 0; i < TOTAL; i++) {
  const id = 'CLM-' + String(1000 + i);
  // Dates descend, so claim 0 is newest and the first page is the newest fifty.
  const day = String(28 - (i % 28) || 28).padStart(2, '0');
  CLAIMS.push(col(CLAIM_COLS, {
    ClaimID: id, RefNo: 'CW' + (i % 40), IsTest: 'FALSE',
    CustomerID: 'C' + (i % 7), CustomerName: 'RSUD Kota ' + (i % 7),
    SerialNumber: 'XT24' + (100000 + i), ProductName: 'Sansin SWS-4000',
    Principal: 'Sansin', WarrantyType: 'Principal Warranty',
    Status: i % 4 === 0 ? 'Draft' : i % 3 === 0 ? 'Closed' : 'In Fulfilment',
    RequesterEmail: 'rian@rs.co.id', RequesterName: 'Rian',
    CreatedAt: '2026-08-' + day + 'T09:00:00',
    SubmittedAt: '2026-08-' + day + 'T09:0' + (i % 10) + ':00'
  }));
  ITEMS.push(col(ITEM_COLS, {
    ItemID: 'I' + i, ClaimID: id, PartID: 'P1', PartName: 'Blood Pump Rotor',
    Qty: 1, ItemStatus: 'Approved', Deleted: 'FALSE', RowVersion: 1
  }));
}

const SHEETS = { Claims: CLAIMS, ClaimItems: ITEMS };

function Sheet(name, rows) {
  return {
    getName: function () { return name; },
    getLastRow: function () { return rows.length; },
    getLastColumn: function () { return rows[0].length; },
    getDataRange: function () { return { getValues: function () { return rows; } }; },
    getRange: function () { return { getValues: function () { return rows; } }; }
  };
}

const book = {
  getSheetByName: function (n) { return SHEETS[n] ? new Sheet(n, SHEETS[n]) : null; }
};

const store = {};
const sandbox = {
  console: console,
  SpreadsheetApp: { getActive: function () { return book; }, openById: function () { return book; } },
  PropertiesService: {
    getScriptProperties: function () { return { getProperty: function () { return ''; } }; }
  },
  CacheService: {
    getScriptCache: function () {
      return {
        get: function (k) { return store[k] === undefined ? null : store[k]; },
        put: function (k, v) { store[k] = v; },
        remove: function (k) { delete store[k]; }
      };
    }
  },
  LockService: {
    getDocumentLock: function () {
      return { tryLock: function () { return true; }, releaseLock: function () {} };
    }
  },
  Utilities: { formatDate: function () { return '2026-09-12T00:00:00'; } }
};
vm.createContext(sandbox);
['Config.gs', 'Repo.gs', 'Auth.gs', 'Visits.gs', 'Claims.gs'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'),
    sandbox, { filename: f });
});
vm.runInContext('globalThis.__api = { listClaims_, CLAIM_PAGE, CLAIM_PAGE_MAX };',
  sandbox, { filename: 'exports' });

const { listClaims_, CLAIM_PAGE, CLAIM_PAGE_MAX } = sandbox.__api;
const REQ = { role: 'Requester', email: 'rian@rs.co.id', isTester: false, principal: '' };

let pass = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

/* --------------------------------------- a caller that does not ask for a page */

const everything = listClaims_(REQ, { tab: 'all' });
check('a caller that asks for no page still gets the whole set',
  everything.rows.length === TOTAL, 'got ' + everything.rows.length + ' of ' + TOTAL);

check('and is told the total, which is the same number',
  everything.total === TOTAL, 'total ' + everything.total);

/* ------------------------------------------------------------ one page of it */

const first = listClaims_(REQ, { tab: 'all', limit: CLAIM_PAGE });
check('asking for a page gets exactly that many',
  first.rows.length === CLAIM_PAGE, 'got ' + first.rows.length);

check('but the total still counts everything the filter matched',
  first.total === TOTAL, 'total ' + first.total);

check('the page is the newest claims, not an arbitrary slice',
  first.rows[0].claimId === everything.rows[0].claimId);

/* ------------------------------------------- walking it, without gaps or repeats */

const walked = [];
for (let off = 0; off < TOTAL; off += CLAIM_PAGE) {
  listClaims_(REQ, { tab: 'all', limit: CLAIM_PAGE, offset: off })
    .rows.forEach(function (r) { walked.push(r.claimId); });
}
check('walking the offsets returns every claim exactly once',
  walked.length === TOTAL && new Set(walked).size === TOTAL,
  walked.length + ' rows, ' + new Set(walked).size + ' distinct');

check('and in the same order as the unpaged list',
  walked.join(',') === everything.rows.map(function (r) { return r.claimId; }).join(','));

check('an offset past the end answers empty rather than wrapping round',
  listClaims_(REQ, { tab: 'all', limit: CLAIM_PAGE, offset: 10000 }).rows.length === 0);

check('a negative offset is read as the beginning',
  listClaims_(REQ, { tab: 'all', limit: 5, offset: -20 }).rows[0].claimId ===
  everything.rows[0].claimId);

/* -------------------------------------------------------- what a page may ask */

check('a limit beyond the ceiling is capped',
  listClaims_(REQ, { tab: 'all', limit: 99999 }).rows.length === CLAIM_PAGE_MAX,
  'got ' + listClaims_(REQ, { tab: 'all', limit: 99999 }).rows.length);

/* ------------------------------- the badges count the set, never the page */

check('the Needs Action badge counts the whole set, not what is on screen',
  first.counts.action === everything.counts.action,
  first.counts.action + ' vs ' + everything.counts.action);

/* --------------------------------- a filter narrows before the page is cut */

const closed = listClaims_(REQ, { tab: 'all', statuses: ['Closed'], limit: CLAIM_PAGE });
const closedAll = listClaims_(REQ, { tab: 'all', statuses: ['Closed'] });
check('a filtered total is the filtered set, not everything',
  closed.total === closedAll.rows.length && closed.total < TOTAL,
  closed.total + ' of ' + TOTAL);
check('and every row on the page satisfies the filter',
  closed.rows.every(function (r) { return r.status === 'Closed'; }));

// The badge answers "how much is waiting on me", which does not change because
// somebody narrowed the list they are looking at. Counting the filtered rows
// would make it drop to zero the moment a filter excluded the drafts.
check('the fixture has claims that need action, or the next check proves nothing',
  everything.counts.action > 0, 'action ' + everything.counts.action);

check('the badge ignores the filter',
  closed.counts.action === everything.counts.action,
  'filtered ' + closed.counts.action + ' vs ' + everything.counts.action);

check('and ignores the page',
  listClaims_(REQ, { tab: 'all', limit: 5, offset: 300 }).counts.action ===
  everything.counts.action);

/* ------------------------------------------------ the export is never a page */

// Not read off the source but run: the real exportClaims_, handed the filter the
// screen would be holding on page three, with just enough of Drive stubbed to
// let it finish and report how many rows it wrote.
let written = 0;
const sheetStub = {
  setName: function () {}, setFrozenRows: function () {},
  // Count what was actually written, not what getRange was asked for: it is
  // called a second time to embolden the header row.
  getRange: function () {
    return {
      setValues: function (v) { written = v.length; },
      setFontWeight: function () {}
    };
  }
};
Object.assign(sandbox, {
  SpreadsheetApp: Object.assign({}, sandbox.SpreadsheetApp, {
    create: function () {
      return { getSheets: function () { return [sheetStub]; }, getId: function () { return 'tmp'; } };
    },
    flush: function () {}
  }),
  UrlFetchApp: {
    fetch: function () {
      return { getBlob: function () { return { setName: function () { return {}; } }; } };
    }
  },
  ScriptApp: { getOAuthToken: function () { return 'token'; } },
  DriveApp: {
    Access: { ANYONE_WITH_LINK: 1 }, Permission: { VIEW: 1 },
    getFileById: function () { return { setTrashed: function () {} }; }
  }
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'Export.gs'), 'utf8'),
  sandbox, { filename: 'Export.gs' });
// Files.gs is not loaded; the export only wants somewhere to drop the file.
vm.runInContext(
  'function rootFolder_() { return {}; }\n' +
  'function childFolder_() { return { createFile: function () { return {' +
  '  getName: function () { return "x.xlsx"; }, getUrl: function () { return "u"; },' +
  '  setSharing: function () {} }; } }; }\n' +
  'globalThis.__exportClaims_ = exportClaims_;', sandbox, { filename: 'drive-stub' });

const report = sandbox.__exportClaims_(REQ, { tab: 'all', limit: CLAIM_PAGE, offset: 100 });
check('an export taken while looking at page three still writes every claim',
  report.rows === TOTAL, 'wrote ' + report.rows + ' of ' + TOTAL);
check('and the sheet it filled was that many rows plus its header',
  written === TOTAL + 1, 'wrote ' + written + ' rows');

/* -------------------------------------------------------------------- report */

console.log('verify-paging: ' + pass + ' checks passed' +
  (failures.length ? ', ' + failures.length + ' FAILED' : ''));
failures.forEach(function (f) { console.log('  FAIL  ' + f); });
process.exit(failures.length ? 1 : 0);
