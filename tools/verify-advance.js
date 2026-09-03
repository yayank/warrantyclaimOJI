/**
 * verify-advance.js — checks the queue of parts waiting to go out from stock.
 *
 * A hospital's machine is down. The part goes out today, from the shelf,
 * whether or not the principal has approved the claim and whether the bill
 * eventually lands with them or with us — what they ship later replenishes the
 * shelf. Recording that one claim at a time answered the wrong question:
 * "what did I send against this claim?" is asked after the fact, and nothing
 * anywhere asked "what has to go out today?".
 *
 * So the queue must not filter on how far a claim has got. It asks two things:
 * has the part left the building, and has anybody written down that it did.
 *
 *   node tools/verify-advance.js
 */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ------------------------------------------------------------- fixtures */

let CLAIMS;
let ITEMS;

function reset() {
  CLAIMS = [];
  ITEMS = [];
}

function claim(id, status, warrantyType, extra) {
  const c = Object.assign({
    ClaimID: id, RefNo: 'CW310826', Status: status, WarrantyType: warrantyType,
    CustomerID: 'C1', CustomerName: 'RSUD Koja', SerialNumber: 'XT' + id,
    ProductName: 'Sansin SWS-4000', Principal: 'Sansin', IsTest: false,
    RequesterEmail: 'rian@rs.co.id', RequesterName: 'Rian',
    CreatedAt: '2026-08-20T09:00:00', SubmittedAt: '2026-08-20T09:00:00',
    RowVersion: 1
  }, extra || {});
  CLAIMS.push(c);
  return c;
}

function item(id, claimId, itemStatus, advanceIssued, extra) {
  const i = Object.assign({
    ItemID: id, ClaimID: claimId, PartID: 'P1', PartName: 'Rotor', Qty: 1,
    ItemStatus: itemStatus, AdvanceIssued: !!advanceIssued,
    AdvanceIssuedAt: advanceIssued ? '2026-08-21T10:00:00' : '',
    AdvanceIssuedBy: advanceIssued ? 'admin@oneject.co.id' : '',
    AdvanceNote: '', PartReturnAt: ''
  }, extra || {});
  ITEMS.push(i);
  return i;
}

