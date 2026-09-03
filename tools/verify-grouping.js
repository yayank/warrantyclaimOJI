/**
 * verify-grouping.js — the requester's All tab, cut into status blocks.
 *
 * A requester does not work a queue off the top of a list; they come to the
 * portal to find out where their own claims have got to. So All opens by
 * default and is broken into blocks, in the order a claim moves through them.
 *
 * The first attempt at this rendered every block heading first and then every
 * claim underneath, so the screen read "In Fulfilment (2) / Closed (4)" and
 * then six rows belonging to neither. Counting the headings, or the rows, or
 * both, would have called that correct. So this runs the real claimTable from
 * src/Script.html and reads the tbody back in order, checking that each row
 * falls under the heading that names its own status.
 *
 *   node tools/verify-grouping.js
 */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ------------------------------------------------- the client, as it ships */

const sandbox = {
  console: console,
  document: {
    getElementById: function () { return { innerHTML: '', hidden: false, children: [],
      addEventListener: function () {}, querySelectorAll: function () { return []; } }; },
    createElement: function () { return { dataset: {}, children: [], style: {},
      appendChild: function () {}, addEventListener: function () {} }; },
    body: { appendChild: function () {} },
    querySelectorAll: function () { return []; },
    addEventListener: function () {}
  },
  window: { APP_CLIENT_ID: 'stub.apps.googleusercontent.com' },
  google: { script: { run: {} } },
  setTimeout: setTimeout,
  clearTimeout: clearTimeout
};
vm.createContext(sandbox);

const script = fs.readFileSync(path.join(__dirname, '..', 'src', 'Script.html'), 'utf8')
  .replace(/^[\s\S]*?<script>/, '')
  .replace(/<\/script>\s*$/, '');
vm.runInContext(script +
  '\nglobalThis.__api = { claimTable, groupClaims_, customerFilter, applyDeepLink, ' +
  'STATUS, ITEM, ROLE, WARRANTY, S };',
  sandbox, { filename: 'client' });

const { claimTable, groupClaims_, customerFilter, applyDeepLink,
  STATUS, ITEM, ROLE, WARRANTY, S } = sandbox.__api;

/* --------------------------------------------------------------- fixtures */

let seq = 0;
function claim(status, extra) {
  seq++;
  return Object.assign({
    claimId: 'CLM-' + seq, refNo: 'CWT0001', status: status,
    warrantyType: WARRANTY.PRINCIPAL, customerName: 'RS Advent Bandung',
    serialNumber: 'XT240' + seq, requesterName: 'Rian', workOrderNo: 'WO-' + seq,
    principal: 'Sansin', createdAt: '2026-08-30T09:00:00', submittedAt: '2026-08-30T09:00:00',
    ageDays: 2,
    items: [{ itemId: 'I' + seq, partName: 'Plunger', qty: 1, itemStatus: ITEM.APPROVED }],
    summary: { approved: 1, rejected: 0, pending: 0, shipped: 0, advance: 0, awaitingReturn: 0 }
  }, extra || {});
}

/**
 * The tbody read back the way the screen reads it: headings and claim rows in
 * the order they actually appear, which is the whole point of the exercise.
 */
function render(role, tab, rows, collapsed, group) {
  S.session = { email: 'rian@rs.co.id', role: role, isTester: false };
  S.tab = tab;
  S.rows = rows;
  S.collapsed = collapsed || {};
  S.group = group || 'status';
  const html = claimTable();

  const out = [];
  // The class may carry a modifier (a customer heading is "group-header plain"),
  // so the name is matched as a prefix rather than the whole attribute.
  const re = /<tr class="(group-header|ref-header|click|sub)[^"]*"(?:[^>]*data-claim="([^"]*)")?[^>]*>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1] === 'group-header') {
      const label = m[3].replace(/<span class="group-n">(\d+)<\/span>/, '');
      const n = /<span class="group-n">(\d+)<\/span>/.exec(m[3]);
      out.push({ kind: 'head', label: label.replace(/<[^>]*>/g, '').trim(), n: n ? Number(n[1]) : null });
    } else if (m[1] === 'ref-header') {
      const n = /<span class="group-n">(\d+)<\/span>/.exec(m[3]);
      out.push({
        kind: 'ref',
        label: m[3].replace(/<span class="group-n">\d+<\/span>/, '')
          .replace(/<[^>]*>/g, '').trim(),
        n: n ? Number(n[1]) : null
      });
    } else if (m[1] === 'click') {
      out.push({ kind: 'claim', claimId: m[2], html: m[3] });
    } else {
      out.push({ kind: 'sub', html: m[3] });
    }
  }
  return out;
}

