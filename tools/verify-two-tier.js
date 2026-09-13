/**
 * verify-two-tier.js — two warranties on one claim, and the one nobody outside
 * the company may see.
 *
 * The portal used to answer one question: does the principal still cover this
 * unit. The question the board actually asks is the other one — how much are we
 * covering that the principal no longer does — and the two answers differ often
 * enough that a single column could never carry both.
 *
 * FOUR QUADRANTS, NOT TWO. Both covering, both finished, and the two mixed
 * cases. Only one of the four costs us money, and CostBorne has to be true in
 * exactly that one.
 *
 * A PHOTOGRAPH, NOT A POINTER. What a claim recorded is what was true when it
 * was filed. Correcting a unit's installation date next month must not rewrite
 * a decision taken last month.
 *
 * AND THE LEAK. A principal is a partner outside the company; whether we are
 * still covering a unit they have stopped covering is our position in that
 * negotiation. It must not reach them on a screen, in a claim, or — the one
 * that is easy to forget, because it never passes the dispatcher — in the
 * Excel file the server writes to Drive.
 *
 *   node tools/verify-two-tier.js
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

function Sheet(name, rows) {
  const s = {
    rows: rows,
    getName: function () { return name; },
    getLastRow: function () { return s.rows.length; },
    getLastColumn: function () { return s.rows.length ? s.rows[0].length : 0; },
    setFrozenRows: function () {},
    setName: function () {},
    appendRow: function (row) {
      const width = s.getLastColumn();
      const line = row.slice();
      while (line.length < width) line.push('');
      s.rows.push(line);
    },
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
        setValue: function (v) { s.rows[r - 1][c - 1] = v; },
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
  getId: function () { return 'book'; },
  getName: function () { return 'fixture'; }
};

// What the export writes, caught before it tries to reach Drive.
let exported = null;
const tempBook = {
  getId: function () { return 'temp'; },
  getSheets: function () {
    return [{
      setName: function () {},
      setFrozenRows: function () {},
      getRange: function (r, c, nr, nc) {
        return {
          setValues: function (v) { if (nr > 1 || !exported) exported = v; },
          setFontWeight: function () {}
        };
      }
    }];
  }
};

const sandbox = {
  console: console,
  SpreadsheetApp: {
    getActive: function () { return book; },
    openById: function () { return book; },
    create: function () { return tempBook; },
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
  // The export stops here, having already written its rows.
  UrlFetchApp: { fetch: function () { throw new Error('no network in a fixture'); } },
  ScriptApp: { getOAuthToken: function () { return 't'; } },
  DriveApp: {
    getFileById: function () { return { setTrashed: function () {} }; },
    Access: { ANYONE_WITH_LINK: 1 },
    Permission: { VIEW: 1 }
  },
  Utilities: {
    formatDate: function (d, tz, fmt) {
      if (fmt === 'yyyy') return '2025';
      if (fmt === 'yyMMdd') return '250601';
      return '2025-06-01T09:00:00';
    }
  }
};

vm.createContext(sandbox);
['Config.gs', 'Repo.gs', 'Auth.gs', 'Warranty.gs', 'WarrantyRules.gs', 'Units.gs',
  'Audit.gs', 'Visits.gs', 'MasterData.gs', 'Claims.gs', 'Export.gs', 'Code.gs'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'),
    sandbox, { filename: f });
});
vm.runInContext([
  'globalThis.sendMail_ = function () { return { Status: "Sent" }; };',
  'globalThis.attachmentsFor_ = function () { return []; };',
  'globalThis.notifyAmendment_ = function () {};',
  'globalThis.claimFolderLink_ = function () { return function () { return ""; }; };',
  'globalThis.rootFolder_ = function () { throw new Error("no Drive in a fixture"); };',
  'globalThis.__api = { SHEET, SCHEMA, INDEX_MEMO, WARRANTY_TYPE, CUSTOMER_WARRANTY_TYPE,',
  '  saveClaim_, listClaims_, getClaim_, overrideWarranty_, exportClaims_,',
  '  redactForRole_, recomputeUnitWarranty_, claimWarranty_, findBy_, update_,',
  '  CUSTOMER_SIDE_FIELDS };'
].join('\n'), sandbox, { filename: 'stubs' });

const api = sandbox.__api;
const SHEET = api.SHEET;

const SRI = {
  email: 'sri@oji.co.id', name: 'Sri', role: 'Administrator',
  actualRole: 'Administrator', simulatedRole: null, isTester: false, principal: ''
};
const RIAN = {
  email: 'rian@dist.co.id', name: 'Rian', role: 'Requester',
  actualRole: 'Requester', simulatedRole: null, isTester: false, principal: ''
};
const SANSIN = {
  email: 'order@sansin.co.jp', name: 'Sansin', role: 'Principal',
  actualRole: 'Principal', simulatedRole: null, isTester: false, principal: 'Sansin'
};

/* ------------------------------------------------------------- the fixture */

