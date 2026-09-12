/**
 * verify-bulk.js — the same move over several claims at once.
 *
 * Two things are at stake, and neither shows on screen when it goes wrong.
 *
 * The first is a half-applied batch. Fifteen claims are ticked, the twelfth
 * will not move because somebody else touched it a minute ago, and the loop
 * stops there: twelve are returned, three are not, and the screen says nothing
 * about which. So a claim that fails is caught and named and the rest carry
 * on, and the report has to be able to say so.
 *
 * The second is which buttons the bar offers. The panel's rule is one status,
 * one step; a selection spanning two statuses has no single right answer and
 * must offer nothing — and say why, because a bar that just goes blank reads
 * as a broken screen.
 *
 *   node tools/verify-bulk.js
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
function refused(fn) {
  try { fn(); return ''; } catch (e) { return String(e.message || e); }
}
/**
 * A batch call that a broken build might throw out of. A throw is a failure to
 * report, not a reason to stop before the rest of the file has had its say.
 */
/** The first refusal in a result, or a blank one, so a check can read it safely. */
function firstFailure(result) {
  return ((result && result.failed) || [])[0] || { claimId: '', error: '(nothing was refused)' };
}
function stage(label, fn) {
  try { return fn(); } catch (e) {
    failures.push(label + ' — threw: ' + String(e.message || e));
    return { done: [], failed: [] };
  }
}

/* ----------------------------------------------- a spreadsheet that writes */

let READS = 0;

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
    deleteRows: function (start, count) { s.rows.splice(start - 1, count); },
    getDataRange: function () { return s.getRange(1, 1, s.rows.length, s.getLastColumn()); },
    getRange: function (r, c, nr, nc) {
      return {
        getValues: function () {
          READS++;
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

const NOW = new Date('2026-09-12T08:00:00Z');
function pad(n, w) { return String(n).padStart(w, '0'); }

let MAILED = [];

const sandbox = {
  console: console,
  SpreadsheetApp: {
    getActive: function () { return book; },
    openById: function () { return book; },
    flush: function () {}
  },
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
  Utilities: {
    formatDate: function (date, tz, fmt) {
      const d = date instanceof Date ? date : NOW;
      if (fmt === 'yyyy') return String(d.getUTCFullYear());
      if (fmt === 'yyMMdd') {
        return String(d.getUTCFullYear()).slice(2) +
          pad(d.getUTCMonth() + 1, 2) + pad(d.getUTCDate(), 2);
      }
      return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1, 2) + '-' +
        pad(d.getUTCDate(), 2) + 'T' + pad(d.getUTCHours(), 2) + ':' +
        pad(d.getUTCMinutes(), 2) + ':' + pad(d.getUTCSeconds(), 2);
    }
  }
};
vm.createContext(sandbox);
['Config.gs', 'Repo.gs', 'Auth.gs', 'Audit.gs', 'Claims.gs'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'),
    sandbox, { filename: f });
});
vm.runInContext([
  'globalThis.sendMail_ = function (o) { globalThis.__mailed.push(o); return { Status: "Sent" }; };',
  'globalThis.attachmentsFor_ = function () { return []; };',
  'globalThis.TEMPLATE = { CLAIM_RETURN: "CLAIM_RETURN" };',
  'globalThis.__api = { returnClaims_, forwardClaims_, startInternalVerifications_,',
  '  returnClaim_, listClaims_, findBy_, readAll_, BULK_MAX, SHEET, SCHEMA, STATUS };'
].join('\n'), sandbox, { filename: 'stubs' });
sandbox.__mailed = MAILED;

const api = sandbox.__api;
const SHEET = api.SHEET;
const ADMIN = {
  email: 'sri@oji.co.id', role: 'Administrator', actualRole: 'Administrator',
  simulatedRole: null, isTester: false, principal: ''
};
const RIAN = {
  email: 'rian@rs.co.id', role: 'Requester', actualRole: 'Requester',
  simulatedRole: null, isTester: false, principal: ''
};

/* ----------------------------------------------------------- the fixture */

const CLAIM_COLS = api.SCHEMA[SHEET.CLAIMS];
const ITEM_COLS = api.SCHEMA[SHEET.ITEMS];

