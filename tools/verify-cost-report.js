/**
 * verify-cost-report.js — the number the board asks for.
 *
 * The principal has stopped covering a unit and we have not, so the part comes
 * out of our own pocket. That quadrant now exists on the claim; this is about
 * counting it without lying about it.
 *
 * THE RANGE HAS TO BE INCLUSIVE AT BOTH ENDS. A report that quietly drops the
 * last day of the month is wrong every single month, by an amount nobody can
 * see, and the first person to notice will be reconciling it against something
 * else.
 *
 * IT MUST NOT BE PAGED. Paging in this portal is opt-in for exactly this
 * reason: a default page size turns a four hundred claim report into a fifty
 * claim report that looks complete. This asks for the whole set and the check
 * counts what came back.
 *
 * AND IT COUNTS WHAT WE ARE ACTUALLY ON THE HOOK FOR. A rejected part costs
 * nobody anything, and a draft has not cost anybody anything yet.
 *
 *   node tools/verify-cost-report.js
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
function refuses(fn) {
  try { fn(); return ''; } catch (e) { return String(e.message || e); }
}

/* ---------------------------------------------------------- a spreadsheet */

function Sheet(name, rows) {
  const s = {
    rows: rows,
    getName: function () { return name; },
    getLastRow: function () { return s.rows.length; },
    getLastColumn: function () { return s.rows.length ? s.rows[0].length : 0; },
    setFrozenRows: function () {},
    setName: function () {},
    appendRow: function (row) { s.rows.push(row.slice()); },
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
        setValue: function () {},
        setFontWeight: function () {}
      };
    }
  };
  return s;
}

let SHEETS = {};
let written = null;
const book = {
  getSheetByName: function (n) { return SHEETS[n] || null; },
  insertSheet: function (n) { SHEETS[n] = new Sheet(n, []); return SHEETS[n]; },
  getId: function () { return 'book'; },
  getName: function () { return 'fixture'; }
};
const tempBook = {
  getId: function () { return 'temp'; },
  getSheets: function () {
    return [{
      setName: function () {},
      setFrozenRows: function () {},
      getRange: function (r, c, nr) {
        return {
          setValues: function (v) { if (nr > 1) written = v; },
          setFontWeight: function () {}
        };
      }
    }];
  }
};

const sandbox = {
  console: console,
  SpreadsheetApp: {
    getActive: function () { return book; },
    openById: function () { return book; },
    create: function () { return tempBook; },
    flush: function () {}
  },
  PropertiesService: {
    getScriptProperties: function () {
      return { getProperty: function () { return null; }, setProperty: function () {} };
    }
  },
  CacheService: {
    getScriptCache: function () {
      return {
        get: function () { return null; }, getAll: function () { return {}; },
        put: function () {}, putAll: function () {},
        remove: function () {}, removeAll: function () {}
      };
    }
  },
  LockService: {
    getDocumentLock: function () {
      return { tryLock: function () { return true; }, releaseLock: function () {} };
    }
  },
  UrlFetchApp: { fetch: function () { throw new Error('no network in a fixture'); } },
  ScriptApp: { getOAuthToken: function () { return 't'; } },
  DriveApp: {
    getFileById: function () { return { setTrashed: function () {} }; },
    Access: { ANYONE_WITH_LINK: 1 }, Permission: { VIEW: 1 }
  },
  Utilities: { formatDate: function () { return '2026-09-13T09:00:00'; } }
};

