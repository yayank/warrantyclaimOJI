/**
 * verify-unit-requests.js — refusing a claim without throwing the work away.
 *
 * A unit the register has never heard of can no longer be claimed on: there is
 * a separate system of record for installations that has to be updated first,
 * and a distributor who can claim on an unreported unit never reports one.
 *
 * That refusal is only defensible if it costs the engineer nothing. Somebody is
 * standing in front of a broken machine; they have typed the fault and
 * photographed the part. So the whole of this file is about what survives the
 * refusal — the draft, its attachments, and a request that reaches an
 * administrator by two routes and closes itself the moment the unit exists,
 * whichever of the four ways it arrived by.
 *
 * The loop has to close from every direction, because a request left open is a
 * draft nobody ever hears about again.
 *
 *   node tools/verify-unit-requests.js
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
        clearContent: function () {
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
let MAIL = [];
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
  Drive: { Files: { insert: function () { return { id: 'imported' }; }, remove: function () {} } },
  MimeType: { GOOGLE_SHEETS: 'x' },
  Utilities: {
    formatDate: function (d, tz, fmt) {
      if (fmt === 'yyyy') return '2026';
      if (fmt === 'yyMMdd') return '260913';
      return '2026-09-13T09:00:00';
    },
    base64Decode: function () { return []; },
    newBlob: function () { return {}; }
  }
};

vm.createContext(sandbox);
['Config.gs', 'Repo.gs', 'Auth.gs', 'Warranty.gs', 'WarrantyRules.gs', 'Units.gs',
  'Audit.gs', 'Visits.gs', 'Mailer.gs', 'MasterData.gs', 'Claims.gs'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'),
    sandbox, { filename: f });
});
vm.runInContext([
  // Recorded rather than sent: what matters here is who was written to and
  // under which template, and the mailer itself has its own file.
  'globalThis.sendMail_ = function (opts) { globalThis.__mail.push(opts); return { Status: "Sent" }; };',
  'globalThis.claimMailData_ = function () { return {}; };',
  'globalThis.attachmentsFor_ = function () { return []; };',
  'globalThis.auditForClaim_ = function () { return []; };',
  'globalThis.fileClaimOnSubmit_ = function () { return "folder-1"; };',
  'globalThis.__api = { SHEET, SCHEMA, INDEX_MEMO, TEMPLATE, STATUS,',
  '  UNIT_REQUEST_STATUS, saveClaim_, submitClaim_, saveUnit_, applyUnitUpdate_,',
  '  importUnits_, listUnitRequests_, rejectUnitRequest_, openUnitRequestCount_,',
  '  findBy_, readAll_, readSheetRows_, update_ };'
].join('\n'), sandbox, { filename: 'stubs' });
sandbox.__mail = MAIL;

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

/* ------------------------------------------------------------- the fixture */

const POP_COLS = api.SCHEMA[SHEET.POPULATION];
const ATT_COLS = api.SCHEMA[SHEET.ATTACHMENTS];

function popRow(serial) {
  const u = {
    Delivery: 'DEL', SellingInDate: '2024-04-01', Material: 'MAT-A',
    ItemDescription: 'MAT-A analyser', Batch: serial, DeliveryQuantity: 1,
    ShipToParty: 'RSUD Koja', Principal: 'Sansin',
    Channel: 'distributor', DistributorID: 'DST-1', InstalledAt: '01/07/2024'
  };
  return POP_COLS.map(function (c) { return u[c] === undefined ? '' : u[c]; });
}

