/**
 * verify-unit-admin.js — filling the unit register in, and not wrecking it.
 *
 * The register now carries columns nobody outside this office can supply: how
 * the machine reached the hospital, when it was installed, what extension was
 * bought with it. Three ways of getting that wrong, and the portal has already
 * been bitten by two of them in other places:
 *
 * A DATE READ THE WRONG WAY ROUND. dd/mm/yyyy in, half a year out, and no
 * symptom at all. A row the portal cannot read has to be refused by line
 * number, not guessed at and not silently dropped.
 *
 * A WRITE THAT HAPPENS BEFORE ANYBODY AGREED TO IT. The preview is the whole
 * safety of a bulk import: if one rejected row still lets the rest through,
 * "nothing is written until every row is accepted" is a sentence on a screen
 * and not a property of the code.
 *
 * AND THE IMPORT THAT WIPES WHAT IT DOES NOT KNOW ABOUT. The principal's
 * workbook carries their columns and only theirs. Clearing the whole row before
 * writing it back would erase every installation date in the register on every
 * import — quietly, and only visible months later as warranties that stopped
 * being computable.
 *
 *   node tools/verify-unit-admin.js
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
function refuses(label, fn) {
  try { fn(); return ''; } catch (e) { return String(e.message || e); }
}

/* ---------------------------------------------------------- a spreadsheet */

let writes = [];

function Sheet(name, rows) {
  const s = {
    rows: rows,
    getName: function () { return name; },
    getLastRow: function () { return s.rows.length; },
    getLastColumn: function () { return s.rows.length ? s.rows[0].length : 0; },
    setFrozenRows: function () {},
    appendRow: function (row) {
      const width = s.getLastColumn();
      const line = row.slice();
      while (line.length < width) line.push('');
      s.rows.push(line);
    },
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
          writes.push({ sheet: name, row: r, col: c, rows: nr, cols: nc });
          values.forEach(function (line, i) {
            const at = r - 1 + i;
            if (!s.rows[at]) s.rows[at] = [];
            line.forEach(function (v, j) { s.rows[at][c - 1 + j] = v; });
          });
        },
        clearContent: function () {
          writes.push({ sheet: name, row: r, col: c, rows: nr, cols: nc, clear: true });
          for (let i = 0; i < nr; i++) {
            const row = s.rows[r - 1 + i];
            if (!row) continue;
            for (let j = 0; j < nc; j++) row[c - 1 + j] = '';
          }
        },
        setValue: function (v) { s.rows[r - 1][c - 1] = v; },
        setFontWeight: function () {}
      };
    }
  };
  return s;
}

let SHEETS = {};
let IMPORTED = {};
const book = {
  getSheetByName: function (n) { return SHEETS[n] || null; },
  insertSheet: function (n) { SHEETS[n] = new Sheet(n, []); return SHEETS[n]; },
  getId: function () { return 'book'; },
  getName: function () { return 'fixture'; }
};
const importBook = {
  getSheetByName: function (n) { return IMPORTED[n] || null; },
  getId: function () { return 'imported'; }
};

const sandbox = {
  console: console,
  SpreadsheetApp: {
    getActive: function () { return book; },
    openById: function (id) { return id === 'imported' ? importBook : book; },
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
        get: function () { return null; }, getAll: function () { return {}; },
        put: function () {}, putAll: function () {},
        remove: function () {}, removeAll: function () {}
      };
    }
  },
  LockService: {
    getDocumentLock: function () {
      return { tryLock: function () { return true; }, releaseLock: function () {} };
    }
  },
  Drive: {
    Files: {
      insert: function () { return { id: 'imported' }; },
      remove: function () {}
    }
  },
  MimeType: { GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet' },
  Utilities: {
    formatDate: function () { return '2026-09-12T10:00:00'; },
    base64Decode: function () { return []; },
    newBlob: function () { return {}; }
  }
};