function rowOf(cols, values) {
  return cols.map(function (c) { return values[c] === undefined ? '' : values[c]; });
}

function claimRow(id, extra) {
  return rowOf(CLAIM_COLS, Object.assign({
    ClaimID: id, RefNo: 'CW120926', IsTest: false,
    CustomerID: 'C1', CustomerName: 'RSUD Koja',
    SerialNumber: 'XT24' + id, ProductName: 'Sansin SWS-4000',
    Principal: 'Sansin', WarrantyType: 'Principal Warranty',
    Status: 'Submitted', WorkOrderNo: '',
    RequesterEmail: 'rian@rs.co.id', RequesterName: 'Rian',
    CreatedAt: '2026-09-01T09:00:00', SubmittedAt: '2026-09-01T09:30:00',
    ItemCount: 1, PendingCount: 1, ApprovedCount: 0, RejectedCount: 0,
    ShippedCount: 0, AwaitingReturnCount: 0, AdvanceCount: 0, AdvanceQueueCount: 1,
    Deleted: false, UpdatedAt: '2026-09-01T09:30:00', UpdatedBy: 'rian@rs.co.id',
    RowVersion: 1
  }, extra || {}));
}

function itemRow(id, claimId, extra) {
  return rowOf(ITEM_COLS, Object.assign({
    ItemID: id, ClaimID: claimId, PartID: 'P1', PartName: 'Blood Pump Rotor',
    Qty: 1, ItemStatus: 'Pending', AdvanceIssued: false,
    Deleted: false, UpdatedAt: '2026-09-01T09:30:00', UpdatedBy: 'rian@rs.co.id',
    RowVersion: 1
  }, extra || {}));
}

const IDS = ['CLM-A', 'CLM-B', 'CLM-C', 'CLM-D', 'CLM-E'];

function reset(overrides) {
  const over = overrides || {};
  SHEETS = {
    Claims: new Sheet('Claims', [CLAIM_COLS.slice()].concat(
      IDS.map(function (id) { return claimRow(id, over[id] || {}); }))),
    ClaimItems: new Sheet('ClaimItems', [ITEM_COLS.slice()].concat(
      IDS.map(function (id) { return itemRow('ITM-' + id, id); }))),
    AuditLog: new Sheet('AuditLog', [api.SCHEMA[SHEET.AUDIT].slice()]),
    Attachments: new Sheet('Attachments', [api.SCHEMA[SHEET.ATTACHMENTS].slice()])
  };
  MAILED.length = 0;
}

function statusOf(id) {
  const c = api.findBy_(SHEET.CLAIMS, 'ClaimID', id);
  return c ? c.Status : '(gone)';
}
function targets(ids) {
  return ids.map(function (id) {
    const c = api.findBy_(SHEET.CLAIMS, 'ClaimID', id);
    return { claimId: id, rowVersion: c ? Number(c.RowVersion) : 1 };
  });
}

/* -------------------------------------------------- a batch that all works */

reset();
const returned = stage('a batch where every claim can move', function () {
  return api.returnClaims_(ADMIN, { claims: targets(IDS), reason: 'Serial number wrong' });
});
check('every claim in the batch is reported done',
  returned.done.length === 5 && !returned.failed.length, JSON.stringify(returned));
check('and every one of them actually moved',
  IDS.every(function (id) { return statusOf(id) === 'Returned to Requester'; }),
  IDS.map(statusOf).join(', '));
check('each requester is told about their own claim',
  MAILED.length === 5, MAILED.length + ' messages');
check('and the reason is written on the claim, not only in the email',
  api.findBy_(SHEET.CLAIMS, 'ClaimID', 'CLM-A').ReturnReason === 'Serial number wrong');

/* --------------------------- one that will not move does not stop the rest */

// CLM-C is already closed, so it cannot be returned. The other four must be.
reset({ 'CLM-C': { Status: 'Closed' } });
const partly = stage('a batch with one claim that cannot move', function () {
  return api.returnClaims_(ADMIN, { claims: targets(IDS), reason: 'Please revise' });
});

check('the four that could move did', partly.done.length === 4,
  JSON.stringify(partly.done));