function build(registered) {
  MAIL.length = 0;
  SHEETS = {
    Claims: new Sheet('Claims', [api.SCHEMA[SHEET.CLAIMS].slice()]),
    ClaimItems: new Sheet('ClaimItems', [api.SCHEMA[SHEET.ITEMS].slice()]),
    AuditLog: new Sheet('AuditLog', [api.SCHEMA[SHEET.AUDIT].slice()]),
    Attachments: new Sheet('Attachments', [ATT_COLS.slice()]),
    UnitRequests: new Sheet('UnitRequests', [api.SCHEMA[SHEET.UNIT_REQUESTS].slice()]),
    Customer: new Sheet('Customer', [['CustomerID', 'Name', 'Active'],
      ['C1', 'RSUD Koja', true]]),
    sparepart: new Sheet('sparepart', [['PartID', 'Name', 'Active'],
      ['P1', 'Blood Pump Rotor', true]]),
    users: new Sheet('users', [api.SCHEMA[SHEET.USERS].slice(),
      ['sri@oji.co.id', 'Sri', 'Administrator', '', '', true, '']]),
    Principals: new Sheet('Principals', [api.SCHEMA[SHEET.PRINCIPALS].slice(),
      ['PR1', 'Sansin', true, '']]),
    Distributors: new Sheet('Distributors', [api.SCHEMA[SHEET.DISTRIBUTORS].slice(),
      ['DST-1', 'PT Sinar Medika', 'a@x.co.id', true, '']]),
    Products: new Sheet('Products', [api.SCHEMA[SHEET.PRODUCTS].slice(),
      ['MAT-A', 'MAT-A analyser', 'Sansin', 'AKL', '', true, '']]),
    WarrantyRules: new Sheet('WarrantyRules', [api.SCHEMA[SHEET.RULES].slice(),
      ['R1', 'MAT-A', 'principal', '*', 'assembly', 24, '', '', true, '']]),
    warranty: new Sheet('warranty', [api.SCHEMA[SHEET.WARRANTY].slice()]),
    Settings: new Sheet('Settings', [['Key', 'Value']]),
    Population: new Sheet('Population', [POP_COLS.slice()].concat(
      registered ? [popRow(registered)] : []))
  };
  ['population', 'warranty', 'products', 'rules'].forEach(function (k) {
    delete api.INDEX_MEMO[k];
  });
}

const STRANGER = 'XT2403777';

/** A complete claim: the gate under test is the unit, not the paperwork. */
function completeDraft(serial) {
  const claim = api.saveClaim_(RIAN, {
    customerId: 'C1', serialNumber: serial, problem: 'Leaking pump',
    items: [{ partId: 'P1', qty: 1 }]
  });
  // This claim's own part, not the first one on the sheet: with two drafts in
  // play the second would otherwise be given the first one's photograph and
  // read as still missing its own.
  const item = api.readAll_(SHEET.ITEMS).filter(function (i) {
    return i.ClaimID === claim.claimId;
  })[0];
  [['FAULT', ''], ['REPORT', ''], ['PART', item.ItemID]].forEach(function (pair, n) {
    SHEETS.Attachments.appendRow(ATT_COLS.map(function (c) {
      const a = {
        AttachmentID: claim.claimId + '-ATT-' + n, ClaimID: claim.claimId, ItemID: pair[1], Kind: pair[0],
        DriveFileId: 'f' + n, FileName: pair[0] + '.jpg', MimeType: 'image/jpeg',
        SizeBytes: 100, Version: 1, Superseded: false,
        UploadedBy: RIAN.email, UploadedAt: '2026-09-13T08:00:00'
      };
      return a[c] === undefined ? '' : a[c];
    }));
  });
  return claim;
}

function requests() { return api.readSheetRows_(SHEET.UNIT_REQUESTS); }

/** The claim row, or an empty one — a missing claim is a failed check, not a crash. */
function claimRow(id) { return api.findBy_(SHEET.CLAIMS, 'ClaimID', id) || {}; }
function mailOf(code) { return MAIL.filter(function (m) { return m.code === code; }); }

/** The first message of a kind, or a blank one, so a missing mail fails a check. */
function firstMail(code) {
  return mailOf(code)[0] || { to: [], data: {}, linkQuery: '' };
}

/* ================================================= the refusal, and what survives */

build();
const draft = stage('drafting a claim on a unit nobody has registered', function () {
  return completeDraft(STRANGER);
}) || {};
const held = stage('submitting it', function () {
  return api.submitClaim_(RIAN, {
    claimId: draft.claimId, rowVersion: claimRow(draft.claimId).RowVersion
  });
}) || {};

