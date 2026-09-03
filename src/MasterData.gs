/**
 * MasterData.gs — reference lists.
 *
 * Claims reference master data by ID and keep a copy of the name as it read at
 * submission. That is what stops a rename stranding the history: the screen
 * shows today's name, the audit trail still shows what the principal actually
 * saw. Nothing here is ever deleted — entries are deactivated, so an old claim
 * stays readable.
 */

const MASTER = {
  users: { sheet: SHEET.USERS, key: 'Email', label: 'Name' },
  customers: { sheet: SHEET.CUSTOMER, key: 'CustomerID', label: 'Name', prefix: 'CUS' },
  parts: { sheet: SHEET.PART, key: 'PartID', label: 'Name', prefix: 'PART' },
  recipients: { sheet: SHEET.RECIPIENTS, key: 'RecipientID', label: 'Name', prefix: 'RCP' },
  principals: { sheet: SHEET.PRINCIPALS, key: 'PrincipalID', label: 'Name', prefix: 'PRN' }
};

/**
 * Principals are held by name rather than by ID, because the name is what
 * arrives in the population sheet the principal itself supplies. The master list
 * is the set of names the portal accepts; anything else in an import is flagged
 * rather than silently creating a new principal.
 */
function principalNames_() {
  return readAll_(SHEET.PRINCIPALS)
    .filter(function (p) { return isTrue_(p.Active); })
    .map(function (p) { return String(p.Name).trim(); })
    .filter(Boolean);
}

/**
 * Who to ask when something the portal will not accept needs a human — a
 * customer or a unit that is not on the master lists. Screens name the
 * administrator rather than telling the user to find one.
 */
function administrators_() {
  return readAll_(SHEET.USERS)
    .filter(function (u) { return u.Role === ROLE.ADMIN && isTrue_(u.Active); })
    .map(function (u) {
      const email = String(u.Email || '').trim();
      return { name: String(u.Name || '').trim() || email, email: email };
    })
    .filter(function (a) { return a.email; });
}

/** The same contact, as one sentence an error message can carry. */
function administratorContact_() {
  const admins = administrators_();
  if (!admins.length) return 'Please contact the portal administrator.';
  return 'Please contact the administrator: ' + admins.map(function (a) {
    return a.name + ' (' + a.email + ')';
  }).join(', ') + '.';
}

/** Lists master data every screen needs, cached because it barely changes. */
function referenceData_(session) {
  const customers = readAll_(SHEET.CUSTOMER)
    .filter(function (c) { return isTrue_(c.Active); })
    .filter(function (c) {
      // The internal entry is meaningless to a hospital-facing requester.
      return session.role === ROLE.PRODUCTION || c.Name !== PRODUCTION_CUSTOMER;
    })
    .map(function (c) { return { id: c.CustomerID, name: c.Name }; })
    .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });

  const parts = readAll_(SHEET.PART)
    .filter(function (p) { return isTrue_(p.Active); })
    .map(function (p) { return { id: p.PartID, name: p.Name }; })
    .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });

  const recipients = session.role === ROLE.ADMIN
    ? readAll_(SHEET.RECIPIENTS).filter(function (r) { return isTrue_(r.Active); })
      .map(function (r) {
        return {
          id: String(r.RecipientID), name: r.Name, email: r.Email,
          company: r.Company, principal: String(r.Principal || '').trim()
        };
      })
    : [];

  return {
    customers: customers,
    parts: parts,
    recipients: recipients,
    statuses: [STATUS.DRAFT, STATUS.SUBMITTED, STATUS.RETURNED, STATUS.IN_REVIEW,
      STATUS.INTERNAL, STATUS.FULFILMENT, STATUS.CLOSED],
    warrantyTypes: [WARRANTY_TYPE.PRINCIPAL, WARRANTY_TYPE.OUT, WARRANTY_TYPE.MANUAL,
      WARRANTY_TYPE.INTERNAL],
    principals: principalNames_(),
    productionCustomer: PRODUCTION_CUSTOMER,
    // Only the screens that fill a claim in need to name someone to ask; a
    // principal is a partner outside the office and has no such screen.
    administrators: session.role === ROLE.PRINCIPAL ? [] : administrators_()
  };
}

/** Administrator view: every row including inactive ones, plus usage counts. */
function listMaster_(session, kind) {
  requireRole_(session, [ROLE.ADMIN]);
  const def = MASTER[kind];
  if (!def) throw new Error('Unknown master data set.');

  const rows = readAll_(def.sheet);
  const usage = masterUsage_(kind);

  return rows.map(function (r) {
    const out = {};
    SCHEMA[def.sheet].forEach(function (h) { out[h] = r[h]; });
    out.Active = isTrue_(r.Active);
    out.__used = usage[String(r[def.key])] || 0;
    return out;
  });
}