const POP_COLS = api.SCHEMA[SHEET.POPULATION];
const RULE_COLS = api.SCHEMA[SHEET.RULES];

function rule(id, material, scope, basis, months) {
  return [id, material, scope, '*', basis, months, '', '', true, ''];
}

// Today is 1 June 2025. Assembly is Mar 2024, installation 1 Jul 2024.
//   principal in  = assembly + 36  -> Mar 2027      principal out = + 12 -> Mar 2025
//   ours in       = installed + 36 -> 1 Jul 2027    ours out      = +  6 -> 1 Jan 2025
const RULES = [
  rule('P1', 'MAT-Q1', 'principal', 'assembly', 36),
  rule('C1', 'MAT-Q1', 'customer', 'installation', 36),
  rule('P2', 'MAT-Q2', 'principal', 'assembly', 36),
  rule('C2', 'MAT-Q2', 'customer', 'installation', 6),
  rule('P3', 'MAT-Q3', 'principal', 'assembly', 12),
  rule('C3', 'MAT-Q3', 'customer', 'installation', 36),
  rule('P4', 'MAT-Q4', 'principal', 'assembly', 12),
  rule('C4', 'MAT-Q4', 'customer', 'installation', 6),
  // A fifth unit whose own side cannot be worked out: the rule counts from the
  // date the distributor received it and nobody has recorded one.
  rule('P5', 'MAT-Q5', 'principal', 'assembly', 12),
  rule('C5', 'MAT-Q5', 'customer', 'received', 36)
];

const QUADRANTS = ['MAT-Q1', 'MAT-Q2', 'MAT-Q3', 'MAT-Q4'];
// Assembled March 2024, which the serial number has to be able to say: the
// principal rules here count from the assembly month and nothing else carries
// it. A serial the pattern cannot read makes every one of these units Manual.
const SERIAL = ['XT2403001', 'XT2403002', 'XT2403003', 'XT2403004'];

function popRow(serial, material, extra) {
  const u = Object.assign({
    Delivery: 'DEL', SellingInDate: '2024-04-01', Material: material,
    ItemDescription: material + ' analyser', Batch: serial, DeliveryQuantity: 1,
    ShipToParty: 'RSUD Koja', Principal: 'Sansin',
    Channel: 'distributor', DistributorID: 'DST-1', CustomerID: 'C1',
    InstalledAt: '01/07/2024'
  }, extra || {});
  return POP_COLS.map(function (c) { return u[c] === undefined ? '' : u[c]; });
}

