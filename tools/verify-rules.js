/**
 * verify-rules.js — the warranty terms, and the four ways of getting them wrong.
 *
 * The portal used to answer every warranty question with one number, and the
 * reason that survived so long is that a wrong warranty looks exactly like a
 * right one. Nothing on the screen says "this is 22 months because that is the
 * only figure anybody wrote down". So this checks the parts where a plausible
 * wrong answer is easiest to produce.
 *
 * WHICH ROW APPLIES. A model can carry several rules at once — one per sales
 * channel, one per period. Picking the wrong one gives an answer that is
 * confidently off by a year.
 *
 * WHAT THE WINDOW IS MEASURED AGAINST. The unit's own basis date, never today.
 * Measured against today, entering next year's terms would shorten every unit
 * already sold, overnight and silently.
 *
 * WHAT HAPPENS WITH NOTHING TO COUNT FROM. It says so and stops. A rule that
 * counts from the installation date, on a unit with no installation date, must
 * not quietly become 22 months from assembly.
 *
 * AND THE UNITS NOBODY HAS WRITTEN A RULE FOR YET. They keep the answer they
 * have today, which is what makes filling the rules sheet something that can be
 * done a model at a time instead of all at once.
 *
 *   node tools/verify-rules.js
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

/* ---------------------------------------------------------- a spreadsheet */

function Sheet(name, rows) {
  const s = {
    rows: rows,
    getName: function () { return name; },
    getLastRow: function () { return s.rows.length; },
    getLastColumn: function () { return s.rows.length ? s.rows[0].length : 0; },
    setFrozenRows: function () {},
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
        setValues: function () {},
        setValue: function () {}
      };
    }
  };
  return s;
}

let SHEETS = {};
const book = {
  getSheetByName: function (n) { return SHEETS[n] || null; },
  insertSheet: function (n) { SHEETS[n] = new Sheet(n, []); return SHEETS[n]; },
  getId: function () { return 'book'; },
  getName: function () { return 'fixture'; }
};

const sandbox = {
  console: console,
  SpreadsheetApp: {
    getActive: function () { return book; },
    openById: function () { return book; },
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
        get: function () { return null; },
        getAll: function () { return {}; },
        put: function () {},
        putAll: function () {},
        remove: function () {},
        removeAll: function () {}
      };
    }
  },
  Utilities: {
    formatDate: function (d) { return d.toISOString().slice(0, 19); }
  }
};

vm.createContext(sandbox);
['Config.gs', 'Repo.gs', 'Warranty.gs', 'WarrantyRules.gs'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'),
    sandbox, { filename: f });
});
vm.runInContext(
  'globalThis.__api = { SHEET, SCHEMA, INDEX_MEMO, WARRANTY_TYPE, CUSTOMER_WARRANTY_TYPE,' +
  '  WARRANTY_SCOPE, WARRANTY_BASIS, SALES_CHANNEL, XT_WARRANTY_MONTHS,' +
  '  resolveWarranty_, pickRule_, basisDate_, determineWarranty_, unitOf_,' +
  '  productsIndex_, rulesIndex_, dateKey_, warrantyEnd_ };',
  sandbox, { filename: 'stubs' });

const api = sandbox.__api;
const SHEET = api.SHEET;
const SCOPE = api.WARRANTY_SCOPE;
const BASIS = api.WARRANTY_BASIS;

/* ------------------------------------------------------------- the fixture */

// The population sheet is written with the columns the next backlog item adds,
// not just the ones the schema declares today. The engine has to read them the
// moment they exist, and a fixture that only carries today's columns could not
// tell whether it does.
const POP_COLS = ['Delivery', 'SellingInDate', 'Material', 'ItemDescription',
  'Batch', 'DeliveryQuantity', 'ShipToParty', 'Principal',
  'Channel', 'ReceivedAtDistributor', 'InstalledAt',
  'ExtendedMonthsPrincipal', 'ExtendedMonthsCustomer'];

