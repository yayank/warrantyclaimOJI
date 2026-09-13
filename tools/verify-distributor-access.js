/**
 * verify-distributor-access.js — one account per distributor, and what it sees.
 *
 * A distributor account belongs to the company, not to a person: whoever sits
 * behind it may change and the claim history stays where it is. Our own field
 * service is the other way round — one account each, because the person is
 * answerable for the claim.
 *
 * THE TRAP, AND MOST OF THIS FILE. A claim carries TWO distributor columns.
 * DistributorID comes from the unit and says who sold the machine.
 * RequesterDistributorID comes from the account and says on whose behalf the
 * claim was filed. They agree almost always — and disagree exactly when our own
 * field service attends a machine a distributor sold. Scoping on the unit's
 * column would hand that claim to the distributor, which is the single thing
 * this access rule exists to prevent, and it would look correct in every
 * fixture where the two columns happen to match.
 *
 * SO THE FIXTURE MAKES THEM DISAGREE. Two distributors, one hospital, and a
 * claim of our own on each of their machines.
 *
 *   node tools/verify-distributor-access.js
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
function refuses(fn) {
  try { fn(); return ''; } catch (e) { return String(e.message || e); }
}

/* ---------------------------------------------------------- a spreadsheet */

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
  insertSheet: function (n) { SHEETS[n] = new Sheet(n, []); return SHEETS[n]; },
  getId: function () { return 'book'; },
  getName: function () { return 'fixture'; }
};

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
  Utilities: {
    formatDate: function (d, tz, fmt) {
      if (fmt === 'yyyy') return '2026';
      if (fmt === 'yyMMdd') return '260913';
      return '2026-09-13T09:00:00';
    }
  }
};

vm.createContext(sandbox);
['Config.gs', 'Repo.gs', 'Auth.gs', 'Warranty.gs', 'WarrantyRules.gs', 'Units.gs',
  'Audit.gs', 'Visits.gs', 'MasterData.gs', 'Claims.gs', 'Setup.gs'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'),
    sandbox, { filename: f });
});
vm.runInContext([
  'globalThis.sendMail_ = function () { return { Status: "Sent" }; };',
  'globalThis.attachmentsFor_ = function () { return []; };',
  'globalThis.auditForClaim_ = function () { return []; };',
  'globalThis.notifyAmendment_ = function () {};',
  'globalThis.__api = { SHEET, SCHEMA, INDEX_MEMO, ROLE, STATUS, WARRANTY_TYPE,',
  '  visibleClaims_, saveClaim_, saveMaster_, listClaims_, findBy_, readAll_,',
  '  backfillRequesterDistributor_ };'
].join('\n'), sandbox, { filename: 'stubs' });

const api = sandbox.__api;
const SHEET = api.SHEET;
const CLAIM_COLS = api.SCHEMA[SHEET.CLAIMS];
const POP_COLS = api.SCHEMA[SHEET.POPULATION];

/* --------------------------------------------------------- the people */

function session(extra) {
  return Object.assign({
    email: '', name: '', role: api.ROLE.REQUESTER, actualRole: api.ROLE.REQUESTER,
    simulatedRole: null, isTester: false, principal: '', distributor: ''
  }, extra);
}

const SATU = session({ email: 'ops@sinar.co.id', name: 'PT Sinar Medika', distributor: 'DST-1' });
const DUA = session({ email: 'ops@dua.co.id', name: 'PT Dua Medika', distributor: 'DST-2' });
const BUDI = session({ email: 'budi@oji.co.id', name: 'Budi' });
const SITI = session({ email: 'siti@oji.co.id', name: 'Siti' });
const SRI = session({
  email: 'sri@oji.co.id', name: 'Sri',
  role: api.ROLE.ADMIN, actualRole: api.ROLE.ADMIN
});

/* ------------------------------------------------------------- fixture */

function popRow(serial, distributorId) {
  const u = {
    Delivery: 'DEL', SellingInDate: '2024-04-01', Material: 'MAT-A',
    ItemDescription: 'MAT-A analyser', Batch: serial, DeliveryQuantity: 1,
    ShipToParty: 'RSUD Koja', Principal: 'Sansin',
    Channel: 'distributor', DistributorID: distributorId, CustomerID: 'C1'
  };
  return POP_COLS.map(function (c) { return u[c] === undefined ? '' : u[c]; });
}