function build() {
  SHEETS = {
    Claims: new Sheet('Claims', [api.SCHEMA[SHEET.CLAIMS].slice()]),
    ClaimItems: new Sheet('ClaimItems', [api.SCHEMA[SHEET.ITEMS].slice()]),
    AuditLog: new Sheet('AuditLog', [api.SCHEMA[SHEET.AUDIT].slice()]),
    Attachments: new Sheet('Attachments', [api.SCHEMA[SHEET.ATTACHMENTS].slice()]),
    Customer: new Sheet('Customer', [['CustomerID', 'Name', 'Active'],
      ['C1', 'RSUD Koja', true]]),
    sparepart: new Sheet('sparepart', [['PartID', 'Name', 'Active'],
      ['P1', 'Blood Pump Rotor', true]]),
    Principals: new Sheet('Principals', [api.SCHEMA[SHEET.PRINCIPALS].slice(),
      ['PR1', 'Sansin', true, '']]),
    Distributors: new Sheet('Distributors', [api.SCHEMA[SHEET.DISTRIBUTORS].slice(),
      ['DST-1', 'PT Sinar Medika', 'ops@sinarmedika.co.id', true, '']]),
    Products: new Sheet('Products', [api.SCHEMA[SHEET.PRODUCTS].slice()]
      .concat(QUADRANTS.concat(['MAT-Q5']).map(function (m) {
        return [m, m, 'Sansin', 'AKL', '', true, ''];
      }))),
    WarrantyRules: new Sheet('WarrantyRules', [RULE_COLS.slice()].concat(RULES)),
    warranty: new Sheet('warranty', [api.SCHEMA[SHEET.WARRANTY].slice()]),
    Population: new Sheet('Population', [POP_COLS.slice()].concat(
      QUADRANTS.map(function (m, n) { return popRow(SERIAL[n], m); }),
      [popRow('XT2403005', 'MAT-Q5')]))
  };
  ['population', 'warranty', 'products', 'rules'].forEach(function (k) {
    delete api.INDEX_MEMO[k];
  });
}

function fileClaim(serial) {
  return api.saveClaim_(RIAN, {
    customerId: 'C1', serialNumber: serial, problem: 'Leaking pump',
    items: [{ partId: 'P1', qty: 1 }]
  });
}

function claimRow(id) { return api.findBy_(SHEET.CLAIMS, 'ClaimID', id); }

/* ================================================== the four quadrants */

build();
const filed = QUADRANTS.map(function (m, n) {
  return stage('filing a claim on ' + m, function () { return fileClaim(SERIAL[n]); });
});

check('a claim is filed on each of the four units',
  filed.every(function (c) { return c && c.claimId; }),
  JSON.stringify(filed.map(function (c) { return c && c.claimId; })));

const rows = filed.map(function (c) { return c && claimRow(c.claimId); });

check('both covering: the principal side says so',
  rows[0].WarrantyType === api.WARRANTY_TYPE.PRINCIPAL, String(rows[0].WarrantyType));
check('and our side says so too',
  rows[0].CustomerWarrantyType === api.CUSTOMER_WARRANTY_TYPE.IN,
  String(rows[0].CustomerWarrantyType));
check('and nothing is being absorbed', rows[0].CostBorne === false,
  String(rows[0].CostBorne));

check('the principal covering while ours has ended is not a cost to us',
  rows[1].WarrantyType === api.WARRANTY_TYPE.PRINCIPAL &&
  rows[1].CustomerWarrantyType === api.CUSTOMER_WARRANTY_TYPE.OUT &&
  rows[1].CostBorne === false,
  rows[1].WarrantyType + ' / ' + rows[1].CustomerWarrantyType + ' / ' + rows[1].CostBorne);

// The quadrant the whole design exists for.
check('the principal finished while we are still covering it IS a cost to us',
  rows[2].WarrantyType === api.WARRANTY_TYPE.OUT &&
  rows[2].CustomerWarrantyType === api.CUSTOMER_WARRANTY_TYPE.IN &&
  rows[2].CostBorne === true,
  rows[2].WarrantyType + ' / ' + rows[2].CustomerWarrantyType + ' / ' + rows[2].CostBorne);

check('and neither of us covering it is a spare-part sale, not a cost',
  rows[3].WarrantyType === api.WARRANTY_TYPE.OUT &&
  rows[3].CustomerWarrantyType === api.CUSTOMER_WARRANTY_TYPE.OUT &&
  rows[3].CostBorne === false,
  rows[3].WarrantyType + ' / ' + rows[3].CustomerWarrantyType + ' / ' + rows[3].CostBorne);

check('exactly one of the four is absorbed',
  rows.filter(function (r) { return r.CostBorne === true; }).length === 1);

// "Nobody covers this" and "nobody has worked it out yet" are different
// answers, and only one of them is a cost anybody can put a figure against.
const unchecked = claimRow(stage('filing a claim on a unit we cannot work out',
  function () { return fileClaim('XT2403005'); }).claimId);
check('a claim whose own side is still to be checked is not counted as absorbed',
  unchecked.CostBorne === false &&
  unchecked.CustomerWarrantyType === api.WARRANTY_TYPE.MANUAL,
  unchecked.CustomerWarrantyType + ' / ' + unchecked.CostBorne);
