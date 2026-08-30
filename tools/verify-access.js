/**
 * verify-access.js — checks who can see which claims.
 *
 * The portal serves several principals, and the whole guarantee is that none of
 * them ever sees another's claims. That rule lives in visibleClaims_, so it is
 * worth proving rather than assuming: this loads Auth.gs itself and puts a small
 * fixture of claims behind it.
 *
 *   node tools/verify-access.js
 */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CLAIMS = [
  { ClaimID: 'C1', Principal: 'Sansin', WarrantyType: 'Principal Warranty',
    Status: 'In Review', RequesterEmail: 'rian@rs.co.id', IsTest: false },
  { ClaimID: 'C2', Principal: 'Nikkiso', WarrantyType: 'Principal Warranty',
    Status: 'In Review', RequesterEmail: 'rian@rs.co.id', IsTest: false },
  { ClaimID: 'C3', Principal: 'Sansin', WarrantyType: 'Principal Warranty',
    Status: 'Submitted', RequesterEmail: 'rian@rs.co.id', IsTest: false },
  { ClaimID: 'C4', Principal: '', WarrantyType: 'Principal Warranty',
    Status: 'In Review', RequesterEmail: 'rian@rs.co.id', IsTest: false },
  { ClaimID: 'C5', Principal: 'Sansin', WarrantyType: 'Internal Warranty',
    Status: 'In Fulfilment', RequesterEmail: 'dewi@rs.co.id', IsTest: false },
  { ClaimID: 'C6', Principal: 'Sansin', WarrantyType: 'Principal Warranty',
    Status: 'Closed', RequesterEmail: 'dewi@rs.co.id', IsTest: false },
  { ClaimID: 'T1', Principal: 'Sansin', WarrantyType: 'Principal Warranty',
    Status: 'In Review', RequesterEmail: 'tester@example.com', IsTest: true }
];

const USERS = [
  { Email: 'admin@oneject.co.id', Name: 'Admin', Role: 'Administrator', Principal: '', Active: true },
  { Email: 'roland@sansin.com', Name: 'Roland', Role: 'Principal', Principal: 'Sansin', Active: true },
  { Email: 'kenji@nikkiso.com', Name: 'Kenji', Role: 'Principal', Principal: 'Nikkiso', Active: true },
  { Email: 'stray@principal.com', Name: 'Stray', Role: 'Principal', Principal: '', Active: true },
  { Email: 'rian@rs.co.id', Name: 'Rian', Role: 'Requester', Principal: '', Active: true },
  { Email: 'dewi@rs.co.id', Name: 'Dewi', Role: 'Requester', Principal: '', Active: true },
  { Email: 'gone@rs.co.id', Name: 'Gone', Role: 'Requester', Principal: '', Active: false },
  { Email: 'tester@example.com', Name: 'Tester', Role: 'Tester', Principal: '', Active: true }
];

const sandbox = {
  console: console,
  readLive_: function (name) { return name === 'Claims' ? CLAIMS : []; },
  readAll_: function (name) { return name === 'users' ? USERS : []; },
  isTrue_: function (v) { return v === true || v === 'TRUE' || v === 'true'; },
  setting_: function () { return sandbox.__clientId; },
  Session: {
    getActiveUser: function () {
      return { getEmail: function () { return sandbox.__builtInEmail || ''; } };
    }
  },
  CacheService: {
    getScriptCache: function () {
      return { get: function () { return null; }, put: function () {} };
    }
  },
  Utilities: {
    base64EncodeWebSafe: function () { return 'k'; },
    computeDigest: function () { return []; },
    DigestAlgorithm: { SHA_256: 'sha256' }
  },
  // Stands in for the tokeninfo round trip; identity itself is Google's job.
  UrlFetchApp: {
    fetch: function (url) {
      const email = decodeURIComponent(String(url).split('id_token=')[1] || '');
      return {
        getResponseCode: function () { return email ? 200 : 401; },
        getContentText: function () {
          return JSON.stringify({
            email: email, email_verified: true, aud: 'test-client-id',
            exp: Math.floor(Date.now() / 1000) + 3000
          });
        }
      };
    }
  }
};
sandbox.__clientId = 'test-client-id';
sandbox.__builtInEmail = '';
vm.createContext(sandbox);

const source = ['Config.gs', 'Auth.gs']
  .map(function (f) { return fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'); })
  .concat(['globalThis.__api = { resolveSession_, visibleClaims_, canEditClaimFields_ };'])
  .join('\n');
vm.runInContext(source, sandbox, { filename: 'access' });

const { resolveSession_, visibleClaims_, canEditClaimFields_ } = sandbox.__api;

let pass = 0;
let fail = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) { pass++; return; }
  fail++;
  failures.push(name + (detail ? ' — ' + detail : ''));
}

function seen(email, simulated) {
  return visibleClaims_(resolveSession_(email, simulated))
    .map(function (c) { return c.ClaimID; }).sort().join(',');
}

/* --------------------------------------------------------- sign-in rules */

check('an unregistered address is refused', (function () {
  try { resolveSession_('nobody@example.com'); return false; } catch (e) { return e.auth === true; }
})());

