/**
 * verify-summary.js — the counts on the claim row never disagree with the items.
 *
 * The tab rules ask item questions ("is anything still pending?", "is a part
 * still out?"), so answering them for a list of claims meant reading every
 * item in the workbook. The counts now sit on the claim row as well.
 *
 * That is a copy of the truth, and the danger is not that it is wrong today
 * but that it goes wrong quietly: a claim whose PendingCount is stale reads as
 * finished, drops out of In Progress, and nobody chases it. Nothing on any
 * screen would say so.
 *
 * So this does not check that the summary is written. It walks every claim
 * after every kind of change — approve, reject, schedule, forward, fulfil from
 * stock, ship, advance issue, part return, add a part, remove a part, merge
 * two claims — and compares what is stored against a fresh count taken from
 * ClaimItems. A path that forgets to recount fails here and only here.
 *
 * Six such paths existed when the columns were added: syncItems_,
 * mergeIntoClaim_, setAvailability_, forwardOrder_, fulfilFromStock_ and
 * setAdvanceIssue_ all changed items without recomputeClaimStatus_ ever being
 * called.
 *
 *   node tools/verify-summary.js
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
          READS[name] = (READS[name] || 0) + 1;
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

const READS = {};
function readsDuring(fn) {
  Object.keys(READS).forEach(function (k) { delete READS[k]; });
  const out = fn();
  return { reads: Object.assign({}, READS), out: out };
}

let SHEETS = {};
const book = {
  getSheetByName: function (n) { return SHEETS[n] || null; },
  getSheets: function () { return Object.keys(SHEETS).map(function (n) { return SHEETS[n]; }); },
  insertSheet: function (n) { SHEETS[n] = new Sheet(n, []); return SHEETS[n]; },
  getId: function () { return 'book'; },
  getName: function () { return 'fixture'; }
};

/* -------------------------------------------------------------- the sandbox */

const NOW = new Date('2026-09-12T08:00:00Z');
function pad(n, w) { return String(n).padStart(w, '0'); }

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
['Config.gs', 'Repo.gs', 'Auth.gs', 'Audit.gs', 'Visits.gs', 'Claims.gs'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'),
    sandbox, { filename: f });
});

// Everything past the claim itself is somebody else's file. The mailer, the
// Drive folder and the templates are not what is under test here.
vm.runInContext([
  'globalThis.sendMail_ = function () { return { Status: "Sent" }; };',
  'globalThis.notifyDecision_ = function () {};',
  'globalThis.notifyAmendment_ = function () {};',
  'globalThis.attachmentsFor_ = function () { return []; };',
  // Mailer.gs is not loaded; the template codes it declares are only labels here.
  'globalThis.TEMPLATE = { ORDER_FORWARD: "ORDER_FORWARD" };',
  'globalThis.__api = { listClaims_, shapeClaim_, summaryOf_, SUMMARY_COLS,',
  '  syncItems_, decideItems_, setAvailability_, forwardOrder_, fulfilFromStock_,',
  '  markShipped_, setAdvanceIssue_, recordPartReturn_, mergeIntoClaim_,',
  '  recomputeClaimStatus_, refreshClaimSummaries_, readAll_, readLive_, findBy_,',
  '  SHEET, SCHEMA, ITEM_STATUS, STATUS };'
].join('\n'), sandbox, { filename: 'stubs' });

vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'Setup.gs'), 'utf8'),
  sandbox, { filename: 'Setup.gs' });
vm.runInContext('globalThis.__api.backfillClaimSummaries_ = backfillClaimSummaries_;',
  sandbox, { filename: 'setup-export' });

const api = sandbox.__api;
const SHEET = api.SHEET;
const ITEM = api.ITEM_STATUS;
const ADMIN = {
  email: 'sri@oji.co.id', role: 'Administrator', actualRole: 'Administrator',
  simulatedRole: null, isTester: false, principal: ''
};
const SANSIN = {
  email: 'order@sansin.co.jp', role: 'Principal', actualRole: 'Principal',
  simulatedRole: null, isTester: false, principal: 'Sansin'
};
const RIAN = {
  email: 'rian@rs.co.id', role: 'Requester', actualRole: 'Requester',
  simulatedRole: null, isTester: false, principal: ''
};

