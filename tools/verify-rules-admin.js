/**
 * verify-rules-admin.js — editing the terms the whole portal answers from.
 *
 * WarrantyRules decides what every screen says about every unit. Until now it
 * could only be edited by opening the spreadsheet, where one mistyped cell
 * changes the answer for hundreds of units with nothing recording who did it.
 *
 * THE OVERLAP IS THE POINT. Two active rules covering the same model, the same
 * side and the same channel over periods that meet are not a preference the
 * portal can settle: pickRule_ will pick one, deterministically and invisibly,
 * and the other will look as though it was ignored. That has to be refused at
 * the point of entry, naming the rule it collides with — not accepted and
 * quietly resolved later.
 *
 * A GENERAL RULE WITH ONE EXCEPTION IS NOT AN OVERLAP. A rule taking either
 * channel alongside one naming a channel is how that is meant to be written,
 * and pickRule_ prefers the specific one on purpose. Refusing it would make the
 * screen unusable for the commonest shape there is.
 *
 * AND A CHANGED RULE THAT CHANGES NOTHING. The dates live on the unit rows and
 * were worked out under the old rule. Save without recomputing and the
 * administrator sees no unit move, with no way to find out why.
 *
 *   node tools/verify-rules-admin.js
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
    appendRow: function (row) {
      const width = s.getLastColumn();
      const line = row.slice();
      while (line.length < width) line.push('');
      s.rows.push(line);
    },
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
        setValue: function (v) { s.rows[r - 1][c - 1] = v; },
        setFontWeight: function () {}
      };
    }
  };
  return s;
}

let SHEETS = {};
let CACHE = {};
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
        get: function (k) { return CACHE[k] === undefined ? null : CACHE[k]; },
        getAll: function (keys) {
          const out = {};
          keys.forEach(function (k) { if (CACHE[k] !== undefined) out[k] = CACHE[k]; });
          return out;
        },
        put: function (k, v) { CACHE[k] = String(v); },
        putAll: function (e) { Object.keys(e).forEach(function (k) { CACHE[k] = String(e[k]); }); },
        remove: function (k) { delete CACHE[k]; },
        removeAll: function (keys) { keys.forEach(function (k) { delete CACHE[k]; }); }
      };
    }
  },
  LockService: {
    getDocumentLock: function () {
      return { tryLock: function () { return true; }, releaseLock: function () {} };
    }
  },
  Utilities: { formatDate: function () { return '2026-09-12T10:00:00'; } }
};

vm.createContext(sandbox);
['Config.gs', 'Repo.gs', 'Auth.gs', 'Warranty.gs', 'WarrantyRules.gs', 'Units.gs',
  'Audit.gs', 'MasterData.gs'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'),
    sandbox, { filename: f });
});
vm.runInContext(
  'globalThis.__api = { SHEET, SCHEMA, INDEX_MEMO, listMaster_, saveMaster_,' +
  '  rulesIndex_, findBy_, readAll_, determineWarranty_ };',
  sandbox, { filename: 'stubs' });

const api = sandbox.__api;
const SHEET = api.SHEET;
const SRI = {
  email: 'sri@oji.co.id', name: 'Sri', role: 'Administrator',
  actualRole: 'Administrator', simulatedRole: null, isTester: false, principal: ''
};
const RIAN = {
  email: 'rian@dist.co.id', name: 'Rian', role: 'Requester',
  actualRole: 'Requester', simulatedRole: null, isTester: false, principal: ''
};

/* ------------------------------------------------------------- the fixture */

const POP_COLS = api.SCHEMA[SHEET.POPULATION];
const RULE_COLS = api.SCHEMA[SHEET.RULES];

function ruleRow(id, material, scope, channel, basis, months, from, to, active) {
  return [id, material, scope, channel, basis, months, from || '', to || '',
    active === undefined ? true : active, ''];
}

