/**
 * Code.gs — the web app entry point and the single API surface.
 *
 * Every client call arrives here carrying its ID token, so authentication is
 * enforced in one place rather than repeated in dozens of exported functions.
 * Nothing the browser sends about identity or role is trusted.
 */

function doGet(e) {
  const page = HtmlService.createTemplateFromFile('index');
  page.clientId = setting_(SETTING_KEY.CLIENT_ID, '');
  page.deepLink = JSON.stringify((e && e.parameter) || {});
  return page.evaluate()
    .setTitle('Warranty Claim Portal')
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
    return { ok: true, data: data, session: publicSession_(session) };
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
    case 'email.digestNow': return sendDigestNow_(session);

    /* audit and test mode */
    case 'audit.list': return listAudit_(session, payload);
    case 'test.purge': return purgeTestClaims_(session);

    default:
      throw new Error('Unknown action: ' + action);
  }
}