// One hospital, two distributors. The owner's rule: a distributor must not see
// another requester's claims even at the same hospital.
const UNITS = [
  ['XT2403001', 'DST-1'],
  ['XT2403002', 'DST-2']
];

function build() {
  SHEETS = {
    Claims: new Sheet('Claims', [CLAIM_COLS.slice()]),
    ClaimItems: new Sheet('ClaimItems', [api.SCHEMA[SHEET.ITEMS].slice()]),
    AuditLog: new Sheet('AuditLog', [api.SCHEMA[SHEET.AUDIT].slice()]),
    Attachments: new Sheet('Attachments', [api.SCHEMA[SHEET.ATTACHMENTS].slice()]),
    Customer: new Sheet('Customer', [['CustomerID', 'Name', 'Active'],
      ['C1', 'RSUD Koja', true]]),
    sparepart: new Sheet('sparepart', [['PartID', 'Name', 'Active'],
      ['P1', 'Blood Pump Rotor', true]]),
    users: new Sheet('users', [api.SCHEMA[SHEET.USERS].slice(),
      ['sri@oji.co.id', 'Sri', 'Administrator', '', '', true, ''],
      ['budi@oji.co.id', 'Budi', 'Requester', '', '', true, ''],
      ['siti@oji.co.id', 'Siti', 'Requester', '', '', true, ''],
      ['ops@sinar.co.id', 'PT Sinar Medika', 'Requester', '', 'DST-1', true, ''],
      ['ops@dua.co.id', 'PT Dua Medika', 'Requester', '', 'DST-2', true, '']]),
    Principals: new Sheet('Principals', [api.SCHEMA[SHEET.PRINCIPALS].slice(),
      ['PR1', 'Sansin', true, '']]),
    Distributors: new Sheet('Distributors', [api.SCHEMA[SHEET.DISTRIBUTORS].slice(),
      ['DST-1', 'PT Sinar Medika', 'ops@sinar.co.id', true, ''],
      ['DST-2', 'PT Dua Medika', 'ops@dua.co.id', true, '']]),
    Products: new Sheet('Products', [api.SCHEMA[SHEET.PRODUCTS].slice(),
      ['MAT-A', 'MAT-A analyser', 'Sansin', 'AKL', '', true, '']]),
    WarrantyRules: new Sheet('WarrantyRules', [api.SCHEMA[SHEET.RULES].slice()]),
    warranty: new Sheet('warranty', [api.SCHEMA[SHEET.WARRANTY].slice()]),
    Population: new Sheet('Population', [POP_COLS.slice()].concat(
      UNITS.map(function (u) { return popRow(u[0], u[1]); })))
  };
  ['population', 'warranty', 'products', 'rules'].forEach(function (k) {
    delete api.INDEX_MEMO[k];
  });
}

/**
 * Files a claim, recording a failure rather than dying if the save refuses —
 * a scope bug makes saveClaim_ unable to read back what it just wrote, and the
 * run has to reach the checks that explain why.
 */
function file(who, serial) {
  return stage('filing on ' + serial + ' as ' + who.email, function () {
    return api.saveClaim_(who, {
      customerId: 'C1', serialNumber: serial, problem: 'Leaking pump',
      items: [{ partId: 'P1', qty: 1 }]
    });
  }) || {};
}

function seenBy(who) {
  return api.visibleClaims_(who).map(function (c) { return c.ClaimID; }).sort();
}

/* ============================================== what the claim records */

build();
const bySinar = stage('a distributor files a claim on its own machine', function () {
  return file(SATU, 'XT2403001');
}) || {};
const row = api.findBy_(SHEET.CLAIMS, 'ClaimID', bySinar.claimId) || {};

check('the claim records who sold the machine', row.DistributorID === 'DST-1',
  String(row.DistributorID));
check('and, separately, on whose behalf it was filed',
  row.RequesterDistributorID === 'DST-1', String(row.RequesterDistributorID));

const byUs = stage('our own engineer attends the same machine', function () {
  return file(BUDI, 'XT2403001');
}) || {};
const ours = api.findBy_(SHEET.CLAIMS, 'ClaimID', byUs.claimId) || {};

// The two columns disagreeing is the whole point: this row is the one that
// leaks if visibility is scoped on the unit.
check('a claim of ours on their machine still names them as the seller',
  ours.DistributorID === 'DST-1', String(ours.DistributorID));