check('and are actually returned on the sheet',
  ['CLM-A', 'CLM-B', 'CLM-D', 'CLM-E']
    .every(function (id) { return statusOf(id) === 'Returned to Requester'; }),
  IDS.map(function (id) { return id + '=' + statusOf(id); }).join(', '));
check('the one that could not is left exactly as it was',
  statusOf('CLM-C') === 'Closed');
check('and is named in the report, with the reason it could not',
  partly.failed.length === 1 && firstFailure(partly).claimId === 'CLM-C' &&
  /submitted/i.test(firstFailure(partly).error), JSON.stringify(partly.failed));
check('no email went to the claim that did not move',
  MAILED.length === 4, MAILED.length + ' messages');

// The failure being first in the list must not swallow the ones behind it.
reset({ 'CLM-A': { Status: 'Closed' } });
const firstBad = stage('a batch whose first claim cannot move', function () {
  return api.returnClaims_(ADMIN, { claims: targets(IDS), reason: 'Please revise' });
});
check('a failure at the head of the batch stops nothing behind it',
  firstBad.done.length === 4 && firstBad.failed.length === 1,
  JSON.stringify(firstBad.failed) + ' / ' + firstBad.done.length + ' done');

/* -------------------------------- somebody else moved it while it was listed */

reset();
const stale = stage('a batch holding one claim edited underneath it', function () {
  return api.returnClaims_(ADMIN, {
    claims: [{ claimId: 'CLM-A', rowVersion: 1 }, { claimId: 'CLM-B', rowVersion: 99 }],
    reason: 'Please revise'
  });
});
check('a claim edited underneath the list is refused, not written over',
  stale.done.join() === 'CLM-A' && stale.failed.length === 1 &&
  firstFailure(stale).claimId === 'CLM-B', JSON.stringify(stale));
check('and the refusal is said in words rather than the word STALE',
  !/^STALE$/.test(firstFailure(stale).error) && /somebody else/i.test(firstFailure(stale).error),
  firstFailure(stale).error);
check('the claim it refused is untouched',
  statusOf('CLM-B') === 'Submitted');

/* ------------------------------------------------- forwarding, one WO apiece */

reset();
const fwd = stage('a forward batch with one claim missing its number', function () {
  return api.forwardClaims_(ADMIN, {
    claims: [
      { claimId: 'CLM-A', rowVersion: 1, workOrderNo: 'WO-1' },
      { claimId: 'CLM-B', rowVersion: 1, workOrderNo: 'WO-2' },
      { claimId: 'CLM-C', rowVersion: 1, workOrderNo: '' }
    ]
  });
});
check('the two with a work order number went', fwd.done.join() === 'CLM-A,CLM-B',
  JSON.stringify(fwd));
check('each carrying its own number, not one number for the batch',
  api.findBy_(SHEET.CLAIMS, 'ClaimID', 'CLM-A').WorkOrderNo === 'WO-1' &&
  api.findBy_(SHEET.CLAIMS, 'ClaimID', 'CLM-B').WorkOrderNo === 'WO-2');
check('the one without is refused and says so',
  fwd.failed.length === 1 && /work order/i.test(firstFailure(fwd).error),
  JSON.stringify(fwd.failed));
check('and stays where it was', statusOf('CLM-C') === 'Submitted');

// A unit outside principal warranty has nobody to forward to.
reset({ 'CLM-B': { WarrantyType: 'Out of Principal Warranty' } });
const mixedFwd = stage('a forward batch holding a unit outside the warranty', function () {
  return api.forwardClaims_(ADMIN, {
    claims: [
      { claimId: 'CLM-A', rowVersion: 1, workOrderNo: 'WO-1' },
      { claimId: 'CLM-B', rowVersion: 1, workOrderNo: 'WO-2' }
    ]
  });
});
check('a unit outside principal warranty is refused by the server too',
  mixedFwd.done.join() === 'CLM-A' && /principal warranty/i.test(firstFailure(mixedFwd).error),
  JSON.stringify(mixedFwd));

/* ------------------------------------------------ moving to internal warranty */

reset({
  'CLM-A': { WarrantyType: 'Out of Principal Warranty' },
  'CLM-B': { WarrantyType: 'Out of Principal Warranty' }
});
const internal = api.startInternalVerifications_(ADMIN,
  { claims: targets(['CLM-A', 'CLM-B']) });
