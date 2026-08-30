/**
 * verify-sheets.js — checks that a sheet's first row is never mistaken for a
 * header when it is really data.
 *
 * The customer and spare-part lists came out of the old workbook as one bare
 * column of names. Read as if row 1 were a header, the first customer vanishes
 * and every Name reads blank — which is what emptied the dropdown in the claim
 * form. This loads Repo.gs and MasterData.gs as they are, puts a fake
 * spreadsheet behind them, and checks what the form would actually be offered.
 *
 *   node tools/verify-sheets.js
 */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ------------------------------------------------------ a fake spreadsheet */

function Sheet(name, grid) {
  this.name = name;
  this.grid = (grid || []).map(function (r) { return r.slice(); });
  this.frozen = 0;
}

Sheet.prototype.getName = function () { return this.name; };

Sheet.prototype.getLastRow = function () {
  let last = 0;
  this.grid.forEach(function (row, r) {
    if (row.some(function (c) { return c !== '' && c !== null && c !== undefined; })) last = r + 1;
  });
  return last;
};

Sheet.prototype.getLastColumn = function () {
  let last = 0;
  this.grid.forEach(function (row) {
    row.forEach(function (c, i) {
      if (c !== '' && c !== null && c !== undefined) last = Math.max(last, i + 1);
    });
  });
  return last;
};

Sheet.prototype.getMaxRows = function () { return Math.max(this.grid.length, 1000); };

Sheet.prototype.cell = function (r, c) {
  while (this.grid.length <= r) this.grid.push([]);
  const row = this.grid[r];
  while (row.length <= c) row.push('');
  return row;
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
          const source = s.grid[r0 + r] || [];
          const v = source[c0 + c];
          line.push(v === undefined ? '' : v);
        }
        out.push(line);
      }
      return out;
    },
    setValues: function (values) {
      values.forEach(function (line, r) {
        line.forEach(function (v, c) {
          s.cell(r0 + r, c0 + c)[c0 + c] = v;
        });
      });
      return this;
    },
    setValue: function (v) { s.cell(r0, c0)[c0] = v; return this; },
    clearContent: function () {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) s.cell(r0 + r, c0 + c)[c0 + c] = '';
      }
      return this;
    }
  };
};

Sheet.prototype.appendRow = function (values) {
  const r = this.getLastRow();
  values.forEach(function (v, c) { this.cell(r, c)[c] = v; }, this);
};

Sheet.prototype.clearContents = function () { this.grid = []; };
Sheet.prototype.setFrozenRows = function (n) { this.frozen = n; };

function Book(sheets) {
  this.sheets = sheets || {};
}
Book.prototype.getName = function () { return 'Fixture'; };
Book.prototype.getId = function () { return 'fixture-id'; };
Book.prototype.getUrl = function () { return 'https://example.invalid/fixture'; };
Book.prototype.getSheetByName = function (n) { return this.sheets[n] || null; };
Book.prototype.insertSheet = function (n) {
  this.sheets[n] = new Sheet(n, []);
  return this.sheets[n];
};

/* ---------------------------------------------------------- loading the app */

const cache = {};
const sandbox = {
  console: console,
  SpreadsheetApp: { getActive: function () { return sandbox.__book; }, openById: function () { return sandbox.__book; } },
  PropertiesService: { getScriptProperties: function () { return { getProperty: function () { return ''; } }; } },
  CacheService: {
    getScriptCache: function () {
      return {
        get: function (k) { return cache[k] === undefined ? null : cache[k]; },
        put: function (k, v) { cache[k] = v; },
        remove: function (k) { delete cache[k]; },
        removeAll: function (keys) { keys.forEach(function (k) { delete cache[k]; }); }
      };
    }
  },
  LockService: {
    getDocumentLock: function () {
      return { tryLock: function () { return true; }, releaseLock: function () {} };
    }
  },
  Utilities: {
    formatDate: function () { return '260830'; }
  }
};
vm.createContext(sandbox);