vm.createContext(sandbox);
['Config.gs', 'Repo.gs', 'Auth.gs', 'Warranty.gs', 'WarrantyRules.gs', 'Units.gs',
  'Audit.gs', 'MasterData.gs'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'),
    sandbox, { filename: f });
});
vm.runInContext(
  'globalThis.__api = { SHEET, SCHEMA, INDEX_MEMO, WARRANTY_TYPE, UNIT_IMPORT_MAX,' +
  '  listUnits_, saveUnit_, previewUnitUpdate_, applyUnitUpdate_, importUnits_,' +
  '  unitAdminRow_, checkUnitFields_, findBy_, readAll_ };',
  sandbox, { filename: 'stubs' });

const api = sandbox.__api;
const SHEET = api.SHEET;
const POP_COLS = api.SCHEMA[SHEET.POPULATION];
const SRI = {
  email: 'sri@oji.co.id', name: 'Sri', role: 'Administrator',
  actualRole: 'Administrator', simulatedRole: null, isTester: false, principal: ''
};
const RIAN = {
  email: 'rian@dist.co.id', name: 'Rian', role: 'Requester',
  actualRole: 'Requester', simulatedRole: null, isTester: false, principal: ''
};

/* ------------------------------------------------------------- the fixture */

const RULE_COLS = api.SCHEMA[SHEET.RULES];
const RULES = [
  ['R1', 'MAT-A', 'principal', '*', 'assembly', 24, '', '', true, ''],
  ['R2', 'MAT-A', 'customer', '*', 'installation', 36, '', '', true, ''],
  ['R3', 'MAT-B', 'principal', '*', 'assembly', 24, '', '', true, ''],
  ['R4', 'MAT-B', 'customer', 'distributor', 'received', 24, '', '', true, '']
];

function popRow(u) {
  return POP_COLS.map(function (c) { return u[c] === undefined ? '' : u[c]; });
}

const SEED = [
  { Delivery: 'DEL', SellingInDate: '2024-04-01', Material: 'MAT-A',
    ItemDescription: 'MAT-A analyser', Batch: 'XT2403001', DeliveryQuantity: 1,
    ShipToParty: 'RSUD Koja', Principal: 'Sansin',
    Channel: 'distributor', DistributorID: 'DST-1', InstalledAt: '01/07/2024' },
  // Everything after the principal's own columns is still blank on this one.
  { Delivery: 'DEL', SellingInDate: '2024-04-01', Material: 'MAT-A',
    ItemDescription: 'MAT-A analyser', Batch: 'XT2403002', DeliveryQuantity: 1,
    ShipToParty: 'RSUP Persahabatan', Principal: 'Sansin' },
  { Delivery: 'DEL', SellingInDate: '2024-04-01', Material: 'MAT-B',
    ItemDescription: 'MAT-B analyser', Batch: 'XT2403003', DeliveryQuantity: 1,
    ShipToParty: 'RSUD Koja', Principal: 'Sansin',
    Channel: 'distributor', DistributorID: 'DST-2' }
];

function build() {
  writes = [];
  SHEETS = {
    Population: new Sheet('Population', [POP_COLS.slice()].concat(SEED.map(popRow))),
    Products: new Sheet('Products', [api.SCHEMA[SHEET.PRODUCTS].slice(),
      ['MAT-A', 'MAT-A analyser', 'Sansin', 'AKL', '', true, ''],
      ['MAT-B', 'MAT-B analyser', 'Sansin', 'AKL', '', true, '']]),
    WarrantyRules: new Sheet('WarrantyRules', [RULE_COLS.slice()].concat(RULES)),
    Distributors: new Sheet('Distributors', [api.SCHEMA[SHEET.DISTRIBUTORS].slice(),
      ['DST-1', 'PT Sinar Medika', 'a@x.co.id', true, ''],
      ['DST-2', 'PT Dua Medika', 'b@x.co.id', true, '']]),
    AuditLog: new Sheet('AuditLog', [api.SCHEMA[SHEET.AUDIT].slice()]),
    warranty: new Sheet('warranty', [api.SCHEMA[SHEET.WARRANTY].slice()]),
    Principals: new Sheet('Principals', [api.SCHEMA[SHEET.PRINCIPALS].slice(),
      ['PR1', 'Sansin', true, '']])
  };
  ['population', 'warranty', 'products', 'rules'].forEach(function (k) {
    delete api.INDEX_MEMO[k];
  });
}

