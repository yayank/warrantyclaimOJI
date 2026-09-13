/**
 * verify-actions.js — checks which buttons a claim offers, and to whom.
 *
 * The panel used to offer everything that was legal at a status. An
 * administrator opening a submitted claim got eight buttons — amend, override,
 * attribute, record stock, return, forward — for what is really one decision:
 * does this go to the principal or not. The decision got lost among the
 * corrections, and Amend let an administrator edit a claim behind the
 * requester's back.
 *
 * Each status now offers the move that belongs to it. This runs the real
 * renderPanelActions from src/Script.html against a stubbed document and reads
 * back the labels it produced.
 *
 *   node tools/verify-actions.js
 */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ---------------------------------------------- just enough of a document */

function node() {
  const n = {
    type: '', className: '', textContent: '', dataset: {}, children: [],
    innerHTML: '',
    appendChild: function (c) { n.children.push(c); return c; },
    addEventListener: function () {},
    querySelectorAll: function () { return []; },
    setAttribute: function () {}, removeAttribute: function () {}
  };
  return n;
}

const host = node();
const sandbox = {
  console: console,
  document: {
    // The page's own el() goes through this; the panel foot is the only node
    // whose contents are read back, so every other id gets a fresh blank one.
    getElementById: function (id) { return id === 'panelActions' ? host : node(); },
    createElement: function (tag) { const n = node(); n.type = tag; return n; },
    body: node(),
    querySelectorAll: function () { return []; },
    addEventListener: function () {}
  },
  // A client id set means the page waits for the sign-in library rather than
  // starting a session of its own while it loads.
  window: { APP_CLIENT_ID: 'stub.apps.googleusercontent.com' },
  google: { script: { run: {} } },
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  confirm: function () { return true; }
};
vm.createContext(sandbox);

const script = fs.readFileSync(path.join(__dirname, '..', 'src', 'Script.html'), 'utf8')
  .replace(/^[\s\S]*?<script>/, '')
  .replace(/<\/script>\s*$/, '');
vm.runInContext(script + '\nglobalThis.__api = { renderPanelActions, STATUS, ITEM, WARRANTY, ROLE, S };',
  sandbox, { filename: 'client' });

const { renderPanelActions, STATUS, ITEM, WARRANTY, ROLE, S } = sandbox.__api;

/* --------------------------------------------------------------- fixtures */

function claim(status, warrantyType, extra) {
  return Object.assign({
    claimId: 'CLM-1', status: status, warrantyType: warrantyType,
    serialNumber: 'XT24100001', principal: 'Sansin', rowVersion: 1,
    requesterEmail: 'rian@rs.co.id',
    items: [{ itemId: 'I1', itemStatus: ITEM.PENDING }],
    summary: { approved: 0, rejected: 0, pending: 1, shipped: 0, advance: 0, awaitingReturn: 0 }
  }, extra || {});
}

function labels(role, c) {
  S.session = { email: 'admin@oneject.co.id', role: role, isTester: false };
  host.children = [];
  host.innerHTML = '';
  renderPanelActions(c);
  return host.children.map(function (b) { return b.textContent; });
}

let pass = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}
function same(got, want) {
  return got.length === want.length && want.every(function (w, i) { return got[i] === w; });
}
function exactly(name, role, c, want) {
  const got = labels(role, c);
  check(name, same(got, want), 'got [' + got.join(', ') + ']');
}

/* ------------------------------------------- the administrator's four cases */

exactly('principal warranty, submitted: return it, or forward it',
  ROLE.ADMIN, claim(STATUS.SUBMITTED, WARRANTY.PRINCIPAL),
  ['Unit history', 'Return to Requester', 'Forward to Principal']);

exactly('out of principal warranty, submitted: return it, or take it on ourselves',
  ROLE.ADMIN, claim(STATUS.SUBMITTED, WARRANTY.OUT),
  ['Unit history', 'Return to Requester', 'Process Internal Warranty']);

exactly('sent back to the requester: nothing to do but look',
  ROLE.ADMIN, claim(STATUS.RETURNED, WARRANTY.OUT),
  ['Unit history']);

exactly('internal verification: decide the parts',
  ROLE.ADMIN, claim(STATUS.INTERNAL, WARRANTY.OUT),
  ['Unit history', 'Approve parts', 'Reject parts']);