const UNITS = [
  // serial,     material, sellingIn,    channel,       received,     installed,  extP, extC
  ['XT2403001', 'MAT-A', '2024-05-20', 'direct', '2024-06-10', '2024-07-01', 0, 0],
  ['XT2403002', 'MAT-B', '2024-05-20', 'distributor', '', '', 0, 0],
  ['XT2403003', 'MAT-B', '2024-05-20', 'direct', '', '', 0, 0],
  ['XT2403004', 'MAT-C', '2023-06-01', 'direct', '', '', 0, 0],
  ['XT2403005', 'MAT-C', '2024-06-01', 'direct', '', '', 0, 0],
  ['XT2403006', 'MAT-D', '2024-05-01', 'direct', '', '', 0, 0],
  ['XT2403007', 'MAT-E', '2024-05-01', 'direct', '', '', 0, 0],
  // No installation date, and the rule for it counts from one.
  ['XT2403008', 'MAT-F', '2024-05-01', 'direct', '', '', 0, 0],
  // Extended on both sides, by different amounts.
  ['XT2403009', 'MAT-A', '2024-05-20', 'direct', '2024-06-10', '2024-07-01', 6, 12],
  // Sold through a distributor, but every rule on the model names direct.
  ['XT2403010', 'MAT-G', '2024-05-01', 'distributor', '', '', 0, 0],
  // The channel was never recorded, and the rules all name one.
  ['XT2403011', 'MAT-G', '2024-05-01', '', '', '', 0, 0],
  // Older than any rule on file.
  ['XT2403012', 'MAT-C', '2019-01-01', 'direct', '', '', 0, 0],
  // Nothing says what model this is.
  ['XT2403013', '', '2024-05-01', 'direct', '', '', 0, 0],
  // The last day of a short month, for the clamp.
  ['XT2401014', 'MAT-H', '2024-01-31', 'direct', '', '', 0, 0],
  // A window that ends on a month rather than a day.
  ['XT2403015', 'MAT-I', '2024-06-30', 'direct', '', '', 0, 0],
  ['XT2403016', 'MAT-I', '2024-07-01', 'direct', '', '', 0, 0]
];

const RULE_COLS = ['RuleID', 'Material', 'Scope', 'Channel', 'Basis', 'Months',
  'EffectiveFrom', 'EffectiveTo', 'Active', 'Notes'];

function rule(id, material, scope, channel, basis, months, from, to, active) {
  return [id, material, scope, channel, basis, months, from || '', to || '',
    active === undefined ? true : active, ''];
}

const RULES = [
  // Four bases on one model, so the same unit gives four different answers.
  rule('R-A1', 'MAT-A', 'principal', '*', 'assembly', 12),
  rule('R-A2', 'MAT-A', 'customer', '*', 'installation', 24),
  // Channel: the specific row must beat the catch-all.
  rule('R-B1', 'MAT-B', 'principal', '*', 'selling-in', 12),
  rule('R-B2', 'MAT-B', 'principal', 'distributor', 'selling-in', 24),
  // Two periods on one model.
  rule('R-C1', 'MAT-C', 'principal', '*', 'selling-in', 12, '2020-01-01', '2023-12-31'),
  rule('R-C2', 'MAT-C', 'principal', '*', 'selling-in', 24, '2024-01-01'),
  // Equally specific, both open: the later start wins.
  rule('R-D1', 'MAT-D', 'principal', '*', 'selling-in', 12, '2020-01-01'),
  rule('R-D2', 'MAT-D', 'principal', '*', 'selling-in', 36, '2024-01-01'),
  // Identical in every way that ranks: the later id wins.
  rule('R-E1', 'MAT-E', 'principal', '*', 'selling-in', 12, '2024-01-01'),
  rule('R-E2', 'MAT-E', 'principal', '*', 'selling-in', 30, '2024-01-01'),
  // Counts from a date this unit has not got.
  rule('R-F1', 'MAT-F', 'principal', '*', 'installation', 12),
  // Direct only.
  rule('R-G1', 'MAT-G', 'principal', 'direct', 'selling-in', 12),
  // The clamp.
  rule('R-H1', 'MAT-H', 'principal', '*', 'selling-in', 1),
  // A window that ends in a month covers the whole of it.
  rule('R-I1', 'MAT-I', 'principal', '*', 'selling-in', 12, '2024-01-01', '2024-06'),
  // Rows that must be ignored, every one of them a way to get a wrong number.
  rule('R-X1', 'MAT-A', 'principal', '*', 'selling-in', 99, '', '', false),
  rule('R-X2', 'MAT-A', 'principal', '*', 'selling-in', 0),
  rule('R-X3', 'MAT-A', 'principal', '*', 'selling-in', 'twelve'),
  rule('R-X4', 'MAT-A', 'principal', '*', 'delivery', 99),
  rule('R-X5', 'MAT-A', 'both', '*', 'selling-in', 99)
];