vm.createContext(sandbox);
['Config.gs', 'Repo.gs', 'Auth.gs', 'Warranty.gs', 'WarrantyRules.gs', 'Units.gs',
  'Audit.gs', 'Visits.gs', 'MasterData.gs', 'Claims.gs', 'Export.gs',
  'Reports.gs'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'),
    sandbox, { filename: f });
});
vm.runInContext([
  'globalThis.attachmentsFor_ = function () { return []; };',
  'globalThis.claimFolderLink_ = function () { return function () { return ""; }; };',
  'globalThis.rootFolder_ = function () { throw new Error("no Drive in a fixture"); };',
  'globalThis.__api = { SHEET, SCHEMA, INDEX_MEMO, STATUS, ITEM_STATUS,',
  '  CUSTOMER_WARRANTY_TYPE, WARRANTY_TYPE, costReport_, exportCostReport_, listClaims_ };'
].join('\n'), sandbox, { filename: 'stubs' });

const api = sandbox.__api;
const SHEET = api.SHEET;
const CLAIM_COLS = api.SCHEMA[SHEET.CLAIMS];
const ITEM_COLS = api.SCHEMA[SHEET.ITEMS];

const SRI = {
  email: 'sri@oji.co.id', name: 'Sri', role: 'Administrator',
  actualRole: 'Administrator', simulatedRole: null, isTester: false, principal: ''
};
const RIAN = {
  email: 'rian@dist.co.id', name: 'Rian', role: 'Requester',
  actualRole: 'Requester', simulatedRole: null, isTester: false, principal: ''
};
const SANSIN = {
  email: 'order@sansin.co.jp', name: 'Sansin', role: 'Principal',
  actualRole: 'Principal', simulatedRole: null, isTester: false, principal: 'Sansin'
};

/* ------------------------------------------------------------- the fixture */

function row(cols, values) {
  return cols.map(function (c) { return values[c] === undefined ? '' : values[c]; });
}

let seq = 0;
const CLAIMS = [];
const ITEMS = [];

/** One claim, with the parts it is on the hook for. */
function claim(spec) {
  seq++;
  const id = 'CLM-' + String(1000 + seq);
  const statuses = spec.items || [api.ITEM_STATUS.APPROVED];
  CLAIMS.push(row(CLAIM_COLS, {
    ClaimID: id, RefNo: 'CW' + String(seq), IsTest: false,
    CustomerID: 'C1', CustomerName: spec.customer || 'RSUD Koja',
    SerialNumber: spec.serial || ('XT24030' + seq),
    ProductName: spec.product || 'MAT-A analyser',
    Principal: spec.principal || 'Sansin',
    WarrantyType: spec.principalOut === false
      ? api.WARRANTY_TYPE.PRINCIPAL : api.WARRANTY_TYPE.OUT,
    WarrantyExpiry: '2025-03',
    DistributorID: spec.distributorId === undefined ? 'DST-1' : spec.distributorId,
    DistributorName: spec.distributor === undefined ? 'PT Sinar Medika' : spec.distributor,
    CustomerWarrantyType: spec.ourCover === false
      ? api.CUSTOMER_WARRANTY_TYPE.OUT : api.CUSTOMER_WARRANTY_TYPE.IN,
    CustomerWarrantyExpiry: '2027-07-01',
    CostBorne: spec.costBorne === undefined ? true : spec.costBorne,
    Status: spec.status || api.STATUS.FULFILMENT,
    RequesterEmail: 'rian@dist.co.id', RequesterName: 'Rian',
    CreatedAt: spec.date, SubmittedAt: spec.status === api.STATUS.DRAFT ? '' : spec.date,
    ItemCount: statuses.length,
    PendingCount: statuses.filter(function (s) { return s === api.ITEM_STATUS.PENDING; }).length,
    ApprovedCount: statuses.filter(function (s) { return s === api.ITEM_STATUS.APPROVED; }).length,
    RejectedCount: statuses.filter(function (s) { return s === api.ITEM_STATUS.REJECTED; }).length,
    ShippedCount: statuses.filter(function (s) { return s === api.ITEM_STATUS.SHIPPED; }).length,
    AwaitingReturnCount: 0, AdvanceCount: 0, AdvanceQueueCount: 0,
    Deleted: false, UpdatedAt: spec.date, UpdatedBy: 'sri@oji.co.id', RowVersion: 1
  }));
  statuses.forEach(function (status, n) {
    ITEMS.push(row(ITEM_COLS, {
      ItemID: id + '-I' + n, ClaimID: id, PartID: 'P1', PartName: 'Rotor', Qty: 1,
      ItemStatus: status, AdvanceIssued: false, Deleted: false,
      UpdatedAt: spec.date, UpdatedBy: 'sri@oji.co.id', RowVersion: 1
    }));
  });
  return id;
}

