/**
 * verify-visits.js — what moved while you were away, and only that.
 *
 * A "new since last visit" marker is easy to build and easy to build uselessly.
 * Two things decide which, and both are checked here.
 *
 * WHEN THE BOUNDARY MOVES. If it moved every time a list was drawn, the marker
 * would be gone by the time anybody read it — and a reload is a fresh sign-in,
 * so moving it on every sign-in fails the same way more slowly. It moves when a
 * page opens after a real absence, and when somebody says they have looked.
 * Never while a list is being drawn, however many times that happens.
 *
 * WHOSE CHANGES COUNT. Not your own. Somebody who has just forwarded twelve
 * claims does not need twelve markers telling them so, and a marker that lights
 * up for your own work stops meaning "look at this".
 *
 *   node tools/verify-visits.js
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

/* ------------------------------------------------------------- the clock */

// Moved by hand, because the whole feature is about elapsed time and a test
// that waits for real minutes to pass is a test nobody runs.
let CLOCK = new Date('2026-09-10T08:00:00Z');
function tick(minutes) { CLOCK = new Date(CLOCK.getTime() + minutes * 60000); }
function pad(n, w) { return String(n).padStart(w, '0'); }
function stampOf(d) {
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1, 2) + '-' +
    pad(d.getUTCDate(), 2) + 'T' + pad(d.getUTCHours(), 2) + ':' +
    pad(d.getUTCMinutes(), 2) + ':' + pad(d.getUTCSeconds(), 2);
}
function now() { return stampOf(CLOCK); }
function minutesApart(a, b) {
  return (new Date(b + 'Z').getTime() - new Date(a + 'Z').getTime()) / 60000;
}

/* ----------------------------------------------- a spreadsheet that writes */

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
let STORE = {};
const book = {
  getSheetByName: function (n) { return SHEETS[n] || null; },
  getSheets: function () { return Object.keys(SHEETS).map(function (n) { return SHEETS[n]; }); },
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
      return {
        getProperty: function (k) { return STORE[k] === undefined ? null : STORE[k]; },
        setProperty: function (k, v) { STORE[k] = String(v); },
        deleteProperty: function (k) { delete STORE[k]; }
      };
    }
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
      const d = date instanceof Date ? date : CLOCK;
      if (fmt === 'yyyy') return String(d.getUTCFullYear());
      if (fmt === 'yyMMdd') {
        return String(d.getUTCFullYear()).slice(2) +
          pad(d.getUTCMonth() + 1, 2) + pad(d.getUTCDate(), 2);
      }
      return stampOf(d);
    }
  }
};
// Everything that asks the time gets the hand-moved clock.
sandbox.Date = function () {
  if (!(this instanceof sandbox.Date)) return new Date(CLOCK).toString();
  // Only the arguments actually given: passing seven of them, most undefined,
  // makes Date read a string as a year and hand back NaN.
  const args = Array.prototype.slice.call(arguments);
  return args.length ? new Date(...args) : new Date(CLOCK);
};
sandbox.Date.now = function () { return CLOCK.getTime(); };
sandbox.Date.prototype = Date.prototype;

vm.createContext(sandbox);
['Config.gs', 'Repo.gs', 'Auth.gs', 'Audit.gs', 'Visits.gs', 'Claims.gs'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'),
    sandbox, { filename: f });
});
vm.runInContext([
  'globalThis.sendMail_ = function () { return { Status: "Sent" }; };',
  'globalThis.attachmentsFor_ = function () { return []; };',
  'globalThis.__api = { openVisit_, visitSince_, markVisitSeen_, isNewToViewer_,',
  '  VISIT_GAP_MINUTES, listClaims_, refreshClaimSummaries_, decideItems_, findBy_,',
  '  SHEET, SCHEMA };'
].join('\n'), sandbox, { filename: 'stubs' });

const api = sandbox.__api;
const SHEET = api.SHEET;
const SRI = {
  email: 'sri@oji.co.id', role: 'Administrator', actualRole: 'Administrator',
  simulatedRole: null, isTester: false, principal: ''
};
const RIAN = {
  email: 'rian@rs.co.id', role: 'Requester', actualRole: 'Requester',
  simulatedRole: null, isTester: false, principal: ''
};
const SANSIN = {
  email: 'order@sansin.co.jp', role: 'Principal', actualRole: 'Principal',
  simulatedRole: null, isTester: false, principal: 'Sansin'
};
// The same person, wearing another role for the afternoon. Their visit is
// theirs, not the hat's.
const TESTER = {
  email: 'sri@oji.co.id', role: 'Principal', actualRole: 'Tester',
  simulatedRole: 'Principal', isTester: true, principal: 'Sansin'
};

