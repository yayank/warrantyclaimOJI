/**
 * Triggers.gs — scheduled work.
 *
 * The digest is the one that matters. Claims reach the principal's screen the
 * moment an administrator forwards them; only the notification waits for the
 * evening, so a batch arrives as one message rather than ten.
 */

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });

  const hour = Number(setting_(SETTING_KEY.DIGEST_HOUR, 17));
  ScriptApp.newTrigger('sendDailyDigest').timeBased().atHour(hour).everyDays(1).create();
  ScriptApp.newTrigger('dailyMaintenance').timeBased().atHour(1).everyDays(1).create();
  return 'Triggers installed: digest at ' + hour + ':00, maintenance at 01:00 ' + TZ;
}

/** Entry point for the scheduled digest. */
function sendDailyDigest() {
  return dispatchDigest_({ email: 'system', actualRole: 'System', simulatedRole: null, isTester: false });
}

/**
 * Collects claims that have been forwarded but not yet notified and sends one
 * message per reference number.
 *
 * PrincipalNotifiedAt is what makes this safe to re-run: a claim already
 * included is skipped, and a claim whose send failed keeps an empty marker so
 * it is picked up next time rather than vanishing.
 */
function dispatchDigest_(session) {
  const pending = readLive_(SHEET.CLAIMS).filter(function (c) {
    return c.Status === STATUS.IN_REVIEW &&
      c.WarrantyType === WARRANTY_TYPE.PRINCIPAL &&
      !c.PrincipalNotifiedAt &&
      !isTrue_(c.IsTest);
  });
  if (!pending.length) return { sent: 0, claims: 0 };

  const items = readLive_(SHEET.ITEMS);
  const batches = {};
  pending.forEach(function (c) {
    (batches[c.RefNo] = batches[c.RefNo] || []).push(c);
  });

  const to = principalEmails_();
  let sent = 0;

  Object.keys(batches).forEach(function (refNo) {
    const claims = batches[refNo];
    const verifiers = {};
    const shaped = claims.map(function (c) {
      verifiers[c.UpdatedBy || ''] = true;
      const own = items.filter(function (i) { return i.ClaimID === c.ClaimID; });
      return {
        ClaimID: c.ClaimID, Customer: c.CustomerName, SerialNumber: c.SerialNumber,
        WarrantyBasis: c.WarrantyBasis, WorkOrder: c.WorkOrderNo || '—',
        Problem: c.ProblemDescription,
        Items: own.map(function (i) { return { PartName: i.PartName, Qty: i.Qty }; })
      };
    });

    const partCount = shaped.reduce(function (n, c) { return n + c.Items.length; }, 0);
    const record = sendMail_({
      code: TEMPLATE.DAILY_DIGEST,
      to: to,
      refNo: refNo,
      claimIds: claims.map(function (c) { return c.ClaimID; }),
      isTest: false,
      linkQuery: 'page=batch&ref=' + refNo,
      linkLabel: 'Review This Batch',
      data: {
        RefNo: refNo,
        ClaimCount: claims.length,
        PartCount: partCount,
        VerifiedBy: Object.keys(verifiers).filter(String).join(', '),
        Claims: shaped,
        // Present at the top level so a rewritten template can reference the
        // first claim's fields directly without opening a section.
        ClaimID: shaped[0].ClaimID,
        WarrantyBasis: shaped[0].WarrantyBasis
      }
    });

    if (record.Status === 'Sent') {
      const stamp = nowIso_();
      claims.forEach(function (c) {
        update_(SHEET.CLAIMS, 'ClaimID', c.ClaimID, { PrincipalNotifiedAt: stamp });
      });
      sent++;
    }
  });

  return { sent: sent, claims: pending.length };
}

/** Administrator button for a batch that cannot wait for 17:00. */
function sendDigestNow_(session) {
  requireRole_(session, [ROLE.ADMIN]);
  const result = dispatchDigest_(session);
  audit_(session, 'ForwardToPrincipal', {
    field: 'DailyDigest', newValue: result.sent + ' batch(es), ' + result.claims + ' claim(s)'
  });
  return result;
}

function dailyMaintenance() {
  const removed = cleanUpExports_();
  const backup = backupSpreadsheet_();
  return { exportsRemoved: removed, backup: backup };
}

/** A copy a day. Cheap, and there is no other way back once a sheet is damaged. */
function backupSpreadsheet_() {
  const folder = childFolder_(rootFolder_(), FOLDER.BACKUP);
  const stamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const name = 'WarrantyClaims_' + stamp;

  const existing = folder.getFilesByName(name);
  if (existing.hasNext()) return name + ' (already present)';

  DriveApp.getFileById(ss_().getId()).makeCopy(name, folder);

  // Keep a fortnight; older copies are of no practical use and cost quota.
  const cutoff = Date.now() - 14 * 86400000;
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    if (f.getDateCreated().getTime() < cutoff) f.setTrashed(true);
  }
  return name;
}
