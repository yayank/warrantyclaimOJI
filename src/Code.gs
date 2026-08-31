/**
 * Code.gs — the web app entry point and the single API surface.
 *
 * Every client call arrives here carrying its ID token, so authentication is
 * enforced in one place rather than repeated in dozens of exported functions.
 * Nothing the browser sends about identity or role is trusted.
 */

function doGet(e) {
  // Deploying before setUp() has run is the ordinary first mistake. Saying so
  // plainly beats a stack trace that names a line number and nothing else.
  const missing = missingSheets_();
  if (missing.length) return setupPage_(missing);

  const page = HtmlService.createTemplateFromFile('index');
  page.clientId = setting_(SETTING_KEY.CLIENT_ID, '');
  page.deepLink = JSON.stringify((e && e.parameter) || {});
  return page.evaluate()
    .setTitle('Warranty Claim Portal')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Shown instead of the portal while the spreadsheet is not prepared.
 *
 * It names the spreadsheet the script is actually bound to, because the second
 * form of this mistake — setUp() ran, but against a different spreadsheet than
 * the one being looked at — is otherwise very hard to see.
 */
function setupPage_(missing) {
  const book = boundSpreadsheet_();
  const esc = function (t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };

  const html =
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<style>' +
    'body{margin:0;background:#f2f5f6;color:#101619;font-family:-apple-system,' +
    'BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;font-size:15px;line-height:1.6;' +
    'display:grid;place-items:center;min-height:100vh;padding:28px}' +
    '.card{background:#fff;border:1px solid #d7dee1;border-radius:8px;max-width:560px;' +
    'padding:26px 28px;box-shadow:0 8px 24px -12px rgba(16,22,25,.18)}' +
    'h1{margin:0 0 4px;font-size:19px}p{margin:10px 0}' +
    'code{background:#e8ecee;padding:1px 5px;border-radius:3px;font-size:.9em;' +
    'font-family:ui-monospace,Menlo,Consolas,monospace}' +
    'ol{margin:10px 0;padding-left:20px}li{margin:5px 0}' +
    '.muted{color:#6f7c82;font-size:13px}' +
    '.warn{border-left:3px solid #9a5b06;background:#f7e8d2;color:#9a5b06;' +
    'padding:10px 13px;border-radius:5px;font-size:13.5px;margin:14px 0}' +
    '</style></head><body><div class="card">' +
    '<h1>Setup is not finished</h1>' +
    '<p>This spreadsheet does not have the sheets the portal needs yet.</p>' +
    '<div class="warn"><b>' + missing.length + ' sheet' + (missing.length === 1 ? '' : 's') +
    ' missing:</b><br>' + esc(missing.join(', ')) + '</div>' +
    '<p><b>To finish setting up:</b></p><ol>' +
    '<li>Open the Apps Script editor</li>' +
    '<li>Choose the <code>setUp</code> function from the dropdown</li>' +
    '<li>Press Run and grant the permissions it asks for</li>' +
    '<li>Reload this page</li>' +
    '</ol>' +
    (book.id
      ? '<p class="muted">The script is writing to: <b>' + esc(book.name) + '</b><br>' +
        '<code>' + esc(book.id) + '</code><br>' +
        'If that is not the spreadsheet you expected, correct ' +
        '<code>SPREADSHEET_ID</code> in Project Settings &rarr; Script Properties, ' +
        'then run <code>setUp</code> again.</p>'
      : '<p class="muted">No spreadsheet could be opened at all. Set ' +
        '<code>SPREADSHEET_ID</code> in Project Settings &rarr; Script Properties.' +
        (book.error ? '<br>' + esc(book.error) : '') + '</p>') +
    '</div></body></html>';

  return HtmlService.createHtmlOutput(html)
    .setTitle('Warranty Claim Portal — setup')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/**
 * Single dispatcher. Returns {ok, data} or {ok:false, error, kind} — errors are
 * returned rather than thrown so the client can show the message instead of a
 * bare failure handler.
 */
function api(request) {
  const req = request || {};
  try {
    const session = resolveSession_(req.token, req.simulatedRole);
    const data = route_(session, req.action, req.payload || {});
    return { ok: true, data: jsonSafe_(data), session: publicSession_(session) };
  } catch (err) {
    return {
      ok: false,
      error: String(err && err.message ? err.message : err),
      kind: err && err.auth ? 'auth' : (err && err.forbidden ? 'forbidden'
        : (err && err.stale ? 'stale' : 'error')),
      current: err && err.stale ? err.current : undefined
    };
  }
}

/**
 * The last check before a value crosses to the browser.
 *
 * google.script.run accepts primitives, arrays and plain objects and nothing
 * else: a Date anywhere inside a return value fails the whole call, and the
 * page is handed null with no error to show. cellValue_ already keeps Dates out
 * of everything read from a sheet; this covers whatever a future caller builds
 * in code. NaN and Infinity are not JSON either, and leave as null.
 */
function jsonSafe_(value) {
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? '' : Utilities.formatDate(value, TZ, "yyyy-MM-dd'T'HH:mm:ss");
  }
  if (typeof value === 'number') return isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(jsonSafe_);
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach(function (k) { out[k] = jsonSafe_(value[k]); });
    return out;
  }
  return value;
}

