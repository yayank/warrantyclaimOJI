/**
 * verify-views.js — a saved filter combination belongs to one person.
 *
 * The obvious place for these is PropertiesService.getUserProperties(). It is
 * the wrong place: the web app runs as the person who deployed it, so "user
 * properties" are that one person's for every visitor — one administrator
 * would open the portal and find somebody else's presets, and saving would
 * overwrite them. Nothing on screen would say so. So the address is in the key
 * instead, and the first thing checked here is that two people who save on the
 * same morning still have their own.
 *
 * The other half is the client's: a view is only "showing" while the screen
 * still matches it, opening one clears the filters it does not mention, and a
 * view naming a hospital that has since been switched off opens with an
 * explanation rather than an empty table.
 *
 *   node tools/verify-views.js
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
function refused(fn) {
  try { fn(); return ''; } catch (e) { return String(e.message || e); }
}
/**
 * Setup that a broken build might throw from. A throw is a failure to report,
 * not a reason to stop before the rest of the file has had its say.
 */
function stage(label, fn) {
  try { return fn(); } catch (e) {
    failures.push(label + ' — threw: ' + String(e.message || e));
    return null;
  }
}

/* ------------------------------------------------------- the script store */

let STORE = {};
const sandbox = {
  console: console,
  PropertiesService: {
    getScriptProperties: function () {
      return {
        getProperty: function (k) { return STORE[k] === undefined ? null : STORE[k]; },
        setProperty: function (k, v) { STORE[k] = String(v); },
        deleteProperty: function (k) { delete STORE[k]; }
      };
    },
    // Present, and deliberately useless: reaching for it is the bug.
    getUserProperties: function () {
      throw new Error('getUserProperties would be the deployer\'s, not the visitor\'s.');
    }
  },
  SpreadsheetApp: { getActive: function () { return null; } },
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
  Utilities: { formatDate: function () { return '2026-09-12T00:00:00'; } }
};
vm.createContext(sandbox);
['Config.gs', 'Repo.gs', 'Views.gs'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'),
    sandbox, { filename: f });
});
vm.runInContext('globalThis.__api = { listViews_, saveView_, deleteView_, ' +
  'VIEW_MAX, VIEW_NAME_MAX };', sandbox, { filename: 'exports' });
const api = sandbox.__api;

const SRI = { email: 'sri@oji.co.id', role: 'Administrator', actualRole: 'Administrator' };
const RIAN = { email: 'rian@rs.co.id', role: 'Requester', actualRole: 'Requester' };
// A Tester wearing somebody else's hat is still the same person, and their
// presets should follow them rather than the role they are simulating.
const TESTER = {
  email: 'sri@oji.co.id', role: 'Principal', actualRole: 'Tester', simulatedRole: 'Principal'
};

function view(name, extra) {
  return Object.assign({
    name: name, tab: 'action', group: 'customer',
    filters: {
      statuses: ['In Review'], warrantyTypes: [], customerId: 'C7',
      customerName: 'RSUD Koja', principal: 'Sansin',
      distributorId: '', costBorne: false, from: '', to: ''
    }
  }, extra || {});
}

/* ------------------------------------------------------- the round trip */

STORE = {};
check('nobody starts with any', api.listViews_(SRI).views.length === 0);

api.saveView_(SRI, view('Sansin, waiting on me'));
const mine = api.listViews_(SRI).views;
check('what was saved comes back', mine.length === 1 && mine[0].name === 'Sansin, waiting on me',
  JSON.stringify(mine));
check('with the tab and the grouping it was saved with',
  mine[0].tab === 'action' && mine[0].group === 'customer');
check('and every filter, unchanged',
  JSON.stringify(mine[0].filters) === JSON.stringify(view('x').filters),
  JSON.stringify(mine[0].filters));

/* ------------------------------- the trap: one deployer, many visitors */

check('somebody else sees none of it', api.listViews_(RIAN).views.length === 0,
  JSON.stringify(api.listViews_(RIAN).views));

api.saveView_(RIAN, view('My drafts', { tab: 'action', group: 'status' }));
check('and saving their own does not disturb the first',
  api.listViews_(SRI).views.length === 1 && api.listViews_(RIAN).views.length === 1);
check('the two are kept under different keys, each naming its person',
  Object.keys(STORE).length === 2 &&
  !!STORE['views:' + SRI.email] && !!STORE['views:' + RIAN.email],
  Object.keys(STORE).join(', '));

check('a Tester simulating another role still gets their own',
  api.listViews_(TESTER).views.length === 1 &&
  api.listViews_(TESTER).views[0].name === 'Sansin, waiting on me');

/* -------------------------------------------------- saving over a name */

api.saveView_(SRI, view('Sansin, waiting on me', { tab: 'progress' }));
check('saving under a name that exists replaces it rather than adding a second',
  api.listViews_(SRI).views.length === 1, JSON.stringify(api.listViews_(SRI).views));
check('and it is the new one that is kept',
  api.listViews_(SRI).views[0].tab === 'progress');