check('submitting does not throw at somebody who did nothing wrong', !!held.claimId,
  JSON.stringify(Object.keys(held)));
check('the claim stays a draft',
  claimRow(draft.claimId).Status === api.STATUS.DRAFT,
  String(claimRow(draft.claimId).Status));
check('it is given no reference number, because it was not submitted',
  !claimRow(draft.claimId).RefNo);
check('and the answer says why, so the screen can explain rather than fail',
  !!held.unitRequest && held.unitRequest.serialNumber === STRANGER,
  JSON.stringify(held.unitRequest));

// The point of the whole design: nothing the engineer did is thrown away.
check('every photograph is still attached to the draft',
  api.readAll_(SHEET.ATTACHMENTS).length === 3,
  String(api.readAll_(SHEET.ATTACHMENTS).length));
check('and so is the part they asked for',
  api.readAll_(SHEET.ITEMS).length === 1);
check('and the fault they typed',
  claimRow(draft.claimId).ProblemDescription === 'Leaking pump');

/* ------------------------------------------------------------- the request */

const one = requests()[0] || {};
check('a request is waiting', requests().length === 1 && one.Status === api.UNIT_REQUEST_STATUS.OPEN,
  JSON.stringify(requests().map(function (r) { return r.Status; })));
check('carrying the serial number an administrator has to register',
  one.SerialNumber === STRANGER, String(one.SerialNumber));
check('the draft it is holding up',
  one.ClaimID === draft.claimId, String(one.ClaimID));
check('where the machine is',
  one.CustomerName === 'RSUD Koja', String(one.CustomerName));
check('who found it',
  one.RequestedBy === 'rian@dist.co.id' && one.RequestedByName === 'Rian',
  one.RequestedBy + ' / ' + one.RequestedByName);
check('and what they said was wrong with it, so the queue is not a list of bare codes',
  one.Note === 'Leaking pump', String(one.Note));

check('the administrator is emailed rather than left to notice the queue',
  mailOf(api.TEMPLATE.UNIT_REQUEST).length === 1,
  String(mailOf(api.TEMPLATE.UNIT_REQUEST).length));
check('at the address on the users sheet',
  firstMail(api.TEMPLATE.UNIT_REQUEST).to.join() === 'sri@oji.co.id',
  JSON.stringify(firstMail(api.TEMPLATE.UNIT_REQUEST).to));
check('with the serial number in it',
  firstMail(api.TEMPLATE.UNIT_REQUEST).data.SerialNumber === STRANGER);
// Through sendMail_, so the notifications switch and the email log both apply.
check('and through the mailer, not around it',
  !!firstMail(api.TEMPLATE.UNIT_REQUEST).linkQuery);

// Pressing Submit again is the obvious thing to try, and it must not fill the
// administrator's queue with copies of one request.
stage('submitting the same draft again', function () {
  return api.submitClaim_(RIAN, {
    claimId: draft.claimId, rowVersion: claimRow(draft.claimId).RowVersion
  });
});
check('trying again refreshes the request rather than raising a second one',
  requests().length === 1, String(requests().length));
check('though the administrator is reminded',
  mailOf(api.TEMPLATE.UNIT_REQUEST).length === 2);

/* --------------------------------------- a registered unit is unaffected */

build(STRANGER);
const ok = stage('claiming on a unit that is on the register', function () {
  const c = completeDraft(STRANGER);
  return api.submitClaim_(RIAN, {
    claimId: c.claimId, rowVersion: claimRow(c.claimId).RowVersion
  });
});
check('a registered unit submits as it always did',
  ok && ok.status === api.STATUS.SUBMITTED, ok ? String(ok.status) : 'threw');
check('with no request raised', requests().length === 0);
check('and nothing on the answer to explain', ok && ok.unitRequest === undefined);

/* ------------------------------- the paperwork rules still come first */

// Checked before the unit, on purpose: the draft that waits has to be one that
// can go through untouched, and a half-filled one cannot.
build();
const bare = api.saveClaim_(RIAN, {
  customerId: 'C1', serialNumber: STRANGER, problem: 'Leaking pump',
  items: [{ partId: 'P1', qty: 1 }]
});
const complaint = refuses(function () {
  api.submitClaim_(RIAN, {
    claimId: bare.claimId, rowVersion: claimRow(bare.claimId).RowVersion
  });
});
check('an incomplete claim is still told what it is missing',
  /fault photo/.test(complaint), complaint);
