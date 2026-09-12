/**
 * verify-unit-warranty.js — the warranty dates kept on the unit itself.
 *
 * The rules engine works an answer out; this is about where the answer is put
 * and what happens the next time it is worked out. Three ways of getting that
 * wrong, all of them quiet:
 *
 * DATES READ THE WRONG WAY ROUND. The import files are dd/mm/yyyy. To
 * new Date(), "03/09/2025" is 9 March; to whoever typed it, 3 September. Half a
 * year of warranty, and nothing on any screen to suggest a date was guessed at.
 *
 * A COPY THAT DRIFTS. The dates on the unit are a copy of what the rules say,
 * and a copy is only safe while it is recomputed from source rather than
 * adjusted. Run twice, it has to say the same thing twice.
 *
 * A WRITE THAT TOUCHES MORE THAN IT SHOULD. Recomputing writes seven columns.
 * Everything else on the row — what somebody typed, what another feature owns —
 * has to come back unchanged.
 *
 *   node tools/verify-unit-warranty.js
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
function stage(label, fn) {
  try { return fn(); } catch (e) {
    failures.push(label + ' — threw: ' + String(e.message || e));
    return null;
  }
}

/* ---------------------------------------------------------- a spreadsheet */

let writes = 0;

function Sheet(name, rows) {
  const s = {
    rows: rows,
    getName: function () { return name; },
    getLastRow: function () { return s.rows.length; },
    getLastColumn: function () { return s.rows.length ? s.rows[0].length : 0; },
    setFrozenRows: function () {},
    appendRow: function (row) { s.rows.push(row.slice()); },
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
          writes++;
          values.forEach(function (line, i) {
            const at = r - 1 + i;
            if (!s.rows[at]) s.rows[at] = [];
            line.forEach(function (v, j) { s.rows[at][c - 1 + j] = v; });
          });
        },
        setValue: function (v) { writes++; s.rows[r - 1][c - 1] = v; }
      };
    }
  };
  return s;
}

let SHEETS = {};
let CACHE = {};
const book = {
  getSheetByName: function (n) { return SHEETS[n] || null; },
  insertSheet: function (n) { SHEETS[n] = new Sheet(n, []); return SHEETS[n]; },
  getId: function () { return 'book'; },
  getName: function () { return 'fixture'; }
};

let STAMP = '2026-09-12T10:00:00';

const sandbox = {
  console: console,
  SpreadsheetApp: {
    getActive: function () { return book; },
    openById: function () { return book; },
    flush: function () {}
  },
  PropertiesService: {
    getScriptProperties: function () {
      return { getProperty: function () { return null; }, setProperty: function () {} };
    }
  },
  CacheService: {
    getScriptCache: function () {
      return {
        get: function (k) { return CACHE[k] === undefined ? null : CACHE[k]; },
        getAll: function (keys) {
          const out = {};
          keys.forEach(function (k) { if (CACHE[k] !== undefined) out[k] = CACHE[k]; });
          return out;
        },
        put: function (k, v) { CACHE[k] = String(v); },
        putAll: function (e) { Object.keys(e).forEach(function (k) { CACHE[k] = String(e[k]); }); },
        remove: function (k) { delete CACHE[k]; },
        removeAll: function (keys) { keys.forEach(function (k) { delete CACHE[k]; }); }
      };
    }
  },
  Utilities: { formatDate: function () { return STAMP; } }
};

vm.createContext(sandbox);
['Config.gs', 'Repo.gs', 'Warranty.gs', 'WarrantyRules.gs', 'Units.gs'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'),
    sandbox, { filename: f });
});
vm.runInContext(
  'globalThis.__api = { SHEET, SCHEMA, INDEX_MEMO, UNIT_WARRANTY_COLS,' +
  '  WARRANTY_TYPE, parseLocalDate_, unitWarrantyOf_, unitRowToUnit_,' +
  '  recomputeUnitWarranty_, unitOf_, populationIndex_, determineWarranty_ };',
  sandbox, { filename: 'stubs' });

const api = sandbox.__api;
const SHEET = api.SHEET;
const POP_COLS = api.SCHEMA[SHEET.POPULATION];

/* ================================================== reading a date by hand */