/* --------------------------------------------------- the boundary itself */

STORE = {};
CLOCK = new Date('2026-09-10T08:00:00Z');

const firstEver = api.openVisit_(SRI);
check('the first visit ever is measured from itself, so nothing is flagged',
  firstEver === now(), firstEver + ' against ' + now());

tick(5);
const reload = api.openVisit_(SRI);
check('a reload five minutes later is the same visit, and the boundary holds',
  reload === firstEver, reload + ' against ' + firstEver);

tick(20);
check('and still is at twenty-five minutes', api.openVisit_(SRI) === firstEver);

// Long enough away that what happened meanwhile is worth pointing at.
const leftAt = now();
tick(api.VISIT_GAP_MINUTES + 1);
const nextDay = api.openVisit_(SRI);
check('coming back after a real absence measures from when you left',
  nextDay === leftAt, nextDay + ' against ' + leftAt);

tick(2);
check('and that boundary then holds through the visit that follows',
  api.openVisit_(SRI) === nextDay);

/* ------------------------------- drawing a list never moves the boundary */

// Crossing the gap matters here: a tab left open all morning is exactly the
// case where a boundary that moves on reading would wipe the markers before
// anybody came back to read them. So the clock runs well past VISIT_GAP while
// nothing but reads happen.
const held = api.visitSince_(SRI);
for (let i = 0; i < 10; i++) { tick(api.VISIT_GAP_MINUTES); api.visitSince_(SRI); }
check('reading the boundary does not move it, however long the clock runs',
  api.visitSince_(SRI) === held, api.visitSince_(SRI) + ' against ' + held);
check('and the hours that passed are still hours it can point back across',
  minutesApart(held, now()) > api.VISIT_GAP_MINUTES * 5,
  minutesApart(held, now()) + ' minutes');

/* ------------------------------------------------------ saying you looked */

tick(1);
const cleared = api.markVisitSeen_(SRI);
check('marking as seen moves the boundary to now', cleared.since === now(),
  cleared.since + ' against ' + now());
check('and the boundary read back afterwards agrees',
  api.visitSince_(SRI) === now());
tick(5);
check('a reload after that keeps the cleared boundary rather than reopening it',
  api.openVisit_(SRI) === cleared.since);

/* ------------------------------------------------------- one per person */

STORE = {};
CLOCK = new Date('2026-09-10T08:00:00Z');
const sriFirst = api.openVisit_(SRI);
tick(api.VISIT_GAP_MINUTES + 1);
const rianFirst = api.openVisit_(RIAN);

check('two people each get their own first visit',
  sriFirst !== rianFirst, sriFirst + ' / ' + rianFirst);
check('and neither one moves the other',
  api.visitSince_(SRI) === sriFirst && api.visitSince_(RIAN) === rianFirst);
check('kept under keys that name them',
  !!STORE['visit:' + SRI.email] && !!STORE['visit:' + RIAN.email],
  Object.keys(STORE).join(', '));

check('a Tester simulating another role keeps their own visit',
  api.visitSince_(TESTER) === sriFirst, api.visitSince_(TESTER) + ' against ' + sriFirst);

/* --------------------------------------------------- a damaged property */

STORE = { 'visit:sri@oji.co.id': '{ not json' };
check('a stamp that will not parse reads as no visit rather than an error',
  stage('reading a damaged visit stamp', function () {
    return api.visitSince_(SRI) === '';
  }) === true);
check('and opening over it starts a fresh first visit',
  stage('opening over a damaged stamp', function () {
    return api.openVisit_(SRI) === now();
  }) === true);

/* ------------------------------------------------ whose change counts */

const BOUNDARY = '2026-09-11T08:00:00';
function claimRowObj(extra) {
  return Object.assign({ ClaimID: 'CLM-A', UpdatedAt: '', UpdatedBy: '' }, extra || {});
}

check('a change after the boundary, by somebody else, is new',
  api.isNewToViewer_(claimRowObj({
    UpdatedAt: '2026-09-11T10:00:00', UpdatedBy: 'rian@rs.co.id'
  }), SRI, BOUNDARY));