const source = ['Config.gs', 'Repo.gs', 'MasterData.gs']
  .map(function (f) { return fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'); })
  .concat(['globalThis.__api = { ensureSheets_, readAll_, referenceData_, isTrue_ };'])
  .join('\n');
vm.runInContext(source, sandbox, { filename: 'sheets' });

const { ensureSheets_, readAll_, referenceData_ } = sandbox.__api;

/* ------------------------------------------------------------------ fixtures */

// The customer list exactly as the old workbook holds it: one column, no header.
const HEADERLESS = [
  ['PT. Asri Trisna Mandiri'],
  ['PT. Bunda Medika'],
  ['RS Cipto Mangunkusumo']
];

// The same sheet after the earlier version treated row 1 as a header: the
// declared columns were appended beside the data and IDs handed out.
const DAMAGED = [
  ['PT. Asri Trisna Mandiri', 'CustomerID', 'Name', 'Active'],
  ['PT. Bunda Medika', 'CUS-001', '', true],
  ['RS Cipto Mangunkusumo', 'CUS-002', '', true]
];

function book(customer, extra) {
  const sheets = {};
  Object.keys(sandbox.SCHEMA || {}).length;
  sheets.Customer = new Sheet('Customer', customer);
  Object.keys(extra || {}).forEach(function (k) { sheets[k] = new Sheet(k, extra[k]); });
  return new Book(sheets);
}

function run(customer, extra) {
  sandbox.__book = book(customer, extra);
  Object.keys(cache).forEach(function (k) { delete cache[k]; });
  const repaired = ensureSheets_();
  return { repaired: repaired, book: sandbox.__book };
}

let pass = 0;
let fail = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) { pass++; return; }
  fail++;
  failures.push(name + (detail ? ' — ' + detail : ''));
}

function names(b) {
  sandbox.__book = b;
  return readAll_('Customer').map(function (c) { return String(c.Name || ''); });
}

/* ------------------------------------------ a list that never had a header */

let state = run(HEADERLESS);
check('a headerless customer list is reported as repaired',
  state.repaired.indexOf('Customer') !== -1, JSON.stringify(state.repaired));

check('it gets the declared header row',
  state.book.getSheetByName('Customer').grid[0].join('|') === 'CustomerID|Name|Active',
  String(state.book.getSheetByName('Customer').grid[0]));

check('no row is lost to the header', names(state.book).length === 3,
  String(names(state.book).length));

check('the first customer survives instead of becoming a column name',
  names(state.book)[0] === 'PT. Asri Trisna Mandiri', names(state.book)[0]);

check('every row carries its name', names(state.book).every(Boolean),
  JSON.stringify(names(state.book)));

check('every adopted row is active',
  readAll_('Customer').every(function (c) { return c.Active === true; }));

/* ------------------------------- a list the earlier version already mangled */

state = run(DAMAGED);
check('a half-headed customer list is repaired too',
  state.repaired.indexOf('Customer') !== -1, JSON.stringify(state.repaired));

check('the value stranded in the header row comes back as a row',
  names(state.book).length === 3, String(names(state.book).length));

check('the stranded value keeps its place at the top',
  names(state.book)[0] === 'PT. Asri Trisna Mandiri', names(state.book)[0]);

check('names move out of column A and under the Name header',
  names(state.book).join(',') ===
    'PT. Asri Trisna Mandiri,PT. Bunda Medika,RS Cipto Mangunkusumo',
  names(state.book).join(','));

check('identifiers already handed out are kept',
  readAll_('Customer').map(function (c) { return String(c.CustomerID || ''); }).join(',') ===
    ',CUS-001,CUS-002',
  readAll_('Customer').map(function (c) { return String(c.CustomerID || ''); }).join(','));

// setUp() appends the internal production customer with the header filled in
// properly, so a repaired sheet has to keep both shapes side by side.
state = run(DAMAGED.concat([['', 'CUS-003', 'Internal — Production', true]]));
sandbox.__book = state.book;
check('a correctly filled row added later is carried across unchanged',
  readAll_('Customer').map(function (c) { return String(c.Name || ''); }).join(',') ===
    'PT. Asri Trisna Mandiri,PT. Bunda Medika,RS Cipto Mangunkusumo,Internal — Production',
  readAll_('Customer').map(function (c) { return String(c.Name || ''); }).join(','));
