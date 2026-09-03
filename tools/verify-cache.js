/**
 * verify-cache.js — counts how often the unit sheets are actually read.
 *
 * The Population sheet holds 2,610 rows and the warranty sheet as many again.
 * Saving one claim asks them three separate questions — the warranty verdict,
 * the product name, the owning principal — and every serial number lookup as it
 * is typed asks the same again. Each of those was a full sheet read, because
 * the index is larger than the 100KB CacheService will store in one entry and
 * the put failed without saying so.
 *
 * This puts a full-size population behind the real Warranty.gs and counts
 * getValues() calls: within one execution the sheet is read once, and a later
 * execution reads it not at all.
 *
 *   node tools/verify-cache.js
 */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ------------------------------------ a spreadsheet that counts its reads */

let reads = { Population: 0, warranty: 0 };

function Sheet(name, grid) { this.name = name; this.grid = grid; }
Sheet.prototype.getLastRow = function () { return this.grid.length; };
Sheet.prototype.getLastColumn = function () { return this.grid[0].length; };
Sheet.prototype.getRange = function (row, col, numRows, numCols) {
  const s = this;
  return {
    getValues: function () {
      reads[s.name] = (reads[s.name] || 0) + 1;
      const out = [];
      for (let r = 0; r < numRows; r++) {
        const line = [];
        for (let c = 0; c < numCols; c++) {
          const v = (s.grid[row - 1 + r] || [])[col - 1 + c];
          line.push(v === undefined ? '' : v);
        }
        out.push(line);
      }
      return out;
    }
  };
};

/* --------------------------- a cache with the real 100KB per-entry limit */

const ENTRY_LIMIT = 100 * 1024;
let store = {};

const cache = {
  get: function (k) { return store[k] === undefined ? null : store[k]; },
  getAll: function (keys) {
    const out = {};
    keys.forEach(function (k) { if (store[k] !== undefined) out[k] = store[k]; });
    return out;
  },
  put: function (k, v) {
    if (String(v).length > ENTRY_LIMIT) throw new Error('Argument too large: value');
    store[k] = String(v);
  },
  putAll: function (entries) {
    Object.keys(entries).forEach(function (k) { cache.put(k, entries[k]); });
  },
  remove: function (k) { delete store[k]; },
  removeAll: function (keys) { keys.forEach(function (k) { delete store[k]; }); }
};

/* ---------------------------------------------------------- the fixture */

const POPULATION = [['Delivery', 'SellingInDate', 'Material', 'ItemDescription', 'Batch',
  'DeliveryQuantity', 'ShipToParty', 'Principal']];
const WARRANTY = [['SellingInDate', 'Material', 'Batch', 'Status', 'exp', 'Expired']];
for (let i = 0; i < 2610; i++) {
  const sn = 'XT24' + String(100000 + i);
  POPULATION.push(['DEL' + i, '2024-10-01', 'MAT-' + i,
    'Sansin SWS-4000 Hemodialysis Machine, unit ' + i, sn, 1, 'RSUD ' + i, 'Sansin']);
  WARRANTY.push(['2024-10-01', 'MAT-' + i, sn, 'Active', '', '8/2026']);
}

// The fixture's units carry cover to 8/2026, and determineWarranty_ falls back
// to the real clock when it is not given a date. Left to itself this check
// passed until 1 September 2026 and then began failing on its own, with no
// change to any code it tests. The harness already pretends today is 30 August
// 2026; every call below is handed that same day.
const TODAY = new Date(2026, 7, 30);

const book = {
  getSheetByName: function (n) {
    if (n === 'Population') return new Sheet('Population', POPULATION);
    if (n === 'warranty') return new Sheet('warranty', WARRANTY);
    return null;
  }
};

/* ---------------------------------------------------------- loading it up */

function load() {
  const sandbox = {
    console: console,
    SpreadsheetApp: { getActive: function () { return book; }, openById: function () { return book; } },
    PropertiesService: { getScriptProperties: function () { return { getProperty: function () { return ''; } }; } },
    CacheService: { getScriptCache: function () { return cache; } },
    LockService: { getDocumentLock: function () { return { tryLock: function () { return true; }, releaseLock: function () {} }; } },
    Utilities: { formatDate: function () { return '2026-08-30T00:00:00'; } }
  };
  vm.createContext(sandbox);
  vm.runInContext(
    ['Config.gs', 'Repo.gs', 'Warranty.gs']
      .map(function (f) { return fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'); })
      .concat(['globalThis.__api = { populationIndex_, warrantyIndex_, productName_, principalFor_, determineWarranty_, cachePutLarge_, cacheGetLarge_ };'])
      .join('\n'),
    sandbox, { filename: 'cache' }
  );
  return sandbox.__api;
}

let pass = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

/* ------------------------------------------- one execution, one sheet read */

reads = {}; store = {};
let app = load();

const SN = 'XT24100500';
app.determineWarranty_(SN, TODAY);
app.productName_(SN);
app.principalFor_(SN);
app.productName_('XT24100501');

check('the population sheet is read once for a whole save, not once per question',
  reads.Population === 1, 'read ' + reads.Population + ' times');
check('and the warranty sheet likewise',
  reads.warranty === 1, 'read ' + reads.warranty + ' times');

/* ---------------------------------- the index is genuinely past the limit */

check('the index really is too large for one cache entry, or this proves nothing',
  JSON.stringify(app.populationIndex_()).length > ENTRY_LIMIT,
  JSON.stringify(app.populationIndex_()).length + ' bytes');

check('so it was stored in more than one chunk',
  Number(store['populationIndex:n']) > 1, 'chunks: ' + store['populationIndex:n']);

check('every chunk is within what CacheService will take',
  Object.keys(store).every(function (k) { return store[k].length <= ENTRY_LIMIT; }));

/* -------------------------------- the next execution reads nothing at all */

reads = {};
app = load();                       // fresh globals, same cache — a new request
const product = app.productName_(SN);
app.determineWarranty_(SN, TODAY);
app.principalFor_(SN);

check('a later request serves both indexes from the cache, reading no sheet',
  !reads.Population && !reads.warranty,
  'Population ' + (reads.Population || 0) + ', warranty ' + (reads.warranty || 0));

check('and the answer it serves is the right one',
  product === 'Sansin SWS-4000 Hemodialysis Machine, unit 500', String(product));

check('the warranty verdict survives the round trip too',
  app.determineWarranty_(SN, TODAY).type === 'Principal Warranty',
  app.determineWarranty_(SN, TODAY).type);

/* ------------------------------------- a half-expired cache is not trusted */

delete store['populationIndex:1'];
reads = {};
app = load();
check('losing one chunk rebuilds the index rather than serving half of it',
  Object.keys(app.populationIndex_()).length === 2610 && reads.Population === 1,
  Object.keys(app.populationIndex_()).length + ' entries, ' + reads.Population + ' reads');

/* ------------------------------------------------ round trip on its own */

reads = {}; store = {};
app = load();
const wide = { text: 'x'.repeat(250000), emoji: '😀 unit', n: 1 };
app.cachePutLarge_('probe', wide, 600);
check('a value far past the limit round trips exactly, emoji included',
  JSON.stringify(app.cacheGetLarge_('probe')) === JSON.stringify(wide));

check('a cache that holds nothing yields null rather than half a value',
  app.cacheGetLarge_('never-written') === null);

/* -------------------------------------------------------------------- report */

console.log('');
failures.forEach(function (f) { console.log('  ✗ ' + f); });
console.log('  ' + pass + ' passed, ' + failures.length + ' failed');
console.log('');
process.exit(failures.length ? 1 : 0);