check('a deactivated account is refused', (function () {
  try { resolveSession_('gone@rs.co.id'); return false; } catch (e) { return e.auth === true; }
})());

check('a principal account with no principal assigned is refused', (function () {
  try { resolveSession_('stray@principal.com'); return false; } catch (e) { return e.auth === true; }
})());

check('a missing token is refused', (function () {
  try { resolveSession_(''); return false; } catch (e) { return e.auth === true; }
})());

/* -------------------------------------------------- separation of principals */

check('a principal sees only their own units, in review or later',
  seen('roland@sansin.com') === 'C1,C6', seen('roland@sansin.com'));

check('the other principal sees only theirs',
  seen('kenji@nikkiso.com') === 'C2', seen('kenji@nikkiso.com'));

check('neither principal can see the other, whatever the status',
  seen('roland@sansin.com').indexOf('C2') === -1 &&
  seen('kenji@nikkiso.com').indexOf('C1') === -1);

check('a claim attributed to nobody reaches no principal',
  seen('roland@sansin.com').indexOf('C4') === -1 &&
  seen('kenji@nikkiso.com').indexOf('C4') === -1);

check('a claim still with the administrator is invisible to the principal',
  seen('roland@sansin.com').indexOf('C3') === -1);

check('an internal warranty claim never reaches a principal',
  seen('roland@sansin.com').indexOf('C5') === -1);

/* -------------------------------------------------------------- other roles */

check('an administrator sees every real claim',
  seen('admin@oneject.co.id') === 'C1,C2,C3,C4,C5,C6', seen('admin@oneject.co.id'));

check('a requester sees only their own claims',
  seen('rian@rs.co.id') === 'C1,C2,C3,C4', seen('rian@rs.co.id'));

check('and none belonging to a colleague',
  seen('rian@rs.co.id').indexOf('C5') === -1);

/* ------------------------------------------------------------- test claims */

check('test claims are hidden from everyone but the tester',
  seen('admin@oneject.co.id').indexOf('T1') === -1 &&
  seen('roland@sansin.com').indexOf('T1') === -1);

check('a tester simulating the administrator sees test claims too',
  seen('tester@example.com', 'Administrator').indexOf('T1') !== -1,
  seen('tester@example.com', 'Administrator'));

check('a tester simulating a principal is still bound by principal scope',
  // The tester account carries no principal of its own, so no principal's claims
  // match — which is the safe outcome rather than seeing everything.
  seen('tester@example.com', 'Principal') === '',
  seen('tester@example.com', 'Principal'));

/* ------------------------------- identity without a configured sign-in client */

// With no client ID set, Apps Script's own identity is used instead. It comes
// from Google rather than the browser, so it is trusted the same way — but it is
// blank for anyone outside the owner's domain, and that must fail closed.
sandbox.__clientId = '';

sandbox.__builtInEmail = 'admin@oneject.co.id';
check('the built-in identity is accepted when no client ID is configured',
  resolveSession_(null).email === 'admin@oneject.co.id');

check('and still carries the role from the users sheet, not a default',
  resolveSession_(null).role === 'Administrator');

sandbox.__builtInEmail = '';
check('a caller Google will not identify is refused, never waved through', (function () {
  try { resolveSession_(null); return false; } catch (e) { return e.auth === true; }
})());

sandbox.__builtInEmail = 'nobody@example.com';
check('an identified but unregistered address is still refused', (function () {
  try { resolveSession_(null); return false; } catch (e) { return e.auth === true; }
})());

sandbox.__builtInEmail = 'roland@sansin.com';
check('the built-in path applies the same principal scope',
  visibleClaims_(resolveSession_(null)).map(function (c) { return c.ClaimID; }).sort().join(',')
    === 'C1,C6');

sandbox.__clientId = 'test-client-id';
sandbox.__builtInEmail = '';

/* ------------------------------------------------------------ edit windows */

const requester = resolveSession_('rian@rs.co.id');
const admin = resolveSession_('admin@oneject.co.id');
const principal = resolveSession_('roland@sansin.com');

check('a requester may edit their own draft',
  canEditClaimFields_(requester,
    { Status: 'Draft', RequesterEmail: 'rian@rs.co.id' }) === true);

check('but not once it is submitted',
  canEditClaimFields_(requester,
    { Status: 'Submitted', RequesterEmail: 'rian@rs.co.id' }) === false);

check('and never somebody else\'s draft',
  canEditClaimFields_(requester,
    { Status: 'Draft', RequesterEmail: 'dewi@rs.co.id' }) === false);

check('an administrator may correct a submitted claim',
  canEditClaimFields_(admin, { Status: 'Submitted' }) === true);

check('but not one already with the principal',
  canEditClaimFields_(admin, { Status: 'In Review' }) === false);

check('a principal never edits claim details',
  canEditClaimFields_(principal, { Status: 'In Review' }) === false);

console.log('');
console.log('  ' + pass + ' passed, ' + fail + ' failed');
failures.forEach(function (f) { console.log('    ✗ ' + f); });
console.log('');

process.exit(fail ? 1 : 0);
