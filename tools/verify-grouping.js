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
  '\nglobalThis.__api = { claimTable, groupByStatus_, applyDeepLink, STATUS, ITEM, ROLE, WARRANTY, S };',
  sandbox, { filename: 'client' });

const { claimTable, groupByStatus_, applyDeepLink, STATUS, ITEM, ROLE, WARRANTY, S } = sandbox.__api;

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
function render(role, tab, rows, collapsed) {
  S.session = { email: 'rian@rs.co.id', role: role, isTester: false };
  S.tab = tab;
  S.rows = rows;
  S.collapsed = collapsed || {};
  const html = claimTable();

  const out = [];
  const re = /<tr class="(group-header|click|sub)"(?:[^>]*data-claim="([^"]*)")?[^>]*>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1] === 'group-header') {
      const label = m[3].replace(/<span class="group-n">(\d+)<\/span>/, '');
      const n = /<span class="group-n">(\d+)<\/span>/.exec(m[3]);
      out.push({ kind: 'head', label: label.replace(/<[^>]*>/g, '').trim(), n: n ? Number(n[1]) : null });
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

check('a heading is never left with nothing under it',
  seen.every(function (e, i) {
    return e.kind !== 'head' || (seen[i + 1] && seen[i + 1].kind === 'claim');
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

/* ------------------------------------------- who gets blocks, and where */

check('the requester gets no blocks on a tab they chose themselves',
  render(ROLE.REQUESTER, 'progress', mixed)
    .every(function (e) { return e.kind !== 'head'; }));

check('an administrator reads a flat list',
  render(ROLE.ADMIN, 'all', mixed).every(function (e) { return e.kind !== 'head'; }));

check('so does the principal',
  render(ROLE.PRINCIPAL, 'all', mixed).every(function (e) { return e.kind !== 'head'; }));

check('production reads the same blocks as the requester',
  render(ROLE.PRODUCTION, 'all', mixed).filter(function (e) { return e.kind === 'head'; }).length === 5);

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
  shown[0].kind === 'head' && shown[1].kind === 'claim');

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

function claimCell(rows) {
  return render(ROLE.REQUESTER, 'all', rows)
    .filter(function (e) { return e.kind === 'claim'; })[0].html
    .match(/<td class="stack">([\s\S]*?)<\/td>/)[1]
    .replace(/<[^>]*>/g, '|').replace(/\|+/g, '|').replace(/^\||\|$/g, '');
}

const submitted = claimCell([claim(STATUS.FULFILMENT, { refNo: 'CWT310826', claimId: 'TEST-0009' })]);
check('the reference is the top line and the claim id the second',
  submitted === 'CWT310826|TEST-0009', submitted);

// A draft has no reference yet. Leading with its absence would put the words
// "not submitted" where the name of the thing belongs.
const draft = claimCell([claim(STATUS.DRAFT, { refNo: '', claimId: 'TEST-0010' })]);
check('a claim with no reference yet still leads with its own id',
  draft === 'TEST-0010|not submitted', draft);

/* --------------------------------------------- which tab opens, and for whom */

function opensOn(role) {
  S.session = { email: 'x@y.z', role: role, isTester: false };
  S.page = 'claims';
  S.tab = 'action';
  S.deepLink = {};
  applyDeepLink();
  return { page: S.page, tab: S.tab };
}

check('a requester opens on All', opensOn(ROLE.REQUESTER).tab === 'all');
check('so does production', opensOn(ROLE.PRODUCTION).tab === 'all');
check('an administrator still opens on what needs them',
  opensOn(ROLE.ADMIN).tab === 'action');
check('and the principal is sent to their batches, not to a tab',
  opensOn(ROLE.PRINCIPAL).page === 'batch');

/* -------------------------------------------------------------------- report */

console.log('verify-grouping: ' + pass + ' checks passed' +
  (failures.length ? ', ' + failures.length + ' FAILED' : ''));
failures.forEach(function (f) { console.log('  FAIL  ' + f); });
process.exit(failures.length ? 1 : 0);