function parsed(v) { return api.parseLocalDate_(v).iso; }
function refused(v) { return api.parseLocalDate_(v).error; }

check('a date written the Indonesian way is read the Indonesian way',
  parsed('03/09/2025') === '2025-09-03', parsed('03/09/2025'));
check('which is not what new Date() would have made of it',
  new Date('03/09/2025').getMonth() === 2 && parsed('03/09/2025') === '2025-09-03');
check('a single-digit day and month still read day first',
  parsed('3/9/2025') === '2025-09-03', parsed('3/9/2025'));
check('the thirteenth of a month is a day, not a thirteenth month',
  parsed('13/09/2025') === '2025-09-13', parsed('13/09/2025'));

check('ISO is taken as it stands, being the one other shape nobody can misread',
  parsed('2025-09-03') === '2025-09-03');
check('and ISO with a time on it loses the time',
  parsed('2025-09-03T11:53:50') === '2025-09-03');

check('a real Date from the sheet keeps its own day, not a timezone away',
  parsed(new Date(2025, 8, 3)) === '2025-09-03', parsed(new Date(2025, 8, 3)));

check('an empty cell is not a mistake', parsed('') === '' && refused('') === '');

check('a month that does not exist is refused, and says why',
  /no month 13/.test(refused('09/13/2025')), refused('09/13/2025'));
check('a day that does not exist in that month is refused',
  /not a day that exists/.test(refused('31/02/2025')), refused('31/02/2025'));
check('and so is anything else, by name',
  /dd\/mm\/yyyy/.test(refused('Sep 3 2025')), refused('Sep 3 2025'));
check('including the American order written with dashes',
  refused('09-03-2025') !== '', refused('09-03-2025'));
check('nothing refused ever comes back with a date anyway',
  ['09/13/2025', '31/02/2025', 'Sep 3 2025', 'rubbish'].every(function (v) {
    return api.parseLocalDate_(v).iso === '';
  }));

/* ------------------------------------------------------------- the fixture */

const RULE_COLS = ['RuleID', 'Material', 'Scope', 'Channel', 'Basis', 'Months',
  'EffectiveFrom', 'EffectiveTo', 'Active', 'Notes'];

function rule(id, material, scope, basis, months) {
  return [id, material, scope, '*', basis, months, '', '', true, ''];
}

const RULES = [
  rule('R-A1', 'MAT-A', 'principal', 'assembly', 12),
  rule('R-A2', 'MAT-A', 'customer', 'installation', 24),
  rule('R-B1', 'MAT-B', 'principal', 'selling-in', 18),
  rule('R-B2', 'MAT-B', 'customer', 'received', 30),
  rule('R-C1', 'MAT-C', 'principal', 'installation', 12)
];

// Written as an administrator writes them: dd/mm/yyyy in the cells they type.
const UNITS = [
  { Batch: 'XT2403001', Material: 'MAT-A', SellingInDate: '20/05/2024',
    InstalledAt: '01/07/2024', ReceivedAtDistributor: '10/06/2024' },
  { Batch: 'XT2403002', Material: 'MAT-B', SellingInDate: '20/05/2024',
    ReceivedAtDistributor: '10/06/2024' },
  // Extended on both sides, by different figures.
  { Batch: 'XT2403003', Material: 'MAT-A', SellingInDate: '20/05/2024',
    InstalledAt: '01/07/2024', ExtendedMonthsPrincipal: 6, ExtendedMonthsCustomer: 12 },
  // The rule counts from a date this unit has not got.
  { Batch: 'XT2403004', Material: 'MAT-C', SellingInDate: '20/05/2024' },
  // A model with no rule at all.
  { Batch: 'XT2403005', Material: 'MAT-Z', SellingInDate: '20/05/2024' }
];

function popRow(u) {
  return POP_COLS.map(function (c) {
    if (c === 'ItemDescription') return (u.Material || '') + ' analyser';
    if (c === 'DeliveryQuantity') return 1;
    if (c === 'ShipToParty') return 'RSUD Koja';
    if (c === 'Principal') return 'Sansin';
    if (c === 'Delivery') return 'DEL';
    return u[c] === undefined ? '' : u[c];
  });
}