function build(rules) {
  CACHE = {};
  SHEETS = {
    Products: new Sheet('Products', [api.SCHEMA[SHEET.PRODUCTS].slice(),
      ['MAT-A', 'MAT-A analyser', 'Sansin', 'AKL', '', true, ''],
      ['MAT-B', 'MAT-B analyser', 'Sansin', 'AKD', '', true, '']]),
    WarrantyRules: new Sheet('WarrantyRules', [RULE_COLS.slice()].concat(rules || [])),
    Distributors: new Sheet('Distributors', [api.SCHEMA[SHEET.DISTRIBUTORS].slice(),
      ['DST-1', 'PT Sinar Medika', 'a@x.co.id', true, '']]),
    Principals: new Sheet('Principals', [api.SCHEMA[SHEET.PRINCIPALS].slice(),
      ['PR1', 'Sansin', true, '']]),
    AuditLog: new Sheet('AuditLog', [api.SCHEMA[SHEET.AUDIT].slice()]),
    Claims: new Sheet('Claims', [api.SCHEMA[SHEET.CLAIMS].slice()]),
    ClaimItems: new Sheet('ClaimItems', [api.SCHEMA[SHEET.ITEMS].slice()]),
    warranty: new Sheet('warranty', [api.SCHEMA[SHEET.WARRANTY].slice()]),
    Population: new Sheet('Population', [POP_COLS.slice()].concat([
      POP_COLS.map(function (c) {
        const u = { Batch: 'XT2403001', Material: 'MAT-A', ItemDescription: 'MAT-A analyser',
          Principal: 'Sansin', SellingInDate: '2024-04-01', DeliveryQuantity: 1 };
        return u[c] === undefined ? '' : u[c];
      })
    ]))
  };
  ['population', 'warranty', 'products', 'rules'].forEach(function (k) {
    delete api.INDEX_MEMO[k];
  });
}

function rule(extra) {
  return Object.assign({
    Material: 'MAT-A', Scope: 'principal', Channel: '*', Basis: 'assembly',
    Months: 24, EffectiveFrom: '', EffectiveTo: '', Active: true, Notes: ''
  }, extra || {});
}

function save(record) { return api.saveMaster_(SRI, 'rules', record); }

/* ============================================================= the overlap */

build([ruleRow('RULE-001', 'MAT-A', 'principal', '*', 'assembly', 24,
  '2020-01-01', '2023-12-31')]);

check('a rule in a period nobody else covers is accepted',
  !!stage('saving a later period', function () {
    return save(rule({ EffectiveFrom: '01/01/2024' }));
  }));

build([ruleRow('RULE-001', 'MAT-A', 'principal', '*', 'assembly', 24,
  '2020-01-01', '2023-12-31')]);
const clash = refuses(function () {
  save(rule({ EffectiveFrom: '01/01/2023', EffectiveTo: '31/12/2025' }));
});
check('one whose period meets an existing rule is refused', clash !== '');
check('and it names the rule it collides with',
  /RULE-001/.test(clash), clash);
check('and says what that rule covers, so the fix is obvious',
  /2020-01-01 to 2023-12-31/.test(clash), clash);
check('nothing was written', SHEETS.WarrantyRules.rows.length === 2,
  String(SHEETS.WarrantyRules.rows.length));

// Open-ended windows are the ones people get wrong: a rule with no end date
// covers everything after its start, so anything later collides with it.
build([ruleRow('RULE-001', 'MAT-A', 'principal', '*', 'assembly', 24, '2020-01-01', '')]);
check('a rule with no end date collides with anything after it',
  refuses(function () { save(rule({ EffectiveFrom: '01/01/2026' })); }) !== '');
build([ruleRow('RULE-001', 'MAT-A', 'principal', '*', 'assembly', 24, '', '')]);
check('and one with no dates at all collides with everything',
  refuses(function () { save(rule({ EffectiveFrom: '01/01/2026', EffectiveTo: '31/12/2026' })); }) !== '');
check('including another rule with no dates at all',
  refuses(function () { save(rule()); }) !== '');

// Abutting is not overlapping: one ends the day before the next begins.
build([ruleRow('RULE-001', 'MAT-A', 'principal', '*', 'assembly', 24,
  '2020-01-01', '2023-12-31')]);
check('a period that begins the day the last one ended is refused',
  refuses(function () {
    save(rule({ EffectiveFrom: '31/12/2023', EffectiveTo: '31/12/2025' }));
  }) !== '');
check('but one that begins the day after is fine',
  refuses(function () {
    save(rule({ EffectiveFrom: '01/01/2024', EffectiveTo: '31/12/2025' }));
  }) === '');

/* ------------------------------------------- what is deliberately not a clash */

