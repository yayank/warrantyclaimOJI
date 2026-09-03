/**
 * verify-save.js — counts the Drive round trips a save costs.
 *
 * "Saving the claim" was slow, and the requester guessed at the population
 * sheet. It was Drive. Creating a new claim opened the root folder, the test
 * folder, _DRAFT and finally the claim's own folder — four calls, each a
 * network round trip, paid before the requester had attached a single file.
 *
 * Saving is now Drive-free: the folder is made by the first upload that needs
 * somewhere to put a file, and the id is written back so the walk happens once
 * per claim rather than once per file. That write must not bump RowVersion —
 * the browser is holding the claim it just saved and submits it next.
 *
 *   node tools/verify-save.js
 */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* -------------------------------------------- a Drive that counts its calls */

let drive = { open: 0, list: 0, create: 0 };

function Folder(id, name) { this.id = id; this.name = name; this.children = {}; }
Folder.prototype.getId = function () { return this.id; };
Folder.prototype.getName = function () { return this.name; };
Folder.prototype.getFoldersByName = function (name) {
  drive.list++;
  const child = this.children[name];
  let taken = false;
  return {
    hasNext: function () { return !!child && !taken; },
    next: function () { taken = true; return child; }
  };
};
Folder.prototype.createFolder = function (name) {
  drive.create++;
  const f = new Folder('F' + (++folderSeq), name);
  this.children[name] = f;
  return f;
};

let folderSeq = 0;
const ROOT = new Folder('ROOT', 'root');
const byId = { ROOT: ROOT };
const realCreate = Folder.prototype.createFolder;
Folder.prototype.createFolder = function (name) {
  const f = realCreate.call(this, name);
  byId[f.getId()] = f;
  return f;
};

const DriveApp = {
  getRootFolder: function () { return ROOT; },
  getFolderById: function (id) {
    drive.open++;
    if (!byId[id]) throw new Error('No item with the given ID could be found');
    return byId[id];
  }
};

/* ------------------------------------------------ a spreadsheet of objects */

let SHEETS;
let versionBumps;

function reset() {
  SHEETS = {
    Claims: [],
    ClaimItems: [],
    Customer: [{ CustomerID: 'C1', Name: 'RSUD Koja', Active: true }],
    sparepart: [{ PartID: 'P1', Name: 'Rotor', Active: true }],
    Attachments: [],
    AuditLog: []
  };
  versionBumps = [];
  drive = { open: 0, list: 0, create: 0 };
  ROOT.children = {};
}