check('both move to internal verification',
  internal.done.length === 2 &&
  statusOf('CLM-A') === 'Internal Verification' &&
  statusOf('CLM-B') === 'Internal Verification', JSON.stringify(internal));

/* ------------------------------------------------------- who may ask at all */

reset();
check('a requester cannot return anybody\'s claims in a batch',
  /permission/i.test(refused(function () {
    api.returnClaims_(RIAN, { claims: targets(IDS), reason: 'no' });
  })), refused(function () {
    api.returnClaims_(RIAN, { claims: targets(IDS), reason: 'no' });
  }));
check('and nothing moved when they tried',
  IDS.every(function (id) { return statusOf(id) === 'Submitted'; }));

check('a batch with nothing in it is refused',
  /no claims/i.test(refused(function () {
    api.returnClaims_(ADMIN, { claims: [], reason: 'x' });
  })));
check('a return with no reason is refused before anything moves',
  /reason|why/i.test(refused(function () {
    api.returnClaims_(ADMIN, { claims: targets(IDS), reason: '  ' });
  })) && statusOf('CLM-A') === 'Submitted');

const huge = [];
for (let i = 0; i < api.BULK_MAX + 1; i++) huge.push({ claimId: 'CLM-A', rowVersion: 1 });
const tooMany = refused(function () {
  api.returnClaims_(ADMIN, { claims: huge, reason: 'x' });
});
check('a batch past the ceiling is refused, saying what the ceiling is',
  tooMany.indexOf(String(api.BULK_MAX)) !== -1, tooMany || 'it was accepted');
check('and refused before anything moved', statusOf('CLM-A') === 'Submitted');

/* --------------------------- the batch does not build a panel per claim */

// returnClaim_ answers with getClaim_, which reads the items, the attachments
// and the whole audit trail. Right for one claim, because the panel redraws
// from it; five times over for a batch nobody looks at is most of an
// execution's budget. The split exists for this, so it is measured.
reset();
READS = 0;
stage('measuring the batch', function () {
  return api.returnClaims_(ADMIN, { claims: targets(IDS), reason: 'batch' });
});
const batchReads = READS;

reset();
READS = 0;
IDS.forEach(function (id) {
  api.returnClaim_(ADMIN, { claimId: id, rowVersion: 1, reason: 'one at a time' });
});
const oneByOneReads = READS;

check('the batch reads less than the same claims one at a time',
  batchReads < oneByOneReads,
  batchReads + ' reads against ' + oneByOneReads);
check('and noticeably less, or the split was not worth making',
  batchReads < oneByOneReads * 0.8,
  batchReads + ' against ' + oneByOneReads + ' — ' +
  Math.round((1 - batchReads / oneByOneReads) * 100) + '% fewer');

/* ============================================== and what the bar offers */

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
const clientSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'Script.html'), 'utf8')
  .replace(/^[\s\S]*?<script>/, '')
  .replace(/<\/script>\s*$/, '');
vm.runInContext(clientSrc +
  '\nglobalThis.__client = { S, claimBulkOffer, canPickClaims, openPartsOf, claimTable,' +
  ' STATUS, ITEM, WARRANTY, ROLE };',
  clientBox, { filename: 'client' });
const C = clientBox.__client;

let n = 0;
function claim(status, extra) {
  n++;
  return Object.assign({
    claimId: 'CLM-' + n, refNo: 'CW120926', status: status,
    warrantyType: C.WARRANTY.PRINCIPAL, customerName: 'RSUD Koja',
    serialNumber: 'XT240' + n, requesterName: 'Rian', workOrderNo: '',
    principal: 'Sansin', createdAt: '2026-09-01T09:00:00', submittedAt: '2026-09-01T09:30:00',
    ageDays: 2, rowVersion: 1, itemsLoaded: true,
    items: [{ itemId: 'I' + n, partName: 'Rotor', qty: 1, itemStatus: C.ITEM.PENDING }],
    summary: { itemCount: 1, approved: 0, rejected: 0, pending: 1, shipped: 0,
      advance: 0, advanceQueue: 1, awaitingReturn: 0 }
  }, extra || {});
}

function offer(role, claims) {
  return C.claimBulkOffer(role, claims);
}