const byId = {};
function statusOf(claimId) { return byId[claimId]; }

let pass = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

/* ------------------------------------------ every row under its own heading */

const mixed = [
  claim(STATUS.CLOSED), claim(STATUS.FULFILMENT), claim(STATUS.DRAFT),
  claim(STATUS.CLOSED), claim(STATUS.FULFILMENT), claim(STATUS.RETURNED),
  claim(STATUS.CLOSED), claim(STATUS.SUBMITTED), claim(STATUS.CLOSED)
];
mixed.forEach(function (c) { byId[c.claimId] = c.status; });

const seen = render(ROLE.REQUESTER, 'all', mixed);

// This is the check the first attempt failed: it produced two headings and then
// six rows, so no row had a heading of its own above it.
let current = null;
let misplaced = 0;
seen.forEach(function (e) {
  if (e.kind === 'head') current = e.label;
  if (e.kind === 'claim') {
    const want = statusOf(e.claimId);
    // "Returned to Requester" reads as "Revised!" to a requester; the heading
    // uses the same word the row's own pill does.
    const shown = want === STATUS.RETURNED ? 'Revised!' : want;
    if (current !== shown) misplaced++;
  }
});
check('every claim sits under the heading that names its status', misplaced === 0,
  misplaced + ' of ' + mixed.length + ' misplaced; read: ' +
  seen.map(function (e) { return e.kind === 'head' ? '[' + e.label + ']' : e.claimId; }).join(' '));

check('a status heading is always followed by a reference heading',
  seen.every(function (e, i) {
    return e.kind !== 'head' || (seen[i + 1] && seen[i + 1].kind === 'ref');
  }));

check('and a reference heading always by a claim',
  seen.every(function (e, i) {
    return e.kind !== 'ref' || (seen[i + 1] && seen[i + 1].kind === 'claim');
  }));

check('no claim appears before the first heading',
  seen.length > 0 && seen[0].kind === 'head', 'first entry is ' + (seen[0] && seen[0].kind));

/* -------------------------------------------------- the order, and the count */

const heads = seen.filter(function (e) { return e.kind === 'head'; });
check('the blocks follow the order a claim moves through',
  heads.map(function (e) { return e.label; }).join(' → ') ===
  'Draft → Revised! → Submitted → In Fulfilment → Closed',
  heads.map(function (e) { return e.label; }).join(' → '));

check('each heading counts the rows actually beneath it',
  heads.every(function (head) {
    const at = seen.indexOf(head);
    let n = 0;
    for (let i = at + 1; i < seen.length && seen[i].kind !== 'head'; i++) {
      if (seen[i].kind === 'claim') n++;
    }
    return head.n === n;
  }));

check('no claim is dropped on the way',
  seen.filter(function (e) { return e.kind === 'claim'; }).length === mixed.length,
  'rendered ' + seen.filter(function (e) { return e.kind === 'claim'; }).length +
  ' of ' + mixed.length);

/* ------------------------------- a status the order does not know about */

