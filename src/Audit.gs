/**
 * Audit.gs — the trail.
 *
 * The actor recorded is always the real signed-in address, even when a Tester is
 * simulating another role. Recording the simulated identity instead would make
 * the trail state something that never happened, and this is the document the
 * business relies on when a claim is disputed with the principal.
 */

function audit_(session, action, opts) {
  const o = opts || {};
  insert_(SHEET.AUDIT, {
    LogID: nextId_(SHEET.AUDIT, 'LogID', 'LOG'),
    Timestamp: nowIso_(),
    Actor: session.email,
    ActorRole: session.actualRole,
    SimulatedRole: session.simulatedRole || '',
    ClaimID: o.claimId || '',
    ItemID: o.itemId || '',
    Action: action,
    Field: o.field || '',
    OldValue: o.oldValue === undefined ? '' : String(o.oldValue),
    NewValue: o.newValue === undefined ? '' : String(o.newValue),
    Reason: o.reason || '',
    IsTest: !!o.isTest
  });
}

/** Writes one audit row per changed field. */
function auditChanges_(session, action, claimId, changes, reason, isTest) {
  const rows = changes.map(function (c) {
    return {
      LogID: '',
      Timestamp: nowIso_(),
      Actor: session.email,
      ActorRole: session.actualRole,
      SimulatedRole: session.simulatedRole || '',
      ClaimID: claimId,
      ItemID: c.itemId || '',
      Action: action,
      Field: c.field,
      OldValue: c.oldValue === undefined ? '' : String(c.oldValue),
      NewValue: c.newValue === undefined ? '' : String(c.newValue),
      Reason: reason || '',
      IsTest: !!isTest
    };
  });
  if (!rows.length) return;

  // One scan for the whole batch rather than one per row.
  const stamp = Utilities.formatDate(new Date(), TZ, 'yyMMdd');
  const head = 'LOG-' + stamp + '-';
  let max = 0;
  readAll_(SHEET.AUDIT).forEach(function (r) {
    const v = String(r.LogID || '');
    if (v.indexOf(head) === 0) {
      const n = parseInt(v.substring(head.length), 10);
      if (!isNaN(n) && n > max) max = n;
    }
  });
  rows.forEach(function (r, i) { r.LogID = head + padLeft_(max + i + 1, 4); });
  insertMany_(SHEET.AUDIT, rows);
}

/** Audit trail for one claim, newest first. */
function auditForClaim_(claimId) {
  return readAll_(SHEET.AUDIT)
    .filter(function (r) { return r.ClaimID === claimId; })
    .sort(function (a, b) { return String(b.Timestamp).localeCompare(String(a.Timestamp)); })
    .map(function (r) {
      return {
        timestamp: r.Timestamp,
        actor: r.Actor,
        role: r.SimulatedRole ? r.ActorRole + ' → ' + r.SimulatedRole : r.ActorRole,
        action: r.Action,
        field: r.Field,
        oldValue: r.OldValue,
        newValue: r.NewValue,
        reason: r.Reason
      };
    });
}

/** Paged audit view for the administrator screen. */
function listAudit_(session, filter) {
  requireRole_(session, [ROLE.ADMIN]);
  const f = filter || {};
  let rows = readAll_(SHEET.AUDIT);

  if (f.claimId) rows = rows.filter(function (r) { return r.ClaimID === f.claimId; });
  if (f.actor) {
    rows = rows.filter(function (r) {
      return String(r.Actor).toLowerCase().indexOf(String(f.actor).toLowerCase()) !== -1;
    });
  }
  if (f.action) rows = rows.filter(function (r) { return r.Action === f.action; });

  rows.sort(function (a, b) { return String(b.Timestamp).localeCompare(String(a.Timestamp)); });
  const limit = f.limit || 200;
  return {
    total: rows.length,
    rows: rows.slice(0, limit).map(function (r) {
      return {
        timestamp: r.Timestamp, actor: r.Actor, role: r.ActorRole,
        simulatedRole: r.SimulatedRole, claimId: r.ClaimID, itemId: r.ItemID,
        action: r.Action, field: r.Field, oldValue: r.OldValue,
        newValue: r.NewValue, reason: r.Reason, isTest: isTrue_(r.IsTest)
      };
    })
  };
}