function build(extraRows) {
  writes = 0;
  CACHE = {};
  SHEETS = {
    Population: new Sheet('Population', [POP_COLS.slice()]
      .concat(UNITS.map(popRow))
      .concat(extraRows || [])),
    Products: new Sheet('Products', [
      ['Material', 'Name', 'Principal', 'Regulation', 'SerialPattern', 'Active', 'Notes']
    ].concat(['MAT-A', 'MAT-B', 'MAT-C'].map(function (m) {
      return [m, m, 'Sansin', 'AKL', '', true, ''];
    }))),
    WarrantyRules: new Sheet('WarrantyRules', [RULE_COLS.slice()].concat(RULES)),
    warranty: new Sheet('warranty', [api.SCHEMA[SHEET.WARRANTY].slice()])
  };
  ['population', 'warranty', 'products', 'rules'].forEach(function (k) {
    delete api.INDEX_MEMO[k];
  });
}

function cell(serial, column) {
  const rows = SHEETS.Population.rows;
  const head = rows[0];
  const keyAt = head.indexOf('Batch');
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][keyAt]) === serial) return rows[i][head.indexOf(column)];
  }
  return undefined;
}

/* ============================================= what lands on the unit row */

build();
const first = api.recomputeUnitWarranty_(null);

check('every unit on the sheet is worked out', first.units === 5, String(first.units));
check('and every one of them had nothing there before', first.changed === 5,
  String(first.changed));

check('the assembly month comes off the serial number',
  cell('XT2403001', 'AssemblyMonth') === '2024-03', cell('XT2403001', 'AssemblyMonth'));

check('a rule counting from assembly stores a month',
  cell('XT2403001', 'WarrantyEndPrincipal') === '2025-03',
  cell('XT2403001', 'WarrantyEndPrincipal'));
check('a rule counting from installation stores the day as well',
  cell('XT2403001', 'WarrantyEndCustomer') === '2026-07-01',
  cell('XT2403001', 'WarrantyEndCustomer'));
check('a rule counting from selling-in reads the date the administrator typed',
  cell('XT2403002', 'WarrantyEndPrincipal') === '2025-11-20',
  cell('XT2403002', 'WarrantyEndPrincipal'));
check('and one counting from the date the distributor received it, likewise',
  cell('XT2403002', 'WarrantyEndCustomer') === '2026-12-10',
  cell('XT2403002', 'WarrantyEndCustomer'));

// The whole point of two tiers, on one row: the principal has stopped and we
// have not, and the sheet can now say so.
check('the two sides of one unit end on different dates',
  cell('XT2403001', 'WarrantyEndPrincipal') !== cell('XT2403001', 'WarrantyEndCustomer'));

check('the start each side counted from is kept beside the end',
  cell('XT2403001', 'WarrantyStartPrincipal') === '2024-03' &&
  cell('XT2403001', 'WarrantyStartCustomer') === '2024-07-01',
  cell('XT2403001', 'WarrantyStartPrincipal') + ' / ' + cell('XT2403001', 'WarrantyStartCustomer'));

check('so is the working, in words',
  /assembled Mar 2024 \+ 12 months/.test(cell('XT2403001', 'WarrantyBasisPrincipal')),
  cell('XT2403001', 'WarrantyBasisPrincipal'));

/* --------------------------------------------------------- extended warranty */

check('an extension pushes the principal side out by its own figure',
  cell('XT2403003', 'WarrantyEndPrincipal') === '2025-09',
  cell('XT2403003', 'WarrantyEndPrincipal'));
check('and our side out by a different one',
  cell('XT2403003', 'WarrantyEndCustomer') === '2027-07-01',
  cell('XT2403003', 'WarrantyEndCustomer'));
check('the unit beside it, with no extension, is untouched by either',
  cell('XT2403001', 'WarrantyEndPrincipal') === '2025-03' &&
  cell('XT2403001', 'WarrantyEndCustomer') === '2026-07-01');

/* ------------------------------------------------- when there is no answer */

check('a rule with no date to count from leaves the end date empty',
  cell('XT2403004', 'WarrantyEndPrincipal') === '',
  String(cell('XT2403004', 'WarrantyEndPrincipal')));