function publicSession_(session) {
  return {
    email: session.email,
    name: session.name,
    role: session.role,
    actualRole: session.actualRole,
    principal: session.principal,
    isTester: session.isTester,
    simulatedRole: session.simulatedRole
  };
}

function route_(session, action, payload) {
  switch (action) {
    /* session and reference data */
    case 'session.bootstrap':
      return {
        session: publicSession_(session),
        reference: referenceData_(session),
        appUrl: setting_(SETTING_KEY.APP_URL, '')
      };

    /* claims */
    case 'claims.list': return listClaims_(session, payload);
    case 'claims.get': return getClaim_(session, payload.claimId);
    case 'claims.save': return saveClaim_(session, payload);
    case 'claims.upload': return uploadAttachment_(session, payload);
    case 'claims.submit': return submitClaim_(session, payload);
    case 'claims.return': return returnClaim_(session, payload);
    case 'claims.override': return overrideWarranty_(session, payload);
    case 'claims.forward': return forwardToPrincipal_(session, payload);
    case 'claims.withdraw': return withdrawFromPrincipal_(session, payload);
    case 'claims.internal': return startInternalVerification_(session, payload);
    case 'claims.decide': return decideItems_(session, payload);
    case 'claims.availability': return setAvailability_(session, payload);
    case 'claims.forwardOrder': return forwardOrder_(session, payload);
    case 'claims.shipped': return markShipped_(session, payload);
    case 'claims.partReturn': return recordPartReturn_(session, payload);
    case 'claims.advanceIssue': return setAdvanceIssue_(session, payload);
    case 'claims.delete': return deleteClaim_(session, payload);
    case 'claims.lookup': return lookupSerial_(session, payload.serialNumber);
    case 'claims.units': return unitOptions_(session);
    case 'claims.attachment': return attachmentData_(session, payload.attachmentId);
    case 'claims.export': return exportClaims_(session, payload);

    /* master data */
    case 'master.list': return listMaster_(session, payload.kind);
    case 'master.save': return saveMaster_(session, payload.kind, payload.record);
    case 'master.units': return listUnits_(session, payload);
    case 'master.importPreview': return previewUnitImport_(session, payload);
    case 'master.import': return importUnits_(session, payload);
    case 'master.unknownPrincipals': return unknownPrincipals_(session);

    /* email templates and archive */
    case 'templates.list': return listTemplates_(session);
    case 'templates.save': return saveTemplate_(session, payload);
    case 'templates.restore': return restoreTemplate_(session, payload.code);
    case 'templates.test': return sendTestTemplate_(session, payload.code);
    case 'email.log': return listEmailLog_(session, payload);
    case 'email.setEnabled': return setEmailEnabled_(session, payload.enabled);
    case 'email.digestNow': return sendDigestNow_(session);

    /* audit and test mode */
    case 'audit.list': return listAudit_(session, payload);
    case 'test.purge': return purgeTestClaims_(session);

    default:
      throw new Error('Unknown action: ' + action);
  }
}