function cell(serial, column) {
  const rows = SHEETS.Population.rows;
  const keyAt = rows[0].indexOf('Batch');
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][keyAt]) === serial) return rows[i][rows[0].indexOf(column)];
  }
  return undefined;
}

/* ======================================================= what still needs doing */

build();
const listed = api.listUnits_(SRI, {});
check('the register lists every unit', listed.total === 3, String(listed.total));
check('and says how many still need something',
  listed.incomplete === 2, String(listed.incomplete));

const byserial = {};
listed.rows.forEach(function (r) { byserial[r.serialNumber] = r; });

check('a unit with everything it needs is complete',
  byserial['XT2403001'].complete === true,
  byserial['XT2403001'].missing.join('; '));
check('one with no installation date says which date',
  /installation \(BAST\) date/.test(byserial['XT2403002'].missing.join('; ')),
  byserial['XT2403002'].missing.join('; '));
check('and one missing the date its own rule counts from says that one instead',
  /received the unit/.test(byserial['XT2403003'].missing.join('; ')),
  byserial['XT2403003'].missing.join('; '));
check('a date on the row that nobody can read is called out as unreadable, not as absent',
  (function () {
    build();
    SHEETS.Population.rows[1][POP_COLS.indexOf('InstalledAt')] = '2024-13-45';
    delete api.INDEX_MEMO.population;
    return /not a date the portal can read/.test(
      api.listUnits_(SRI, { search: 'XT2403001' }).rows[0].missing.join('; '));
  })());

build();
check('the work list can be cut to only what is unfinished',
  api.listUnits_(SRI, { incomplete: true }).rows.length === 2);
check('and narrowed to one distributor, which makes it one email',
  api.listUnits_(SRI, { incomplete: true, distributorId: 'DST-2' }).rows.length === 1);
check('and to one model',
  api.listUnits_(SRI, { material: 'MAT-A' }).rows.length === 2);
check('search finds a unit by its hospital, not only by its serial number',
  api.listUnits_(SRI, { search: 'persahabatan' }).rows.length === 1);
check('and the models on the sheet come back so the filter can offer them',
  api.listUnits_(SRI, {}).materials.join() === 'MAT-A,MAT-B',
  api.listUnits_(SRI, {}).materials.join());
check('nobody but an administrator may read the register',
  refuses('listing as a requester', function () { api.listUnits_(RIAN, {}); }) !== '');

/* ============================================================ one unit at a time */

build();
const saved = stage('filling in an installation date', function () {
  return api.saveUnit_(SRI, { Batch: 'XT2403002', InstalledAt: '15/08/2024' });
});
// Read day first, then stored as ISO. Normalising at the point of entry is
// what stops the sheet accumulating cells that mean one thing to a person and
// another to new Date(); the recompute still never rewrites a cell it does not
// own, so a value nobody edited stays exactly as it was typed.
check('a date typed dd/mm/yyyy is stored unambiguously',
  cell('XT2403002', 'InstalledAt') === '2024-08-15',
  String(cell('XT2403002', 'InstalledAt')));
check('and the warranty is worked out again there and then',
  cell('XT2403002', 'WarrantyEndCustomer') === '2027-08-15',
  String(cell('XT2403002', 'WarrantyEndCustomer')));
check('so the unit stops being one that still needs something',
  saved && saved.complete === true, saved ? saved.missing.join('; ') : 'threw');
check('and the change is on the audit trail',
  SHEETS.AuditLog.rows.slice(1).some(function (r) {
    return String(r[api.SCHEMA[SHEET.AUDIT].indexOf('Field')]).indexOf('XT2403002.InstalledAt') !== -1;
  }), JSON.stringify(SHEETS.AuditLog.rows.slice(1).map(function (r) { return r[8] + ' ' + r[9]; })));

check('a date written the American way round is refused rather than stored',
  refuses('saving 08/15/2024', function () {
    api.saveUnit_(SRI, { Batch: 'XT2403002', InstalledAt: '08/15/2024' });
  }).indexOf('no month 15') !== -1,
  refuses('x', function () {
    api.saveUnit_(SRI, { Batch: 'XT2403002', InstalledAt: '08/15/2024' });
  }));