/* --------------------------------------------------------------- the fixture */

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
    Deleted: false, UpdatedAt: '2026-09-01T09:30:00', UpdatedBy: 'rian@rs.co.id',
    RowVersion: 1
  }, extra || {}));
}

function itemRow(id, claimId, extra) {
  return rowOf(ITEM_COLS, Object.assign({
    ItemID: id, ClaimID: claimId, PartID: 'P1', PartName: 'Blood Pump Rotor',
    Qty: 1, ItemStatus: ITEM.PENDING, AdvanceIssued: false,
    Deleted: false, UpdatedAt: '2026-09-01T09:30:00', UpdatedBy: 'rian@rs.co.id',
    RowVersion: 1
  }, extra || {}));
}

function reset() {
  SHEETS = {
    Claims: new Sheet('Claims', [CLAIM_COLS.slice(),
      claimRow('CLM-A'),
      claimRow('CLM-B'),
      claimRow('CLM-C', { Status: 'Submitted' }),
      claimRow('CLM-D', { Status: 'Draft', SubmittedAt: '' })
    ]),
    ClaimItems: new Sheet('ClaimItems', [ITEM_COLS.slice(),
      itemRow('ITM-A-01', 'CLM-A'),
      itemRow('ITM-A-02', 'CLM-A', { PartID: 'P2', PartName: 'Plunger' }),
      itemRow('ITM-A-03', 'CLM-A', { PartID: 'P3', PartName: 'Cell' }),
      itemRow('ITM-B-01', 'CLM-B'),
      itemRow('ITM-B-02', 'CLM-B', { PartID: 'P2', PartName: 'Plunger' }),
      // P4 is on no other claim, so a merge has both a part to move across and
      // two to fold into their twins by quantity.
      itemRow('ITM-B-03', 'CLM-B', { PartID: 'P4', PartName: 'Tubing Set' }),
      itemRow('ITM-C-01', 'CLM-C'),
      itemRow('ITM-D-01', 'CLM-D')
    ]),
    AuditLog: new Sheet('AuditLog', [api.SCHEMA[SHEET.AUDIT].slice()]),
    Attachments: new Sheet('Attachments', [api.SCHEMA[SHEET.ATTACHMENTS].slice()]),
    sparepart: new Sheet('sparepart', [['PartID', 'Name', 'Active'],
      ['P1', 'Blood Pump Rotor', true], ['P2', 'Plunger', true],
      ['P3', 'Cell', true], ['P4', 'Tubing Set', true]]),
    Recipients: new Sheet('Recipients', [
      ['RecipientID', 'Name', 'Email', 'Company', 'Principal', 'Active', 'Notes'],
      ['R1', 'Sansin Order Desk', 'order@sansin.co.jp', 'Sansin', 'Sansin', true, '']
    ])
  };
}

/* ------------------------------------------- the check the whole file is for */

/** The counts as the items actually stand, claim by claim. */
function truth() {
  const byClaim = {};
  api.readAll_(SHEET.CLAIMS).forEach(function (c) { byClaim[c.ClaimID] = []; });
  api.readLive_(SHEET.ITEMS).forEach(function (i) {
    if (byClaim[i.ClaimID]) byClaim[i.ClaimID].push(i);
  });
  return byClaim;
}

/**
 * Every claim on the sheet, compared column by column with a fresh count of
 * its items. Called after every action below; a path that does not recount is
 * caught here whatever else it got right.
 */
function consistent(label) {
  const byClaim = truth();
  const wrong = [];
  api.readAll_(SHEET.CLAIMS).forEach(function (c) {
    const want = api.summaryOf_(byClaim[c.ClaimID] || []);
    api.SUMMARY_COLS.forEach(function (col) {
      if (Number(c[col] || 0) !== want[col]) {
        wrong.push(c.ClaimID + '.' + col + ' says ' + (c[col] === '' ? '(empty)' : c[col]) +
          ', items say ' + want[col]);
      }
    });
  });
  check('the counts agree with the items after ' + label,
    wrong.length === 0, wrong.slice(0, 4).join('; '));
  return wrong.length === 0;
}

/** The stored summary for one claim, as numbers. */
function stored(claimId) {
  const c = api.findBy_(SHEET.CLAIMS, 'ClaimID', claimId);
  const out = {};
  api.SUMMARY_COLS.forEach(function (col) { out[col] = Number(c[col] || 0); });
  return out;
}

