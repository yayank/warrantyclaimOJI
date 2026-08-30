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
    .concat(['globalThis.__api = { matchesTab_, needsAction_, STATUS, ITEM_STATUS, ROLE };'])
    .join('\n'),
  sandbox, { filename: 'tabs' }
);

const { matchesTab_, needsAction_, STATUS, ITEM_STATUS, ROLE } = sandbox.__api;

const OWNER = 'rian@rs.co.id';

function session(role) {
  return { email: OWNER, role: role, isTester: false, principal: 'Sansin' };
}

function row(status, itemStatus) {
  return {
    claimId: 'C1', status: status, principal: 'Sansin',
    warrantyType: 'Principal Warranty', requesterEmail: OWNER,
    items: [{ itemId: 'I1', itemStatus: itemStatus || ITEM_STATUS.PENDING }]
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
  return ['action', 'progress', 'completed'].filter(function (tab) {
    return matchesTab_(session(role), r, tab);
  });
}

/* ------------------------------------- every claim lands in exactly one tab */

const STATUSES = [STATUS.DRAFT, STATUS.SUBMITTED, STATUS.RETURNED, STATUS.IN_REVIEW,
  STATUS.INTERNAL, STATUS.FULFILMENT, STATUS.CLOSED];
const ITEMS = [ITEM_STATUS.PENDING, ITEM_STATUS.APPROVED, ITEM_STATUS.REJECTED,
  ITEM_STATUS.FORWARDED, ITEM_STATUS.AWAITING, ITEM_STATUS.SHIPPED];
const ROLES = [ROLE.REQUESTER, ROLE.PRODUCTION, ROLE.ADMIN, ROLE.PRINCIPAL];

ROLES.forEach(function (role) {
  STATUSES.forEach(function (status) {
    ITEMS.forEach(function (itemStatus) {
      const found = tabsFor(role, row(status, itemStatus));
      check(role + ' · ' + status + ' · ' + itemStatus + ' lands in exactly one tab',
        found.length === 1, found.length ? 'in ' + found.join(' and ') : 'in no tab at all');
    });
  });
});

/* ------------------------------------------------- the placements that matter */

check('a draft is the requester\'s to finish',
  tabsFor(ROLE.REQUESTER, row(STATUS.DRAFT))[0] === 'action');

check('a draft is not the administrator\'s to act on',
  !needsAction_(session(ROLE.ADMIN), row(STATUS.DRAFT)));

check('but the administrator still sees it, under In Progress',
  tabsFor(ROLE.ADMIN, row(STATUS.DRAFT))[0] === 'progress');

check('a returned claim is back with the requester',
  tabsFor(ROLE.REQUESTER, row(STATUS.RETURNED))[0] === 'action');

check('a submitted claim waits on the administrator',
  tabsFor(ROLE.ADMIN, row(STATUS.SUBMITTED))[0] === 'action');

check('and is progress, not action, for the requester who sent it',
  tabsFor(ROLE.REQUESTER, row(STATUS.SUBMITTED))[0] === 'progress');

check('a claim in review with a pending part waits on the principal',
  tabsFor(ROLE.PRINCIPAL, row(STATUS.IN_REVIEW, ITEM_STATUS.PENDING))[0] === 'action');

check('once decided it is no longer theirs to act on',
  tabsFor(ROLE.PRINCIPAL, row(STATUS.IN_REVIEW, ITEM_STATUS.APPROVED))[0] === 'progress');

check('fulfilment with an approved part is the administrator\'s',
  tabsFor(ROLE.ADMIN, row(STATUS.FULFILMENT, ITEM_STATUS.APPROVED))[0] === 'action');

check('a closed claim is completed for everyone',
  ROLES.every(function (r) { return tabsFor(r, row(STATUS.CLOSED, ITEM_STATUS.SHIPPED))[0] === 'completed'; }));

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