check('saying it was sold through a distributor without saying which one is refused',
  refuses('channel without distributor', function () {
    api.saveUnit_(SRI, { Batch: 'XT2403002', Channel: 'distributor', DistributorID: '' });
  }).indexOf('which one') !== -1);
check('a distributor nobody has on the list is refused',
  refuses('unknown distributor', function () {
    api.saveUnit_(SRI, { Batch: 'XT2403002', Channel: 'distributor', DistributorID: 'DST-9' });
  }).indexOf('not on the distributor list') !== -1);
check('a model with no product row is refused, because it would have no rule either',
  refuses('unknown material', function () {
    api.saveUnit_(SRI, { Batch: 'XT2403002', Material: 'MAT-Z' });
  }).indexOf('not on the product list') !== -1);
check('and a channel that is neither of the two is refused',
  refuses('odd channel', function () {
    api.saveUnit_(SRI, { Batch: 'XT2403002', Channel: 'sideways' });
  }).indexOf('neither direct nor distributor') !== -1);

build();
const registered = stage('registering a unit that is not on the sheet', function () {
  return api.saveUnit_(SRI, {
    isNew: true, Batch: 'xt2403009', Material: 'MAT-A', ShipToParty: 'RS Mitra',
    Channel: 'direct', InstalledAt: '01/02/2025'
  });
});
check('a newly registered unit is on the register', !!api.findBy_(SHEET.POPULATION, 'Batch', 'XT2403009'));
check('with its serial number in the case the register uses',
  registered && registered.serialNumber === 'XT2403009',
  registered ? registered.serialNumber : 'threw');
check('and its warranty already worked out',
  cell('XT2403009', 'WarrantyEndCustomer') === '2028-02-01',
  String(cell('XT2403009', 'WarrantyEndCustomer')));
check('registering one that is already there is refused',
  refuses('registering a duplicate', function () {
    api.saveUnit_(SRI, { isNew: true, Batch: 'XT2403001' });
  }).indexOf('already on the register') !== -1);
check('and editing one that is not there is refused too',
  refuses('editing a stranger', function () {
    api.saveUnit_(SRI, { Batch: 'XT2409999', InstalledAt: '01/02/2025' });
  }).indexOf('not on the register') !== -1);
check('a requester cannot touch the register at all',
  refuses('saving as a requester', function () {
    api.saveUnit_(RIAN, { Batch: 'XT2403001', InstalledAt: '01/02/2025' });
  }) !== '');

/* ================================================= a file, checked before it lands */

build();
const FILE = [
  { __line: 2, Batch: 'XT2403002', InstalledAt: '15/08/2024' },
  { __line: 3, Batch: 'XT2403003', ReceivedAtDistributor: '20/09/2024' },
  { __line: 4, Batch: 'XT2403001', InstalledAt: '09/13/2024' },
  { __line: 5, Batch: 'XT2409999', InstalledAt: '01/01/2025' },
  { __line: 6, Batch: 'XT2403002', InstalledAt: '16/08/2024' },
  { __line: 7, Batch: '', InstalledAt: '01/01/2025' }
];

const preview = stage('previewing a file', function () {
  return api.previewUnitUpdate_(SRI, { rows: FILE });
});
check('the good rows are counted', preview && preview.accepted === 2, String(preview.accepted));
check('and the bad ones are named by line number',
  preview && preview.rejected.map(function (r) { return r.line; }).join() === '4,5,6,7',
  preview ? preview.rejected.map(function (r) { return r.line; }).join() : 'threw');
// Looked up by line rather than by position: a revert that stops rejecting one
// of these must fail the check for that row, not take the whole run down with
// an index that is no longer there.
function why(line) {
  const hit = (preview ? preview.rejected : []).filter(function (r) { return r.line === line; })[0];
  return hit ? hit.reasons.join('; ') : '(line ' + line + ' was accepted)';
}

check('a date nobody can read is refused, and says why',
  /no month 13/.test(why(4)), why(4));
check('a serial number not on the register is refused rather than created',
  /not on the unit register/.test(why(5)), why(5));
check('the same unit twice in one file is refused, naming the earlier line',
  /line 2/.test(why(6)), why(6));
check('and a row with no serial number at all is refused',
  /no serial number/.test(why(7)), why(7));