function masterUsage_(kind) {
  const counts = {};
  if (kind === 'parts') {
    readLive_(SHEET.ITEMS).forEach(function (i) {
      counts[i.PartID] = (counts[i.PartID] || 0) + 1;
    });
  } else if (kind === 'customers') {
    readLive_(SHEET.CLAIMS).forEach(function (c) {
      counts[c.CustomerID] = (counts[c.CustomerID] || 0) + 1;
    });
  } else if (kind === 'users') {
    readLive_(SHEET.CLAIMS).forEach(function (c) {
      const e = String(c.RequesterEmail || '').toLowerCase();
      counts[e] = (counts[e] || 0) + 1;
    });
  } else if (kind === 'recipients') {
    readLive_(SHEET.ITEMS).forEach(function (i) {
      if (i.ForwardedTo) counts[i.ForwardedTo] = (counts[i.ForwardedTo] || 0) + 1;
    });
  } else if (kind === 'principals') {
    const byName = {};
    readLive_(SHEET.CLAIMS).forEach(function (c) {
      const n = String(c.Principal || '').trim();
      if (n) byName[n] = (byName[n] || 0) + 1;
    });
    readAll_(SHEET.PRINCIPALS).forEach(function (p) {
      counts[p.PrincipalID] = byName[String(p.Name).trim()] || 0;
    });
  }
  return counts;
}

function saveMaster_(session, kind, record) {
  requireRole_(session, [ROLE.ADMIN]);
  const def = MASTER[kind];
  if (!def) throw new Error('Unknown master data set.');

  return withLock_(function () {
    const keyValue = record[def.key];
    const existing = keyValue ? findBy_(def.sheet, def.key, keyValue) : null;

    if (kind === 'users') validateUsers_(record, existing);

    if (!existing) {
      const row = {};
      SCHEMA[def.sheet].forEach(function (h) { row[h] = record[h] === undefined ? '' : record[h]; });
      if (def.prefix && !row[def.key]) row[def.key] = nextMasterId_(def);
      if (row.Active === '') row.Active = true;
      if (SCHEMA[def.sheet].indexOf('CreatedAt') !== -1) row.CreatedAt = nowIso_();
      insert_(def.sheet, row);
      audit_(session, 'MasterDataChange', {
        field: kind + '.' + row[def.key], oldValue: '', newValue: row[def.label] || ''
      });
      clearReferenceCache_();
      return row;
    }

    const changes = [];
    const patch = {};
    SCHEMA[def.sheet].forEach(function (h) {
      if (record[h] === undefined || h === def.key) return;
      if (String(existing[h]) !== String(record[h])) {
        changes.push({ field: h, oldValue: existing[h], newValue: record[h] });
      }
      patch[h] = record[h];
    });
    const updated = update_(def.sheet, def.key, keyValue, patch);
    auditChanges_(session, 'MasterDataChange', '', changes.map(function (c) {
      return { field: kind + '.' + keyValue + '.' + c.field, oldValue: c.oldValue, newValue: c.newValue };
    }), record.__reason || '', false);
    clearReferenceCache_();
    return updated;
  });
}

function validateUsers_(record, existing) {
  const email = String(record.Email || '').trim().toLowerCase();
  if (!email || email.indexOf('@') === -1) throw new Error('Enter a valid email address.');
  const roles = [ROLE.REQUESTER, ROLE.PRODUCTION, ROLE.ADMIN, ROLE.PRINCIPAL, ROLE.TESTER];
  if (roles.indexOf(record.Role) === -1) throw new Error('Choose a valid role.');

  // Without a principal, a Principal account has no claims to see and no digest
  // to receive, so the account would simply not work.
  if (record.Role === ROLE.PRINCIPAL) {
    const principal = String(record.Principal || '').trim();
    if (!principal) throw new Error('A Principal account must be assigned to a principal.');
    if (principalNames_().indexOf(principal) === -1) {
      throw new Error('"' + principal + '" is not an active principal.');
    }
  }

  // Losing the last administrator would lock everyone out of master data.
  const admins = readAll_(SHEET.USERS).filter(function (u) {
    return u.Role === ROLE.ADMIN && isTrue_(u.Active);
  });
  const wasAdmin = existing && existing.Role === ROLE.ADMIN && isTrue_(existing.Active);
  const willBeAdmin = record.Role === ROLE.ADMIN && isTrue_(record.Active);
  if (wasAdmin && !willBeAdmin && admins.length <= 1) {
    throw new Error('At least one active administrator must remain.');
  }
}

function nextMasterId_(def) {
  let max = 0;
  readAll_(def.sheet).forEach(function (r) {
    const m = new RegExp('^' + def.prefix + '-(\\d+)$').exec(String(r[def.key] || ''));
    if (m) max = Math.max(max, Number(m[1]));
  });
  return def.prefix + '-' + padLeft_(max + 1, 3);
}