const odd = [claim(STATUS.CLOSED), claim('Some Future Status'), claim(STATUS.DRAFT)];
odd.forEach(function (c) { byId[c.claimId] = c.status; });
const withOdd = render(ROLE.REQUESTER, 'all', odd);
check('a status the order does not name still reaches the screen',
  withOdd.filter(function (e) { return e.kind === 'claim'; }).length === 3,
  'rendered ' + withOdd.filter(function (e) { return e.kind === 'claim'; }).length + ' of 3');
check('and it lands at the end rather than among the known ones',
  withOdd.filter(function (e) { return e.kind === 'head'; })
    .map(function (e) { return e.label; }).join(' → ') === 'Draft → Closed → Some Future Status');

/* --------------------------------------- the cut is the reader's, not the role's */

// Grouping began as something only the requester's All tab did. It is a choice
// on the toolbar now, so every role and every tab is cut the same way.

[ROLE.REQUESTER, ROLE.PRODUCTION, ROLE.ADMIN, ROLE.PRINCIPAL].forEach(function (role) {
  check(role + ' reads the list in blocks',
    render(role, 'all', mixed).filter(function (e) { return e.kind === 'head'; }).length === 5);
});

check('and on a tab they chose themselves too',
  render(ROLE.REQUESTER, 'progress', mixed)
    .filter(function (e) { return e.kind === 'head'; }).length === 5);

check('an empty list draws no headings at all',
  render(ROLE.REQUESTER, 'all', []).length === 0);

/* ------------------- one table: the claim, and its spare parts beneath it */

// The screen used to be two tables behind a By claim / By spare part switch,
// so the parts of a claim were only ever visible in the table that dropped the
// claim's own row. Now they are the same table.

const shown = render(ROLE.REQUESTER, 'all', mixed);

check('every claim carries its spare parts directly beneath it',
  mixed.every(function (c) {
    const at = shown.findIndex(function (e) {
      return e.kind === 'claim' && e.claimId === c.claimId;
    });
    return at !== -1 && shown[at + 1] && shown[at + 1].kind === 'sub';
  }));

check('the parts do not push the next claim out of its block',
  shown.filter(function (e) { return e.kind === 'claim'; }).length === mixed.length);

check('and a part never appears before the claim it belongs to',
  shown[0].kind === 'head' && shown[1].kind === 'ref' && shown[2].kind === 'claim',
  shown.slice(0, 3).map(function (e) { return e.kind; }).join(' → '));

const folded = {};
folded[mixed[1].claimId] = true;
const afterFold = render(ROLE.REQUESTER, 'all', mixed, folded);
check('a claim folded away keeps its own row',
  afterFold.filter(function (e) { return e.kind === 'claim'; }).length === mixed.length);
check('and gives up only its own parts',
  afterFold.filter(function (e) { return e.kind === 'sub'; }).length ===
  shown.filter(function (e) { return e.kind === 'sub'; }).length - 1);

/* --------------------------- what the spare-part table used to hold alone */

const flagged = [claim(STATUS.FULFILMENT, {
  items: [{ itemId: 'IX', partName: 'Plunger', qty: 2, itemStatus: ITEM.SHIPPED,
    advanceIssued: true, awaitingReturn: true, decisionReason: 'covered by principal' }],
  summary: { approved: 1, rejected: 0, pending: 0, shipped: 1, advance: 1, awaitingReturn: 1 }
})];
const detail = render(ROLE.ADMIN, 'progress', flagged)
  .filter(function (e) { return e.kind === 'sub'; }).map(function (e) { return e.html; }).join('');

check('the part row still names the part and its quantity',
  detail.indexOf('Plunger') !== -1 && detail.indexOf('2 pcs') !== -1, detail);
check('stock issued in advance is still marked on the part',
  detail.indexOf('issued in advance') !== -1, detail);
check('so is the faulty part still owed back',
  detail.indexOf('to return') !== -1, detail);
check('and the reason a part was decided the way it was',
  detail.indexOf('covered by principal') !== -1, detail);

check('a requester is not shown the advance-issue flag — the stock is not theirs',
  render(ROLE.REQUESTER, 'all', flagged)
    .filter(function (e) { return e.kind === 'sub'; })
    .map(function (e) { return e.html; }).join('').indexOf('issued in advance') === -1);