check('even though the principal has certainly stopped covering it',
  unchecked.WarrantyType === api.WARRANTY_TYPE.OUT, String(unchecked.WarrantyType));
check('and it says what is missing rather than giving a date',
  /received the unit/.test(String(unchecked.CustomerWarrantyBasis)),
  String(unchecked.CustomerWarrantyBasis));

check('the two sides expire on different dates, and the claim keeps both',
  rows[2].WarrantyExpiry === '2025-03' && rows[2].CustomerWarrantyExpiry === '2027-07-01',
  rows[2].WarrantyExpiry + ' / ' + rows[2].CustomerWarrantyExpiry);
check('with the working for our side, not only the date',
  /installed 1 Jul 2024 \+ 36 months/.test(String(rows[2].CustomerWarrantyBasis)),
  String(rows[2].CustomerWarrantyBasis));
check('and a stamp saying when the photograph was taken',
  !!rows[2].WarrantySnapshotAt, String(rows[2].WarrantySnapshotAt));

/* ------------------------------------------------- distributor and hospital */

check('a claim through a distributor names the distributor',
  rows[0].DistributorID === 'DST-1' && rows[0].DistributorName === 'PT Sinar Medika',
  rows[0].DistributorID + ' / ' + rows[0].DistributorName);
check('and the hospital as well, because the same hospital buys from several',
  rows[0].CustomerName === 'RSUD Koja', String(rows[0].CustomerName));

/* ================================================ a photograph, not a pointer */

// The unit's installation date turns out to be wrong and is corrected. The
// claim already filed decided what it decided.
const wasExpiry = rows[2].CustomerWarrantyExpiry;
const installedAt = POP_COLS.indexOf('InstalledAt');
SHEETS.Population.rows[3][installedAt] = '01/07/2019';
delete api.INDEX_MEMO.population;

// Read back the way a screen reads it, not off the sheet: a claim that
// resolved its warranty as it was drawn would pass a check against the row and
// still show the wrong answer to everybody.
const afterFix = api.getClaim_(SRI, filed[2].claimId);
check('correcting a unit does not rewrite a claim already filed',
  afterFix.customerWarrantyExpiry === wasExpiry,
  afterFix.customerWarrantyExpiry + ' against ' + wasExpiry);
check('nor the quadrant it was filed in', afterFix.costBorne === true);
check('nor the principal side of it',
  afterFix.warrantyExpiry === '2025-03', String(afterFix.warrantyExpiry));

// But a new claim on the same unit reads the corrected data.
const later = stage('filing a second claim after the correction', function () {
  return fileClaim(SERIAL[2]);
});
check('while a claim filed after the correction reads the new date',
  later && claimRow(later.claimId).CustomerWarrantyExpiry === '2022-07-01',
  later ? String(claimRow(later.claimId).CustomerWarrantyExpiry) : 'threw');
SHEETS.Population.rows[3][installedAt] = '01/07/2024';
delete api.INDEX_MEMO.population;

/* -------------------------------------------- an override moves the quadrant */

build();
const q3 = fileClaim(SERIAL[2]);
check('the claim starts as one we absorb', claimRow(q3.claimId).CostBorne === true);

api.update_(SHEET.CLAIMS, 'ClaimID', q3.claimId, { Status: 'Submitted' });
const overridden = stage('overriding the principal warranty', function () {
  return api.overrideWarranty_(SRI, {
    claimId: q3.claimId, warrantyType: api.WARRANTY_TYPE.PRINCIPAL,
    reason: 'Confirmed by the principal in writing'
  });
});
check('an administrator saying the principal still covers it clears the absorption',
  overridden && claimRow(q3.claimId).CostBorne === false,
  overridden ? String(claimRow(q3.claimId).CostBorne) : 'threw');
check('and the claim still remembers what we owe the buyer',
  claimRow(q3.claimId).CustomerWarrantyType === api.CUSTOMER_WARRANTY_TYPE.IN);