/* ------------------------------------------------------ the columns exist */

api.SUMMARY_COLS.forEach(function (col) {
  check('the Claims schema declares ' + col, CLAIM_COLS.indexOf(col) !== -1);
});

/* ------------------------------------------------------------ the backfill */

reset();
// Claims written before the columns existed: every summary cell empty, which
// reads as zero and would put a claim with three pending parts in the wrong tab.
check('the fixture starts with the counts unwritten, as an old sheet would',
  stored('CLM-A').PendingCount === 0 && truth()['CLM-A'].length === 3);

const filled = api.backfillClaimSummaries_();
check('the backfill reports how many claims it counted',
  filled.claims === 4, 'counted ' + filled.claims);
check('and how many were wrong before it ran',
  filled.corrected === 4, 'corrected ' + filled.corrected);
consistent('the one-off backfill');

check('a claim with three pending parts says so',
  stored('CLM-A').PendingCount === 3, JSON.stringify(stored('CLM-A')));

const again = api.backfillClaimSummaries_();
check('running the backfill twice corrects nothing the second time',
  again.corrected === 0 && again.claims === 4, JSON.stringify(again));

/* ------------------------------------------------- what the screens read */

// The list and the row on the claim have to be the same numbers, or the tab a
// claim falls into stops matching what the reader sees when they open it.
const listed = api.listClaims_(ADMIN, { tab: 'all' });
listed.rows.forEach(function (row) {
  const cols = stored(row.claimId);
  check('the list and the row agree for ' + row.claimId,
    cols.PendingCount === row.summary.pending &&
    cols.ApprovedCount === row.summary.approved &&
    cols.RejectedCount === row.summary.rejected &&
    cols.ShippedCount === row.summary.shipped &&
    cols.AwaitingReturnCount === row.summary.awaitingReturn &&
    cols.AdvanceCount === row.summary.advance,
    JSON.stringify(cols) + ' against ' + JSON.stringify(row.summary));
});

/* ---------------------------------------------- one path at a time, in order */

function fresh() {
  reset();
  api.backfillClaimSummaries_();
}

/* a part decided ------------------------------------------------------------ */

fresh();
api.decideItems_(SANSIN, { itemIds: ['ITM-A-01'], decision: 'approve' });
consistent('one part approved');
check('the approval landed on the claim row',
  stored('CLM-A').ApprovedCount === 1 && stored('CLM-A').PendingCount === 2,
  JSON.stringify(stored('CLM-A')));

api.decideItems_(SANSIN, { itemIds: ['ITM-A-02'], decision: 'reject', reason: 'wear and tear' });
consistent('one part rejected');
check('and so did the rejection',
  stored('CLM-A').RejectedCount === 1 && stored('CLM-A').PendingCount === 1,
  JSON.stringify(stored('CLM-A')));

/* scheduled, forwarded, fulfilled from stock --------------------------------- */

fresh();
api.decideItems_(SANSIN, { itemIds: ['ITM-A-01', 'ITM-A-02', 'ITM-A-03'], decision: 'approve' });
consistent('all three approved');

api.setAvailability_(ADMIN, {
  itemIds: ['ITM-A-01'], availabilityDate: '2026-09-30', documentRefNo: 'PO-1'
});
consistent('a part scheduled');
check('scheduling does not change what is approved',
  stored('CLM-A').ApprovedCount === 3, JSON.stringify(stored('CLM-A')));

api.forwardOrder_(ADMIN, { itemIds: ['ITM-A-02'], recipientIds: ['R1'] });
consistent('an order forwarded to the principal');

api.fulfilFromStock_(ADMIN, { itemIds: ['ITM-A-03'], note: 'off the shelf' });
consistent('a part taken from stock');

/* shipped, and the part owed back -------------------------------------------- */

api.markShipped_(ADMIN, { itemIds: ['ITM-A-01', 'ITM-A-02'] });
consistent('two parts shipped');
check('a shipped part is owed back until it comes',
  stored('CLM-A').ShippedCount === 2 && stored('CLM-A').AwaitingReturnCount === 2,
  JSON.stringify(stored('CLM-A')));