check('and no request is raised for a draft that could not go through anyway',
  requests().length === 0, String(requests().length));

/* ============================================ closing the loop, four ways */

function heldDraft() {
  build();
  const c = completeDraft(STRANGER);
  stage('holding a draft for an unregistered unit', function () {
    return api.submitClaim_(RIAN, {
      claimId: c.claimId, rowVersion: claimRow(c.claimId).RowVersion
    });
  });
  MAIL.length = 0;
  return c;
}

// 1 — registered from the unit form.
const viaForm = heldDraft();
stage('registering the unit by hand', function () {
  return api.saveUnit_(SRI, {
    isNew: true, Batch: STRANGER, Material: 'MAT-A', ShipToParty: 'RSUD Koja',
    Channel: 'direct', InstalledAt: '01/07/2024'
  });
});
check('registering the unit closes the request',
  (requests()[0] || {}).Status === api.UNIT_REQUEST_STATUS.REGISTERED,
  String((requests()[0] || {}).Status));
check('and records who did it and when',
  !!(requests()[0] || {}).HandledBy && !!(requests()[0] || {}).HandledAt);
check('the person waiting is told, rather than left watching a draft',
  mailOf(api.TEMPLATE.UNIT_REQUEST_DONE).length === 1,
  String(mailOf(api.TEMPLATE.UNIT_REQUEST_DONE).length));
check('at their address, not the administrator\'s',
  firstMail(api.TEMPLATE.UNIT_REQUEST_DONE).to.join() === 'rian@dist.co.id',
  JSON.stringify(firstMail(api.TEMPLATE.UNIT_REQUEST_DONE).to));
check('and told there is nothing to retype',
  /nothing needs typing again/.test(
    firstMail(api.TEMPLATE.UNIT_REQUEST_DONE).data.Message || ''),
  firstMail(api.TEMPLATE.UNIT_REQUEST_DONE).data.Message);

// And the whole point: the draft goes through as it stands.
const nowGoes = stage('submitting the draft that was waiting', function () {
  return api.submitClaim_(RIAN, {
    claimId: viaForm.claimId,
    rowVersion: claimRow(viaForm.claimId).RowVersion
  });
});
check('the draft that was waiting now submits, untouched',
  nowGoes && nowGoes.status === api.STATUS.SUBMITTED,
  nowGoes ? String(nowGoes.status) : 'threw');
check('with the parts and photographs it was holding all along',
  nowGoes && nowGoes.items.length === 1 && api.readAll_(SHEET.ATTACHMENTS).length === 3);

// 2 — arrived in the CSV update. It cannot add a unit, so this is the case
// where a request must stay open.
const viaCsv = heldDraft();
check('a CSV update cannot register a unit, so the request stays open',
  (function () {
    stage('updating a unit that does not exist', function () {
      try {
        api.applyUnitUpdate_(SRI, { rows: [{ __line: 2, Batch: STRANGER, InstalledAt: '01/07/2024' }] });
      } catch (e) { /* refused, which is the point */ }
      return true;
    });
    return (requests()[0] || {}).Status === api.UNIT_REQUEST_STATUS.OPEN;
  })(), String((requests()[0] || {}).Status));
check('and nobody is told anything that is not true',
  mailOf(api.TEMPLATE.UNIT_REQUEST_DONE).length === 0);

// 3 — arrived in the principal's own workbook, which knows nothing about any
// of this. A request left open behind that route is a draft nobody hears about.
heldDraft();
IMPORTED = {
  Population: new Sheet('Population', [
    ['Delivery', 'SellingInDate', 'Material', 'ItemDescription', 'Batch',
      'DeliveryQuantity', 'ShipToParty', 'Principal'],
    ['DEL', '2024-04-01', 'MAT-A', 'MAT-A analyser', STRANGER, 1, 'RSUD Koja', 'Sansin']
  ]),
  warranty: new Sheet('warranty', [api.SCHEMA[SHEET.WARRANTY].slice()])
};
stage('importing the principal workbook', function () {
  return api.importUnits_(SRI, { data: 'x', fileName: 'units.xlsx' });
});
check('a unit arriving in the principal file closes the request too',
  (requests()[0] || {}).Status === api.UNIT_REQUEST_STATUS.REGISTERED,
  String((requests()[0] || {}).Status));
