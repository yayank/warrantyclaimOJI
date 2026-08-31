/**
 * verify-closing.js — checks that a claim is not closed while a part is owed.
 *
 * A replacement ships and the faulty part is meant to come back. Closing the
 * claim the moment the new part goes out erases the only record that something
 * is still outstanding — and a part sent without its old one returned is
 * exactly what goes missing.
 *
 *   node tools/verify-closing.js
 */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let CLAIMS;
let ITEMS;

function reset() {
  CLAIMS = [];
  ITEMS = [];
}

function claim(id, over) {
  return Object.assign({
    ClaimID: id, RefNo: 'CW310826', IsTest: false, CustomerName: 'RSUD Koja',
    SerialNumber: 'XT2410090', Status: 'In Fulfilment', WarrantyType: 'Principal Warranty',
    RequesterEmail: 'rian@rs.co.id', Deleted: false, RowVersion: 1
  }, over || {});
}

function item(id, claimId, over) {
  return Object.assign({
    ItemID: id, ClaimID: claimId, PartID: 'P1', PartName: 'Rotor', Qty: 1,
    ItemStatus: 'Shipped', AdvanceIssued: false, PartReturnAt: '', PartReturnNote: '',
    Deleted: false, RowVersion: 1
  }, over || {});
}

const sandbox = {
  console: console,
  withLock_: function (fn) { return fn(); },
  readLive_: function (name) {
    return (name === 'ClaimItems' ? ITEMS : CLAIMS).filter(function (r) { return r.Deleted !== true; });
  },
  readAll_: function (name) { return name === 'ClaimItems' ? ITEMS : CLAIMS; },
  findBy_: function (name, field, value) {
    return sandbox.readAll_(name).filter(function (r) {
      return String(r[field]) === String(value);
    })[0] || null;
  },
  update_: function (name, field, value, patch) {
    const row = sandbox.findBy_(name, field, value);
    Object.keys(patch).forEach(function (k) { row[k] = patch[k]; });
    return row;
  },
  audit_: function () {},
  guardTestScope_: function () {},
  requireRole_: function () { return true; },
  forbid_: function (m) { const e = new Error(m); e.forbidden = true; return e; },
  nowIso_: function () { return '2026-08-31T10:00:00'; },
  isTrue_: function (v) { return v === true || v === 'TRUE' || v === 'true'; },
  formatDate_: function (v) { return String(v); },
  attachmentsFor_: function () { return []; },
  auditForClaim_: function () { return []; },
  visibleClaims_: function () { return sandbox.readLive_('Claims'); },
  canEditClaimFields_: function () { return false; }
};
vm.createContext(sandbox);
vm.runInContext(
  ['Config.gs', 'Claims.gs']
    .map(function (f) { return fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'); })
    .concat(['globalThis.__api = { recomputeClaimStatus_, recordPartReturn_, shapeClaim_ };'])
    .join('\n'),
  sandbox, { filename: 'closing' }
);

const { recomputeClaimStatus_, recordPartReturn_, shapeClaim_ } = sandbox.__api;
const admin = { email: 'admin@oneject.co.id', role: 'Administrator', isTester: false };

let pass = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}
function statusOf(id) { return sandbox.findBy_('Claims', 'ClaimID', id).Status; }

/* -------------------------------------------- one part out, nothing back yet */

reset();
CLAIMS.push(claim('C1'));
ITEMS.push(item('I1', 'C1'));
recomputeClaimStatus_(admin, 'C1');
check('a shipped part with nothing returned holds the claim open',
  statusOf('C1') === 'In Fulfilment', statusOf('C1'));

recordPartReturn_(admin, { itemId: 'I1', note: 'brought back, cracked housing' });
check('recording the return is what closes it', statusOf('C1') === 'Closed', statusOf('C1'));
check('and the return is written on the item',
  !!sandbox.findBy_('ClaimItems', 'ItemID', 'I1').PartReturnAt);
check('with the note kept',
  sandbox.findBy_('ClaimItems', 'ItemID', 'I1').PartReturnNote === 'brought back, cracked housing');

/* ------------------------------------------ one outstanding holds them all */

reset();
CLAIMS.push(claim('C2'));
ITEMS.push(item('I1', 'C2', { PartReturnAt: '2026-08-20T09:00:00' }));
ITEMS.push(item('I2', 'C2', { PartID: 'P2', PartName: 'Cell' }));
recomputeClaimStatus_(admin, 'C2');
check('one part still outstanding holds the whole claim',
  statusOf('C2') === 'In Fulfilment', statusOf('C2'));
recordPartReturn_(admin, { itemId: 'I2', note: '' });
check('and the last return closes it', statusOf('C2') === 'Closed', statusOf('C2'));

/* ------------------------------------- nothing was sent, so nothing is owed */

reset();
CLAIMS.push(claim('C3', { Status: 'In Review' }));
ITEMS.push(item('I1', 'C3', { ItemStatus: 'Rejected' }));
recomputeClaimStatus_(admin, 'C3');
check('a claim where every part was rejected still closes — nothing ever went out',
  statusOf('C3') === 'Closed', statusOf('C3'));

reset();
CLAIMS.push(claim('C4', { Status: 'In Review' }));
ITEMS.push(item('I1', 'C4', { ItemStatus: 'Rejected' }));
ITEMS.push(item('I2', 'C4', { PartID: 'P2', PartName: 'Cell' }));   // shipped, unreturned
recomputeClaimStatus_(admin, 'C4');
check('but one part that did go out still holds it',
  statusOf('C4') === 'In Fulfilment', statusOf('C4'));

/* --------------------------------- a part still being decided is not a return */

reset();
CLAIMS.push(claim('C5', { Status: 'In Review' }));
ITEMS.push(item('I1', 'C5', { ItemStatus: 'Pending' }));
recomputeClaimStatus_(admin, 'C5');
check('a pending part leaves the status where it was',
  statusOf('C5') === 'In Review', statusOf('C5'));

/* ------------------------------------------------- what the screens are told */

reset();
CLAIMS.push(claim('C6'));
ITEMS.push(item('I1', 'C6'));
ITEMS.push(item('I2', 'C6', { PartID: 'P2', PartName: 'Cell', PartReturnAt: '2026-08-20T09:00:00' }));
const shaped = shapeClaim_(CLAIMS[0], ITEMS);
check('the item that is owed says so', shaped.items[0].awaitingReturn === true);
check('the one already back does not', shaped.items[1].awaitingReturn === false);
check('and the claim counts what is outstanding',
  shaped.summary.awaitingReturn === 1, String(shaped.summary.awaitingReturn));

/* -------------------------------------------------------------------- report */

console.log('');
failures.forEach(function (f) { console.log('  ✗ ' + f); });
console.log('  ' + pass + ' passed, ' + failures.length + ' failed');
console.log('');
process.exit(failures.length ? 1 : 0);
