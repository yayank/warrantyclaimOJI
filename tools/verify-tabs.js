/**
 * verify-tabs.js — checks that no claim can hide from the role looking at it.
 *
 * The claims screen has four tabs, and three of them partition the work:
 * Needs Action, In Progress, Completed. A claim that matches none of them is
 * reachable only from All, which is where a draft went to hide from the
 * administrator — every tab said no, and nothing said why.
 *
 * matchesTab_ and needsAction_ are pure functions of a row and a role, so they
 * are called here exactly as the server calls them.
 *
 *   node tools/verify-tabs.js
 */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { console: console };
vm.createContext(sandbox);
vm.runInContext(
  ['Config.gs', 'Claims.gs']
    .map(function (f) { return fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'); })
    .concat(['globalThis.__api = { matchesTab_, needsAction_, awaitingReturnOnly_, STATUS, ITEM_STATUS, ROLE };'])
    .join('\n'),
  sandbox, { filename: 'tabs' }
);

const { matchesTab_, needsAction_, STATUS, ITEM_STATUS, ROLE } = sandbox.__api;

const OWNER = 'rian@rs.co.id';

function session(role) {
  return { email: OWNER, role: role, isTester: false, principal: 'Sansin' };
}

/**
 * `owed` is how many shipped parts have not had their faulty one returned —
 * the only thing separating a claim that is finished from one that is over.
 */
function row(status, itemStatus, owed, warrantyType) {
  const item = { itemId: 'I1', itemStatus: itemStatus || ITEM_STATUS.PENDING };
  return {
    claimId: 'C1', status: status, principal: 'Sansin',
    warrantyType: warrantyType || 'Principal Warranty', requesterEmail: OWNER,
    items: [item],
    summary: {
      approved: 0, rejected: 0, shipped: 0, advance: 0,
      pending: item.itemStatus === ITEM_STATUS.PENDING ? 1 : 0,
      awaitingReturn: owed || 0
    }
  };
}

let pass = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

/** Which of the three working tabs a claim lands in, for this role. */
function tabsFor(role, r) {
  return ['action', 'progress', 'completed', 'closed'].filter(function (tab) {
    return matchesTab_(session(role), r, tab);
  });
}

/* ------------------------ every live claim is reachable while it is live */

const STATUSES = [STATUS.DRAFT, STATUS.SUBMITTED, STATUS.RETURNED, STATUS.IN_REVIEW,
  STATUS.INTERNAL, STATUS.FULFILMENT, STATUS.CLOSED];
const ITEMS = [ITEM_STATUS.PENDING, ITEM_STATUS.APPROVED, ITEM_STATUS.REJECTED,
  ITEM_STATUS.FORWARDED, ITEM_STATUS.AWAITING, ITEM_STATUS.SHIPPED];
const ROLES = [ROLE.REQUESTER, ROLE.PRODUCTION, ROLE.ADMIN, ROLE.PRINCIPAL];

ROLES.forEach(function (role) {
  STATUSES.forEach(function (status) {
    ITEMS.forEach(function (itemStatus) {
      const r = row(status, itemStatus);
      const found = tabsFor(role, r);
      // Needs Action and In Progress overlap on purpose: the first is a
      // shortcut into the second. What must never happen is a live claim in no
      // working tab at all — that is how work stops being tracked. A draft is
      // the exception: not under way, waiting on nobody but its author.
      const draftOfSomeoneElse = status === STATUS.DRAFT && !needsAction_(session(role), r);
      check(role + ' · ' + status + ' · ' + itemStatus +
        (draftOfSomeoneElse ? ' sits outside the working tabs' : ' is in a working tab'),
        draftOfSomeoneElse ? found.length === 0 : found.length >= 1,
        'in ' + (found.join(' and ') || 'no tab at all'));

      check(role + ' · ' + status + ' · ' + itemStatus + ' is never both live and finished',
        !(found.indexOf('closed') !== -1 && found.indexOf('progress') !== -1));
    });
  });
});

/* ------------------------------------------------- the placements that matter */

check('a draft is the requester\'s to finish',
  tabsFor(ROLE.REQUESTER, row(STATUS.DRAFT))[0] === 'action');

check('a draft is not the administrator\'s to act on',
  !needsAction_(session(ROLE.ADMIN), row(STATUS.DRAFT)));

check('and it is in none of the administrator\'s working tabs',
  tabsFor(ROLE.ADMIN, row(STATUS.DRAFT)).length === 0,
  tabsFor(ROLE.ADMIN, row(STATUS.DRAFT)).join(', '));

check('the administrator reaches it from All instead',
  matchesTab_(session(ROLE.ADMIN), row(STATUS.DRAFT), 'all'));

check('a returned claim is back with the requester',
  tabsFor(ROLE.REQUESTER, row(STATUS.RETURNED))[0] === 'action');

check('a submitted claim waits on the administrator',
  tabsFor(ROLE.ADMIN, row(STATUS.SUBMITTED)).indexOf('action') !== -1);

check('and it is still in In Progress — needing attention does not remove it',
  tabsFor(ROLE.ADMIN, row(STATUS.SUBMITTED)).indexOf('progress') !== -1,
  tabsFor(ROLE.ADMIN, row(STATUS.SUBMITTED)).join(', '));

check('internal verification has a queue of its own',
  matchesTab_(session(ROLE.ADMIN), row(STATUS.INTERNAL), 'internal'));

check('and nothing else is in it',
  !matchesTab_(session(ROLE.ADMIN), row(STATUS.SUBMITTED), 'internal') &&
  !matchesTab_(session(ROLE.ADMIN), row(STATUS.IN_REVIEW), 'internal') &&
  !matchesTab_(session(ROLE.ADMIN), row(STATUS.CLOSED), 'internal'));

/* -------------------------- the two roads, each a cut through In Progress */

const OUT = 'Out of Principal Warranty';

check('a principal-warranty claim under way has a queue of its own',
  matchesTab_(session(ROLE.ADMIN), row(STATUS.IN_REVIEW), 'principal'));

check('and it is still in In Progress — the tab is a cut, not a removal',
  tabsFor(ROLE.ADMIN, row(STATUS.IN_REVIEW)).indexOf('progress') !== -1);

check('a claim outside the principal warranty is not in it',
  !matchesTab_(session(ROLE.ADMIN), row(STATUS.INTERNAL, null, 0, OUT), 'principal'));

check('nor is a draft that has not been submitted',
  !matchesTab_(session(ROLE.ADMIN), row(STATUS.DRAFT), 'principal'));

check('nor a closed one',
  !matchesTab_(session(ROLE.ADMIN), row(STATUS.CLOSED, ITEM_STATUS.SHIPPED), 'principal'));

check('nor one that is only waiting on the faulty part coming back',
  !matchesTab_(session(ROLE.ADMIN), row(STATUS.FULFILMENT, ITEM_STATUS.SHIPPED, 1), 'principal'));

check('the internal queue is the other road, and the two do not overlap',
  matchesTab_(session(ROLE.ADMIN), row(STATUS.INTERNAL, null, 0, OUT), 'internal') &&
  !matchesTab_(session(ROLE.ADMIN), row(STATUS.INTERNAL, null, 0, OUT), 'principal'));

check('and is progress, not action, for the requester who sent it',
  tabsFor(ROLE.REQUESTER, row(STATUS.SUBMITTED)).join() === 'progress');

check('a claim in review with a pending part waits on the principal',
  tabsFor(ROLE.PRINCIPAL, row(STATUS.IN_REVIEW, ITEM_STATUS.PENDING)).indexOf('action') !== -1);

check('once decided it is no longer theirs to act on',
  tabsFor(ROLE.PRINCIPAL, row(STATUS.IN_REVIEW, ITEM_STATUS.APPROVED)).indexOf('action') === -1);

check('fulfilment with an approved part is the administrator\'s',
  tabsFor(ROLE.ADMIN, row(STATUS.FULFILMENT, ITEM_STATUS.APPROVED)).indexOf('action') !== -1);

check('a closed claim reads as Closed for everyone, and only Closed',
  ROLES.every(function (r) {
    return tabsFor(r, row(STATUS.CLOSED, ITEM_STATUS.SHIPPED)).join() === 'closed';
  }));

/* ------------------------------ finished, and over, are not the same thing */

const owing = row(STATUS.FULFILMENT, ITEM_STATUS.SHIPPED, 1);
const settled = row(STATUS.CLOSED, ITEM_STATUS.SHIPPED, 0);

check('the warranty is done but the faulty part is still out — Completed',
  tabsFor(ROLE.ADMIN, owing).join() === 'completed', tabsFor(ROLE.ADMIN, owing).join(', '));

check('and it is not in In Progress as well — the tab would read longer than the work',
  tabsFor(ROLE.ADMIN, owing).indexOf('progress') === -1);

check('once the part is back the claim is Closed, not Completed',
  tabsFor(ROLE.ADMIN, settled).join() === 'closed', tabsFor(ROLE.ADMIN, settled).join(', '));

check('a claim still deciding parts is neither',
  tabsFor(ROLE.ADMIN, row(STATUS.IN_REVIEW, ITEM_STATUS.PENDING, 0)).indexOf('completed') === -1);

check('nor is one whose approved part has not shipped yet',
  tabsFor(ROLE.ADMIN, row(STATUS.FULFILMENT, ITEM_STATUS.APPROVED, 0)).indexOf('completed') === -1);

check('a draft is never Completed, whatever it carries',
  tabsFor(ROLE.ADMIN, row(STATUS.DRAFT, ITEM_STATUS.SHIPPED, 1)).indexOf('completed') === -1);

check('All shows what the three working tabs show',
  STATUSES.every(function (status) {
    return ROLES.every(function (role) { return matchesTab_(session(role), row(status), 'all'); });
  }));

/* -------------------------------------------------------------------- report */

console.log('');
failures.slice(0, 12).forEach(function (f) { console.log('  ✗ ' + f); });
if (failures.length > 12) console.log('  … and ' + (failures.length - 12) + ' more');
console.log('  ' + pass + ' passed, ' + failures.length + ' failed');
console.log('');
process.exit(failures.length ? 1 : 0);