check('and the person waiting is told that way as well',
  mailOf(api.TEMPLATE.UNIT_REQUEST_DONE).length === 1);

/* ------------------------------------------------------------ turning one down */

const rejected = heldDraft();
check('turning a request down without saying why is refused',
  /has to say why/.test(refuses(function () {
    api.rejectUnitRequest_(SRI, { requestId: requests()[0].RequestID, reason: '' });
  })));
stage('turning it down', function () {
  return api.rejectUnitRequest_(SRI, {
    requestId: requests()[0].RequestID, reason: 'That serial number is not one of ours.'
  });
});
check('a request turned down is closed',
  (requests()[0] || {}).Status === api.UNIT_REQUEST_STATUS.REJECTED,
  String((requests()[0] || {}).Status));
// The draft is theirs. Correcting the serial number or abandoning the claim is
// their decision, and deleting their work to tidy a queue would be the portal
// making it for them.
check('but the draft is left exactly where it was',
  claimRow(rejected.claimId).Status === api.STATUS.DRAFT);
check('with everything still attached to it',
  api.readAll_(SHEET.ATTACHMENTS).length === 3);
check('and the reason reaches the person who has to act on it',
  /not one of ours/.test(
    firstMail(api.TEMPLATE.UNIT_REQUEST_DONE).data.Message || ''),
  firstMail(api.TEMPLATE.UNIT_REQUEST_DONE).data.Message);
check('turning the same one down twice is refused',
  /already been handled/.test(refuses(function () {
    api.rejectUnitRequest_(SRI, { requestId: requests()[0].RequestID, reason: 'again' });
  })));

/* ------------------------------------------------------------------ the queue */

build();
['XT2403701', 'XT2403702'].forEach(function (sn) {
  const c = completeDraft(sn);
  stage('queueing ' + sn, function () {
    return api.submitClaim_(RIAN, {
      claimId: c.claimId, rowVersion: claimRow(c.claimId).RowVersion
    });
  });
});

const queue = api.listUnitRequests_(SRI, {});
check('the queue shows what is waiting', queue.rows.length === 2, String(queue.rows.length));
// Read by position, so a queue that came back short must fail this rather than
// take the run down with it.
const first = queue.rows[0] || {};
check('oldest first, because that is the one somebody has been waiting on longest',
  first.serialNumber === 'XT2403701', String(first.serialNumber));
check('and the badge can be had without building the list',
  api.openUnitRequestCount_() === 2, String(api.openUnitRequestCount_()));
check('it names the distributor as well as the hospital',
  typeof first.distributorName === 'string', typeof first.distributorName);

stage('turning down the oldest', function () {
  return api.rejectUnitRequest_(SRI, { requestId: first.requestId, reason: 'typo' });
});
check('a handled request leaves the queue',
  api.listUnitRequests_(SRI, {}).rows.length === 1);
check('but can still be looked up',
  api.listUnitRequests_(SRI, { all: true }).rows.length === 2);
check('and the count follows', api.openUnitRequestCount_() === 1);

check('a requester cannot read the queue',
  refuses(function () { api.listUnitRequests_(RIAN, {}); }) !== '');
check('nor turn a request down',
  refuses(function () {
    api.rejectUnitRequest_(RIAN, { requestId: 'UR-1', reason: 'x' });
  }) !== '');

/* ------------------------------------------------------------------ report */

console.log('verify-unit-requests: ' + pass + ' checks passed' +
  (failures.length ? ', ' + failures.length + ' FAILED' : ''));
failures.forEach(function (f) { console.log('  FAIL  ' + f); });
process.exit(failures.length ? 1 : 0);