check('the same change made by you is not',
  !api.isNewToViewer_(claimRowObj({
    UpdatedAt: '2026-09-11T10:00:00', UpdatedBy: 'sri@oji.co.id'
  }), SRI, BOUNDARY));

check('and the address is matched whatever case it was written in',
  !api.isNewToViewer_(claimRowObj({
    UpdatedAt: '2026-09-11T10:00:00', UpdatedBy: 'Sri@OJI.co.id'
  }), SRI, BOUNDARY));

check('a change from before the boundary is not new',
  !api.isNewToViewer_(claimRowObj({
    UpdatedAt: '2026-09-10T10:00:00', UpdatedBy: 'rian@rs.co.id'
  }), SRI, BOUNDARY));

check('a claim never touched at all is not new',
  !api.isNewToViewer_(claimRowObj({ UpdatedBy: 'rian@rs.co.id' }), SRI, BOUNDARY));

check('and with no boundary yet, nothing is new',
  !api.isNewToViewer_(claimRowObj({
    UpdatedAt: '2026-09-11T10:00:00', UpdatedBy: 'rian@rs.co.id'
  }), SRI, ''));

/* ============================================ through the real claim list */

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
    Status: 'In Review', RequesterEmail: 'rian@rs.co.id', RequesterName: 'Rian',
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

const LIST_IDS = ['CLM-A', 'CLM-B', 'CLM-C', 'CLM-D'];

function buildSheets(overrides) {
  const over = overrides || {};
  SHEETS = {
    Claims: new Sheet('Claims', [CLAIM_COLS.slice()].concat(
      LIST_IDS.map(function (id) { return claimRow(id, over[id] || {}); }))),
    ClaimItems: new Sheet('ClaimItems', [ITEM_COLS.slice()].concat(
      LIST_IDS.map(function (id) { return itemRow('ITM-' + id, id); }))),
    AuditLog: new Sheet('AuditLog', [api.SCHEMA[SHEET.AUDIT].slice()]),
    Attachments: new Sheet('Attachments', [api.SCHEMA[SHEET.ATTACHMENTS].slice()])
  };
}

// Sri last looked on the 11th. Since then: the principal touched two claims,
// Sri touched one themselves, and one has not moved since before that.
STORE = {};
CLOCK = new Date('2026-09-11T08:00:00Z');
api.openVisit_(SRI);
CLOCK = new Date('2026-09-12T08:00:00Z');
api.openVisit_(SRI);

buildSheets({
  'CLM-A': { UpdatedAt: '2026-09-11T20:00:00', UpdatedBy: 'order@sansin.co.jp' },
  'CLM-B': { UpdatedAt: '2026-09-11T21:00:00', UpdatedBy: 'order@sansin.co.jp' },
  'CLM-C': { UpdatedAt: '2026-09-11T22:00:00', UpdatedBy: 'sri@oji.co.id' },
  'CLM-D': { UpdatedAt: '2026-09-10T09:00:00', UpdatedBy: 'order@sansin.co.jp' }
});

function marked() {
  return api.listClaims_(SRI, { tab: 'all', items: 'none' })
    .rows.filter(function (r) { return r.isNew; })
    .map(function (r) { return r.claimId; }).sort();
}

check('the list marks what moved while they were away',
  marked().join() === 'CLM-A,CLM-B', marked().join() || '(none)');
check('their own change is not among them', marked().indexOf('CLM-C') === -1);
check('and neither is one that had not moved since before they left',
  marked().indexOf('CLM-D') === -1);

const listed = api.listClaims_(SRI, { tab: 'all', items: 'none' });
check('the count says how many, over the whole set rather than the page',
  listed.counts.fresh === 2, 'counted ' + listed.counts.fresh);
check('and still does when only a page is asked for',
  api.listClaims_(SRI, { tab: 'all', items: 'none', limit: 1 }).counts.fresh === 2,
  'counted ' + api.listClaims_(SRI, { tab: 'all', limit: 1 }).counts.fresh);

// The failure this whole design exists to avoid: markers that are gone by the
// time somebody looks at them.
for (let i = 0; i < 5; i++) {
  CLOCK = new Date(CLOCK.getTime() + api.VISIT_GAP_MINUTES * 2 * 60000);
  api.listClaims_(SRI, { tab: 'all', items: 'none' });
}
check('drawing the list all morning leaves the markers exactly where they were',
  marked().join() === 'CLM-A,CLM-B', marked().join() || '(none)');