const PRODUCTS = ['MAT-A', 'MAT-B', 'MAT-C', 'MAT-D', 'MAT-E', 'MAT-F', 'MAT-G',
  'MAT-H', 'MAT-I'].map(function (m) {
  return [m, m + ' analyser', 'Sansin', 'AKL', '', true, ''];
});

function build(rules) {
  SHEETS = {
    Population: new Sheet('Population', [POP_COLS.slice()].concat(
      UNITS.map(function (u) {
        return ['DEL', u[2], u[1], u[1] + ' analyser', u[0], 1, 'RSUD Koja',
          'Sansin', u[3], u[4], u[5], u[6], u[7]];
      }))),
    Products: new Sheet('Products', [
      ['Material', 'Name', 'Principal', 'Regulation', 'SerialPattern', 'Active', 'Notes']
    ].concat(PRODUCTS)),
    WarrantyRules: new Sheet('WarrantyRules', [RULE_COLS.slice()].concat(rules)),
    warranty: new Sheet('warranty', [api.SCHEMA[SHEET.WARRANTY].slice()])
  };
  delete api.INDEX_MEMO.population;
  delete api.INDEX_MEMO.warranty;
  delete api.INDEX_MEMO.products;
  delete api.INDEX_MEMO.rules;
}

const TODAY = new Date(2025, 5, 1);   // 1 June 2025

function verdict(serial, scope) {
  return api.resolveWarranty_(api.unitOf_(serial), scope || SCOPE.PRINCIPAL, TODAY);
}

build(RULES);

/* ------------------------------------------------------------ the four bases */

check('the products sheet is read', Object.keys(api.productsIndex_()).length === 9,
  Object.keys(api.productsIndex_()).length + ' products');

const unitA = api.unitOf_('XT2403001');
check('a unit carries the material the rules are keyed on', unitA.Material === 'MAT-A');
check('and the dates the rules count from', unitA.InstalledAt === '2024-07-01',
  JSON.stringify(unitA));

check('the assembly month comes off the serial number, not off a column',
  api.basisDate_(unitA, BASIS.ASSEMBLY) === '2024-03',
  api.basisDate_(unitA, BASIS.ASSEMBLY));
check('the selling-in date is the one on the unit',
  api.basisDate_(unitA, BASIS.SELLING_IN) === '2024-05-20');
check('so is the date the distributor received it',
  api.basisDate_(unitA, BASIS.RECEIVED) === '2024-06-10');
check('and the installation date',
  api.basisDate_(unitA, BASIS.INSTALLATION) === '2024-07-01');

// The same unit, four rules, four different answers — which is the whole point
// of the sheet, and the thing one hardcoded constant could never express.
function endWith(basis, months) {
  const rules = [rule('R-T', 'MAT-A', 'principal', '*', basis, months)];
  build(rules);
  return verdict('XT2403001');
}