// The whole safety of an import: it said what it would do, and it did none of it.
check('previewing writes nothing whatsoever',
  cell('XT2403002', 'InstalledAt') === '' && writes.length === 0,
  String(cell('XT2403002', 'InstalledAt')) + ', ' + writes.length + ' writes');

check('and a batch with a rejected row in it will not be written even if asked',
  refuses('applying a batch with rejects', function () {
    api.applyUnitUpdate_(SRI, { rows: FILE });
  }).indexOf('will not accept') !== -1);
check('so still nothing has been written',
  cell('XT2403002', 'InstalledAt') === '', String(cell('XT2403002', 'InstalledAt')));

/* ------------------------------------------------------------ and then it lands */

build();
const good = [
  { __line: 2, Batch: 'XT2403002', InstalledAt: '15/08/2024' },
  { __line: 3, Batch: 'XT2403003', ReceivedAtDistributor: '20/09/2024' }
];
const applied = stage('writing the accepted rows', function () {
  return api.applyUnitUpdate_(SRI, { rows: good });
});
check('both units are written', applied && applied.written === 2, String(applied && applied.written));
check('with the dates read day first and stored unambiguously',
  cell('XT2403002', 'InstalledAt') === '2024-08-15' &&
  cell('XT2403003', 'ReceivedAtDistributor') === '2024-09-20',
  cell('XT2403002', 'InstalledAt') + ' / ' + cell('XT2403003', 'ReceivedAtDistributor'));
check('the warranty columns follow immediately',
  cell('XT2403002', 'WarrantyEndCustomer') === '2027-08-15' &&
  cell('XT2403003', 'WarrantyEndCustomer') === '2026-09-20',
  cell('XT2403002', 'WarrantyEndCustomer') + ' / ' + cell('XT2403003', 'WarrantyEndCustomer'));
check('and the register now says nothing is outstanding',
  api.listUnits_(SRI, { incomplete: true }).rows.length === 0,
  JSON.stringify(api.listUnits_(SRI, { incomplete: true }).rows.map(function (r) {
    return r.serialNumber + ': ' + r.missing.join('; ');
  })));

// A round trip per row does not finish two thousand units inside six minutes.
const importWrites = writes.filter(function (w) {
  return w.sheet === 'Population' && w.rows > 1;
});
const perRow = writes.filter(function (w) { return w.sheet === 'Population' && w.rows === 1; });
check('the file is written a column at a time, never a row at a time',
  perRow.length === 0 && importWrites.length > 0,
  perRow.length + ' single-row writes, ' + importWrites.length + ' column writes');
check('and only the columns the file actually carried are among them',
  importWrites.length <= 2 + 8, importWrites.length + ' column writes');

check('a column the file did not mention is left alone',
  cell('XT2403001', 'DistributorID') === 'DST-1');

/* ============================ the principal's workbook, and what it must not erase */

build();
// An administrator has done the work: channel, distributor, installation date.
api.saveUnit_(SRI, { Batch: 'XT2403002', Channel: 'direct', InstalledAt: '15/08/2024' });
const workDone = cell('XT2403002', 'InstalledAt');
const computed = cell('XT2403002', 'WarrantyEndCustomer');
check('the work is on the row to begin with', workDone === '2024-08-15' && !!computed,
  workDone + ' / ' + computed);

// The principal sends the same workbook again. It carries their eight columns
// and knows nothing about the rest.
const THEIR_COLS = ['Delivery', 'SellingInDate', 'Material', 'ItemDescription', 'Batch',
  'DeliveryQuantity', 'ShipToParty', 'Principal'];
IMPORTED = {
  Population: new Sheet('Population', [THEIR_COLS.slice()].concat(SEED.map(function (u) {
    return THEIR_COLS.map(function (c) { return u[c] === undefined ? '' : u[c]; });
  }))),
  warranty: new Sheet('warranty', [api.SCHEMA[SHEET.WARRANTY].slice()])
};

stage('re-importing the principal workbook', function () {
  return api.importUnits_(SRI, { data: 'x', fileName: 'units.xlsx' });
});

check('the principal\'s own columns are refreshed',
  cell('XT2403002', 'ItemDescription') === 'MAT-A analyser');
