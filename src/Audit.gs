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

/* --------------------------------------------------------------- archives */

/*
 * The trail is never pruned — it is the document the business falls back on
 * when a claim is disputed — so it can only be moved aside. Rows from a year
 * that has finished live on a sheet of their own, and the working sheet holds
 * the current year alone, which is what keeps the Audit Log screen from
 * re-reading a decade every time it opens.
 *
 * Archive sheets are deliberately absent from SCHEMA: they come into existence
 * when a year rolls over, and listing them there would have setUp() report a
 * healthy spreadsheet as incomplete.
 */

function auditSheetName_(year) {
  return SHEET.AUDIT + '-' + year;
}

function auditYearOf_(row) {
  const t = String(row.Timestamp || '');
  return /^\d{4}/.test(t) ? t.substring(0, 4) : '';
}

function thisYear_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy');
}

/**
 * Every year the trail can be read for, newest first. Pass the working sheet's
 * rows if you have already read them; it is the one read worth not repeating.
 */
function auditYears_(currentRows) {
  const prefix = SHEET.AUDIT + '-';
  const found = {};
  found[thisYear_()] = true;
  ss_().getSheets().forEach(function (s) {
    const name = s.getName();
    if (name.indexOf(prefix) !== 0) return;
    const year = name.substring(prefix.length);
    if (/^\d{4}$/.test(year)) found[year] = true;
  });
  // A row still waiting to be moved is a year the screen must offer, or the
  // day before the trigger runs the old entries would be unreachable.
  (currentRows || readAll_(SHEET.AUDIT)).forEach(function (r) {
    const year = auditYearOf_(r);
    if (year) found[year] = true;
  });
  return Object.keys(found).sort().reverse();
}

/**
 * What identifies one entry when deciding whether it has already been archived.
 * LogID normally, but a row written before that column was filled has to be
 * recognised by its content or a re-run would copy it a second time.
 */
function auditKey_(row) {
  if (row.LogID) return 'id:' + row.LogID;
  return 'v:' + SCHEMA[SHEET.AUDIT].map(function (h) {
    return String(row[h] === undefined ? '' : row[h]);
  }).join('\u0000');
}

/** Drops entries the list already holds, counting duplicates rather than collapsing them. */
function dedupeAudit_(rows) {
  const seen = {};
  return rows.filter(function (r) {
    const k = auditKey_(r);
    if (seen[k]) return false;
    seen[k] = true;
    return true;
  });
}

function auditArchiveSheet_(year) {
  const name = auditSheetName_(year);
  const book = ss_();
  let s = book.getSheetByName(name);
  if (!s) {
    s = book.insertSheet(name);
    s.appendRow(SCHEMA[SHEET.AUDIT]);
    s.setFrozenRows(1);
  }
  return s;
}

/**
 * Moves finished years off the working sheet. Run daily; safe to run twice.
 *
 * The order is the whole point: every row is written to its archive first and
 * only then removed from the working sheet. A run that dies in between leaves
 * the row in both places, and the next run recognises it and skips the copy —
 * so the failure mode is a duplicate for a day, never an entry that is gone.
 */
function archiveAudit_() {
  return withLock_(function () {
    const current = thisYear_();
    const stale = readAll_(SHEET.AUDIT).filter(function (r) {
      const year = auditYearOf_(r);
      return year && year < current;
    });
    if (!stale.length) return { moved: 0, years: [] };

    const byYear = {};
    stale.forEach(function (r) {
      const year = auditYearOf_(r);
      (byYear[year] = byYear[year] || []).push(r);
    });

    const years = Object.keys(byYear).sort();
    years.forEach(function (year) {
      auditArchiveSheet_(year);
      const held = {};
      readSheetRows_(auditSheetName_(year)).forEach(function (r) {
        const k = auditKey_(r);
        held[k] = (held[k] || 0) + 1;
      });
      // Counted, not flagged: two entries that happen to read alike are two
      // entries, and treating them as one would leave one behind.
      const fresh = byYear[year].filter(function (r) {
        const k = auditKey_(r);
        if (held[k]) { held[k]--; return false; }
        return true;
      });
      if (fresh.length) insertMany_(auditSheetName_(year), fresh);
    });
    SpreadsheetApp.flush();

    deleteRows_(SHEET.AUDIT, stale.map(function (r) { return r.__row; }));
    return { moved: stale.length, years: years };
  });
}

/**
 * The entries for one year, wherever they are sitting.
 *
 * Both places are read because the move happens once a day: on the second of
 * January last year is still on the working sheet, and after the trigger runs
 * it is on the archive. Reading both makes the answer the same either way.
 */
function auditRowsForYear_(year, currentRows) {
  const current = currentRows || readAll_(SHEET.AUDIT);
  return dedupeAudit_(
    readSheetRows_(auditSheetName_(year)).concat(
      current.filter(function (r) { return auditYearOf_(r) === year; })));
}

/** Audit trail for one claim, newest first. */
function auditForClaim_(claimId) {
  // Every year, not just the current one: a claim opened in December and
  // disputed in February must still show what was done to it.
  const current = readAll_(SHEET.AUDIT);
  let all = [];
  auditYears_(current).forEach(function (year) {
    all = all.concat(readSheetRows_(auditSheetName_(year)));
  });
  return dedupeAudit_(all.concat(current))
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
  const current = readAll_(SHEET.AUDIT);
  const years = auditYears_(current);
  const year = f.year && years.indexOf(String(f.year)) !== -1 ? String(f.year) : years[0];
  let rows = auditRowsForYear_(year, current);

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
    years: years,
    year: year,
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