build([ruleRow('RULE-001', 'MAT-A', 'principal', '*', 'assembly', 24, '', '')]);
check('a rule naming a channel beside one taking either is allowed',
  refuses(function () { save(rule({ Channel: 'distributor', Months: 36 })); }) === '',
  refuses(function () { save(rule({ Channel: 'distributor', Months: 36 })); }));

build([ruleRow('RULE-001', 'MAT-A', 'principal', '*', 'assembly', 24, '', '')]);
check('the other side of the same model is a different question',
  refuses(function () { save(rule({ Scope: 'customer' })); }) === '');
check('and so is another model',
  refuses(function () { save(rule({ Material: 'MAT-B' })); }) === '');

build([ruleRow('RULE-001', 'MAT-A', 'principal', '*', 'assembly', 24, '', '', false)]);
check('a retired rule does not stand in the way of a new one',
  refuses(function () { save(rule()); }) === '',
  refuses(function () { save(rule()); }));

build([ruleRow('RULE-001', 'MAT-A', 'principal', '*', 'assembly', 24, '', '')]);
check('and editing a rule does not collide with itself',
  refuses(function () {
    save(rule({ RuleID: 'RULE-001', Months: 30 }));
  }) === '',
  refuses(function () { save(rule({ RuleID: 'RULE-001', Months: 30 })); }));

// Writing next year's terms before retiring this year's is the ordinary way to
// do it, and it needs the draft to be storable while the old rule is still
// live. A retired rule answers nobody, so it cannot be competing with anything.
build([ruleRow('RULE-001', 'MAT-A', 'principal', '*', 'assembly', 24, '', '')]);
check('a replacement can be written and left retired while the old rule still stands',
  refuses(function () { save(rule({ Months: 36, Active: false })); }) === '',
  refuses(function () { save(rule({ Months: 36, Active: false })); }));
const draft = api.readAll_(SHEET.RULES).filter(function (r) {
  return String(r.RuleID) !== 'RULE-001';
})[0] || {};
check('but switching it on before retiring the old one is refused',
  /RULE-001/.test(refuses(function () {
    save(rule({ RuleID: draft.RuleID, Months: 36, Active: true }));
  })), refuses(function () { save(rule({ RuleID: draft.RuleID, Months: 36, Active: true })); }));
check('and after the old one is retired it goes live',
  (function () {
    stage('retiring the old rule', function () {
      return save(rule({ RuleID: 'RULE-001', Active: false }));
    });
    return refuses(function () {
      save(rule({ RuleID: draft.RuleID, Months: 36, Active: true }));
    }) === '';
  })());

/* ================================================================ each field */

build();
check('a model that is not on the product list is refused',
  /not on the product list/.test(refusedFresh({ Material: 'MAT-Z' })),
  refusedFresh({ Material: 'MAT-Z' }));
check('a side that is neither of the two is refused',
  /principal.*customer/.test(refusedFresh({ Scope: 'both' })), refusedFresh({ Scope: 'both' }));
check('a basis the engine does not know is refused, and lists the ones it does',
  /assembly, selling-in, received, installation/.test(refusedFresh({ Basis: 'delivery' })),
  refusedFresh({ Basis: 'delivery' }));
check('a channel that is neither is refused',
  /direct.*distributor/.test(refusedFresh({ Channel: 'sideways' })),
  refusedFresh({ Channel: 'sideways' }));
// Each of these starts from an empty rules sheet on purpose: run one after
// another, the first one that slips through would create a rule the rest then
// collide with, and they would all look refused for the wrong reason.
function refusedFresh(record) {
  build();
  return refuses(function () { save(rule(record)); });
}
check('zero months is refused',
  /whole number above zero/.test(refusedFresh({ Months: 0 })),
  refusedFresh({ Months: 0 }));
check('so is a fraction of a month',
  /whole number above zero/.test(refusedFresh({ Months: 1.5 })),
  refusedFresh({ Months: 1.5 }));
check('and so is something that is not a number at all',
  /whole number above zero/.test(refusedFresh({ Months: 'twelve' })),
  refusedFresh({ Months: 'twelve' }));
check('a rule that stops before it starts is refused',
  /before it starts/.test(refusedFresh({ EffectiveFrom: '01/01/2025', EffectiveTo: '01/01/2024' })),
  refusedFresh({ EffectiveFrom: '01/01/2025', EffectiveTo: '01/01/2024' }));