// This is the one that would have gone unnoticed for months: warranties that
// simply stopped being computable, with nothing to say what had happened.
check('but the installation date an administrator filled in survives the import',
  cell('XT2403002', 'InstalledAt') === '2024-08-15',
  String(cell('XT2403002', 'InstalledAt')));
check('and so does the channel',
  cell('XT2403002', 'Channel') === 'direct', String(cell('XT2403002', 'Channel')));
check('and the warranty is still worked out',
  cell('XT2403002', 'WarrantyEndCustomer') === computed,
  cell('XT2403002', 'WarrantyEndCustomer') + ' against ' + computed);

/* ================================================== and what the browser does first */

const clientBox = {
  console: console,
  document: {
    getElementById: function () {
      return { innerHTML: '', hidden: false, children: [], value: '', checked: false,
        addEventListener: function () {}, querySelectorAll: function () { return []; } };
    },
    createElement: function () { return { dataset: {}, children: [], style: {},
      appendChild: function () {}, addEventListener: function () {} }; },
    body: { appendChild: function () {} },
    querySelectorAll: function () { return []; },
    addEventListener: function () {}
  },
  window: { APP_CLIENT_ID: 'stub.apps.googleusercontent.com' },
  google: { script: { run: {} } },
  setTimeout: setTimeout,
  clearTimeout: clearTimeout
};
vm.createContext(clientBox);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'src', 'Script.html'), 'utf8')
    .replace(/^[\s\S]*?<script>/, '').replace(/<\/script>\s*$/, '') +
  '\nglobalThis.__client = { parseDelimited, guessMapping, mappedRows, normaliseHeader };',
  clientBox, { filename: 'client' });
const C = clientBox.__client;

// Excel writes a comma here and a semicolon there depending on where it was
// saved. Assuming one of them turns every row into a single column.
const commas = C.parseDelimited('Serial,Installed\nXT2403001,15/08/2024');
check('a comma-separated file is read as columns',
  commas.header.join('|') === 'Serial|Installed' && commas.rows[0][1] === '15/08/2024',
  JSON.stringify(commas));
const semis = C.parseDelimited('Serial;Installed\nXT2403001;15/08/2024');
check('and so is a semicolon-separated one, which is what Indonesian Excel writes',
  semis.rows[0][1] === '15/08/2024', JSON.stringify(semis));
const tabs = C.parseDelimited('Serial\tInstalled\nXT2403001\t15/08/2024');
check('and so is a block pasted straight out of a spreadsheet',
  tabs.rows[0][1] === '15/08/2024', JSON.stringify(tabs));

const quoted = C.parseDelimited('Serial,Hospital\nXT2403001,"RSUD Koja, Jakarta Utara"');
check('a comma inside a quoted field does not split it',
  quoted.rows[0][1] === 'RSUD Koja, Jakarta Utara', JSON.stringify(quoted.rows[0]));

const mapping = C.guessMapping(['Serial Number', 'Tanggal Instalasi', 'Distributor']);
check('columns map themselves when the header says what they are',
  mapping.Batch === 0 && mapping.InstalledAt === 1 && mapping.DistributorID === 2,
  JSON.stringify(mapping));
check('a column nobody recognises is simply not mapped',
  C.guessMapping(['Something Else']).Batch === undefined);

const mapped = C.mappedRows(
  C.parseDelimited('Serial,Installed\nXT2403001,15/08/2024\n\nXT2403002,16/08/2024'),
  { Batch: 0, InstalledAt: 1 });
check('blank lines in the file do not become rows',
  mapped.length === 2, String(mapped.length));
// The line number is what makes a rejection actionable, so it has to survive
// whatever the file did with blank lines.
check('and every row keeps the line it came from',
  mapped[0].__line === 2 && mapped[1].__line === 4,
  JSON.stringify(mapped.map(function (r) { return r.__line; })));

/* ------------------------------------------------------------------ report */

console.log('verify-unit-admin: ' + pass + ' checks passed' +
  (failures.length ? ', ' + failures.length + ' FAILED' : ''));
failures.forEach(function (f) { console.log('  FAIL  ' + f); });
process.exit(failures.length ? 1 : 0);