function build(build_) {
  seq = 0;
  CLAIMS.length = 0;
  ITEMS.length = 0;
  build_();
  SHEETS = {
    Claims: new Sheet('Claims', [CLAIM_COLS.slice()].concat(CLAIMS)),
    ClaimItems: new Sheet('ClaimItems', [ITEM_COLS.slice()].concat(ITEMS)),
    AuditLog: new Sheet('AuditLog', [api.SCHEMA[SHEET.AUDIT].slice()]),
    Attachments: new Sheet('Attachments', [api.SCHEMA[SHEET.ATTACHMENTS].slice()]),
    Population: new Sheet('Population', [api.SCHEMA[SHEET.POPULATION].slice()]),
    warranty: new Sheet('warranty', [api.SCHEMA[SHEET.WARRANTY].slice()])
  };
  ['population', 'warranty', 'products', 'rules'].forEach(function (k) {
    delete api.INDEX_MEMO[k];
  });
}

/* ================================================================ the total */

build(function () {
  claim({ date: '2026-07-10T09:00:00', product: 'Analyser A',
    items: [api.ITEM_STATUS.APPROVED, api.ITEM_STATUS.SHIPPED] });
  claim({ date: '2026-08-05T09:00:00', product: 'Analyser A',
    items: [api.ITEM_STATUS.SHIPPED] });
  claim({ date: '2026-08-20T09:00:00', product: 'Analyser B',
    distributor: 'PT Dua Medika', distributorId: 'DST-2',
    items: [api.ITEM_STATUS.APPROVED] });
  // Not ours to absorb: the principal is still covering it.
  claim({ date: '2026-08-21T09:00:00', principalOut: false, costBorne: false });
  // Nor this: nobody covers it, so the hospital is buying the part.
  claim({ date: '2026-08-22T09:00:00', ourCover: false, costBorne: false });
});

const all = stage('running the report', function () { return api.costReport_(SRI, {}); }) || {};
check('only the claims we absorb are counted',
  all.totals && all.totals.claims === 3, JSON.stringify(all.totals));
check('and the units behind them',
  all.totals && all.totals.units === 3, String(all.totals && all.totals.units));
check('the parts we are on the hook for are added up',
  all.totals && all.totals.parts === 4, String(all.totals && all.totals.parts));
check('and what has already gone out is counted beside them',
  all.totals && all.totals.shipped === 2, String(all.totals && all.totals.shipped));

/* ------------------------------------------------ what does not count */

build(function () {
  claim({ date: '2026-08-01T09:00:00',
    items: [api.ITEM_STATUS.APPROVED, api.ITEM_STATUS.REJECTED] });
});
const rejected = api.costReport_(SRI, {});
// A part nobody is sending costs nobody anything.
check('a rejected part is not something we are absorbing',
  rejected.totals.parts === 1, String(rejected.totals.parts));

build(function () {
  claim({ date: '2026-08-01T09:00:00', status: api.STATUS.DRAFT });
});
check('a draft has not cost anybody anything yet',
  api.costReport_(SRI, {}).totals.claims === 0,
  String(api.costReport_(SRI, {}).totals.claims));

/* =========================================================== the date range */

build(function () {
  claim({ date: '2026-07-31T23:30:00', product: 'Edge before' });
  claim({ date: '2026-08-01T00:30:00', product: 'First of the month' });
  claim({ date: '2026-08-31T23:30:00', product: 'Last of the month' });
  claim({ date: '2026-09-01T00:30:00', product: 'Edge after' });
});