// Dates on this form are typed by the same people who type them on the unit
// form, and they mean the same thing on both.
build();
const dated = stage('saving with dd/mm/yyyy dates', function () {
  return save(rule({ EffectiveFrom: '03/09/2024', EffectiveTo: '31/12/2025' }));
});
check('an effective date is read day first',
  dated && dated.EffectiveFrom === '2024-09-03', dated ? dated.EffectiveFrom : 'threw');
check('and one nobody can read is refused rather than guessed at',
  /no month 13/.test(refusedFresh({ EffectiveFrom: '09/13/2024' })),
  refusedFresh({ EffectiveFrom: '09/13/2024' }));

check('a blank channel means either way rather than nothing',
  (function () {
    build();
    const saved = save(rule({ Channel: '' }));
    return saved.Channel === '*';
  })());

/* ============================================== retired, never deleted */

build([ruleRow('RULE-001', 'MAT-A', 'principal', '*', 'assembly', 24, '', '')]);
const retired = stage('retiring a rule', function () {
  return save(rule({ RuleID: 'RULE-001', Active: false }));
}) || {};
check('a retired rule is still on the sheet',
  SHEETS.WarrantyRules.rows.length === 2, String(SHEETS.WarrantyRules.rows.length));
check('marked inactive rather than removed',
  retired && retired.Active === false, retired ? String(retired.Active) : 'threw');
check('and the engine stops offering it',
  Object.keys(api.rulesIndex_()).length === 0,
  JSON.stringify(Object.keys(api.rulesIndex_())));

/* =================================================== the trail, and the cache */

build();
stage('adding a rule to audit', function () { return save(rule({ Months: 24 })); });
const created = api.readAll_(SHEET.RULES)[0] || {};
SHEETS.AuditLog.rows = [api.SCHEMA[SHEET.AUDIT].slice()];
stage('editing it', function () { return save(rule({ RuleID: created.RuleID, Months: 36 })); });

const auditFields = api.SCHEMA[SHEET.AUDIT];
const trail = SHEETS.AuditLog.rows.slice(1).map(function (r) {
  return {
    field: String(r[auditFields.indexOf('Field')]),
    from: String(r[auditFields.indexOf('OldValue')]),
    to: String(r[auditFields.indexOf('NewValue')]),
    actor: String(r[auditFields.indexOf('Actor')])
  };
});
const monthsChange = trail.filter(function (t) { return /Months$/.test(t.field); })[0];
check('changing a term is on the audit trail', !!monthsChange, JSON.stringify(trail));
check('with the figure it was and the figure it became',
  monthsChange && monthsChange.from === '24' && monthsChange.to === '36',
  monthsChange ? monthsChange.from + ' -> ' + monthsChange.to : 'nothing recorded');
check('and who changed it',
  monthsChange && monthsChange.actor === 'sri@oji.co.id',
  monthsChange ? monthsChange.actor : '');

// The index is held for half an hour. Without dropping it the new term would
// take effect at some point in the next thirty minutes, with nothing on any
// screen to explain the delay.
build([ruleRow('RULE-001', 'MAT-A', 'principal', '*', 'assembly', 24, '', '')]);
api.rulesIndex_();
check('the rules are cached to begin with', !!CACHE['rulesIndex:n'],
  Object.keys(CACHE).join(','));
check('and the cached copy says twenty-four months',
  /"months":24/.test(CACHE['rulesIndex:0'] || ''), CACHE['rulesIndex:0']);

stage('editing a cached rule', function () { return save(rule({ RuleID: 'RULE-001', Months: 36 })); });
check('after an edit the cached copy is the new one, not the old',
  !/"months":24/.test(CACHE['rulesIndex:0'] || ''), CACHE['rulesIndex:0']);
check('and the very next read already has the new term',
  (api.rulesIndex_()['MAT-A|principal'] || [{}])[0].months === 36,
  String((api.rulesIndex_()['MAT-A|principal'] || [{}])[0].months));

/* ------------------------------------------- and the units follow immediately */

build();
check('the unit has no answer before any rule exists',
  api.determineWarranty_('XT2403001', new Date(2025, 0, 1)).source === 'formula');