api.recordPartReturn_(ADMIN, { itemId: 'ITM-A-01', note: 'received' });
consistent('a faulty part returned');
check('and stops being owed once it does',
  stored('CLM-A').ShippedCount === 2 && stored('CLM-A').AwaitingReturnCount === 1,
  JSON.stringify(stored('CLM-A')));

/* the advance issue ---------------------------------------------------------- */

fresh();
api.setAdvanceIssue_(ADMIN, { itemIds: ['ITM-B-01'], issued: true, note: 'machine down' });
consistent('a part issued in advance');
check('the advance is counted', stored('CLM-B').AdvanceCount === 1,
  JSON.stringify(stored('CLM-B')));

api.setAdvanceIssue_(ADMIN, { itemIds: ['ITM-B-01'], issued: false });
consistent('the advance withdrawn again');
check('and uncounted when it is taken back', stored('CLM-B').AdvanceCount === 0,
  JSON.stringify(stored('CLM-B')));

/* parts added and removed on the claim form ---------------------------------- */

fresh();
const draft = api.findBy_(SHEET.CLAIMS, 'ClaimID', 'CLM-D');
api.syncItems_(RIAN, draft, [
  { itemId: 'ITM-D-01', partId: 'P1', qty: 2 },
  { partId: 'P2', qty: 1 },
  { partId: 'P4', qty: 1 }
]);
consistent('two parts added to a draft');
check('the new parts are pending on the claim row',
  stored('CLM-D').PendingCount === 3, JSON.stringify(stored('CLM-D')));

api.syncItems_(RIAN, draft, [{ itemId: 'ITM-D-01', partId: 'P1', qty: 2 }]);
consistent('two parts removed again');
check('a removed part stops being counted',
  stored('CLM-D').PendingCount === 1, JSON.stringify(stored('CLM-D')));

// Every part gone. The row still carries counts, and they are now zero — an
// early return that skipped the write would leave the old number standing.
api.syncItems_(RIAN, draft, []);
consistent('the last part removed');
check('a claim with no parts left counts none',
  stored('CLM-D').PendingCount === 0, JSON.stringify(stored('CLM-D')));

/* two claims merged into one -------------------------------------------------- */

fresh();
const from = api.findBy_(SHEET.CLAIMS, 'ClaimID', 'CLM-B');
const into = api.findBy_(SHEET.CLAIMS, 'ClaimID', 'CLM-A');
const moving = api.readLive_(SHEET.ITEMS).filter(function (i) { return i.ClaimID === 'CLM-B'; });
api.mergeIntoClaim_(RIAN, from, into, moving);
consistent('one claim merged into another');
// Two of the three folded into parts CLM-A already had — the same spare part
// cannot appear twice on one claim — so only the fourth arrives as a row.
check('the part that moved across is counted on the claim it moved to',
  stored('CLM-A').PendingCount === 4, JSON.stringify(stored('CLM-A')));
check('and no longer on the one they left',
  stored('CLM-B').PendingCount === 0, JSON.stringify(stored('CLM-B')));

/* --------------------- nothing else on the row was disturbed along the way */

// The summary is written with setCells_, which leaves RowVersion alone: a
// number the server counted for itself is not an edit, and bumping the version
// would tell a browser holding the claim that somebody else had changed it.
fresh();
const before = api.findBy_(SHEET.CLAIMS, 'ClaimID', 'CLM-B');
api.setAdvanceIssue_(ADMIN, { itemIds: ['ITM-B-01'], issued: true, note: 'machine down' });
const after = api.findBy_(SHEET.CLAIMS, 'ClaimID', 'CLM-B');
check('writing the counts does not bump the claim version',
  Number(after.RowVersion) === Number(before.RowVersion),
  before.RowVersion + ' became ' + after.RowVersion);
check('nor touch the claim status, dates or anybody else',
  after.Status === before.Status && after.UpdatedAt === before.UpdatedAt &&
  after.UpdatedBy === before.UpdatedBy,
  after.Status + ' / ' + after.UpdatedAt);
check('and the other claims are left where they were',
  stored('CLM-A').PendingCount === 3 && stored('CLM-C').PendingCount === 1,
  JSON.stringify(stored('CLM-A')));

/* ---------------------------- the list answers without reading the items */