// Recounting a claim's parts writes with setCells_, which leaves UpdatedAt and
// UpdatedBy alone. If it did not, every summary refresh would light up every
// claim for everybody.
api.refreshClaimSummaries_(['CLM-D']);
check('recounting a claim\'s parts does not make it look new',
  marked().join() === 'CLM-A,CLM-B', marked().join() || '(none)');

// The principal looking at the same claims sees the other side of it.
STORE['visit:' + SANSIN.email] = JSON.stringify({
  boundary: '2026-09-11T08:00:00', seen: '2026-09-12T08:00:00'
});
const theirs = api.listClaims_(SANSIN, { tab: 'all', items: 'none' })
  .rows.filter(function (r) { return r.isNew; })
  .map(function (r) { return r.claimId; }).sort();
check('the principal is not shown their own two changes',
  theirs.indexOf('CLM-A') === -1 && theirs.indexOf('CLM-B') === -1, theirs.join());
check('but is shown the one the administrator made',
  theirs.join() === 'CLM-C', theirs.join() || '(none)');

// Saying you have looked clears them, and the next list says so.
CLOCK = new Date('2026-09-12T09:00:00Z');
api.markVisitSeen_(SRI);
check('after marking as seen, nothing is marked any more',
  marked().length === 0, marked().join());
check('and the count agrees',
  api.listClaims_(SRI, { tab: 'all', items: 'none' }).counts.fresh === 0);

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
const clientSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'Script.html'), 'utf8')
  .replace(/^[\s\S]*?<script>/, '')
  .replace(/<\/script>\s*$/, '');
vm.runInContext(clientSrc +
  '\nglobalThis.__client = { S, claimTable, freshLine, STATUS, ITEM, WARRANTY, ROLE };',
  clientBox, { filename: 'client' });
const C = clientBox.__client;

let n = 0;
function shaped(isNew) {
  n++;
  return {
    claimId: 'CLM-' + n, refNo: 'CW120926', status: C.STATUS.IN_REVIEW,
    warrantyType: C.WARRANTY.PRINCIPAL, customerName: 'RSUD Koja',
    serialNumber: 'XT240' + n, requesterName: 'Rian', workOrderNo: 'WO-' + n,
    principal: 'Sansin', createdAt: '2026-09-01T09:00:00', submittedAt: '2026-09-01T09:30:00',
    ageDays: 2, rowVersion: 1, itemsLoaded: true, isNew: isNew,
    items: [{ itemId: 'I' + n, partName: 'Rotor', qty: 1, itemStatus: C.ITEM.PENDING }],
    summary: { itemCount: 1, approved: 0, rejected: 0, pending: 1, shipped: 0,
      advance: 0, advanceQueue: 1, awaitingReturn: 0 }
  };
}

C.S.session = { email: 'sri@oji.co.id', role: C.ROLE.ADMIN, isTester: false };
C.S.tab = 'all';
C.S.group = 'none';
C.S.collapsed = {};
C.S.pick = {};
C.S.rows = [shaped(true), shaped(false), shaped(true)];
const html = C.claimTable();
const rowsDrawn = html.match(/<tr class="click"[\s\S]*?<\/tr>/g) || [];

check('a claim that moved carries a marker',
  rowsDrawn.length === 3 &&
  rowsDrawn.filter(function (r) { return /p-new/.test(r); }).length === 2,
  rowsDrawn.filter(function (r) { return /p-new/.test(r); }).length + ' marked');
check('and one that did not carries none',
  !/p-new/.test(rowsDrawn[1]));
check('the marker rides inside the claim cell, so the card layout needs no new place for it',
  /<td class="stack c-claim">[\s\S]*?p-new[\s\S]*?<\/td>/.test(rowsDrawn[0]));

C.S.counts = { action: 0, advance: 0, fresh: 3 };
C.S.since = '2026-09-11T08:00:00';
const line = C.freshLine();
check('the line says how many moved, including any not on this page',
  /<b>3<\/b>/.test(line), line);
check('and offers a way to clear them', /seenAll/.test(line), line);
check('with nothing moved, the line is not drawn at all',
  (function () { C.S.counts.fresh = 0; return C.freshLine() === ''; })());

/* ------------------------------------------------------------------ report */

console.log('verify-visits: ' + pass + ' checks passed' +
  (failures.length ? ', ' + failures.length + ' FAILED' : ''));
failures.forEach(function (f) { console.log('  FAIL  ' + f); });
process.exit(failures.length ? 1 : 0);