const august = api.costReport_(SRI, { from: '2026-08-01', to: '2026-08-31' });
const names = august.rows.map(function (r) { return r.productName; }).sort();
check('a month range takes the first day of the month',
  names.indexOf('First of the month') !== -1, names.join(' | '));
// The one that is wrong every month by an amount nobody can see.
check('and the last day of it, right to the end of the day',
  names.indexOf('Last of the month') !== -1, names.join(' | '));
check('but nothing from the day before',
  names.indexOf('Edge before') === -1, names.join(' | '));
check('nor the day after', names.indexOf('Edge after') === -1, names.join(' | '));
check('so August is exactly two claims', august.totals.claims === 2,
  String(august.totals.claims));

check('an open-ended range takes everything',
  api.costReport_(SRI, {}).totals.claims === 4);
check('a range with only a start takes everything after it',
  api.costReport_(SRI, { from: '2026-08-01' }).totals.claims === 3,
  String(api.costReport_(SRI, { from: '2026-08-01' }).totals.claims));
check('and one with only an end, everything up to it',
  api.costReport_(SRI, { to: '2026-08-01' }).totals.claims === 2,
  String(api.costReport_(SRI, { to: '2026-08-01' }).totals.claims));

/* ============================================================== the cuts */

build(function () {
  // The same machine, claimed twice: two claims, one unit. August is made the
  // heavier month on purpose, so that reading the months forwards and ranking
  // them by size give different orders.
  claim({ date: '2026-07-10T09:00:00', product: 'Zeta analyser', principal: 'Sansin',
    serial: 'XT2403SAME', customer: 'RSUD Koja', distributor: 'PT Sinar Medika',
    items: [api.ITEM_STATUS.APPROVED, api.ITEM_STATUS.SHIPPED] });
  claim({ date: '2026-08-05T09:00:00', product: 'Zeta analyser', principal: 'Sansin',
    serial: 'XT2403SAME', customer: 'RSUD Koja', distributor: 'PT Sinar Medika',
    items: [api.ITEM_STATUS.APPROVED, api.ITEM_STATUS.APPROVED] });
  // Alphabetically first, and the smallest: the biggest-first order and the
  // alphabetical one have to disagree, or the check below proves nothing.
  claim({ date: '2026-08-06T09:00:00', product: 'Alpha analyser', principal: 'Nikkiso',
    customer: 'RSUP Persahabatan', distributor: '', distributorId: '',
    items: [api.ITEM_STATUS.APPROVED] });
});
const cut = api.costReport_(SRI, {});

function bucket(kind, key) {
  return (cut.cuts[kind] || []).filter(function (b) { return b.key === key; })[0] || {};
}

check('cut by month, July stands apart from August',
  bucket('month', '2026-07').claims === 1 && bucket('month', '2026-08').claims === 2,
  JSON.stringify(cut.cuts.month));
// August is the heavier month, so a league-table sort would put it first.
check('and months read forwards, because that is how a trend is read',
  cut.cuts.month.map(function (b) { return b.key; }).join() === '2026-07,2026-08',
  cut.cuts.month.map(function (b) { return b.key; }).join());
check('even though the later month is the bigger one',
  bucket('month', '2026-08').parts > bucket('month', '2026-07').parts,
  bucket('month', '2026-07').parts + ' then ' + bucket('month', '2026-08').parts);

check('cut by product, the parts follow the claims',
  bucket('product', 'Zeta analyser').claims === 2 &&
  bucket('product', 'Zeta analyser').parts === 4,
  JSON.stringify(cut.cuts.product));
// Two claims on one machine is one machine. Counting it twice would inflate
// every "how many units are we carrying" answer the report is asked for.
check('and the same unit claimed twice is still one unit',
  bucket('product', 'Zeta analyser').units === 1 && cut.totals.units === 2,
  bucket('product', 'Zeta analyser').units + ' / ' + cut.totals.units);