const sandbox = {
  console: console,
  DriveApp: DriveApp,
  Utilities: { formatDate: function () { return '31 Aug 2026'; } },
  SHEET: null,          // Config.gs supplies the real one
  withLock_: function (fn) { return fn(); },
  readAll_: function (name) { return (SHEETS[name] || []).slice(); },
  readLive_: function (name) { return (SHEETS[name] || []).slice(); },
  findBy_: function (name, field, value) {
    return (SHEETS[name] || []).filter(function (r) {
      return String(r[field]) === String(value);
    })[0] || null;
  },
  insert_: function (name, obj) { (SHEETS[name] = SHEETS[name] || []).push(obj); return obj; },
  update_: function (name, field, value, patch) {
    const row = sandbox.findBy_(name, field, value);
    if (!row) throw new Error(name + ' ' + value + ' not found');
    Object.keys(patch).forEach(function (k) { row[k] = patch[k]; });
    row.RowVersion = Number(row.RowVersion || 0) + 1;
    versionBumps.push({ sheet: name, key: value, fields: Object.keys(patch) });
    return row;
  },
  setCell_: function (name, field, value, cell, v) {
    const row = sandbox.findBy_(name, field, value);
    if (!row) return false;
    row[cell] = v;                    // deliberately no RowVersion bump
    return true;
  },
  nextId_: function (name, field, prefix) {
    return prefix + '-' + ((SHEETS[name] || []).length + 1);
  },
  nowIso_: function () { return '2026-08-31T09:00:00'; },
  isTrue_: function (v) { return v === true || v === 'TRUE' || v === 'true'; },
  formatDate_: function (v) { return String(v); },
  requireRole_: function () { return true; },
  guardTestScope_: function () {},
  forbid_: function (m) { const e = new Error(m || 'forbidden'); e.forbidden = true; return e; },
  audit_: function () {},
  auditChanges_: function () {},
  auditForClaim_: function () { return []; },
  attachmentsFor_: function () { return []; },
  visibleClaims_: function () { return SHEETS.Claims.slice(); },
  recomputeClaimStatus_: function () {},
  notifyAmendment_: function () {},
  sendMail_: function () { return { Status: 'Sent' }; },
  setting_: function (key, fallback) { return fallback; },
  setSetting_: function () {},
  // Warranty.gs is not loaded: the point here is Drive, and the unit sheets
  // have a counter of their own in verify-cache.js.
  determineWarranty_: function () {
    return { type: 'Principal Warranty', expiry: '2027-01', basis: 'assembled 2024-10' };
  },
  productName_: function () { return 'Sansin SWS-4000'; },
  principalFor_: function () { return 'Sansin'; },
  principalNames_: function () { return ['Sansin']; },
  ageDays_: function () { return 0; },
  canEditClaimFields_: function () { return true; },
  padLeft_: function (n, w) { let s = String(n); while (s.length < w) s = '0' + s; return s; }
};
vm.createContext(sandbox);
vm.runInContext(
  ['Config.gs', 'Files.gs', 'Claims.gs']
    .map(function (f) { return fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'); })
    .concat(['globalThis.__api = { saveClaim_, claimFolder_, kindFolder_ };'])
    .join('\n'),
  sandbox, { filename: 'save' }
);

const { saveClaim_, claimFolder_, kindFolder_ } = sandbox.__api;
const requester = { email: 'r@oneject.co.id', name: 'Rina', role: 'Requester', isTester: false };

let pass = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

/* ------------------------------------------------------- saving a new claim */

reset();
const claim = saveClaim_(requester, {
  customerId: 'C1', serialNumber: 'XT24100001', problem: 'Leaking pump',
  items: [{ partId: 'P1', qty: 1 }]
});

check('the claim was created', !!claim && !!claim.claimId, JSON.stringify(claim));
check('saving a new claim opens no Drive folder', drive.open === 0, 'opened ' + drive.open);
check('saving a new claim lists no Drive folder', drive.list === 0, 'listed ' + drive.list);
check('saving a new claim creates no Drive folder', drive.create === 0, 'created ' + drive.create);
check('and it starts with no folder recorded',
  SHEETS.Claims[0].DriveFolderId === '', String(SHEETS.Claims[0].DriveFolderId));
check('the row is at version 1 — the save is one write, not two',
  Number(SHEETS.Claims[0].RowVersion) === 1, String(SHEETS.Claims[0].RowVersion));
check('the claim handed back carries that same version',
  claim.rowVersion === 1, String(claim.rowVersion));

/* ------------------------------------ the first file pays for the folder once */

const row = SHEETS.Claims[0];
const before = drive.create;
const folder = kindFolder_(row, 'FAULT');
check('the first upload builds the tree', drive.create > before && !!folder.getId());
check('and the claim now remembers its folder',
  row.DriveFolderId && row.DriveFolderId !== '', String(row.DriveFolderId));
check('remembering it did not bump RowVersion — the browser is about to submit',
  Number(row.RowVersion) === 1, String(row.RowVersion));
check('nor did it write through update_',
  versionBumps.filter(function (b) { return b.fields.indexOf('DriveFolderId') !== -1; }).length === 0);

const walked = { list: drive.list, create: drive.create };
kindFolder_(row, 'REPORT');
check('the second upload opens the folder by id instead of walking',
  drive.create - walked.create <= 1, 'created ' + (drive.create - walked.create));
check('which is one Drive lookup, not four',
  drive.list - walked.list <= 1, 'listed ' + (drive.list - walked.list));

/* --------------------------------------------------- a claim saved and edited */

reset();
const first = saveClaim_(requester, {
  customerId: 'C1', serialNumber: 'XT24100002', problem: 'Noise',
  items: [{ partId: 'P1', qty: 1 }]
});
const edited = saveClaim_(requester, {
  claimId: first.claimId, rowVersion: first.rowVersion,
  customerId: 'C1', serialNumber: 'XT24100002', problem: 'Loud noise',
  items: [{ partId: 'P1', qty: 2 }]
});
check('editing a draft still touches no Drive',
  drive.open === 0 && drive.list === 0 && drive.create === 0, JSON.stringify(drive));
check('and the edit went through', edited.problem === 'Loud noise', edited.problem);

/* ------------------------------------------------------------------- report */

console.log('verify-save: ' + pass + ' checks passed' +
  (failures.length ? ', ' + failures.length + ' FAILED' : ''));
failures.forEach(function (f) { console.log('  FAIL  ' + f); });
process.exit(failures.length ? 1 : 0);
