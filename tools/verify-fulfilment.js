/**
 * verify-fulfilment.js — checks that a part goes down the right road.
 *
 * A unit under principal warranty is ordered from the principal, and that is
 * the only route the principal is part of. Once a unit is out of their
 * warranty they supply nothing: the part is raised as a purchase request or
 * taken off the shelf. Forwarding such a part to the principal's recipients
 * would ask them to ship something they never agreed to.
 *
 * The three transitions are run here against a small fixture, with the
 * spreadsheet and the mailer replaced by counters.
 *
 *   node tools/verify-fulfilment.js
 */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ------------------------------------------------------- the fixture */

let CLAIMS;
let ITEMS;
let sent;
let audits;

function reset() {
  CLAIMS = [
    { ClaimID: 'CLM-A', RefNo: 'CW310826', CustomerName: 'RSUD Koja', SerialNumber: 'XT1',
      WorkOrderNo: 'WO-1', WarrantyType: 'Principal Warranty', IsTest: false },
    { ClaimID: 'CLM-B', RefNo: 'CW310826', CustomerName: 'RS Hermina', SerialNumber: 'XT2',
      WorkOrderNo: 'WO-2', WarrantyType: 'Internal Warranty', IsTest: false },
    { ClaimID: 'CLM-C', RefNo: 'CW310826', CustomerName: 'RS Mitra', SerialNumber: 'XT3',
      WorkOrderNo: 'WO-3', WarrantyType: 'Out of Principal Warranty', IsTest: false }
  ];
  ITEMS = [
    { ItemID: 'IP1', ClaimID: 'CLM-A', PartName: 'Rotor', Qty: 1, ItemStatus: 'Approved',
      FulfilmentRoute: '', AvailabilityDate: '', DocumentRefNo: '' },
    { ItemID: 'II1', ClaimID: 'CLM-B', PartName: 'Pump', Qty: 1, ItemStatus: 'Approved',
      FulfilmentRoute: '', AvailabilityDate: '', DocumentRefNo: '' },
    { ItemID: 'IO1', ClaimID: 'CLM-C', PartName: 'Cell', Qty: 1, ItemStatus: 'Approved',
      FulfilmentRoute: '', AvailabilityDate: '', DocumentRefNo: '' }
  ];
  sent = [];
  audits = [];
}
reset();

const RECIPIENTS = [{ RecipientID: 'R1', Name: 'Vendor', Email: 'v@x.c', Active: true }];