check('and says what to go and fill in, on the row itself',
  /installation \(BAST\) date/.test(cell('XT2403004', 'WarrantyBasisPrincipal')),
  cell('XT2403004', 'WarrantyBasisPrincipal'));
check('a model nobody has written a rule for says that instead',
  /no principal warranty rule on file/.test(cell('XT2403005', 'WarrantyBasisPrincipal')),
  cell('XT2403005', 'WarrantyBasisPrincipal'));
check('an empty end date is never filled in from a date that happens to be there',
  cell('XT2403004', 'WarrantyEndPrincipal') === '' &&
  cell('XT2403004', 'WarrantyStartPrincipal') === '');

/* --------------------------------------------- dates, never a status */

// A stored status would be wrong by morning. The design says so; this is what
// stops somebody adding one in good faith later.
check('no column anywhere holds a warranty status',
  POP_COLS.every(function (c) { return !/WarrantyStatus/.test(c); }),
  POP_COLS.filter(function (c) { return /Status/.test(c); }).join(','));
check('what is stored is a date, and the verdict is worked out from it',
  /^\d{4}-\d{2}(-\d{2})?$/.test(String(cell('XT2403001', 'WarrantyEndPrincipal'))));

/* ================================================ running it a second time */

STAMP = '2026-09-12T10:00:00';
const stampWas = cell('XT2403001', 'WarrantyComputedAt');
check('the first run stamped when the answer was worked out',
  stampWas === '2026-09-12T10:00:00', String(stampWas));

STAMP = '2026-09-13T11:00:00';
const again = stage('recomputing a second time', function () {
  return api.recomputeUnitWarranty_(null);
});
check('running it again counts the same units', again && again.units === 5);
check('and changes none of them, because nothing it writes depends on today',
  again && again.changed === 0, again ? String(again.changed) : 'threw');
check('so the stamp still says when the answer last moved, not when this last ran',
  cell('XT2403001', 'WarrantyComputedAt') === '2026-09-12T10:00:00',
  String(cell('XT2403001', 'WarrantyComputedAt')));

/* ------------------------------------------- a rule change, and the stamp */

RULES[0][5] = 24;                       // MAT-A principal: 12 months becomes 24
delete api.INDEX_MEMO.rules;
CACHE = {};
const moved = api.recomputeUnitWarranty_(null);
check('changing a rule changes the units it applies to',
  moved.changed === 2, String(moved.changed));
check('the new term is the one on the row',
  cell('XT2403001', 'WarrantyEndPrincipal') === '2026-03',
  cell('XT2403001', 'WarrantyEndPrincipal'));
check('and the stamp moves for those, and only those',
  cell('XT2403001', 'WarrantyComputedAt') === '2026-09-13T11:00:00' &&
  cell('XT2403002', 'WarrantyComputedAt') === '2026-09-12T10:00:00',
  cell('XT2403001', 'WarrantyComputedAt') + ' / ' + cell('XT2403002', 'WarrantyComputedAt'));
RULES[0][5] = 12;

/* ======================================= what a recompute must not touch */

build();
const blank = POP_COLS.map(function () { return ''; });
SHEETS.Population.rows.push(blank.slice());
SHEETS.Population.rows.push(popRow({ Batch: 'XT2403006', Material: 'MAT-B',
  SellingInDate: '20/05/2024' }));

api.recomputeUnitWarranty_(null);
const spacer = SHEETS.Population.rows[UNITS.length + 1];
check('a blank spacing row stays blank rather than becoming a unit with no warranty',
  spacer.every(function (v) { return v === ''; }), JSON.stringify(spacer));
check('and the real row after it is still worked out',
  cell('XT2403006', 'WarrantyEndPrincipal') === '2025-11-20',
  cell('XT2403006', 'WarrantyEndPrincipal'));

// Everything a person typed has to come back exactly as they typed it. The
// recompute owns seven columns and nothing else on the row.
build();
const before = SHEETS.Population.rows.map(function (r) { return r.slice(); });
api.recomputeUnitWarranty_(null);
const owned = api.UNIT_WARRANTY_COLS.concat(['WarrantyComputedAt']);
const touchedOther = [];
SHEETS.Population.rows.forEach(function (row, i) {
  row.forEach(function (v, c) {
    if (owned.indexOf(POP_COLS[c]) !== -1) return;
    if (String(v) !== String(before[i][c])) touchedOther.push(POP_COLS[c]);
  });
});
check('a recompute writes its seven columns and its stamp, and nothing else',
  touchedOther.length === 0, touchedOther.join(', '));