function clearReferenceCache_() {
  CacheService.getScriptCache().remove('settings');
  cacheRemoveLarge_('warrantyIndex');
  cacheRemoveLarge_('populationIndex');
  // The in-memory copies would otherwise outlive the import that replaced them.
  delete INDEX_MEMO.warranty;
  delete INDEX_MEMO.population;
}

/* ------------------------------------------------------------- unit data */

/**
 * The registered units the claim form offers as its serial number list.
 *
 * Fetched on demand rather than at sign-in: every screen needs the customer
 * list, only the claim form needs several thousand serial numbers, and the
 * browser holds them for the rest of the session once it has them.
 */
function unitOptions_(session) {
  requireRole_(session, [ROLE.REQUESTER, ROLE.PRODUCTION, ROLE.ADMIN]);
  return { units: populationUnits_() };
}

function listUnits_(session, filter) {
  requireRole_(session, [ROLE.ADMIN]);
  const f = filter || {};
  let rows = readAll_(SHEET.WARRANTY);
  if (f.search) {
    const q = String(f.search).toUpperCase();
    rows = rows.filter(function (r) { return String(r.Batch).toUpperCase().indexOf(q) !== -1; });
  }
  return {
    total: rows.length,
    rows: rows.slice(0, f.limit || 200).map(function (r) {
      const w = determineWarranty_(r.Batch);
      return {
        serialNumber: r.Batch,
        sellingInDate: formatDate_(r.SellingInDate),
        material: r.Material,
        product: productName_(r.Batch),
        principal: principalFor_(r.Batch),
        computedType: w.type,
        computedBasis: w.basis
      };
    })
  };
}

/**
 * Replaces the unit reference sheets from an uploaded workbook. Row-by-row
 * editing would be the wrong shape for 2,610 rows that arrive from the
 * principal as a file.
 */
function importUnits_(session, payload) {
  requireRole_(session, [ROLE.ADMIN]);
  if (!payload || !payload.data) throw new Error('No file was received.');

  const blob = Utilities.newBlob(
    Utilities.base64Decode(payload.data),
    payload.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    payload.fileName || 'units.xlsx'
  );
  const file = Drive.Files.insert(
    { title: 'import-' + Date.now(), mimeType: MimeType.GOOGLE_SHEETS }, blob
  );

  try {
    const book = SpreadsheetApp.openById(file.id);
    const result = { warranty: 0, population: 0 };

    [
      { from: SHEET.WARRANTY, to: SHEET.WARRANTY, key: 'warranty' },
      { from: SHEET.POPULATION, to: SHEET.POPULATION, key: 'population' }
    ].forEach(function (spec) {
      const source = book.getSheetByName(spec.from);
      if (!source || source.getLastRow() < 2) return;
      const values = source.getRange(1, 1, source.getLastRow(), source.getLastColumn()).getValues();
      const target = sheet_(spec.to);
      if (target.getLastRow() > 1) {
        target.getRange(2, 1, target.getLastRow() - 1, target.getLastColumn()).clearContent();
      }
      const body = values.slice(1);
      if (body.length) target.getRange(2, 1, body.length, values[0].length).setValues(body);
      result[spec.key] = body.length;
    });

    clearReferenceCache_();
    audit_(session, 'MasterDataChange', {
      field: 'units.import',
      newValue: result.warranty + ' warranty rows, ' + result.population + ' population rows'
    });
    return result;
  } finally {
    Drive.Files.remove(file.id);
  }
}

/** Preview of what an import would replace, so nothing is overwritten blind. */
function previewUnitImport_(session, payload) {
  requireRole_(session, [ROLE.ADMIN]);
  return {
    currentWarranty: Math.max(0, sheet_(SHEET.WARRANTY).getLastRow() - 1),
    currentPopulation: Math.max(0, sheet_(SHEET.POPULATION).getLastRow() - 1),
    fileName: payload.fileName
  };
}

/**
 * Principal names present in the population sheet that the master list does not
 * recognise. Those units route to nobody, so this is worth surfacing.
 */
function unknownPrincipals_(session) {
  requireRole_(session, [ROLE.ADMIN]);
  const known = principalNames_();
  const seen = {};
  readAll_(SHEET.POPULATION).forEach(function (r) {
    const n = String(r.Principal || '').trim();
    if (n && known.indexOf(n) === -1) seen[n] = (seen[n] || 0) + 1;
  });
  const blank = readAll_(SHEET.POPULATION).filter(function (r) {
    return r.Batch && !String(r.Principal || '').trim();
  }).length;
  return {
    unknown: Object.keys(seen).map(function (n) { return { name: n, units: seen[n] }; }),
    unattributed: blank
  };
}
