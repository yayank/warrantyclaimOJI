/**
 * Auth.gs — identity and access.
 *
 * The web app runs as its owner so the spreadsheet never has to be shared, which
 * means Session.getActiveUser() is blank for anyone outside the owner's domain —
 * and the principal is outside it. Identity therefore comes from a Google
 * Identity Services ID token that the client sends with every call and the
 * server verifies here. A role supplied by the client is never trusted.
 */

/** Verifies an ID token and resolves the caller's session. Throws if refused. */
function resolveSession_(idToken, simulatedRole) {
  if (!idToken) throw authError_('Please sign in to continue.');

  const claims = verifyIdToken_(idToken);
  const email = String(claims.email || '').toLowerCase();
  if (!email) throw authError_('Your Google account did not return an email address.');
  if (claims.email_verified === 'false' || claims.email_verified === false) {
    throw authError_('This Google account has an unverified email address.');
  }

  const user = readAll_(SHEET.USERS).filter(function (u) {
    return String(u.Email || '').toLowerCase() === email;
  })[0];

  if (!user) throw authError_('The address ' + email + ' is not registered for this portal.');
  if (!isTrue_(user.Active)) throw authError_('Access for ' + email + ' has been deactivated.');

  const actualRole = String(user.Role || '').trim();
  const session = {
    email: email,
    name: user.Name || email,
    role: actualRole,
    actualRole: actualRole,
    // Which principal this account belongs to. Only meaningful for the
    // Principal role, where it decides which claims exist at all.
    principal: String(user.Principal || '').trim(),
    isTester: actualRole === ROLE.TESTER,
    simulatedRole: null
  };

  if (actualRole === ROLE.PRINCIPAL && !session.principal) {
    throw authError_('No principal is assigned to ' + email +
      '. An administrator must set it before you can sign in.');
  }

  if (session.isTester) {
    const wanted = simulatedRole || ROLE.ADMIN;
    if ([ROLE.REQUESTER, ROLE.PRODUCTION, ROLE.ADMIN, ROLE.PRINCIPAL].indexOf(wanted) === -1) {
      throw authError_('Unknown role for simulation: ' + wanted);
    }
    session.role = wanted;
    session.simulatedRole = wanted;
  }
  return session;
}

/**
 * Checks the token with Google's tokeninfo endpoint and caches the result for
 * the rest of its life — the round trip costs 200-400ms and would otherwise be
 * paid on every single call.
 */
function verifyIdToken_(idToken) {
  const cache = CacheService.getScriptCache();
  const key = 'tok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken)
  );
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  const res = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );
  if (res.getResponseCode() !== 200) {
    throw authError_('Your session has expired. Please sign in again.');
  }
  const claims = JSON.parse(res.getContentText());

  const clientId = setting_(SETTING_KEY.CLIENT_ID, '');
  if (!clientId) throw new Error('GoogleClientId is not set in the Settings sheet.');
  if (claims.aud !== clientId) throw authError_('This sign-in was issued for another application.');

  const remaining = Number(claims.exp || 0) - Math.floor(Date.now() / 1000);
  if (remaining <= 0) throw authError_('Your session has expired. Please sign in again.');

  cache.put(key, JSON.stringify(claims), Math.min(remaining, 3300));
  return claims;
}

function authError_(message) {
  const e = new Error(message);
  e.auth = true;
  return e;
}

function forbid_(message) {
  const e = new Error(message || 'You do not have permission to do that.');
  e.forbidden = true;
  return e;
}

function requireRole_(session, roles) {
  if (roles.indexOf(session.role) === -1) throw forbid_();
  return true;
}

/**
 * A Tester may act only on test claims. Everything else about their session
 * follows the role they are simulating.
 */
function guardTestScope_(session, claim) {
  if (!session.isTester) {
    if (isTrue_(claim.IsTest)) {
      throw forbid_('Test claims can only be processed in test mode.');
    }
    return;
  }
  if (!isTrue_(claim.IsTest)) {
    throw forbid_('Test mode — real claims are read-only.');
  }
}

/** Row-level scope. Applied on the server; client-side filtering is cosmetic. */
function visibleClaims_(session) {
  const all = readLive_(SHEET.CLAIMS);
  const showTest = session.isTester;

  return all.filter(function (c) {
    if (isTrue_(c.IsTest) && !showTest) return false;

    switch (session.role) {
      case ROLE.ADMIN:
        return true;

      case ROLE.PRINCIPAL:
        // Their own units only: the portal serves several principals and none of
        // them may see another's claims. A claim with no principal attributed
        // reaches nobody until an administrator assigns one.
        if (!c.Principal || c.Principal !== session.principal) return false;
        // Principal warranty only, and only once an administrator has verified it.
        return c.WarrantyType === WARRANTY_TYPE.PRINCIPAL &&
          [STATUS.IN_REVIEW, STATUS.FULFILMENT, STATUS.CLOSED].indexOf(c.Status) !== -1;

      case ROLE.REQUESTER:
      case ROLE.PRODUCTION:
        return String(c.RequesterEmail || '').toLowerCase() === session.email;

      default:
        return false;
    }
  });
}

function canEditClaimFields_(session, claim) {
  if (session.role === ROLE.REQUESTER || session.role === ROLE.PRODUCTION) {
    return [STATUS.DRAFT, STATUS.RETURNED].indexOf(claim.Status) !== -1 &&
      String(claim.RequesterEmail || '').toLowerCase() === session.email;
  }
  if (session.role === ROLE.ADMIN) {
    return [STATUS.SUBMITTED, STATUS.RETURNED, STATUS.INTERNAL].indexOf(claim.Status) !== -1;
  }
  return false;
}