const byAssembly = endWith(BASIS.ASSEMBLY, 12);
check('counted from the assembly month the answer is a month, not a day',
  byAssembly.expiry === '2025-03', byAssembly.expiry);
check('and it reads as expired on 1 June 2025',
  byAssembly.active === false && byAssembly.type === api.WARRANTY_TYPE.OUT,
  byAssembly.type);

const bySelling = endWith(BASIS.SELLING_IN, 12);
check('counted from the selling-in date the answer keeps the day',
  bySelling.expiry === '2025-05-20', bySelling.expiry);
check('and that unit is out of warranty by eleven days',
  bySelling.active === false, bySelling.expiry);

const byReceived = endWith(BASIS.RECEIVED, 12);
check('counted from the date the distributor received it, the same unit is still covered',
  byReceived.expiry === '2025-06-10' && byReceived.active === true, byReceived.expiry);
check('and the days remaining are counted to the end of that day',
  byReceived.daysRemaining === 10, String(byReceived.daysRemaining));

const byInstall = endWith(BASIS.INSTALLATION, 12);
check('counted from installation it runs a month longer again',
  byInstall.expiry === '2025-07-01' && byInstall.active === true, byInstall.expiry);

check('the working is shown, not just the date',
  /installed 1 Jul 2024 \+ 12 months = valid until 1 Jul 2025/.test(byInstall.basis),
  byInstall.basis);

/* ------------------------------------------------------------ two tiers */

build(RULES);
const principalSide = verdict('XT2403001', SCOPE.PRINCIPAL);
const customerSide = verdict('XT2403001', SCOPE.CUSTOMER);

check('the principal side of a unit and our side of it are answered separately',
  principalSide.expiry !== customerSide.expiry,
  principalSide.expiry + ' / ' + customerSide.expiry);
check('the principal side is expired', principalSide.type === api.WARRANTY_TYPE.OUT,
  principalSide.type);
check('while we still owe the buyer two years from installation',
  customerSide.expiry === '2026-07-01' &&
  customerSide.type === api.CUSTOMER_WARRANTY_TYPE.IN, customerSide.type);
check('and the two sides are labelled as different things',
  api.WARRANTY_TYPE.PRINCIPAL !== api.CUSTOMER_WARRANTY_TYPE.IN);

// This is the quadrant the whole design exists for: the principal has stopped
// paying and we have not.
check('which is exactly the case where the cost lands on us',
  principalSide.active === false && customerSide.active === true);

/* ------------------------------------------------------------ which row wins */

check('a rule naming the channel beats one that takes either',
  verdict('XT2403002').expiry === '2026-05-20', verdict('XT2403002').expiry);
check('and the catch-all still answers the unit sold the other way',
  verdict('XT2403003').expiry === '2025-05-20', verdict('XT2403003').expiry);

check('a unit sold under the old terms keeps the old terms',
  verdict('XT2403004').expiry === '2024-06-01', verdict('XT2403004').expiry);
check('and one sold under the new terms gets the new ones',
  verdict('XT2403005').expiry === '2026-06-01', verdict('XT2403005').expiry);

// The failure this ordering exists to prevent: today is 2025, so a window
// matched against today would give both units the 2024 rule.
check('the window is matched against the unit, not against today',
  verdict('XT2403004').expiry !== verdict('XT2403005').expiry);

check('between two open rules the later start wins',
  verdict('XT2403006').expiry === '2027-05-01', verdict('XT2403006').expiry);
check('and a dead heat is broken by the later id, so the sheet always answers the same',
  verdict('XT2403007').expiry === '2026-11-01', verdict('XT2403007').expiry);

check('a window that ends in a month covers the whole of that month',
  verdict('XT2403015').expiry === '2025-06-30', verdict('XT2403015').expiry);
check('and the day after it is outside',
  verdict('XT2403016').source === 'none', verdict('XT2403016').source);