// An override freezes the warranty until the serial number itself changes, and
// it has to freeze both tiers: half a photograph moving while the other half
// stands is worse than either, because the two would then disagree about the
// same unit on the same screen.
const frozenExpiry = claimRow(q3.claimId).CustomerWarrantyExpiry;
SHEETS.Population.rows[3][POP_COLS.indexOf('InstalledAt')] = '01/07/2015';
delete api.INDEX_MEMO.population;
stage('re-saving an overridden claim', function () {
  return api.saveClaim_(SRI, {
    claimId: q3.claimId, rowVersion: claimRow(q3.claimId).RowVersion,
    customerId: 'C1', serialNumber: SERIAL[2], problem: 'Leaking pump, still',
    items: [{ partId: 'P1', qty: 1 }]
  });
});
check('re-saving an overridden claim does not move our side of the snapshot',
  claimRow(q3.claimId).CustomerWarrantyExpiry === frozenExpiry,
  claimRow(q3.claimId).CustomerWarrantyExpiry + ' against ' + frozenExpiry);
check('nor the absorption the override settled',
  claimRow(q3.claimId).CostBorne === false, String(claimRow(q3.claimId).CostBorne));

/* ========================================== what a principal is not handed */

build();
const all = QUADRANTS.map(function (m, n) { return fileClaim(SERIAL[n]); });
all.forEach(function (c) {
  api.update_(SHEET.CLAIMS, 'ClaimID', c.claimId, { Status: 'In Review' });
});

const adminRows = api.listClaims_(SRI, { tab: 'all', items: 'none' }).rows;
check('an administrator is shown our side of it',
  adminRows.length === 4 &&
  adminRows.every(function (r) { return r.customerWarrantyType !== undefined; }),
  JSON.stringify(adminRows.map(function (r) { return r.customerWarrantyType; })));
check('and which ones we absorb',
  adminRows.filter(function (r) { return r.costBorne; }).length === 1);

// A principal sees only the claims on their own units that are still theirs to
// cover — two of these four. That rule predates this work and is not what is
// being tested here; what matters is what those two rows carry.
const theirRows = api.listClaims_(SANSIN, { tab: 'all', items: 'none' }).rows;
check('the principal sees the claims that are theirs to answer',
  theirRows.length === 2, String(theirRows.length));

function leaked(objects) {
  const found = [];
  objects.forEach(function (o) {
    api.CUSTOMER_SIDE_FIELDS.forEach(function (f) {
      if (o && Object.prototype.hasOwnProperty.call(o, f)) found.push(f);
    });
  });
  return found;
}

check('but not one field of our side of them, in the list',
  leaked(theirRows).length === 0, leaked(theirRows).join(', '));

// Named literally rather than read off CUSTOMER_SIDE_FIELDS: a check that asks
// the list what is on the list agrees with itself even when a field is dropped
// from it, which is exactly how these two went out unredacted for two commits.
check('and specifically not who sold the machine, which is our trade route',
  theirRows.every(function (r) {
    return r.distributorName === undefined && r.distributorId === undefined;
  }), JSON.stringify(theirRows.map(function (r) { return r.distributorName; })));
check('while the administrator still gets it',
  adminRows.every(function (r) { return r.distributorName === 'PT Sinar Medika'; }),
  JSON.stringify(adminRows.map(function (r) { return r.distributorName; })));

const theirDetail = api.getClaim_(SANSIN, all[0].claimId);
check('nor in the claim they open',
  leaked([theirDetail]).length === 0, leaked([theirDetail]).join(', '));
check('while the administrator opening the same claim does see it',
  api.getClaim_(SRI, all[2].claimId).costBorne === true);

// The dispatcher strips it again, for whatever gets written after today.
const throughApi = api.redactForRole_(SANSIN, {
  rows: [{ claimId: 'X', costBorne: true, customerWarrantyType: 'Under Our Warranty' }],
  nested: { deep: [{ customerWarrantyBasis: 'installed…' }] }
});
check('and the dispatcher strips the same fields wherever they are nested',
  leaked([throughApi.rows[0], throughApi.nested.deep[0]]).length === 0,
  JSON.stringify(throughApi));