/* ------------------------------- a claim with nothing on it yet is still a row */

const bare = [claim(STATUS.DRAFT, {
  items: [], summary: { approved: 0, rejected: 0, pending: 0, shipped: 0, advance: 0, awaitingReturn: 0 }
})];
const bareOut = render(ROLE.REQUESTER, 'all', bare);
check('a claim with no spare part on it still appears',
  bareOut.filter(function (e) { return e.kind === 'claim'; }).length === 1);
check('and says so rather than leaving a gap',
  bareOut.some(function (e) { return e.kind === 'sub' && /No spare part/.test(e.html); }));

/* ------------------------------- the reference leads, the claim id follows */

function claimCell(rows, tab) {
  return render(ROLE.REQUESTER, tab || 'all', rows)
    .filter(function (e) { return e.kind === 'claim'; })[0].html
    .match(/<td class="stack">([\s\S]*?)<\/td>/)[1]
    .replace(/<[^>]*>/g, '|').replace(/\|+/g, '|').replace(/^\||\|$/g, '');
}

// The heading above always carries the reference now, so the row never repeats
// it — on any tab, for any role.
const submitted = claimCell([claim(STATUS.FULFILMENT, { refNo: 'CWT310826', claimId: 'TEST-0009' })]);
check('the row carries its claim id and nothing else',
  submitted === 'TEST-0009', submitted);

const draft = claimCell([claim(STATUS.DRAFT, { refNo: '', claimId: 'TEST-0010' })]);
check('and a claim with no reference is no different',
  draft === 'TEST-0010', draft);

/* ----------------------- one reference, several claims, said once */

// The screen repeated the reference on every row, and a reference covers
// several claims, so the same eight characters were read four times over
// telling the reader nothing new each time.

function refClaim(refNo, claimId, status) {
  return claim(status || STATUS.CLOSED, { refNo: refNo, claimId: claimId });
}

const shared = [
  refClaim('CWT310826', 'TEST-260831-0001'),
  refClaim('CWT310826', 'TEST-260831-0002'),
  refClaim('CWT300826', 'TEST-260830-0003'),
  refClaim('CWT300826', 'TEST-260830-0001')
];
const tree = render(ROLE.REQUESTER, 'all', shared);
const refs = tree.filter(function (e) { return e.kind === 'ref'; });

check('a reference is named once, not once per claim',
  refs.length === 2, refs.map(function (e) { return e.label; }).join(' , '));

check('and in the order its claims arrive',
  refs.map(function (e) { return e.label; }).join(' → ') === 'CWT310826 → CWT300826',
  refs.map(function (e) { return e.label; }).join(' → '));

check('every claim of a reference sits under it',
  refs.every(function (r) {
    const at = tree.indexOf(r);
    let n = 0;
    for (let i = at + 1; i < tree.length && tree[i].kind !== 'ref' && tree[i].kind !== 'head'; i++) {
      if (tree[i].kind === 'claim') n++;
    }
    return n === 2 && r.n === 2;
  }));

check('and no claim is lost to the second level',
  tree.filter(function (e) { return e.kind === 'claim'; }).length === shared.length);

// A list with two shapes in it costs the reader more than the row it saves.
const alone = render(ROLE.REQUESTER, 'all', [refClaim('CWT999999', 'TEST-0001')])
  .filter(function (e) { return e.kind === 'ref'; });
check('a reference holding one claim still gets its heading',
  alone.length === 1 && alone[0].label === 'CWT999999' && alone[0].n === 1);

const noRef = render(ROLE.REQUESTER, 'all', [
  claim(STATUS.DRAFT, { refNo: '', claimId: 'TEST-0011' }),
  claim(STATUS.DRAFT, { refNo: '', claimId: 'TEST-0012' })
]);
check('claims with no reference gather under a heading of their own',
  noRef.filter(function (e) { return e.kind === 'ref'; })
    .map(function (e) { return e.label; }).join('') === 'No reference yet');