stage('adding the rule the unit needs', function () { return save(rule({ Months: 24 })); });
const endCol = POP_COLS.indexOf('WarrantyEndPrincipal');
check('saving a rule works every unit out again there and then',
  SHEETS.Population.rows[1][endCol] === '2026-03',
  String(SHEETS.Population.rows[1][endCol]));

const first = api.readAll_(SHEET.RULES)[0] || {};
stage('changing the term', function () { return save(rule({ RuleID: first.RuleID, Months: 36 })); });
check('and changing the term moves them, rather than leaving the screens stale',
  SHEETS.Population.rows[1][endCol] === '2027-03',
  String(SHEETS.Population.rows[1][endCol]));

/* ================================================ products and distributors */

build();
check('a product needs a material code',
  refuses(function () { api.saveMaster_(SRI, 'products', { Material: '', Name: 'x' }); }) !== '');
check('and a name',
  refuses(function () { api.saveMaster_(SRI, 'products', { Material: 'MAT-C', Name: '' }); }) !== '');
// The product list is the only master set whose key a person types, so it is
// the only one where "add" can land on a row that already exists.
check('a material code already on the list cannot be added twice',
  /already on the list/.test(refuses(function () {
    api.saveMaster_(SRI, 'products', { __isNew: true, Material: 'MAT-A', Name: 'Another' });
  })), refuses(function () {
    api.saveMaster_(SRI, 'products', { __isNew: true, Material: 'MAT-A', Name: 'Another' });
  }));
check('while editing the one that is there still works',
  api.saveMaster_(SRI, 'products', { Material: 'MAT-A', Name: 'Renamed' }).Name === 'Renamed');
check('the code is stored in the case the rest of the portal matches on',
  (stage('adding mat-c', function () {
    return api.saveMaster_(SRI, 'products', { Material: 'mat-c', Name: 'MAT-C analyser' });
  }) || {}).Material === 'MAT-C');
check('a regulation that is neither AKD nor AKL is refused',
  /AKD or AKL/.test(refuses(function () {
    api.saveMaster_(SRI, 'products', { Material: 'MAT-D', Name: 'x', Regulation: 'AKX' });
  })));

build();
check('a distributor needs a name',
  refuses(function () { api.saveMaster_(SRI, 'distributors', { Name: '' }); }) !== '');
check('and an address that is an address, if one is given',
  refuses(function () {
    api.saveMaster_(SRI, 'distributors', { Name: 'PT Tiga', Email: 'not-an-address' });
  }) !== '');
const dist = stage('adding a distributor', function () {
  return api.saveMaster_(SRI, 'distributors', { Name: 'PT Tiga Medika', Email: 'C@X.CO.ID' });
});
check('a new distributor is given an id', dist && /^DST-/.test(dist.DistributorID),
  dist ? dist.DistributorID : 'threw');
check('and its address is stored lower case, since that is how addresses are matched',
  dist && dist.Email === 'c@x.co.id', dist ? dist.Email : '');

/* ------------------------------------------------------------ who may do it */

build();
check('a requester cannot read the rules screen',
  refuses(function () { api.listMaster_(RIAN, 'rules'); }) !== '');
check('nor change a rule',
  refuses(function () { api.saveMaster_(RIAN, 'rules', rule()); }) !== '');

/* ------------------------------------------------- the list behind the screen */

build([ruleRow('RULE-001', 'MAT-A', 'principal', '*', 'assembly', 24, '', ''),
  ruleRow('RULE-002', 'MAT-B', 'principal', '*', 'assembly', 12, '', '', false)]);
const listed = api.listMaster_(SRI, 'rules');
check('the screen is shown retired rules as well as live ones',
  listed.length === 2, String(listed.length));
check('and says how many units each rule stands over',
  listed[0].__used === 1 && listed[1].__used === 0,
  listed.map(function (r) { return r.RuleID + ':' + r.__used; }).join(' '));
check('the product list counts its units too',
  api.listMaster_(SRI, 'products').filter(function (p) {
    return p.Material === 'MAT-A';
  })[0].__used === 1);

/* ------------------------------------------------------------------ report */

console.log('verify-rules-admin: ' + pass + ' checks passed' +
  (failures.length ? ', ' + failures.length + ' FAILED' : ''));
failures.forEach(function (f) { console.log('  FAIL  ' + f); });
process.exit(failures.length ? 1 : 0);