api.saveView_(SRI, view('SANSIN, WAITING ON ME', { tab: 'closed' }));
check('the same name in different letters is the same name',
  api.listViews_(SRI).views.length === 1 && api.listViews_(SRI).views[0].tab === 'closed',
  JSON.stringify(api.listViews_(SRI).views.map(function (v) { return v.name; })));
check('and the list keeps the position it had, not the end',
  api.listViews_(SRI).views[0].name === 'SANSIN, WAITING ON ME');

/* --------------------------------------------------- what may be stored */

check('a view with no name is refused',
  /name/i.test(refused(function () { api.saveView_(SRI, view('   ')); })));

api.saveView_(SRI, view('x'.repeat(200)));
const long = api.listViews_(SRI).views.filter(function (v) { return /^x+$/.test(v.name); })[0];
check('a very long name is cut to the limit rather than refused',
  long && long.name.length === api.VIEW_NAME_MAX, long && long.name.length);

api.saveView_(SRI, {
  name: 'junk',
  tab: 'all',
  filters: {
    statuses: ['Draft'], customerId: 'C1',
    // Whatever else the browser felt like sending.
    secret: 'x'.repeat(50000), nested: { a: 1 }, search: 'should not be kept'
  }
});
const junk = api.listViews_(SRI).views.filter(function (v) { return v.name === 'junk'; })[0];
check('a field the view does not have is not stored',
  junk.filters.secret === undefined && junk.filters.nested === undefined,
  Object.keys(junk.filters).join(', '));
check('and neither is the search box, which is a question asked once',
  junk.filters.search === undefined, Object.keys(junk.filters).join(', '));
check('every field the view does have is present, empty if it was not sent',
  junk.filters.principal === '' && Array.isArray(junk.filters.warrantyTypes),
  JSON.stringify(junk.filters));
function storedFor(who) {
  return STORE['views:' + who.email] || '';
}
check('the whole store stayed small', storedFor(SRI).length < 4000,
  'stored ' + storedFor(SRI).length + ' characters');

/* ----------------------------------------------------------- the ceiling */

STORE = {};
for (let i = 0; i < api.VIEW_MAX; i++) api.saveView_(SRI, view('view ' + i));
check('the limit can be reached', api.listViews_(SRI).views.length === api.VIEW_MAX);

const full = refused(function () { api.saveView_(SRI, view('one too many')); });
check('and the one past it is refused, saying what the limit is',
  full.indexOf(String(api.VIEW_MAX)) !== -1, full || 'it was accepted');
check('without disturbing what was already saved',
  api.listViews_(SRI).views.length === api.VIEW_MAX);
check('though replacing one of them still works when full',
  stage('replacing a view while at the limit', function () {
    return api.saveView_(SRI, view('view 3', { tab: 'closed' })).views.length === api.VIEW_MAX;
  }) === true);

/* ------------------------------------------------------------- deleting */

STORE = {};
stage('a list to delete from can be built', function () {
  api.saveView_(SRI, view('keep'));
  api.saveView_(SRI, view('drop'));
  api.saveView_(RIAN, view('drop'));
  api.deleteView_(SRI, { name: 'drop' });
});
check('deleting takes the one named', api.listViews_(SRI).views.length === 1 &&
  api.listViews_(SRI).views[0].name === 'keep');
check('and only from the person who asked',
  api.listViews_(RIAN).views.length === 1, JSON.stringify(api.listViews_(RIAN).views));
check('deleting one that is not there changes nothing',
  api.deleteView_(SRI, { name: 'never existed' }).views.length === 1);
check('deleting nothing at all is refused rather than emptying the list',
  /which/i.test(refused(function () { api.deleteView_(SRI, {}); })) &&
  api.listViews_(SRI).views.length === 1);

/* ------------------------------------------- a store that got damaged */

STORE = { 'views:sri@oji.co.id': '{ not json at all' };
check('a property that will not parse reads as no views, not as an error',
  stage('reading a damaged property', function () {
    return api.listViews_(SRI).views.length === 0;
  }) === true);
STORE = { 'views:sri@oji.co.id': '{"name":"not an array"}' };
check('and neither does one holding the wrong shape',
  stage('reading a property of the wrong shape', function () {
    return api.listViews_(SRI).views.length === 0;
  }) === true);
check('saving over it puts the list back',
  stage('saving over a damaged property', function () {
    api.saveView_(SRI, view('after the damage'));
    return api.listViews_(SRI).views.length === 1;
  }) === true);

/* ================================================== and now the browser */