check('Amend is gone — an administrator does not edit a claim behind its author',
  [STATUS.SUBMITTED, STATUS.INTERNAL, STATUS.IN_REVIEW, STATUS.FULFILMENT, STATUS.RETURNED]
    .every(function (st) {
      return labels(ROLE.ADMIN, claim(st, WARRANTY.PRINCIPAL)).indexOf('Amend') === -1;
    }));

check('and neither is the forward offered on a claim the principal has nothing to do with',
  labels(ROLE.ADMIN, claim(STATUS.SUBMITTED, WARRANTY.OUT)).indexOf('Forward to Principal') === -1);

check('a draft belongs to its author',
  same(labels(ROLE.ADMIN, claim(STATUS.DRAFT, WARRANTY.PRINCIPAL)), ['Unit history']));

/* --------------------------------------------- the claims already under way */

const inReview = labels(ROLE.ADMIN, claim(STATUS.IN_REVIEW, WARRANTY.PRINCIPAL));
check('a claim with the principal can be withdrawn',
  inReview.indexOf('Withdraw from Principal') !== -1, inReview.join(', '));
check('and stock issued against it is still recorded',
  inReview.indexOf('Record advance issue') !== -1, inReview.join(', '));

const owed = labels(ROLE.ADMIN, claim(STATUS.FULFILMENT, WARRANTY.PRINCIPAL, {
  items: [{ itemId: 'I1', itemStatus: ITEM.SHIPPED }],
  summary: { approved: 1, rejected: 0, pending: 0, shipped: 1, advance: 0, awaitingReturn: 1 }
}));
check('the faulty part still owed can be recorded as returned',
  owed.indexOf('Record part return') !== -1, owed.join(', '));

check('a closed claim offers no further move',
  same(labels(ROLE.ADMIN, claim(STATUS.CLOSED, WARRANTY.PRINCIPAL, {
    items: [{ itemId: 'I1', itemStatus: ITEM.SHIPPED }],
    summary: { approved: 1, rejected: 0, pending: 0, shipped: 1, advance: 0, awaitingReturn: 0 }
  })), ['Unit history']));

/* ------------------------------------------------------------ the principal */

const undecided = claim(STATUS.IN_REVIEW, WARRANTY.PRINCIPAL);
exactly('a part still pending can be approved or rejected',
  ROLE.PRINCIPAL, undecided, ['Approve parts', 'Reject parts']);

const decided = claim(STATUS.IN_REVIEW, WARRANTY.PRINCIPAL, {
  items: [{ itemId: 'I1', itemStatus: ITEM.APPROVED }],
  summary: { approved: 1, rejected: 0, pending: 0, shipped: 0, advance: 0, awaitingReturn: 0 }
});
exactly('once approved, the only thing left is to take it back',
  ROLE.PRINCIPAL, decided, ['Reject parts']);

const partly = claim(STATUS.IN_REVIEW, WARRANTY.PRINCIPAL, {
  items: [{ itemId: 'I1', itemStatus: ITEM.APPROVED }, { itemId: 'I2', itemStatus: ITEM.PENDING }],
  summary: { approved: 1, rejected: 0, pending: 1, shipped: 0, advance: 0, awaitingReturn: 0 }
});
exactly('a claim with one part still undecided keeps both',
  ROLE.PRINCIPAL, partly, ['Approve parts', 'Reject parts']);

check('the principal never sees a claim that is not theirs to supply',
  labels(ROLE.PRINCIPAL, claim(STATUS.IN_REVIEW, WARRANTY.OUT)).length === 0);

/* ------------------------------------------------------------- the requester */

const mine = { requesterEmail: 'admin@oneject.co.id' };
check('a requester edits their own draft',
  labels(ROLE.REQUESTER, claim(STATUS.DRAFT, WARRANTY.PRINCIPAL, mine))
    .indexOf('Edit claim') !== -1);
check('and never sees the unit history',
  labels(ROLE.REQUESTER, claim(STATUS.DRAFT, WARRANTY.PRINCIPAL, mine))
    .indexOf('Unit history') === -1);

/* -------------------------------------------------------------------- report */

console.log('verify-actions: ' + pass + ' checks passed' +
  (failures.length ? ', ' + failures.length + ' FAILED' : ''));
failures.forEach(function (f) { console.log('  FAIL  ' + f); });
process.exit(failures.length ? 1 : 0);