check('the dd/mm/yyyy an administrator typed is still there, not rewritten as ISO',
  cell('XT2403001', 'SellingInDate') === '20/05/2024',
  String(cell('XT2403001', 'SellingInDate')));

// One read of the sheet, then one write per column. Not one write per unit:
// two thousand rows one at a time does not finish inside the execution limit.
build();
writes = 0;
api.recomputeUnitWarranty_(null);
check('the whole sheet is written a column at a time, not a row at a time',
  writes === api.UNIT_WARRANTY_COLS.length + 1, writes + ' writes for 5 units');

/* ---------------------------------------------------- asking about a few */

build();
api.recomputeUnitWarranty_(null);
RULES[0][5] = 24;
delete api.INDEX_MEMO.rules;
CACHE = {};
const some = api.recomputeUnitWarranty_(['XT2403001']);
check('naming a unit works out that one', some.units === 1, String(some.units));
check('and it gets the new answer',
  cell('XT2403001', 'WarrantyEndPrincipal') === '2026-03',
  cell('XT2403001', 'WarrantyEndPrincipal'));
check('while a unit nobody asked about keeps the answer it had',
  cell('XT2403003', 'WarrantyEndPrincipal') === '2025-09',
  cell('XT2403003', 'WarrantyEndPrincipal'));
check('a serial typed in lower case still finds its unit',
  stage('recomputing by a lower-case serial', function () {
    return api.recomputeUnitWarranty_(['xt2403003']).units === 1;
  }) === true);
RULES[0][5] = 12;

/* -------------------------------------------- the cache, after a recompute */

build();
api.populationIndex_();
check('the index is cached to begin with', !!CACHE['populationIndex:n'],
  Object.keys(CACHE).join(','));
api.recomputeUnitWarranty_(null);
check('a recompute drops the cached index, so the next question is not answered from it',
  !CACHE['populationIndex:n'], Object.keys(CACHE).join(','));

/* ------------------------------------- and the engine reads the same unit */

build();
api.recomputeUnitWarranty_(null);
const viaIndex = api.unitOf_('XT2403001');
check('a unit read through the index has its dates as ISO, not as typed',
  viaIndex.InstalledAt === '2024-07-01', viaIndex.InstalledAt);
check('which is the same reading the recompute uses',
  viaIndex.InstalledAt ===
  api.unitRowToUnit_({ Batch: 'XT2403001', InstalledAt: '01/07/2024' }).InstalledAt);
check('so the claim form and the stored column cannot disagree',
  api.determineWarranty_('XT2403002', new Date(2025, 0, 1)).expiry ===
  cell('XT2403002', 'WarrantyEndPrincipal'),
  api.determineWarranty_('XT2403002', new Date(2025, 0, 1)).expiry + ' / ' +
  cell('XT2403002', 'WarrantyEndPrincipal'));

// A cell nobody can read must not become a date by accident.
build();
SHEETS.Population.rows[1][POP_COLS.indexOf('InstalledAt')] = '07/01/2024 approx';
delete api.INDEX_MEMO.population;
CACHE = {};
api.recomputeUnitWarranty_(null);
check('an unreadable date is treated as no date rather than as some date',
  cell('XT2403001', 'WarrantyEndCustomer') === '' &&
  /installation \(BAST\) date/.test(cell('XT2403001', 'WarrantyBasisCustomer')),
  String(cell('XT2403001', 'WarrantyEndCustomer')) + ' — ' +
  cell('XT2403001', 'WarrantyBasisCustomer'));

/* ------------------------------------------------------------------ report */

console.log('verify-unit-warranty: ' + pass + ' checks passed' +
  (failures.length ? ', ' + failures.length + ' FAILED' : ''));
failures.forEach(function (f) { console.log('  FAIL  ' + f); });
process.exit(failures.length ? 1 : 0);