check('without stripping anything else', throughApi.rows[0].claimId === 'X');
// A list that comes back as an object keyed "0" is not a list, and the page
// draws nothing.
check('and a list of claims is still a list afterwards',
  Array.isArray(throughApi.rows) && Array.isArray(throughApi.nested.deep),
  Object.prototype.toString.call(throughApi.rows));
check('and without touching what an administrator is sent',
  api.redactForRole_(SRI, { rows: [{ costBorne: true }] }).rows[0].costBorne === true);

/* ------------------------------------------------------------- the export */

// The file is written on the server and handed over as a Drive link. It never
// passes the dispatcher, so a payload filter alone would not have covered it.
exported = null;
stage('exporting as the administrator', function () {
  try { api.exportClaims_(SRI, { tab: 'all' }); } catch (e) { /* stops at Drive */ }
});
const adminSheet = exported;
check('the administrator export names our side in its header',
  adminSheet && adminSheet[0].indexOf('Our warranty') !== -1,
  adminSheet ? adminSheet[0].join(' | ') : 'nothing written');
check('and says which claims we absorb',
  adminSheet && adminSheet.slice(1).filter(function (r) {
    return r.indexOf('Yes') !== -1;
  }).length === 1);
check('and who sold the machine',
  adminSheet && adminSheet[1].indexOf('PT Sinar Medika') !== -1,
  adminSheet ? adminSheet[1].join(' | ') : '');

exported = null;
stage('exporting as the principal', function () {
  try { api.exportClaims_(SANSIN, { tab: 'all' }); } catch (e) { /* stops at Drive */ }
});
const theirSheet = exported;
check('the principal export has their claims in it',
  theirSheet && theirSheet.length === 3, theirSheet ? String(theirSheet.length) : 'nothing');
check('but no column for our side of the warranty',
  theirSheet && ['Our warranty', 'Our warranty basis', 'Cost borne by us', 'Distributor']
    .every(function (c) { return theirSheet[0].indexOf(c) === -1; }),
  theirSheet ? theirSheet[0].join(' | ') : '');
check('and nothing in the rows that says it either',
  theirSheet && theirSheet.slice(1).every(function (r) {
    return r.every(function (cell) {
      return !/Under Our Warranty|Out of Our Warranty/.test(String(cell));
    });
  }));

/* ------------------------------------------------- the filter is not theirs */

build();
QUADRANTS.forEach(function (m, n) {
  const c = fileClaim(SERIAL[n]);
  api.update_(SHEET.CLAIMS, 'ClaimID', c.claimId, { Status: 'In Review' });
});

check('an administrator can ask for only the claims we absorb',
  api.listClaims_(SRI, { tab: 'all', items: 'none', costBorne: true }).rows.length === 1,
  String(api.listClaims_(SRI, { tab: 'all', items: 'none', costBorne: true }).rows.length));
check('a principal asking the same question is not answered by it',
  api.listClaims_(SANSIN, { tab: 'all', items: 'none', costBorne: true }).rows.length === 2,
  String(api.listClaims_(SANSIN, { tab: 'all', items: 'none', costBorne: true }).rows.length));
check('and a view saved with the box unticked does not filter',
  api.listClaims_(SRI, { tab: 'all', items: 'none', costBorne: 'false' }).rows.length === 4,
  String(api.listClaims_(SRI, { tab: 'all', items: 'none', costBorne: 'false' }).rows.length));
check('filtering by distributor finds them',
  api.listClaims_(SRI, { tab: 'all', items: 'none', distributorId: 'DST-1' }).rows.length === 4);
check('and by one that sold nothing, finds none',
  api.listClaims_(SRI, { tab: 'all', items: 'none', distributorId: 'DST-9' }).rows.length === 0);

/* ================================================== and what is drawn */

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
  '\nglobalThis.__client = { S, claimTable, ourWarrantyPill, noCoverWarning,' +
  '  blankFilters, VIEW_FIELDS, STATUS, ITEM, WARRANTY, OUR_WARRANTY, ROLE };',
  clientBox, { filename: 'client' });
const C = clientBox.__client;