check('and keeps its own identifier',
  (readAll_('Customer')[3] || {}).CustomerID === 'CUS-003',
  String((readAll_('Customer')[3] || {}).CustomerID));

/* ------------------------------------------------------------- idempotence */

state = run(HEADERLESS);
const after = JSON.stringify(state.book.getSheetByName('Customer').grid);
sandbox.__book = state.book;
const second = ensureSheets_();
check('a repaired sheet is not repaired again',
  second.indexOf('Customer') === -1, JSON.stringify(second));
check('and its contents are untouched by the second run',
  JSON.stringify(state.book.getSheetByName('Customer').grid) === after);

/* ------------------------------------------ a sheet that is already correct */

state = run([
  ['CustomerID', 'Name', 'Active', 'Notes'],
  ['CUS-001', 'PT. Bunda Medika', true, 'preferred']
]);
check('a proper header is left alone',
  state.repaired.indexOf('Customer') === -1, JSON.stringify(state.repaired));
check('and a column somebody added after the declared ones survives',
  state.book.getSheetByName('Customer').grid[1][3] === 'preferred',
  String(state.book.getSheetByName('Customer').grid[1][3]));

/* ------------------------------------------------------------ spare parts */

state = run(HEADERLESS, { sparepart: [['A pick up tube'], ['Blood pump rotor']] });
check('the spare-part list is adopted on the same rule',
  state.repaired.indexOf('sparepart') !== -1, JSON.stringify(state.repaired));
sandbox.__book = state.book;
check('and keeps both parts, first row included',
  readAll_('sparepart').map(function (p) { return p.Name; }).join(',') ===
    'A pick up tube,Blood pump rotor',
  readAll_('sparepart').map(function (p) { return p.Name; }).join(','));

/* --------------------------------- a sheet with no adoption plan is untouched */

state = run(HEADERLESS, {
  users: [
    ['Email', 'Name', 'Role'],
    ['yayan@oneject.co.id', 'Yayan', 'Administrator']
  ]
});
sandbox.__book = state.book;
check('adding Active to the users sheet still does not deactivate anyone',
  readAll_('users')[0].Active === true, String(readAll_('users')[0].Active));
check('and the users sheet is not rewritten',
  state.repaired.indexOf('users') === -1, JSON.stringify(state.repaired));

/* ------------------------------------- what the claim form is actually offered */

state = run(HEADERLESS, { Principals: [['PrincipalID', 'Name', 'Active'], ['PRN-001', 'Sansin', true]] });
sandbox.__book = state.book;
const reference = referenceData_({ role: 'Requester' });

check('the customer dropdown is offered real names',
  reference.customers.length === 3 &&
  reference.customers.every(function (c) { return !!c.name; }),
  JSON.stringify(reference.customers));

check('and they arrive sorted',
  reference.customers.map(function (c) { return c.name; }).join(',') ===
    'PT. Asri Trisna Mandiri,PT. Bunda Medika,RS Cipto Mangunkusumo',
  reference.customers.map(function (c) { return c.name; }).join(','));

check('an entry with no name would have been visible as a blank option',
  // Guards the check above: prove the assertion can fail.
  [{ id: 'x', name: '' }].every(function (c) { return !!c.name; }) === false);

/* ------------------------------ an unrecognised leading column is not guessed */

sandbox.__book = book([
  ['Kode', 'Wilayah', 'Nama'],
  ['A1', 'Jakarta', 'PT. Bunda Medika']
]);
check('too many unlabelled leading columns stop with an explanation', (function () {
  try { ensureSheets_(); return false; } catch (e) {
    return /does not recognise/.test(e.message) && /CustomerID, Name, Active/.test(e.message);
  }
})());

console.log('');
console.log('  ' + pass + ' passed, ' + fail + ' failed');
failures.forEach(function (f) { console.log('    ✗ ' + f); });
console.log('');

process.exit(fail ? 1 : 0);