// Within one status block, the drafts come after every real reference.
const mixedRef = render(ROLE.REQUESTER, 'all', [
  claim(STATUS.DRAFT, { refNo: '', claimId: 'TEST-0013' }),
  claim(STATUS.DRAFT, { refNo: 'CWT300826', claimId: 'TEST-0014' })
]).filter(function (e) { return e.kind === 'ref'; });
check('and they come last in their block, not first',
  mixedRef.map(function (e) { return e.label; }).join(' → ') === 'CWT300826 → No reference yet',
  mixedRef.map(function (e) { return e.label; }).join(' → '));

check('under a reference heading the row is only its own claim id',
  claimCell([refClaim('CWT310826', 'TEST-0015')], 'all') === 'TEST-0015',
  claimCell([refClaim('CWT310826', 'TEST-0015')], 'all'));

check('the second level reaches every role',
  [ROLE.ADMIN, ROLE.PRINCIPAL, ROLE.PRODUCTION].every(function (role) {
    return render(role, 'all', shared).filter(function (e) { return e.kind === 'ref'; }).length === 2;
  }));

check('and every tab',
  render(ROLE.REQUESTER, 'progress', shared)
    .filter(function (e) { return e.kind === 'ref'; }).length === 2);

/* --------------------------------------------- which tab opens, and for whom */

// The default is the state the client ships with, not something applyDeepLink
// puts there, so it is read from a copy of the client nothing has touched yet.
function freshState() {
  const box = {
    console: { log: function () {} },
    document: sandbox.document,
    window: { APP_CLIENT_ID: 'stub.apps.googleusercontent.com' },
    google: { script: { run: {} } },
    setTimeout: setTimeout, clearTimeout: clearTimeout
  };
  vm.createContext(box);
  vm.runInContext(script + '\nglobalThis.__S = S;', box, { filename: 'fresh' });
  return box.__S;
}

const fresh = freshState();
check('the claims screen opens on the whole list, whoever is reading',
  fresh.tab === 'all', 'opens on ' + fresh.tab);
check('and cut by status until the reader says otherwise',
  fresh.group === 'status', 'cut by ' + fresh.group);

function opensOn(role) {
  S.session = { email: 'x@y.z', role: role, isTester: false };
  S.page = 'claims';
  S.tab = 'all';
  S.deepLink = {};
  applyDeepLink();
  return { page: S.page, tab: S.tab };
}

check('and no role is moved off it',
  [ROLE.REQUESTER, ROLE.PRODUCTION, ROLE.ADMIN]
    .every(function (r) { return opensOn(r).tab === 'all'; }));
check('and the principal is sent to their batches, not to a tab',
  opensOn(ROLE.PRINCIPAL).page === 'batch');

/* ------------------------------------------- cut by hospital instead */

// Status order is the order of the work. A customer list has no order of its
// own, and the reason to cut by customer is to go and find one, so the only
// arrangement that helps is the one you can search by eye.

const hospitals = [
  claim(STATUS.CLOSED, { customerName: 'RSUD Koja', refNo: 'CW1', claimId: 'K1' }),
  claim(STATUS.DRAFT, { customerName: 'Mitra Kasih Cimahi', refNo: 'CW2', claimId: 'M1' }),
  claim(STATUS.FULFILMENT, { customerName: 'RSUD Koja', refNo: 'CW1', claimId: 'K2' }),
  claim(STATUS.CLOSED, { customerName: 'Advent Bandung', refNo: 'CW3', claimId: 'A1' })
];

const byCust = render(ROLE.REQUESTER, 'all', hospitals, {}, 'customer');
const custHeads = byCust.filter(function (e) { return e.kind === 'head'; });

check('cutting by customer gives one block per hospital',
  custHeads.length === 3, custHeads.map(function (e) { return e.label; }).join(' , '));

