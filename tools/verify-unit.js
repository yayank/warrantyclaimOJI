/**
 * verify-unit.js — the two rules that read a machine's claims as one story.
 *
 * The principal receives the day's batch as a unit. Two claims for one serial
 * number inside it read as a double order, so the second submission joins the
 * first — but only while the first is still untouched. Once anyone has acted on
 * it, adding parts underneath them rewrites a decision already taken.
 *
 * And an administrator looking at a new claim needs to know whether this part
 * was already sent to this machine, which is the same question asked backwards.
 *
 *   node tools/verify-unit.js
 */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let CLAIMS;
let ITEMS;
let ATTACHMENTS;
let mails;

function reset() { CLAIMS = []; ITEMS = []; ATTACHMENTS = []; mails = []; }

function claim(id, over) {
  return Object.assign({
    ClaimID: id, RefNo: 'CW310826', IsTest: false, CustomerID: 'CUS-1',
    CustomerName: 'RSUD Koja', SerialNumber: 'XT2410090', ProductName: 'SWS-4000',
    WarrantyType: 'Principal Warranty', Status: 'Submitted', ProblemDescription: 'error 00',
    RequesterEmail: 'rian@rs.co.id', RequesterName: 'Rian', WorkOrderNo: '',
    CreatedAt: '2026-08-31T09:00:00', SubmittedAt: '2026-08-31T09:00:00',
    DriveFolderId: 'folder', Deleted: false, RowVersion: 1
  }, over || {});
}

function item(id, claimId, over) {
  return Object.assign({
    ItemID: id, ClaimID: claimId, PartID: 'P1', PartName: 'Rotor', Qty: 1,
    ItemStatus: 'Pending', AdvanceIssued: false, PartReturnAt: '',
    Deleted: false, RowVersion: 1
  }, over || {});
}

/** The evidence submitClaim_ insists on, so the fixture gets past it. */
function evidenceFor(claimId, itemIds) {
  ATTACHMENTS.push({ AttachmentID: 'A-' + claimId + '-F', ClaimID: claimId, ItemID: '',
    Kind: 'FAULT', Superseded: false });
  ATTACHMENTS.push({ AttachmentID: 'A-' + claimId + '-R', ClaimID: claimId, ItemID: '',
    Kind: 'REPORT', Superseded: false });
  itemIds.forEach(function (id) {
    ATTACHMENTS.push({ AttachmentID: 'A-' + id, ClaimID: claimId, ItemID: id,
      Kind: 'PART', Superseded: false });
  });
}