/*
 * The point of the columns: a tab rule, a filter or a badge is a question
 * about a claim, and the claim now carries its own answer. Asking for a list
 * without the parts must therefore not touch the item sheet at all — and must
 * give exactly the answer it gave when it did.
 */

fresh();
// Enough of a spread that the tabs and badges have something to disagree over.
api.decideItems_(SANSIN, { itemIds: ['ITM-A-01'], decision: 'approve' });
api.decideItems_(SANSIN, { itemIds: ['ITM-A-02'], decision: 'reject', reason: 'wear' });
api.markShipped_(ADMIN, { itemIds: ['ITM-A-01'] });
api.setAdvanceIssue_(ADMIN, { itemIds: ['ITM-B-01'], issued: true, note: 'down' });

const withParts = readsDuring(function () { return api.listClaims_(ADMIN, { tab: 'all' }); });
const without = readsDuring(function () {
  return api.listClaims_(ADMIN, { tab: 'all', items: 'none' });
});

check('asking for the parts reads the item sheet',
  withParts.reads.ClaimItems > 0, 'read it ' + (withParts.reads.ClaimItems || 0) + ' times');
check('not asking for them does not',
  !without.reads.ClaimItems, 'read it ' + (without.reads.ClaimItems || 0) + ' times');
check('and the claim sheet is still read once either way',
  withParts.reads.Claims === without.reads.Claims,
  withParts.reads.Claims + ' against ' + without.reads.Claims);

check('the same claims come back in the same order',
  without.out.rows.map(function (r) { return r.claimId; }).join() ===
  withParts.out.rows.map(function (r) { return r.claimId; }).join());
check('and the same total',
  without.out.total === withParts.out.total,
  without.out.total + ' against ' + withParts.out.total);
// Counted here from the items, by the rule itself, rather than trusting either
// call: AdvanceCount and AdvanceQueueCount are easy to mistake for each other,
// and a claim already sent in advance is exactly the one not in the queue.
const owedNow = (function () {
  const byClaim = truth();
  let n = 0;
  api.readAll_(SHEET.CLAIMS).forEach(function (c) {
    if (c.Status === 'Draft' || c.Status === 'Closed') return;
    (byClaim[c.ClaimID] || []).forEach(function (i) {
      if (i.AdvanceIssued === true) return;
      if (['Shipped', 'Rejected'].indexOf(i.ItemStatus) !== -1) return;
      n++;
    });
  });
  return n;
})();
check('the fixture has parts both waiting to go out and already sent in advance',
  owedNow > 0 && stored('CLM-B').AdvanceCount > 0,
  owedNow + ' waiting, ' + stored('CLM-B').AdvanceCount + ' already sent');
check('the Advance Issue badge counts what is still to go out, not what went',
  withParts.out.counts.advance === owedNow,
  withParts.out.counts.advance + ' against ' + owedNow);

check('and the same badges, which are the numbers a tab is chosen by',
  JSON.stringify(without.out.counts) === JSON.stringify(withParts.out.counts),
  JSON.stringify(without.out.counts) + ' against ' + JSON.stringify(withParts.out.counts));

check('and the same summary on every row',
  without.out.rows.every(function (r, i) {
    return JSON.stringify(r.summary) === JSON.stringify(withParts.out.rows[i].summary);
  }));

['all', 'action', 'progress', 'completed', 'closed', 'principal', 'internal'].forEach(function (tab) {
  const a = api.listClaims_(ADMIN, { tab: tab }).rows.map(function (r) { return r.claimId; });
  const b = api.listClaims_(ADMIN, { tab: tab, items: 'none' })
    .rows.map(function (r) { return r.claimId; });
  check('the ' + tab + ' tab holds the same claims without the parts',
    a.join() === b.join(), a.join() + ' against ' + b.join());
});

check('a row that was not given its parts says so, rather than reading as none',
  without.out.rows.every(function (r) { return r.itemsLoaded === false && !r.items.length; }));

/* the page only ---------------------------------------------------------- */

const paged = api.listClaims_(ADMIN, { tab: 'all', limit: 2, items: 'page' });
check('a page carries its own parts', paged.rows.length === 2 &&
  paged.rows.every(function (r) { return r.itemsLoaded; }));
check('and the parts it carries are the claim\'s own',
  paged.rows.every(function (r) {
    return r.items.every(function (i) { return i.claimId === r.claimId; }) &&
      r.items.length === r.summary.itemCount;
  }));