check('in name order, so a hospital can be found by eye',
  custHeads.map(function (e) { return e.label; }).join(' → ') ===
  'Advent Bandung → Mitra Kasih Cimahi → RSUD Koja',
  custHeads.map(function (e) { return e.label; }).join(' → '));

check('a hospital block counts its own claims, whatever status they are',
  custHeads.filter(function (e) { return e.label === 'RSUD Koja'; })[0].n === 2);

check('and every claim of that hospital is under it',
  (function () {
    const at = byCust.indexOf(custHeads.filter(function (e) { return e.label === 'RSUD Koja'; })[0]);
    const ids = [];
    for (let i = at + 1; i < byCust.length && byCust[i].kind !== 'head'; i++) {
      if (byCust[i].kind === 'claim') ids.push(byCust[i].claimId);
    }
    return ids.join(',') === 'K1,K2';
  })());

check('changing the cut never changes how many claims are on the screen',
  byCust.filter(function (e) { return e.kind === 'claim'; }).length ===
  render(ROLE.REQUESTER, 'all', hospitals, {}, 'status')
    .filter(function (e) { return e.kind === 'claim'; }).length);

check('the hospital column goes when the heading is the hospital',
  byCust.filter(function (e) { return e.kind === 'claim'; })[0]
    .html.indexOf('RSUD Koja') === -1 &&
  render(ROLE.REQUESTER, 'all', hospitals, {}, 'status')
    .filter(function (e) { return e.kind === 'claim'; })
    .some(function (e) { return e.html.indexOf('RSUD Koja') !== -1; }));

check('and the rows still line up with the header that is left',
  (function () {
    const html = claimTable();
    // <thead> starts with the same three characters as a <th>.
    const cols = (html.match(/<th[ >]/g) || []).length;
    const rows = html.match(/<tr class="click"[\s\S]*?<\/tr>/g) || [];
    return rows.length > 0 && rows.every(function (r) {
      return (r.match(/<td/g) || []).length === cols;
    });
  })());

check('the reference level survives the other cut',
  byCust.filter(function (e) { return e.kind === 'ref'; }).length === 3);

const nameless = render(ROLE.REQUESTER, 'all', [
  claim(STATUS.CLOSED, { customerName: 'RSUD Koja' }),
  claim(STATUS.CLOSED, { customerName: '' })
], {}, 'customer').filter(function (e) { return e.kind === 'head'; });
check('a claim with no customer on it still reaches the screen, last',
  nameless.map(function (e) { return e.label; }).join(' → ') === 'RSUD Koja → No customer',
  nameless.map(function (e) { return e.label; }).join(' → '));

check('an unknown cut falls back to status rather than emptying the screen',
  groupClaims_(hospitals, 'something-else').length ===
  groupClaims_(hospitals, 'status').length);

/* ------------------------------- 1.386 hospitals is not a list you scroll */

S.reference = {
  customers: [
    { id: 'C1', name: 'RSUD Koja' },
    { id: 'C2', name: 'Mitra Kasih Cimahi' }
  ]
};
S.filters = { customerId: '' };
const blank = customerFilter();

check('the customer filter is a searchable box, not a dropdown',
  blank.indexOf('<select') === -1 && blank.indexOf('class="combo"') !== -1);

check('with All customers offered as a real choice, which is how it is cleared',
  blank.indexOf('All customers') !== -1);

S.filters = { customerId: 'C2' };
const chosen = customerFilter();
check('and it reads back the hospital being filtered on',
  chosen.indexOf('value="Mitra Kasih Cimahi"') !== -1 &&
  chosen.indexOf('value="C2"') !== -1);

/* -------------------------------------------------------------------- report */

console.log('verify-grouping: ' + pass + ' checks passed' +
  (failures.length ? ', ' + failures.length + ' FAILED' : ''));
failures.forEach(function (f) { console.log('  FAIL  ' + f); });
process.exit(failures.length ? 1 : 0);
