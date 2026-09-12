/**
 * verify-search.js — the customer and unit lists are searched, not shipped.
 *
 * Signing in used to hand the browser every active customer — 1.386 of them —
 * and opening the claim form fetched every registered unit, a few thousand
 * serial numbers, once per session. Both crossed whether the screen named a
 * customer or a unit or not.
 *
 * They are searched on the server now, a page at a time. This runs the real
 * searchCustomers_, searchUnits_ and referenceData_ against a stubbed
 * spreadsheet, and measures what sign-in actually carries.
 *
 *   node tools/verify-search.js
 */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ---------------------------------------------------------- the fixture */

const CUSTOMERS = [['CustomerID', 'Name', 'Active']];
for (let i = 0; i < 1386; i++) {
  CUSTOMERS.push(['C' + i, 'RSUD Kota ' + String(i).padStart(4, '0'), 'TRUE']);
}
// Names worth searching for by hand, plus one that must never reach a requester.
CUSTOMERS.push(['C9001', 'RS TK. II M. Ridwan Meuraksa - Jakarta', 'TRUE']);
CUSTOMERS.push(['C9002', 'RS Advent Bandung', 'TRUE']);
CUSTOMERS.push(['C9003', 'RSUD Koja', 'FALSE']);          // inactive
CUSTOMERS.push(['C9004', 'Internal — Production', 'TRUE']);

const POPULATION = [['Delivery', 'SellingInDate', 'Material', 'ItemDescription', 'Batch',
  'DeliveryQuantity', 'ShipToParty', 'Principal']];
const WARRANTY = [['SellingInDate', 'Material', 'Batch', 'Status', 'exp', 'Expired']];
for (let i = 0; i < 2610; i++) {
  const sn = (i % 2 ? 'XT24' : 'XT23') + String(100000 + i);
  POPULATION.push(['DEL' + i, '2024-10-01', 'MAT-' + i,
    'Sansin SWS-4000 Hemodialysis Machine, unit ' + i, sn, 1, 'RSUD ' + i, 'Sansin']);
  WARRANTY.push(['2024-10-01', 'MAT-' + i, sn, 'Active', '', '8/2030']);
}

const PART = [['PartID', 'Name', 'Active'], ['P1', 'Blood Pump Rotor', 'TRUE']];
const RECIPIENTS = [['RecipientID', 'Name', 'Email', 'Company', 'Principal', 'Active']];
const PRINCIPALS = [['Name', 'Active'], ['Sansin', 'TRUE']];
const USERS = [['Email', 'Name', 'Role', 'Principal', 'Active'],
  ['admin@oneject.co.id', 'Yayank', 'Administrator', '', 'TRUE']];

const SHEETS = {
  Customer: CUSTOMERS, sparepart: PART, Recipients: RECIPIENTS,
  Population: POPULATION, warranty: WARRANTY, Principals: PRINCIPALS, users: USERS
};

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
const cache = {
  get: function (k) { return store[k] === undefined ? null : store[k]; },
  put: function (k, v) { store[k] = v; },
  remove: function (k) { delete store[k]; }
};

function load() {
  const sandbox = {
    console: console,
    SpreadsheetApp: { getActive: function () { return book; }, openById: function () { return book; } },
    PropertiesService: {
      getScriptProperties: function () { return { getProperty: function () { return ''; } }; }
    },
    CacheService: { getScriptCache: function () { return cache; } },
    LockService: {
      getDocumentLock: function () {
        return { tryLock: function () { return true; }, releaseLock: function () {} };
      }
    },
    Utilities: { formatDate: function () { return '2026-09-12T00:00:00'; } }
  };
  vm.createContext(sandbox);
  ['Config.gs', 'Repo.gs', 'Warranty.gs', 'WarrantyRules.gs', 'Auth.gs', 'MasterData.gs'].forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'),
      sandbox, { filename: f });
  });
  vm.runInContext(
    'globalThis.__api = { searchCustomers_, searchUnits_, customerById_, referenceData_, ' +
    'customerOptions_, populationUnitCount_ };', sandbox, { filename: 'exports' });
  return sandbox.__api;
}

const app = load();
const ADMIN = { role: 'Administrator', email: 'admin@oneject.co.id', principal: '' };
const REQ = { role: 'Requester', email: 'rian@rs.co.id', principal: '' };

let pass = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

/* ------------------------------------------- what sign-in actually carries */

const ref = app.referenceData_(REQ);

check('sign-in no longer carries the customer list at all',
  ref.customers === undefined, 'it carries ' +
  (ref.customers ? ref.customers.length + ' customers' : 'nothing'));

check('nor the unit list',
  ref.units === undefined && ref.unitOptions === undefined);