check('the day is clamped rather than spilling into the next month',
  verdict('XT2401014').expiry === '2024-02-29', verdict('XT2401014').expiry);

/* -------------------------------------------------------- rows to ignore */

const forA = api.rulesIndex_()['MAT-A|principal'] || [];
check('a deactivated rule is not on file', forA.every(function (r) { return r.ruleId !== 'R-X1'; }));
check('nor is one with no months', forA.every(function (r) { return r.ruleId !== 'R-X2'; }));
check('nor one whose months will not read as a number',
  forA.every(function (r) { return r.ruleId !== 'R-X3'; }));
check('nor one counting from something that is not a basis',
  forA.every(function (r) { return r.ruleId !== 'R-X4'; }));
check('nor one written for neither side',
  (api.rulesIndex_()['MAT-A|both'] || []).length === 0);
check('leaving exactly the one real principal rule for that model',
  forA.length === 1 && forA[0].ruleId === 'R-A1', JSON.stringify(forA));

/* ------------------------------------------------------- extended warranty */

const extP = verdict('XT2403009', SCOPE.PRINCIPAL);
const extC = verdict('XT2403009', SCOPE.CUSTOMER);
check('extended warranty pushes the principal side out by its own figure',
  extP.expiry === '2025-09', extP.expiry);
check('and our side out by a different one',
  extC.expiry === '2027-07-01', extC.expiry);
check('the extension is spelled out rather than folded into the total',
  /\+ 24 months \+ 12 months extended/.test(extC.basis), extC.basis);
check('a unit without an extension is unaffected',
  verdict('XT2403001', SCOPE.CUSTOMER).expiry === '2026-07-01');

/* ------------------------------------------------- what is missing, and why */

function missingOf(serial, scope) {
  return verdict(serial, scope).missing.join(' | ');
}

check('a unit with no model on it says so',
  /no material code/.test(missingOf('XT2403013')), missingOf('XT2403013'));

check('a rule that counts from a date the unit has not got names that date',
  /installation \(BAST\) date/.test(missingOf('XT2403008')), missingOf('XT2403008'));
check('and does not quietly count from one it has instead',
  verdict('XT2403008').expiry === '' &&
  verdict('XT2403008').type === api.WARRANTY_TYPE.MANUAL);
check('while still recording that a rule was found, so it is not read as an unknown model',
  verdict('XT2403008').source === 'rule', verdict('XT2403008').source);

check('a model with nothing written for it says which model',
  /no principal warranty rule on file for material "MAT-Z"/.test(
    api.resolveWarranty_({ Material: 'MAT-Z' }, SCOPE.PRINCIPAL, TODAY).missing.join(' ')),
  api.resolveWarranty_({ Material: 'MAT-Z' }, SCOPE.PRINCIPAL, TODAY).missing.join(' '));

check('a unit sold through a distributor when the rules are direct-only says that',
  /sold through a distributor/.test(missingOf('XT2403010')), missingOf('XT2403010'));
check('a unit that never recorded which way it was sold says that instead',
  /does not say whether it was sold direct/.test(missingOf('XT2403011')),
  missingOf('XT2403011'));
check('and a unit older than every rule on file says when the rules start',
  /the rules on file start/.test(missingOf('XT2403012')), missingOf('XT2403012'));

check('a real answer carries nothing to chase',
  verdict('XT2403001').missing.length === 0);

/* ============================== the units nobody has written a rule for yet */

// The whole population runs on the old formula until the sheet is filled in,
// so an empty sheet has to leave every existing answer exactly where it was.
build([]);
const bare = api.determineWarranty_('XT2403001', TODAY);
check('with no rules at all, the serial-number formula still answers',
  bare.source === 'formula', bare.source);
check('twenty-two months from the assembly month, as it always has',
  bare.expiry === '2026-01', bare.expiry);
check('and it is still under principal warranty on that reading',
  bare.type === api.WARRANTY_TYPE.PRINCIPAL, bare.type);