check('but is attributed to nobody, because our staff belong to no distributor',
  ours.RequesterDistributorID === '', JSON.stringify(ours.RequesterDistributorID));

/* ================================================== who sees what */

build();
const s1 = file(SATU, 'XT2403001').claimId;      // Sinar, own machine
const s2 = file(SATU, 'XT2403002').claimId;      // Sinar, on Dua's machine
const d1 = file(DUA, 'XT2403002').claimId;       // Dua, own machine
const b1 = file(BUDI, 'XT2403001').claimId;      // us, on Sinar's machine
const t1 = file(SITI, 'XT2403002').claimId;      // us, on Dua's machine

check('a distributor sees what its own company filed',
  seenBy(SATU).join() === [s1, s2].sort().join(), seenBy(SATU).join());

// The failure the whole design guards against.
check('and not a claim our own engineer filed on a machine they sold',
  seenBy(SATU).indexOf(b1) === -1, seenBy(SATU).join());
check('nor anything the other distributor filed',
  seenBy(SATU).indexOf(d1) === -1, seenBy(SATU).join());

check('the other distributor likewise sees only its own',
  seenBy(DUA).join() === d1, seenBy(DUA).join());
// Same hospital, different distributors: the rule the owner stated outright.
check('two distributors at one hospital see nothing of each other',
  seenBy(SATU).filter(function (id) { return seenBy(DUA).indexOf(id) !== -1; }).length === 0);

check('our own field service is still scoped to the person',
  seenBy(BUDI).join() === b1, seenBy(BUDI).join());
check('and one of ours does not see another of ours',
  seenBy(SITI).join() === t1, seenBy(SITI).join());
check('the administrator sees all five', seenBy(SRI).length === 5,
  String(seenBy(SRI).length));

check('and the claims list agrees with the scope, not just visibleClaims_',
  api.listClaims_(SATU, { tab: 'all', items: 'none' }).rows.length === 2,
  String(api.listClaims_(SATU, { tab: 'all', items: 'none' }).rows.length));

/* -------------------------------------- an account that changes hands */

// The account is the company's. Someone else takes it over; the history is the
// company's too and must not move with the person.
// The account is the company's. When it is handed over the ADDRESS changes —
// and that is the case that separates scoping by company from scoping by
// email, which otherwise give the same answer for every claim in this fixture.
build();
const before = file(SATU, 'XT2403001').claimId;
const HANDOVER = session({
  email: 'baru@sinar.co.id', name: 'PT Sinar Medika', distributor: 'DST-1'
});
const after = file(HANDOVER, 'XT2403002').claimId;
check('a claim filed after a handover joins the same company history',
  seenBy(HANDOVER).join() === [before, after].sort().join(), seenBy(HANDOVER).join());
check('and the claim the previous address filed is still the company\'s',
  seenBy(HANDOVER).indexOf(before) !== -1, seenBy(HANDOVER).join());
check('while our own staff are unaffected by any of it',
  seenBy(BUDI).length === 0, seenBy(BUDI).join());

// An administrator correcting a claim must not pull it into their own scope,
// and there is no administrator scope to pull it into — so the stamp has to be
// written once and left alone.
build();
const theirs = file(SATU, 'XT2403001').claimId;
// An administrator may only amend a claim once it has been submitted.
SHEETS.Claims.rows[1][CLAIM_COLS.indexOf('Status')] = api.STATUS.SUBMITTED;
stage('an administrator corrects the claim', function () {
  return api.saveClaim_(SRI, {
    claimId: theirs, rowVersion: api.findBy_(SHEET.CLAIMS, 'ClaimID', theirs).RowVersion,
    customerId: 'C1', serialNumber: 'XT2403001', problem: 'Leaking pump, corrected',
    items: [{ partId: 'P1', qty: 1 }]
  });
});
check('editing a claim never rewrites who it was filed for',
  (api.findBy_(SHEET.CLAIMS, 'ClaimID', theirs) || {}).RequesterDistributorID === 'DST-1',
  String((api.findBy_(SHEET.CLAIMS, 'ClaimID', theirs) || {}).RequesterDistributorID));
check('so the distributor still sees it', seenBy(SATU).join() === theirs);

/* ========================================== one account per distributor */

build();
function saveUser(record) { return api.saveMaster_(SRI, 'users', record); }