check('cut by principal, each one is answerable for its own',
  bucket('principal', 'Sansin').claims === 2 && bucket('principal', 'Nikkiso').claims === 1);
check('cut by distributor', bucket('distributor', 'PT Sinar Medika').claims === 2);
// A blank is a fact about the unit, not a missing row: dropping it would make
// the cuts add up to less than the total, and nobody could say why.
check('and a claim with no distributor is still counted, under a name that says so',
  bucket('distributor', '(sold direct, or not recorded)').claims === 1,
  JSON.stringify(cut.cuts.distributor.map(function (b) { return b.key; })));
check('cut by hospital', bucket('customer', 'RSUD Koja').claims === 2);

check('every cut adds up to the same total',
  cut.groups.every(function (g) {
    return cut.cuts[g.key].reduce(function (n, b) { return n + b.claims; }, 0) ===
      cut.totals.claims;
  }), JSON.stringify(cut.groups.map(function (g) {
    return g.key + ':' + cut.cuts[g.key].reduce(function (n, b) { return n + b.claims; }, 0);
  })));

check('the league tables lead with the biggest, not the first alphabetically',
  cut.cuts.product[0].key === 'Zeta analyser',
  cut.cuts.product.map(function (b) { return b.key; }).join(' | '));

check('and the claims behind the number come with it, newest first',
  cut.rows.length === 3 && cut.rows[0].date > cut.rows[2].date,
  cut.rows.map(function (r) { return r.date; }).join(' | '));

/* ====================================================== not paged, ever */

// Paging is opt-in in this portal precisely so a report cannot be truncated
// into something that looks complete. Two hundred is comfortably past the
// fifty a default page would have given.
build(function () {
  for (let i = 0; i < 200; i++) {
    claim({ date: '2026-08-' + String(10 + (i % 10)).padStart(2, '0') + 'T09:00:00' });
  }
});
const big = api.costReport_(SRI, {});
check('two hundred claims are two hundred claims', big.totals.claims === 200,
  String(big.totals.claims));
check('and all of them are listed, not the first page of them',
  big.rows.length === 200, String(big.rows.length));

written = null;
stage('exporting it', function () {
  try { api.exportCostReport_(SRI, {}); } catch (e) { /* stops at Drive */ }
});
check('the workbook carries every claim too',
  written && written.filter(function (r) { return /^CLM-/.test(String(r[0])); }).length === 200,
  written ? String(written.filter(function (r) { return /^CLM-/.test(String(r[0])); }).length)
    : 'nothing written');
check('with the headline above them',
  written && /absorbed/i.test(String(written[0][0])), written ? String(written[0][0]) : '');
check('and every cut in between',
  written && written.some(function (r) { return String(r[0]) === 'Distributor'; }));
// The whole point of the report; a workbook without it is a list of claims.
check('rows are not ragged, or the sheet write would fail on the real thing',
  written && written.every(function (r) { return r.length === written[0].length; }),
  written ? JSON.stringify(written.slice(0, 3).map(function (r) { return r.length; })) : '');

/* ------------------------------------------------------------ who may see it */

build(function () { claim({ date: '2026-08-01T09:00:00' }); });
check('a principal cannot open the report on what we absorb',
  refuses(function () { api.costReport_(SANSIN, {}); }) !== '');
check('nor export it',
  refuses(function () { api.exportCostReport_(SANSIN, {}); }) !== '');
check('and neither can a requester',
  refuses(function () { api.costReport_(RIAN, {}); }) !== '');

/* ------------------------------------------------------------------ report */

console.log('verify-cost-report: ' + pass + ' checks passed' +
  (failures.length ? ', ' + failures.length + ' FAILED' : ''));
failures.forEach(function (f) { console.log('  FAIL  ' + f); });
process.exit(failures.length ? 1 : 0);