/* the one question the columns cannot answer ------------------------------ */

const byPart = readsDuring(function () {
  return api.listClaims_(ADMIN, { tab: 'all', items: 'none', partId: 'P2' });
});
check('filtering by spare part reads the items even when asked not to',
  byPart.reads.ClaimItems > 0, 'read it ' + (byPart.reads.ClaimItems || 0) + ' times');
check('and answers with the claims that carry that part',
  byPart.out.rows.length > 0 &&
  byPart.out.rows.every(function (r) {
    return r.items.some(function (i) { return i.partId === 'P2'; });
  }), byPart.out.rows.length + ' claims');

/* a sheet where the columns were never filled ----------------------------- */

// Deploying without running setUp() would leave every summary cell empty, and
// an empty cell reads as zero: every claim would look finished. The list must
// notice and count the items instead, not quietly answer nought.
reset();
const unmigrated = readsDuring(function () {
  return api.listClaims_(ADMIN, { tab: 'all', items: 'none' });
});
check('an unmigrated sheet is counted from the items rather than read as zero',
  unmigrated.out.rows.every(function (r) {
    return r.summary.pending === truth()[r.claimId].filter(function (i) {
      return i.ItemStatus === 'Pending';
    }).length;
  }),
  JSON.stringify(unmigrated.out.rows.map(function (r) { return r.summary.pending; })));
check('which does cost the read it was trying to avoid, until setUp() has run',
  unmigrated.reads.ClaimItems > 0);

api.backfillClaimSummaries_();
const migrated = readsDuring(function () {
  return api.listClaims_(ADMIN, { tab: 'all', items: 'none' });
});
check('and stops costing it once the columns are filled',
  !migrated.reads.ClaimItems, 'read it ' + (migrated.reads.ClaimItems || 0) + ' times');
check('with the same answer as the fall-back gave',
  JSON.stringify(migrated.out.rows.map(function (r) { return r.summary; })) ===
  JSON.stringify(unmigrated.out.rows.map(function (r) { return r.summary; })));

/* ------------------------- every path that writes an item, not only these */

/*
 * The fixture above can only exercise the paths that exist today. Three of
 * them — setAvailability_, forwardOrder_ and fulfilFromStock_ — move a part
 * between statuses that all fall in the same bucket, so their recount changes
 * nothing at present and removing it would go unnoticed there.
 *
 * That is exactly the shape of the bug this file exists to prevent, one
 * revision later: a bucket redrawn, a column added, or a new path written that
 * quietly leaves the counts behind. So the source is read as well, and any
 * function that writes to ClaimItems and does not end by recounting fails
 * here — before anybody has to think of a fixture for it.
 */

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'Claims.gs'), 'utf8');
const bodies = source.split(/\n(?=function )/);
const writers = [];
const unguarded = [];

bodies.forEach(function (body) {
  const name = (/^function ([A-Za-z0-9_]+)/.exec(body) || [])[1];
  if (!name) return;
  if (!/(update_|insert_)\(SHEET\.ITEMS/.test(body)) return;
  writers.push(name);
  // recomputeClaimStatus_ counts as recounting because it writes the summary
  // from the items it has already read — checked just below, so this is not
  // taken on trust.
  if (!/(refreshClaimSummaries_|writeClaimSummary_|recomputeClaimStatus_)\(/.test(body)) {
    unguarded.push(name);
  }
});

const recompute = bodies.filter(function (b) {
  return /^function recomputeClaimStatus_/.test(b);
})[0] || '';
check('and recomputeClaimStatus_ is one of the ways it gets recounted',
  /writeClaimSummary_\(/.test(recompute), 'it no longer writes the summary');

check('the source has item-writing paths to check at all',
  writers.length >= 8, 'found ' + writers.length + ': ' + writers.join(', '));

check('every path that writes an item recounts the claim afterwards',
  unguarded.length === 0, unguarded.join(', ') + ' write items without recounting');

/* ----------------------------------------------------------------- report */

console.log('verify-summary: ' + pass + ' checks passed' +
  (failures.length ? ', ' + failures.length + ' FAILED' : ''));
failures.forEach(function (f) { console.log('  FAIL  ' + f); });
process.exit(failures.length ? 1 : 0);
