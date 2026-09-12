/**
 * measure-list.js — what one claims.list costs the spreadsheet.
 *
 * Counts the getValues calls and the cells behind them for a single call, so a
 * change to how the list is answered can be judged on a number rather than on
 * an argument. Run it before and after.
 *
 *   node tools/measure-list.js [claims] [items-per-claim]
 */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CLAIMS_N = Number(process.argv[2] || 412);
const PER_CLAIM = Number(process.argv[3] || 1.3);

let calls = 0;
let cells = 0;
const perSheet = {};

function Sheet(name, rows) {
  const s = {
    getName: function () { return name; },
    getLastRow: function () { return rows.length; },
    getLastColumn: function () { return rows[0].length; },
    getDataRange: function () { return s.getRange(1, 1, rows.length, rows[0].length); },
    getRange: function (r, c, nr, nc) {
      return {
        getValues: function () {
          calls++;
          cells += nr * nc;
          perSheet[name] = perSheet[name] || { calls: 0, cells: 0 };
          perSheet[name].calls++;
          perSheet[name].cells += nr * nc;
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = rows[r - 1 + i] || [];
            out.push(row.slice(c - 1, c - 1 + nc));
          }
          return out;
        },
        setValues: function () {},
        setValue: function () {}
      };
    }
  };
  return s;
}

const sandbox = {
  console: console,
  SpreadsheetApp: { getActive: function () { return book; }, openById: function () { return book; } },
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
  Utilities: { formatDate: function () { return '2026-09-12T00:00:00'; } }
};
vm.createContext(sandbox);
['Config.gs', 'Repo.gs', 'Auth.gs', 'Claims.gs'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'),
    sandbox, { filename: f });
});
vm.runInContext('globalThis.__api = { listClaims_, SCHEMA, SHEET, CLAIM_PAGE, summaryOf_ };',
  sandbox, { filename: 'exports' });
const api = sandbox.__api;

const CLAIM_COLS = api.SCHEMA[api.SHEET.CLAIMS];
const ITEM_COLS = api.SCHEMA[api.SHEET.ITEMS];

function rowOf(cols, values) {
  return cols.map(function (c) { return values[c] === undefined ? '' : values[c]; });
}

const claimRows = [CLAIM_COLS.slice()];
const itemRows = [ITEM_COLS.slice()];
let itemNo = 0;

for (let i = 0; i < CLAIMS_N; i++) {
  const id = 'CLM-' + (1000 + i);
  const items = [];
  const n = Math.max(1, Math.round(PER_CLAIM + (i % 3 === 0 ? 1 : 0) - (i % 3 === 0 ? 0.3 : 0.3)));
  for (let k = 0; k < n; k++) {
    itemNo++;
    const item = {
      ItemID: 'ITM-' + itemNo, ClaimID: id, PartID: 'P' + (k + 1),
      PartName: 'Blood Pump Rotor', Qty: 1,
      ItemStatus: i % 4 === 0 ? 'Pending' : i % 3 === 0 ? 'Shipped' : 'Approved',
      AdvanceIssued: i % 7 === 0, Deleted: false, RowVersion: 1
    };
    items.push(item);
    itemRows.push(rowOf(ITEM_COLS, item));
  }
  const summary = api.summaryOf_(items);
  claimRows.push(rowOf(CLAIM_COLS, Object.assign({
    ClaimID: id, RefNo: 'CW' + (i % 40), IsTest: false,
    CustomerID: 'C' + (i % 7), CustomerName: 'RSUD Kota ' + (i % 7),
    SerialNumber: 'XT24' + (100000 + i), ProductName: 'Sansin SWS-4000',
    Principal: 'Sansin', WarrantyType: 'Principal Warranty',
    Status: i % 4 === 0 ? 'In Review' : i % 3 === 0 ? 'In Fulfilment' : 'Submitted',
    RequesterEmail: 'rian@rs.co.id', RequesterName: 'Rian',
    CreatedAt: '2026-08-01T09:00:00', SubmittedAt: '2026-08-01T09:30:00',
    Deleted: false, UpdatedAt: '2026-08-01T09:30:00', RowVersion: 1
  }, summary)));
}

const SHEETS = { Claims: new Sheet('Claims', claimRows), ClaimItems: new Sheet('ClaimItems', itemRows) };
const book = { getSheetByName: function (n) { return SHEETS[n] || null; } };

const ADMIN = {
  email: 'sri@oji.co.id', role: 'Administrator', actualRole: 'Administrator',
  simulatedRole: null, isTester: false, principal: ''
};

function measure(label, filter) {
  calls = 0;
  cells = 0;
  Object.keys(perSheet).forEach(function (k) { delete perSheet[k]; });
  const t = process.hrtime.bigint();
  const out = api.listClaims_(ADMIN, filter);
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  const detail = Object.keys(perSheet).map(function (n) {
    return n + ' ' + perSheet[n].cells.toLocaleString() + ' cells';
  }).join(', ');
  console.log('  ' + label.padEnd(34) +
    String(calls).padStart(2) + ' getValues, ' +
    cells.toLocaleString().padStart(9) + ' cells, ' +
    ms.toFixed(1).padStart(6) + 'ms   (' + detail + ')');
  return out;
}

console.log('fixture: ' + CLAIMS_N + ' claims, ' + (itemRows.length - 1) + ' items\n');
const page = measure('one page, parts for the page',
  { tab: 'all', limit: api.CLAIM_PAGE, items: 'page' });
measure('one page, no parts at all',
  { tab: 'all', limit: api.CLAIM_PAGE, items: 'none' });
measure('In Progress, parts for the page',
  { tab: 'progress', limit: api.CLAIM_PAGE, items: 'page' });
measure('the orders screen (parts for all)', { tab: 'all' });
console.log('\n  the page carried ' + page.rows.length + ' claims of ' + page.total +
  ', with ' + page.rows.reduce(function (n, r) { return n + r.items.length; }, 0) + ' parts on it');