/* who gets a tick box at all -------------------------------------------- */

[C.ROLE.ADMIN, C.ROLE.PRINCIPAL].forEach(function (role) {
  C.S.session = { email: 'x@y.z', role: role, isTester: false };
  check('a ' + role + ' can pick claims', C.canPickClaims());
});
[C.ROLE.REQUESTER, C.ROLE.PRODUCTION].forEach(function (role) {
  C.S.session = { email: 'x@y.z', role: role, isTester: false };
  check('a ' + role + ' gets no tick box, having no step to take', !C.canPickClaims());
});

/* one status, one step --------------------------------------------------- */

const mixedStatus = [claim(C.STATUS.SUBMITTED), claim(C.STATUS.INTERNAL)];
const mixedOffer = offer(C.ROLE.ADMIN, mixedStatus);
check('a selection spanning two statuses offers nothing',
  mixedOffer.actions.length === 0, mixedOffer.actions.join());
check('and says why, rather than going blank',
  /different statuses/i.test(mixedOffer.note), mixedOffer.note);

const submitted = offer(C.ROLE.ADMIN, [claim(C.STATUS.SUBMITTED), claim(C.STATUS.SUBMITTED)]);
check('submitted claims under principal warranty can be returned or forwarded',
  submitted.actions.join() === 'return,forward', submitted.actions.join());

const outOf = offer(C.ROLE.ADMIN, [
  claim(C.STATUS.SUBMITTED, { warrantyType: C.WARRANTY.OUT }),
  claim(C.STATUS.SUBMITTED, { warrantyType: C.WARRANTY.INTERNAL })
]);
check('submitted claims outside principal warranty take the internal road instead',
  outOf.actions.join() === 'return,internal', outOf.actions.join());

// Returning is the same move whichever warranty the unit is under, so a mixed
// selection keeps it and loses only the road onwards.
const mixedTrack = offer(C.ROLE.ADMIN, [
  claim(C.STATUS.SUBMITTED),
  claim(C.STATUS.SUBMITTED, { warrantyType: C.WARRANTY.OUT })
]);
check('a selection mixing the two warranties can still be returned',
  mixedTrack.actions.join() === 'return', mixedTrack.actions.join());
check('but is offered neither road onwards, and told why',
  /no one road/i.test(mixedTrack.note), mixedTrack.note);

const internalTab = offer(C.ROLE.ADMIN, [claim(C.STATUS.INTERNAL), claim(C.STATUS.INTERNAL)]);
check('claims in internal verification are decided',
  internalTab.actions.join() === 'approve,reject', internalTab.actions.join());

/* the statuses that have no step here ------------------------------------ */

[C.STATUS.DRAFT, C.STATUS.RETURNED, C.STATUS.IN_REVIEW, C.STATUS.FULFILMENT, C.STATUS.CLOSED]
  .forEach(function (status) {
    const out = offer(C.ROLE.ADMIN, [claim(status)]);
    check('nothing bulk is offered at ' + status, out.actions.length === 0, out.actions.join());
    check('and the reason names the status', out.note.length > 0 && /—|elsewhere/.test(out.note),
      out.note);
  });

/* parts that have already been ordered ------------------------------------ */

const ordered = claim(C.STATUS.INTERNAL, {
  items: [{ itemId: 'X1', partName: 'Rotor', qty: 1, itemStatus: C.ITEM.SHIPPED },
    { itemId: 'X2', partName: 'Cell', qty: 1, itemStatus: C.ITEM.AWAITING }]
});
check('a part already ordered is not offered for a decision',
  C.openPartsOf([ordered]).length === 0, C.openPartsOf([ordered]).join());
const nothingOpen = offer(C.ROLE.ADMIN, [ordered]);
check('so a selection of nothing but ordered parts offers no decision',
  nothingOpen.actions.length === 0 && /already been ordered/i.test(nothingOpen.note),
  nothingOpen.note);

const someOpen = offer(C.ROLE.ADMIN, [ordered, claim(C.STATUS.INTERNAL)]);
check('one claim with an open part is enough to offer the decision',
  someOpen.actions.join() === 'approve,reject', someOpen.actions.join());