const sandbox = {
  console: console,
  Utilities: { formatDate: function () { return '31 Aug 2026 09:00'; } },
  withLock_: function (fn) { return fn(); },
  readLive_: function (name) { return name === 'ClaimItems' ? ITEMS : CLAIMS; },
  readAll_: function (name) {
    if (name === 'Recipients') return RECIPIENTS;
    return name === 'ClaimItems' ? ITEMS : CLAIMS;
  },
  findBy_: function (name, field, value) {
    const rows = name === 'ClaimItems' ? ITEMS : CLAIMS;
    return rows.filter(function (r) { return String(r[field]) === String(value); })[0] || null;
  },
  update_: function (name, field, value, patch) {
    const row = sandbox.findBy_(name, field, value);
    Object.keys(patch).forEach(function (k) { row[k] = patch[k]; });
    return row;
  },
  audit_: function (session, action, detail) { audits.push({ action: action, detail: detail }); },
  guardTestScope_: function () {},
  requireRole_: function () { return true; },
  nowIso_: function () { return '2026-08-31T09:00:00'; },
  isTrue_: function (v) { return v === true || v === 'TRUE' || v === 'true'; },
  sendMail_: function (opts) { sent.push(opts); return { Status: 'Sent' }; },
  forbid_: function (m) { const e = new Error(m || 'forbidden'); e.forbidden = true; return e; },
  recomputeClaimStatus_: function () {},
  // The template codes live in Mailer.gs, which is not loaded here: the mailer
  // itself is a counter, and loading it would drag in Drive and MailApp too.
  TEMPLATE: { ORDER_FORWARD: 'ORDER_FORWARD' }
};
vm.createContext(sandbox);
vm.runInContext(
  ['Config.gs', 'Claims.gs']
    .map(function (f) { return fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'); })
    .concat(['globalThis.__api = { forwardOrder_, fulfilFromStock_, setAvailability_, FULFILMENT };'])
    .join('\n'),
  sandbox, { filename: 'fulfilment' }
);

const { forwardOrder_, fulfilFromStock_, setAvailability_, FULFILMENT } = sandbox.__api;
const admin = { email: 'admin@oneject.co.id', role: 'Administrator', isTester: false };

let pass = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}
function refused(fn) {
  try { fn(); return ''; } catch (e) { return e.message; }
}
function item(id) { return ITEMS.filter(function (i) { return i.ItemID === id; })[0]; }

/* --------------------------------- the principal only ever sees their own */

reset();
const ok = forwardOrder_(admin, { itemIds: ['IP1'], recipientIds: ['R1'] });
check('a principal-warranty part is forwarded to the principal as before',
  ok.count === 1 && item('IP1').ItemStatus === 'Order Forwarded', item('IP1').ItemStatus);
check('and the order email goes out', sent.length === 1);

reset();
let why = refused(function () { forwardOrder_(admin, { itemIds: ['II1'], recipientIds: ['R1'] }); });
check('an internal-warranty part is refused rather than forwarded',
  /not under principal warranty/.test(why), why || 'it was forwarded');
check('nothing was emailed when it was refused', sent.length === 0);
check('and the item was left alone', item('II1').ItemStatus === 'Approved', item('II1').ItemStatus);

reset();
why = refused(function () { forwardOrder_(admin, { itemIds: ['IO1'], recipientIds: ['R1'] }); });
check('an out-of-warranty part is refused too',
  /not under principal warranty/.test(why), why || 'it was forwarded');

reset();
why = refused(function () { forwardOrder_(admin, { itemIds: ['IP1', 'II1'], recipientIds: ['R1'] }); });
check('one internal part in the batch stops the whole forward',
  /not under principal warranty/.test(why), why || 'the batch went through');
check('a refused batch forwards none of it, not just the bad one',
  item('IP1').ItemStatus === 'Approved' && sent.length === 0, item('IP1').ItemStatus);

/* --------------------------------------------------- the purchase request */

reset();
setAvailability_(admin, {
  itemIds: ['II1'], availabilityDate: '2026-09-15',
  documentRefNo: 'PR-2609-011', route: FULFILMENT.PR
});
check('a purchase request records the PR number and the date',
  item('II1').DocumentRefNo === 'PR-2609-011' && item('II1').AvailabilityDate === '2026-09-15');
check('and routes the part away from the principal',
  item('II1').FulfilmentRoute === FULFILMENT.PR, item('II1').FulfilmentRoute);
check('it waits for the part, as a principal order does',
  item('II1').ItemStatus === 'Awaiting Part Availability', item('II1').ItemStatus);

reset();
setAvailability_(admin, { itemIds: ['IP1'], availabilityDate: '2026-09-15', documentRefNo: 'DOC-1' });
check('scheduling a principal order still reads as a principal order',
  item('IP1').FulfilmentRoute === FULFILMENT.PRINCIPAL, item('IP1').FulfilmentRoute);

/* ------------------------------------------------------------ from stock */

reset();
fulfilFromStock_(admin, { itemIds: ['II1'], note: 'stock issue 12', availabilityDate: '2026-09-01' });
check('a part taken from stock is marked as such',
  item('II1').FulfilmentRoute === FULFILMENT.STOCK, item('II1').FulfilmentRoute);
check('it is recorded, not shipped — the shipping date means the day it left',
  item('II1').ItemStatus === 'Awaiting Part Availability', item('II1').ItemStatus);
check('the note is kept', item('II1').DocumentRefNo === 'stock issue 12');
check('and the change is in the audit trail',
  audits.some(function (a) { return a.detail.newValue === FULFILMENT.STOCK; }));

reset();
ITEMS[1].ItemStatus = 'Shipped';
why = refused(function () { fulfilFromStock_(admin, { itemIds: ['II1'] }); });
check('a part already shipped cannot be re-routed',
  /Only an approved part/.test(why), why || 'it was re-routed');

reset();
why = refused(function () { fulfilFromStock_(admin, { itemIds: [] }); });
check('an empty selection is refused', /No spare parts/.test(why), why);

/* -------------------------------------------------------------------- report */

console.log('');
failures.forEach(function (f) { console.log('  ✗ ' + f); });
console.log('  ' + pass + ' passed, ' + failures.length + ' failed');
console.log('');
process.exit(failures.length ? 1 : 0);