let n = 0;
function shaped(extra) {
  n++;
  return Object.assign({
    claimId: 'CLM-' + n, refNo: 'CW010625', status: C.STATUS.IN_REVIEW,
    warrantyType: C.WARRANTY.OUT, customerName: 'RSUD Koja',
    distributorName: 'PT Sinar Medika',
    customerWarrantyType: C.OUR_WARRANTY.IN, customerWarrantyExpiry: '2027-07-01',
    costBorne: true,
    serialNumber: 'XT240300' + n, requesterName: 'Rian', workOrderNo: 'WO-' + n,
    principal: 'Sansin', createdAt: '2025-06-01T09:00:00', submittedAt: '2025-06-01T09:30:00',
    ageDays: 2, rowVersion: 1, itemsLoaded: true, isNew: false,
    items: [{ itemId: 'I' + n, partName: 'Rotor', qty: 1, itemStatus: C.ITEM.PENDING }],
    summary: { itemCount: 1, approved: 0, rejected: 0, pending: 1, shipped: 0,
      advance: 0, advanceQueue: 1, awaitingReturn: 0 }
  }, extra || {});
}

C.S.session = { email: 'sri@oji.co.id', role: C.ROLE.ADMIN, isTester: false };
C.S.tab = 'all';
C.S.group = 'none';
C.S.collapsed = {};
C.S.pick = {};
C.S.reference = { distributors: [{ id: 'DST-1', name: 'PT Sinar Medika' }] };
C.S.filters = C.blankFilters();
C.S.rows = [shaped()];
const adminHtml = C.claimTable();

check('the administrator sees both warranties on the row',
  /p-no/.test(adminHtml) && /Ours to/.test(adminHtml), adminHtml.slice(0, 40));
check('and a marker on the one we absorb', /p-cost/.test(adminHtml));
check('and who sold the machine, under the hospital',
  /via PT Sinar Medika/.test(adminHtml));

C.S.session = { email: 'rian@dist.co.id', role: C.ROLE.REQUESTER, isTester: false };
const fieldHtml = C.claimTable();
check('a field engineer is not shown our accounting position',
  !/p-cost/.test(fieldHtml) && !/Ours to/.test(fieldHtml));

C.S.session = { email: 'order@sansin.co.jp', role: C.ROLE.PRINCIPAL, isTester: false };
check('and neither is the principal, even if a row somehow carried it',
  C.ourWarrantyPill(shaped()) === '');
const principalHtml = C.claimTable();
check('nor is the distributor drawn on a principal\'s row',
  !/via PT Sinar Medika/.test(principalHtml));
check('though the hospital still is — that is their claim',
  /RSUD Koja/.test(principalHtml));

check('the saved-view fields carry the new filters',
  C.VIEW_FIELDS.indexOf('costBorne') !== -1 && C.VIEW_FIELDS.indexOf('distributorId') !== -1,
  C.VIEW_FIELDS.join(', '));
check('and a blank filter set starts with the box unticked, not with a string',
  C.blankFilters().costBorne === false, JSON.stringify(C.blankFilters().costBorne));

/* ------------------------------------------------- the warning before submit */

check('outside both warranties, the form says so before the claim is sent',
  /outside both warranties/.test(C.noCoverWarning({
    warranty: { type: C.WARRANTY.OUT },
    customerWarranty: { type: C.OUR_WARRANTY.OUT }
  })));
check('inside ours, it says nothing',
  C.noCoverWarning({
    warranty: { type: C.WARRANTY.OUT },
    customerWarranty: { type: C.OUR_WARRANTY.IN }
  }) === '');
check('inside theirs, it says nothing',
  C.noCoverWarning({
    warranty: { type: C.WARRANTY.PRINCIPAL },
    customerWarranty: { type: C.OUR_WARRANTY.OUT }
  }) === '');
// "Nobody covers this" and "nobody has worked it out yet" are not the same
// sentence, and only one of them is something to warn a person about.
check('and with our side still to be checked, it says nothing either',
  C.noCoverWarning({
    warranty: { type: C.WARRANTY.OUT },
    customerWarranty: { type: C.OUR_WARRANTY.MANUAL }
  }) === '');

/* ------------------------------------------------------------------ report */

console.log('verify-two-tier: ' + pass + ' checks passed' +
  (failures.length ? ', ' + failures.length + ' FAILED' : ''));
failures.forEach(function (f) { console.log('  FAIL  ' + f); });
process.exit(failures.length ? 1 : 0);