check('and the decision is taken over the open parts only',
  C.openPartsOf([ordered, claim(C.STATUS.INTERNAL)]).length === 1);

/* the principal ----------------------------------------------------------- */

const theirs = offer(C.ROLE.PRINCIPAL, [claim(C.STATUS.IN_REVIEW), claim(C.STATUS.IN_REVIEW)]);
check('the principal decides on the claims waiting on them',
  theirs.actions.join() === 'approve,reject', theirs.actions.join());
check('but not across two statuses either',
  offer(C.ROLE.PRINCIPAL, [claim(C.STATUS.IN_REVIEW), claim(C.STATUS.CLOSED)])
    .actions.length === 0);
check('and never the administrator\'s moves',
  offer(C.ROLE.PRINCIPAL, [claim(C.STATUS.SUBMITTED)]).actions.indexOf('forward') === -1);

check('a requester is offered nothing even if a selection somehow reached here',
  offer(C.ROLE.REQUESTER, [claim(C.STATUS.DRAFT)]).actions.length === 0);

check('nothing selected is not an error, just an empty bar',
  offer(C.ROLE.ADMIN, []).actions.length === 0 && offer(C.ROLE.ADMIN, []).note === '');

/* the table still lines up with its header -------------------------------- */

// A column added in front of the caret shifts every colspan under it. The part
// rows are drawn from head.length, so a mistake there is a table that looks
// fine until a claim has a part.
[C.ROLE.ADMIN, C.ROLE.PRINCIPAL, C.ROLE.REQUESTER].forEach(function (role) {
  C.S.session = { email: 'rian@rs.co.id', role: role, isTester: false };
  C.S.tab = 'all';
  C.S.group = 'none';
  C.S.collapsed = {};
  C.S.pick = {};
  C.S.rows = [claim(C.STATUS.SUBMITTED), claim(C.STATUS.SUBMITTED, { items: [] })];
  const html = C.claimTable();
  const cols = (html.match(/<th[ >]/g) || []).length;

  const claimLines = html.match(/<tr class="click"[\s\S]*?<\/tr>/g) || [];
  check('every claim row has one cell per column, as ' + role,
    claimLines.length === 2 && claimLines.every(function (r) {
      return (r.match(/<td/g) || []).length === cols;
    }), claimLines.map(function (r) { return (r.match(/<td/g) || []).length; }).join('/') +
    ' against ' + cols);

  const subLines = html.match(/<tr class="sub"[\s\S]*?<\/tr>/g) || [];
  check('and every part row spans exactly the same width, as ' + role,
    subLines.length === 2 && subLines.every(function (r) {
      const cells = (r.match(/<td/g) || []).length;
      const spans = (r.match(/colspan="(\d+)"/g) || [])
        .reduce(function (t, m) { return t + Number(/\d+/.exec(m)[0]) - 1; }, 0);
      return cells + spans === cols;
    }), subLines.map(function (r) { return (r.match(/<td/g) || []).length; }).join('/') +
    ' cells, ' + cols + ' columns');

  // The elbow that ties a part to its claim is drawn under the caret. A tick
  // column in front of the caret has to push the spacer cells across with it,
  // or the elbow hangs under the tick box instead. The cell arithmetic works
  // out the same either way, so only the count of leading spacers says so.
  const spacers = subLines.map(function (r) {
    return (/^(?:<tr class="sub">)((?:<td><\/td>)*)/.exec(r) || ['', ''])[1]
      .split('<td></td>').length - 1;
  });
  check('a part row is indented past the tick column, as ' + role,
    spacers.length === 2 && spacers.every(function (v) {
      return v === (role === C.ROLE.REQUESTER ? 1 : 2);
    }), spacers.join('/') + ' spacer cells');

  const boxes = (html.match(/data-pick=/g) || []).length;
  check('the tick boxes appear only for a role that can use them, as ' + role,
    boxes === (role === C.ROLE.REQUESTER ? 0 : 2), boxes + ' boxes');
});

/* ------------------------------------------------------------------ report */

console.log('verify-bulk: ' + pass + ' checks passed' +
  (failures.length ? ', ' + failures.length + ' FAILED' : ''));
failures.forEach(function (f) { console.log('  FAIL  ' + f); });
process.exit(failures.length ? 1 : 0);