// Carrying a count would mean reading the Customer and Population sheets to
// greet somebody who may never name a customer or open the claim form — the
// same read the lists were removed to avoid. The counts come back with the
// first search instead.
check('and not so much as a count, which would cost the same sheet reads',
  ref.customerCount === undefined && ref.unitCount === undefined,
  'customers ' + ref.customerCount + ', units ' + ref.unitCount);

check('an empty search is what counts them, and it counts them all',
  app.searchCustomers_(REQ, { query: '' }).total === 1388 &&
  app.searchUnits_(REQ, { query: '' }).total === 2610,
  app.searchCustomers_(REQ, { query: '' }).total + ' / ' +
  app.searchUnits_(REQ, { query: '' }).total);

// 1.386 generated plus the three active extras, less the internal entry a
// requester may not pick: 1388. The inactive one never counted.
const before = JSON.stringify(app.customerOptions_(REQ)).length +
  JSON.stringify(Array.from({ length: 2610 }, function (_, i) {
    return { serial: 'XT24' + (100000 + i), product: 'Sansin SWS-4000 Hemodialysis Machine, unit ' + i, principal: 'Sansin' };
  })).length;
const after = JSON.stringify(ref).length;
check('and sign-in is an order of magnitude smaller for it',
  after * 10 < before,
  Math.round(before / 1024) + 'KB of lists before, ' + Math.round(after / 1024) + 'KB now');

/* ------------------------------------------------- searching the customers */

const ridwan = app.searchCustomers_(REQ, { query: 'ridwan' });
check('a customer search returns only what matches',
  ridwan.options.length === 1 && ridwan.total === 1 &&
  ridwan.options[0].label === 'RS TK. II M. Ridwan Meuraksa - Jakarta',
  JSON.stringify(ridwan.options));

check('matching is case-insensitive and matches inside the name',
  app.searchCustomers_(REQ, { query: 'MEURAKSA' }).total === 1);

const broad = app.searchCustomers_(REQ, { query: 'RSUD', limit: 40 });
check('a broad search is trimmed to the page asked for',
  broad.options.length === 40, 'got ' + broad.options.length);
check('but says how many there really are, so it cannot pass as the whole answer',
  broad.total === 1386, 'total ' + broad.total);

check('an empty query offers the first page rather than nothing',
  app.searchCustomers_(REQ, { query: '' }).options.length === 40);

check('a limit cannot be talked past the ceiling',
  app.searchCustomers_(REQ, { query: '', limit: 99999 }).options.length === 100);

check('an inactive customer is never offered',
  app.searchCustomers_(ADMIN, { query: 'Koja' }).total === 0);

check('and the internal entry is hidden from a requester',
  app.searchCustomers_(REQ, { query: 'Internal' }).total === 0);
check('but offered to production, whose claims are exactly that',
  app.searchCustomers_({ role: 'Production', email: 'agus@oneject.co.id' },
    { query: 'Internal' }).total === 1);

/* ------------------------- naming a choice the page no longer holds a list for */

const one = app.customerById_(REQ, 'C9002');
check('a stored customer id can still be named on screen',
  one.option && one.option.label === 'RS Advent Bandung', JSON.stringify(one));
check('and an id that is gone answers plainly instead of throwing',
  app.customerById_(REQ, 'C-nope').option === null);
check('as does no id at all',
  app.customerById_(REQ, '').option === null);

/* ----------------------------------------------------- searching the units */

const batch = app.searchUnits_(REQ, { query: 'XT24' });
check('a serial number search matches from the start of the serial',
  batch.total === 1305, 'total ' + batch.total);
check('and is trimmed to a page',
  batch.options.length === 40);

check('a serial is not matched somewhere in its middle — typing a batch means that batch',
  app.searchUnits_(REQ, { query: '10000' }).total === 0,
  'total ' + app.searchUnits_(REQ, { query: '10000' }).total);

check('the product name, being a phrase, does match anywhere inside it',
  app.searchUnits_(REQ, { query: 'hemodialysis' }).total === 2610);

check('a unit carries its product as the hint under the serial',
  /Sansin SWS-4000/.test(batch.options[0].hint), JSON.stringify(batch.options[0]));

check('an empty query offers a first page here too',
  app.searchUnits_(REQ, { query: '' }).options.length === 40);

check('nothing matching answers empty rather than everything',
  app.searchUnits_(REQ, { query: 'ZZ9' }).total === 0);

let denied = false;
try { app.searchUnits_({ role: 'Principal', email: 'p@x.co', principal: 'Sansin' }, {}); }
catch (e) { denied = true; }
check('a principal cannot search the unit list — it is not theirs to browse', denied);

/* -------------------------------------------------------------------- report */

console.log('verify-search: ' + pass + ' checks passed' +
  (failures.length ? ', ' + failures.length + ' FAILED' : ''));
failures.forEach(function (f) { console.log('  FAIL  ' + f); });
process.exit(failures.length ? 1 : 0);