const second = refuses(function () {
  saveUser({
    __isNew: true, Email: 'lain@sinar.co.id', Name: 'Orang Lain',
    Role: api.ROLE.REQUESTER, Principal: '', Distributor: 'DST-1', Active: true
  });
});
check('a second account for one distributor is refused', second !== '', second);
check('and it says which account already has it',
  /ops@sinar\.co\.id/.test(second), second);
check('naming the company, not only the code',
  /PT Sinar Medika/.test(second), second);

check('editing the account that already holds it is not a clash with itself',
  refuses(function () {
    saveUser({
      Email: 'ops@sinar.co.id', Name: 'PT Sinar Medika', Role: api.ROLE.REQUESTER,
      Principal: '', Distributor: 'DST-1', Active: true
    });
  }) === '', refuses(function () {
    saveUser({
      Email: 'ops@sinar.co.id', Name: 'PT Sinar Medika', Role: api.ROLE.REQUESTER,
      Principal: '', Distributor: 'DST-1', Active: true
    });
  }));

// Deactivating the old one is how an account is handed over, so the new one has
// to be accepted the moment the old one is off.
build();
stage('deactivating the old account', function () {
  return saveUser({
    Email: 'ops@sinar.co.id', Name: 'PT Sinar Medika', Role: api.ROLE.REQUESTER,
    Principal: '', Distributor: 'DST-1', Active: false
  });
});
check('once the old account is deactivated, a replacement is accepted',
  refuses(function () {
    saveUser({
      __isNew: true, Email: 'baru@sinar.co.id', Name: 'PT Sinar Medika',
      Role: api.ROLE.REQUESTER, Principal: '', Distributor: 'DST-1', Active: true
    });
  }) === '');

build();
check('a distributor nobody has on the list is refused',
  /not on the distributor list/.test(refuses(function () {
    saveUser({
      __isNew: true, Email: 'x@y.co.id', Name: 'X', Role: api.ROLE.REQUESTER,
      Principal: '', Distributor: 'DST-9', Active: true
    });
  })));
check('and an Administrator cannot be given one, because it would mean nothing',
  /Only a Requester account/.test(refuses(function () {
    saveUser({
      __isNew: true, Email: 'z@y.co.id', Name: 'Z', Role: api.ROLE.ADMIN,
      Principal: '', Distributor: 'DST-2', Active: true
    });
  })));
check('an account with no distributor is our own staff, and passes',
  refuses(function () {
    saveUser({
      __isNew: true, Email: 'baru@oji.co.id', Name: 'Baru', Role: api.ROLE.REQUESTER,
      Principal: '', Distributor: '', Active: true
    });
  }) === '');

/* ======================================= the morning after the deploy */

// Claims filed before the column existed have nothing in it. Without the
// backfill a distributor opens the portal and finds their whole history gone.
build();
const old1 = file(SATU, 'XT2403001').claimId;
const old2 = file(BUDI, 'XT2403001').claimId;
const at = CLAIM_COLS.indexOf('RequesterDistributorID');
SHEETS.Claims.rows.slice(1).forEach(function (r) { r[at] = ''; });

check('before the backfill the distributor sees nothing of its own history',
  seenBy(SATU).length === 0, seenBy(SATU).join());

const filled = stage('backfilling the attribution', function () {
  return api.backfillRequesterDistributor_();
});
check('the backfill attributes the ones it can',
  filled && filled.claims === 1, filled ? String(filled.claims) : 'threw');
check('and the history comes back', seenBy(SATU).join() === old1, seenBy(SATU).join());
check('without sweeping in a claim our own engineer filed',
  seenBy(SATU).indexOf(old2) === -1, seenBy(SATU).join());

// Run twice: an account reassigned later must not drag old claims with it.
SHEETS.users.rows[4][api.SCHEMA[SHEET.USERS].indexOf('Distributor')] = 'DST-2';
stage('backfilling again after an account moved', function () {
  return api.backfillRequesterDistributor_();
});
check('a claim already attributed is never moved by a later run',
  (api.findBy_(SHEET.CLAIMS, 'ClaimID', old1) || {}).RequesterDistributorID === 'DST-1',
  String((api.findBy_(SHEET.CLAIMS, 'ClaimID', old1) || {}).RequesterDistributorID));

/* ------------------------------------------------------------------ report */

console.log('verify-distributor-access: ' + pass + ' checks passed' +
  (failures.length ? ', ' + failures.length + ' FAILED' : ''));
failures.forEach(function (f) { console.log('  FAIL  ' + f); });
process.exit(failures.length ? 1 : 0);