const clientBox = {
  console: console,
  document: {
    getElementById: function () {
      return { innerHTML: '', hidden: false, children: [], value: '',
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
const clientSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'Script.html'), 'utf8')
  .replace(/^[\s\S]*?<script>/, '')
  .replace(/<\/script>\s*$/, '');
vm.runInContext(clientSrc +
  '\nglobalThis.__client = { S, blankFilters, viewIsShowing, activeViewName, currentView,' +
  ' viewCustomerGone, applyView, viewFilter, VIEW_FIELDS };',
  clientBox, { filename: 'client' });
const C = clientBox.__client;

/* what counts as "this view is showing" -------------------------------- */

const saved = {
  name: 'Sansin, waiting on me', tab: 'action', group: 'customer',
  filters: {
    statuses: ['In Review'], warrantyTypes: [], customerId: 'C7',
    customerName: 'RSUD Koja', principal: 'Sansin',
    distributorId: '', costBorne: false, from: '', to: ''
  }
};

function screenAs(v) {
  C.S.tab = v.tab;
  C.S.group = v.group;
  C.S.filters = Object.assign(C.blankFilters(), v.filters);
  C.S.views = [saved];
}

screenAs(saved);
check('a view is showing while the screen matches it', C.viewIsShowing(saved));
check('and the toolbar can say which one', C.activeViewName() === saved.name);

C.S.tab = 'all';
check('changing the tab lets go of it', !C.viewIsShowing(saved) && C.activeViewName() === '');

screenAs(saved);
C.S.group = 'status';
check('so does changing how the list is cut', !C.viewIsShowing(saved));

screenAs(saved);
C.S.filters.principal = '';
check('so does clearing a filter', !C.viewIsShowing(saved));

screenAs(saved);
C.S.filters.statuses = ['In Review', 'Closed'];
check('so does adding to one', !C.viewIsShowing(saved));

screenAs(saved);
C.S.filters.search = 'XT2409';
check('but typing in the search box does not: it was never part of the view',
  C.viewIsShowing(saved));

screenAs(saved);
C.S.filters.customerName = 'RSUD Koja (Jakarta Utara)';
check('nor does the customer being renamed, since the id is what filters',
  C.viewIsShowing(saved));

/* what gets sent when the screen is saved ------------------------------ */

screenAs(saved);
C.S.filters.search = 'XT2409';
const sending = C.currentView('Morning');
check('saving sends the filters that make the view',
  C.VIEW_FIELDS.every(function (k) {
    return JSON.stringify(sending.filters[k]) === JSON.stringify(saved.filters[k]);
  }), JSON.stringify(sending.filters));
check('and not the search box', sending.filters.search === undefined,
  Object.keys(sending.filters).join(', '));
check('the customer name rides along so the box can read it back',
  sending.filters.customerName === 'RSUD Koja');

/* opening one ---------------------------------------------------------- */

// Whatever was on screen before has to go, or opening a view would keep the
// filter it does not mention and quietly show less than it should.
C.S.tab = 'closed';
C.S.group = 'none';
C.S.filters = Object.assign(C.blankFilters(),
  { principal: 'Someone Else', statuses: ['Draft'], search: 'leftover' });
C.S.views = [{ name: 'Plain', tab: 'progress', group: 'status', filters: { statuses: ['Closed'] } }];

const asked = [];
clientBox.api = function (action, payload) {
  asked.push(action);
  return Promise.resolve({ option: null });
};
clientBox.loadClaims = function () { asked.push('loadClaims'); };
clientBox.renderClaims = function () {};

C.applyView('Plain');
check('opening a view takes the tab and the grouping with it',
  C.S.tab === 'progress' && C.S.group === 'status', C.S.tab + ' / ' + C.S.group);
check('and clears a filter it does not mention',
  C.S.filters.principal === '' && C.S.filters.search === '',
  JSON.stringify(C.S.filters));
check('while setting the ones it does',
  C.S.filters.statuses.join() === 'Closed');
check('a view with no customer does not ask the server about one',
  asked.join() === 'loadClaims', asked.join());

/* the hospital that was switched off ----------------------------------- */

check('a view pointing at a customer that is gone is recognised',
  C.viewCustomerGone({ customerId: 'C7' }, null));
check('and one pointing at a customer that is still there is not',
  !C.viewCustomerGone({ customerId: 'C7' }, { value: 'C7', label: 'RSUD Koja' }));
check('a view with no customer at all is never called gone',
  !C.viewCustomerGone({ customerId: '' }, null));

C.S.views = [saved];
C.S.viewNotice = '';
asked.length = 0;
const done = C.applyView('Sansin, waiting on me');

Promise.resolve(done).then(function () {
  // applyView answers through a promise chain; let it settle.
  return new Promise(function (r) { setTimeout(r, 0); });
}).then(function () {
  check('a view naming a customer asks whether that customer still exists',
    asked.indexOf('master.customer') !== -1, asked.join());
  check('and the list is still loaded, so the view does open',
    asked.indexOf('loadClaims') !== -1, asked.join());
  check('the screen is told why it is empty, by name',
    /RSUD Koja/.test(C.S.viewNotice) && /Sansin, waiting on me/.test(C.S.viewNotice),
    C.S.viewNotice || '(nothing said)');
  check('and the rest of the view is left set, so clearing the customer shows it',
    C.S.filters.principal === 'Sansin' && C.S.tab === 'action',
    JSON.stringify(C.S.filters));

  console.log('verify-views: ' + pass + ' checks passed' +
    (failures.length ? ', ' + failures.length + ' FAILED' : ''));
  failures.forEach(function (f) { console.log('  FAIL  ' + f); });
  process.exit(failures.length ? 1 : 0);
});