const sandbox = {
  console: console,
  Utilities: { formatDate: function () { return '31 Aug 2026'; } },
  withLock_: function (fn) { return fn(); },
  readLive_: function (name) {
    const rows = name === 'ClaimItems' ? ITEMS : name === 'Attachments' ? ATTACHMENTS : CLAIMS;
    return rows.filter(function (r) { return r.Deleted !== true; });
  },
  readAll_: function (name) {
    return name === 'ClaimItems' ? ITEMS : name === 'Attachments' ? ATTACHMENTS : CLAIMS;
  },
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
  todayRef_: function () { return 'CW310826'; },
  isTrue_: function (v) { return v === true || v === 'TRUE' || v === 'true'; },
  sendMail_: function (o) { mails.push(o); return {}; },
  fileClaimOnSubmit_: function () { return 'folder'; },
  attachmentsFor_: function () { return []; },
  auditForClaim_: function () { return []; },
  visibleClaims_: function () { return sandbox.readLive_('Claims'); },
  canEditClaimFields_: function () { return true; },
  adminEmails_: function () { return ['admin@oneject.co.id']; },
  claimMailData_: function () { return {}; },
  formatDate_: function (v) { return String(v); },
  productName_: function () { return 'SWS-4000'; },
  TEMPLATE: { CLAIM_SUBMIT: 'CLAIM_SUBMIT' }
};
vm.createContext(sandbox);
vm.runInContext(
  ['Config.gs', 'Claims.gs']
    .map(function (f) { return fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'); })
    .concat(['globalThis.__api = { submitClaim_, unitHistory_ };'])
    .join('\n'),
  sandbox, { filename: 'merge' }
);

const { submitClaim_, unitHistory_ } = sandbox.__api;
const rian = { email: 'rian@rs.co.id', role: 'Requester', isTester: false };
const admin = { email: 'admin@oneject.co.id', role: 'Administrator', isTester: false };

let pass = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}
function row(name, id) { return sandbox.findBy_(name, name === 'ClaimItems' ? 'ItemID' : 'ClaimID', id); }

/* ------------------------------------------------ two claims become one */

reset();
CLAIMS.push(claim('C1'));                                   // submitted earlier today
CLAIMS.push(claim('C2', { Status: 'Draft', RefNo: '' }));
ITEMS.push(item('I1', 'C1'));
ITEMS.push(item('I2', 'C2', { PartID: 'P2', PartName: 'Cell' }));
evidenceFor('C2', ['I2']);
let out = submitClaim_(rian, { claimId: 'C2' });

check('the second claim on the same unit joins the first', out.claimId === 'C1', out.claimId);
check('its parts move across', row('ClaimItems', 'I2').ClaimID === 'C1',
  row('ClaimItems', 'I2').ClaimID);
check('its files move across too',
  sandbox.findBy_('Attachments', 'AttachmentID', 'A-C2-F').ClaimID === 'C1');
check('the emptied claim is retired rather than left as a duplicate',
  row('Claims', 'C2').Deleted === true);
check('and the principal is not told twice — one claim, one email',
  mails.length === 0, mails.length + ' sent');

/* ---------------------------------- the same part is a quantity, not a row */

reset();
CLAIMS.push(claim('C1'));
CLAIMS.push(claim('C2', { Status: 'Draft', RefNo: '' }));
ITEMS.push(item('I1', 'C1', { Qty: 1 }));
ITEMS.push(item('I2', 'C2', { Qty: 2 }));
evidenceFor('C2', ['I2']);
submitClaim_(rian, { claimId: 'C2' });
check('the same part on both becomes one row with the quantities added',
  row('ClaimItems', 'I1').Qty === 3, String(row('ClaimItems', 'I1').Qty));
check('and the duplicate row is not left behind',
  row('ClaimItems', 'I2').Deleted === true);

/* ------------------------------------ what must never be merged into */

reset();
CLAIMS.push(claim('C1', { Status: 'In Review' }));          // already with the principal
CLAIMS.push(claim('C2', { Status: 'Draft', RefNo: '' }));
ITEMS.push(item('I1', 'C1'));
ITEMS.push(item('I2', 'C2', { PartID: 'P2', PartName: 'Cell' }));
evidenceFor('C2', ['I2']);
out = submitClaim_(rian, { claimId: 'C2' });
check('a claim the principal is already deciding is never merged into',
  out.claimId === 'C2', out.claimId);
check('so the second claim submits on its own',
  row('Claims', 'C2').Status === 'Submitted', row('Claims', 'C2').Status);
check('and the principal is told about it', mails.length === 1, mails.length + ' sent');

reset();
CLAIMS.push(claim('C1', { SerialNumber: 'XT9999999' }));    // a different machine
CLAIMS.push(claim('C2', { Status: 'Draft', RefNo: '' }));
ITEMS.push(item('I1', 'C1'));
ITEMS.push(item('I2', 'C2'));
evidenceFor('C2', ['I2']);
out = submitClaim_(rian, { claimId: 'C2' });
check('a different unit is a different claim', out.claimId === 'C2', out.claimId);

reset();
CLAIMS.push(claim('C1', { RequesterEmail: 'dewi@rs.co.id' }));
CLAIMS.push(claim('C2', { Status: 'Draft', RefNo: '' }));
ITEMS.push(item('I1', 'C1'));
ITEMS.push(item('I2', 'C2'));
evidenceFor('C2', ['I2']);
out = submitClaim_(rian, { claimId: 'C2' });
check('somebody else\'s claim is never absorbed', out.claimId === 'C2', out.claimId);

reset();
CLAIMS.push(claim('C1', { RefNo: 'CW300826' }));            // yesterday's batch
CLAIMS.push(claim('C2', { Status: 'Draft', RefNo: '' }));
ITEMS.push(item('I1', 'C1'));
ITEMS.push(item('I2', 'C2'));
evidenceFor('C2', ['I2']);
out = submitClaim_(rian, { claimId: 'C2' });
check('and a claim from another day stays in its own batch',
  out.claimId === 'C2', out.claimId);

reset();
CLAIMS.push(claim('C1', { IsTest: true }));                 // a test claim
CLAIMS.push(claim('C2', { Status: 'Draft', RefNo: '' }));
ITEMS.push(item('I1', 'C1'));
ITEMS.push(item('I2', 'C2'));
evidenceFor('C2', ['I2']);
out = submitClaim_(rian, { claimId: 'C2' });
check('a real claim never merges into a test one', out.claimId === 'C2', out.claimId);

/* --------------------------------------------- the history of one machine */

reset();
CLAIMS.push(claim('C1', { Status: 'Closed', SubmittedAt: '2026-07-01T09:00:00' }));
CLAIMS.push(claim('C2', { Status: 'In Review' }));
CLAIMS.push(claim('C3', { SerialNumber: 'XT9999999' }));       // a different machine
CLAIMS.push(claim('C4', { IsTest: true }));                    // a test claim
ITEMS.push(item('I1', 'C1', { ItemStatus: 'Shipped', PartReturnAt: '2026-07-10T09:00:00' }));
ITEMS.push(item('I2', 'C2'));                                  // Rotor again
ITEMS.push(item('I3', 'C2', { PartID: 'P2', PartName: 'Cell' }));
ITEMS.push(item('I4', 'C3'));
ITEMS.push(item('I5', 'C4'));

const hist = unitHistory_(admin, 'xt2410090');
check('the history finds the unit however the serial was typed',
  hist.parts.length === 3, hist.parts.length + ' parts');
check('it counts the claims on that machine only', hist.claims === 2, String(hist.claims));
check('a test claim never appears in a real history',
  !hist.parts.some(function (p) { return p.claimId === 'C4'; }));
check('another machine is not in it',
  !hist.parts.some(function (p) { return p.claimId === 'C3'; }));
check('newest first', hist.parts[0].claimId === 'C2', hist.parts[0].claimId);
check('the part asked for twice is named — that is what a double order looks like',
  hist.repeated.length === 1 && hist.repeated[0].partName === 'Rotor' &&
  hist.repeated[0].times === 2, JSON.stringify(hist.repeated));
check('and a part still owed back is flagged',
  hist.parts.filter(function (p) { return p.claimId === 'C1'; })[0].partReturnAt !== '');

/* -------------------------------------------------------------------- report */

console.log('');
failures.forEach(function (f) { console.log('  ✗ ' + f); });
console.log('  ' + pass + ' passed, ' + failures.length + ' failed');
console.log('');
process.exit(failures.length ? 1 : 0);