const sandbox = {
  console: console,
  readLive_: function (name) { return name === 'ClaimItems' ? ITEMS : CLAIMS; },
  readAll_: function (name) { return name === 'ClaimItems' ? ITEMS : CLAIMS; },
  visibleClaims_: function () { return CLAIMS.slice(); },
  requireRole_: function () { return true; },
  isTrue_: function (v) { return v === true || v === 'TRUE' || v === 'true'; },
  formatDate_: function (v) { return String(v); },
  ageDays_: function () { return 11; },
  forbid_: function (m) { const e = new Error(m || 'forbidden'); e.forbidden = true; return e; }
};
vm.createContext(sandbox);
vm.runInContext(
  ['Config.gs', 'Claims.gs']
    .map(function (f) { return fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'); })
    .concat(['globalThis.__api = { advanceQueue_, awaitingAdvanceIssue_, tabCounts_, ' +
      'shapeClaim_, STATUS, ITEM_STATUS, WARRANTY_TYPE, ROLE };'])
    .join('\n'),
  sandbox, { filename: 'advance' }
);

const { advanceQueue_, tabCounts_, STATUS, ITEM_STATUS, WARRANTY_TYPE, ROLE } = sandbox.__api;
const admin = { email: 'admin@oneject.co.id', role: ROLE.ADMIN, isTester: false };

let pass = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}
function waiting() {
  return advanceQueue_(admin).awaiting.map(function (r) { return r.itemId; });
}
function sent() {
  return advanceQueue_(admin).issued.map(function (r) { return r.itemId; });
}

/* ------------------------- the decision has nothing to do with the queue */

reset();
claim('A', STATUS.SUBMITTED, WARRANTY_TYPE.PRINCIPAL);
item('I-pending', 'A', ITEM_STATUS.PENDING);
check('a part nobody has decided on is still waiting to go out',
  waiting().indexOf('I-pending') !== -1, waiting().join(', '));

reset();
claim('B', STATUS.IN_REVIEW, WARRANTY_TYPE.PRINCIPAL);
item('I-review', 'B', ITEM_STATUS.PENDING);
check('a claim sitting with the principal does not hold the part back',
  waiting().indexOf('I-review') !== -1);

reset();
claim('C', STATUS.FULFILMENT, WARRANTY_TYPE.PRINCIPAL);
item('I-forwarded', 'C', ITEM_STATUS.FORWARDED);
check('nor does an order already placed with them',
  waiting().indexOf('I-forwarded') !== -1);

reset();
claim('D', STATUS.INTERNAL, WARRANTY_TYPE.OUT);
item('I-internal', 'D', ITEM_STATUS.PENDING);
check('a claim we are covering ourselves is in the same queue',
  waiting().indexOf('I-internal') !== -1);

reset();
claim('E', STATUS.SUBMITTED, WARRANTY_TYPE.MANUAL);
item('I-manual', 'E', ITEM_STATUS.PENDING);
check('so is a unit the population sheet cannot place — the machine is down either way',
  waiting().indexOf('I-manual') !== -1);

/* --------------------------------- what does leave the queue, and why */

reset();
claim('F', STATUS.FULFILMENT, WARRANTY_TYPE.PRINCIPAL);
item('I-shipped', 'F', ITEM_STATUS.SHIPPED);
check('a part that has already left the building is not waiting to leave it',
  waiting().length === 0, waiting().join(', '));

reset();
claim('G', STATUS.FULFILMENT, WARRANTY_TYPE.PRINCIPAL);
item('I-rejected', 'G', ITEM_STATUS.REJECTED);
check('a rejected part is not sent under warranty', waiting().length === 0);

reset();
claim('H', STATUS.DRAFT, WARRANTY_TYPE.PRINCIPAL);
item('I-draft', 'H', ITEM_STATUS.PENDING);
check('a claim not yet submitted has nothing to send', waiting().length === 0);

reset();
claim('J', STATUS.CLOSED, WARRANTY_TYPE.PRINCIPAL, { ClosedAt: '2026-08-25T09:00:00' });
item('I-closed', 'J', ITEM_STATUS.SHIPPED);
check('nor has a closed one', waiting().length === 0);

reset();
claim('K', STATUS.SUBMITTED, WARRANTY_TYPE.PRINCIPAL);
item('I-done', 'K', ITEM_STATUS.PENDING, true);
check('a part already sent from stock drops out of the queue',
  waiting().length === 0, waiting().join(', '));
check('and appears in the record of what was sent',
  sent().join() === 'I-done', sent().join(', '));

/* ------------------------------------------- the queue spans the claims */

reset();
claim('L', STATUS.SUBMITTED, WARRANTY_TYPE.PRINCIPAL, { SubmittedAt: '2026-08-10T09:00:00' });
claim('M', STATUS.INTERNAL, WARRANTY_TYPE.OUT, { SubmittedAt: '2026-08-01T09:00:00' });
claim('N', STATUS.IN_REVIEW, WARRANTY_TYPE.PRINCIPAL, { SubmittedAt: '2026-08-20T09:00:00' });
item('I-L', 'L', ITEM_STATUS.PENDING);
item('I-M', 'M', ITEM_STATUS.PENDING);
item('I-N', 'N', ITEM_STATUS.APPROVED);

check('one list carries every open claim, whatever road it is on',
  waiting().length === 3, waiting().join(', '));

check('oldest first — the machine down longest is loaded onto the courier first',
  waiting().join() === 'I-M,I-L,I-N', waiting().join(', '));

const row = advanceQueue_(admin).awaiting[0];
check('each line says which machine and which customer, not just which part',
  row.serialNumber === 'XTM' && row.customerName === 'RSUD Koja' && row.partName === 'Rotor',
  JSON.stringify(row));
check('and which claim it belongs to, to open it',
  row.claimId === 'M' && row.refNo === 'CW310826');

/* -------------------------------------------- the count behind the badge */

const byClaim = {};
ITEMS.forEach(function (i) { (byClaim[i.ClaimID] = byClaim[i.ClaimID] || []).push(i); });
check('the menu badge counts exactly what the queue lists',
  tabCounts_(admin, CLAIMS, byClaim).advance === waiting().length,
  String(tabCounts_(admin, CLAIMS, byClaim).advance));

check('and nobody but the administrator is counting it',
  tabCounts_({ email: 'rian@rs.co.id', role: ROLE.REQUESTER, isTester: false },
    CLAIMS, byClaim).advance === 0);

/* -------------------------------------------------------------- report */

console.log('verify-advance: ' + pass + ' checks passed' +
  (failures.length ? ', ' + failures.length + ' FAILED' : ''));
failures.forEach(function (f) { console.log('  FAIL  ' + f); });
process.exit(failures.length ? 1 : 0);