check('the assembly month is reported either way',
  bare.assemblyMonth === '2024-03', bare.assemblyMonth);

// One model gets a rule. Every other model must be untouched by that.
build([rule('R-A1', 'MAT-A', 'principal', '*', 'assembly', 12)]);
const ruled = api.determineWarranty_('XT2403001', TODAY);
const untouched = api.determineWarranty_('XT2403002', TODAY);
check('a model with a rule is answered by the rule',
  ruled.source === 'rule' && ruled.expiry === '2025-03', ruled.source + ' ' + ruled.expiry);
check('and every model without one is answered as before',
  untouched.source === 'formula' && untouched.expiry === '2026-01',
  untouched.source + ' ' + untouched.expiry);
check('the answer keeps the shape every caller reads',
  ['type', 'expiry', 'assemblyMonth', 'basis', 'daysRemaining', 'source']
    .every(function (k) { return Object.prototype.hasOwnProperty.call(ruled, k); }),
  Object.keys(ruled).join(','));

// A serial that is not on the population sheet cannot be looked up at all.
const stranger = api.determineWarranty_('XT2409999', TODAY);
check('a unit the register has never heard of falls through to the formula',
  stranger.source === 'formula', stranger.source);
const gibberish = api.determineWarranty_('not-a-serial', TODAY);
check('and an unreadable serial number still says so',
  gibberish.source === 'unrecognised', gibberish.source);

// The one case where the rule must win even though it has nothing to say.
build([rule('R-F1', 'MAT-A', 'principal', '*', 'installation', 12)]);
const noDate = api.determineWarranty_('XT2403002', TODAY);
check('a model with no rule is not affected by another model having one',
  noDate.source === 'formula', noDate.source);
build([rule('R-F1', 'MAT-B', 'principal', '*', 'installation', 12)]);
const blocked = api.determineWarranty_('XT2403002', TODAY);
check('but a rule counting from a date the unit lacks stops there',
  blocked.type === api.WARRANTY_TYPE.MANUAL && blocked.source === 'rule',
  blocked.type + ' / ' + blocked.source);
check('rather than falling back to twenty-two months from assembly',
  blocked.expiry !== '2026-01', blocked.expiry);
check('and it says what to go and fill in',
  /installation \(BAST\) date/.test(blocked.basis), blocked.basis);

/* ======================================== and what the page makes of a date */

// An expiry is a month when the serial number was all there was to count from,
// and a full date when the sheet held one. Rendering the second as the first
// would tell somebody a warranty runs to the end of a month it expires part way
// through — a month of cover that does not exist, on the screen the field
// engineer is reading.
const clientBox = {
  console: console,
  document: {
    getElementById: function () {
      return { innerHTML: '', hidden: false, children: [], value: '', checked: false,
        addEventListener: function () {}, querySelectorAll: function () { return []; } };
    },
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
vm.createContext(clientBox);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'src', 'Script.html'), 'utf8')
    .replace(/^[\s\S]*?<script>/, '').replace(/<\/script>\s*$/, '') +
  '\nglobalThis.__client = { monthLabel };',
  clientBox, { filename: 'client' });
const monthLabel = clientBox.__client.monthLabel;

check('a month-precision expiry still reads as a month',
  monthLabel('2026-01') === 'Jan 2026', monthLabel('2026-01'));
check('a date-precision one keeps its day rather than claiming the whole month',
  monthLabel('2025-07-01') === '1 Jul 2025', monthLabel('2025-07-01'));
check('and nothing at all still reads as nothing',
  monthLabel('') === '\u2014', monthLabel(''));

/* ------------------------------------------------------------------ report */

console.log('verify-rules: ' + pass + ' checks passed' +
  (failures.length ? ', ' + failures.length + ' FAILED' : ''));
failures.forEach(function (f) { console.log('  FAIL  ' + f); });
process.exit(failures.length ? 1 : 0);
