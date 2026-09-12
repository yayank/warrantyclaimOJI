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
 * Distributors, by ID, because that is what a unit row carries.
 *
 * The account is the company's, not a person's — whoever sits behind it may
 * change and the claim history stays where it is — so the name here is the
 * company name and nothing more.
 */
function distributorsIndex_() {
  const index = {};
  readSheetRows_(SHEET.DISTRIBUTORS).forEach(function (d) {
    const id = String(d.DistributorID || '').trim();
    if (id) index[id] = String(d.Name || '').trim();
  });
  return index;
}

function distributorName_(id) {
  const key = String(id || '').trim();
  return key ? (distributorsIndex_()[key] || '') : '';
}

function distributorList_() {
  return readSheetRows_(SHEET.DISTRIBUTORS)
    .filter(function (d) { return isTrue_(d.Active); })
    .map(function (d) {
      return { id: String(d.DistributorID || '').trim(), name: String(d.Name || '').trim() };
    })
    .filter(function (d) { return d.id; })
    .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
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
/**
 * The active customers a role may pick from, in name order.
 *
 * Not sent on sign-in any more — there are 1.386 of them, and every screen paid
 * for that list whether it named a customer or not. searchCustomers_ hands back
 * the few that match what is being typed instead.
 */
function customerOptions_(session) {
  return readAll_(SHEET.CUSTOMER)
    .filter(function (c) { return isTrue_(c.Active); })
    .filter(function (c) {
      // The internal entry is meaningless to a hospital-facing requester.
      return session.role === ROLE.PRODUCTION || c.Name !== PRODUCTION_CUSTOMER;
    })
    .map(function (c) { return { value: c.CustomerID, label: c.Name }; })
    .sort(function (a, b) { return String(a.label).localeCompare(String(b.label)); });
}

/**
 * A page of customers matching what has been typed.
 *
 * `total` is how many matched, not how many are returned: the box says how many
 * more there are so a search that is still too broad admits it rather than
 * looking like the whole answer.
 */
function searchCustomers_(session, payload) {
  const p = payload || {};
  const q = String(p.query || '').trim().toLowerCase();
  const limit = Math.min(Number(p.limit) || 40, 100);
  const all = customerOptions_(session);
  const hits = q
    ? all.filter(function (o) { return o.label.toLowerCase().indexOf(q) !== -1; })
    : all;
  return { options: hits.slice(0, limit), total: hits.length };
}

/** One customer by id, so a stored choice can still be named on screen. */
function customerById_(session, customerId) {
  const id = String(customerId || '');
  if (!id) return { option: null };
  const hit = customerOptions_(session).filter(function (o) { return o.value === id; })[0];
  return { option: hit || null };
}

function referenceData_(session) {
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
    parts: parts,
    recipients: recipients,
    statuses: [STATUS.DRAFT, STATUS.SUBMITTED, STATUS.RETURNED, STATUS.IN_REVIEW,
      STATUS.INTERNAL, STATUS.FULFILMENT, STATUS.CLOSED],
    warrantyTypes: [WARRANTY_TYPE.PRINCIPAL, WARRANTY_TYPE.OUT, WARRANTY_TYPE.MANUAL,
      WARRANTY_TYPE.INTERNAL],
    // What we still owe the buyer is not a principal's business, so neither is
    // the list of answers it can have.
    customerWarrantyTypes: session.role === ROLE.PRINCIPAL ? []
      : [CUSTOMER_WARRANTY_TYPE.IN, CUSTOMER_WARRANTY_TYPE.OUT, CUSTOMER_WARRANTY_TYPE.MANUAL],
    distributors: session.role === ROLE.PRINCIPAL ? [] : distributorList_(),
    principals: principalNames_(),
    productionCustomer: PRODUCTION_CUSTOMER,
    // Only the screens that fill a claim in need to name someone to ask; a
    // principal is a partner outside the office and has no such screen.
    administrators: session.role === ROLE.PRINCIPAL ? [] : administrators_()
  };
}

/**
 * Forgets cached settings and reference data.
 *
 * Settings are cached for five minutes, which is right in normal use and
 * exactly wrong while setting up: a corrected Client ID appears not to take
 * effect and the same authorization error keeps coming back. Run this from the
 * editor after changing anything in the Settings sheet.
 */
function clearReferenceCache_() {
  CacheService.getScriptCache().remove('settings');
  cacheRemoveLarge_('warrantyIndex');
  cacheRemoveLarge_('populationIndex');
  // The in-memory copies would otherwise outlive the import that replaced them.
  delete INDEX_MEMO.warranty;
  delete INDEX_MEMO.population;
  forgetWarrantyRules_();
}

/* ------------------------------------------------------------- unit data */

/**
 * Replaces the unit reference sheets from the workbook the principal sends.
 *
 * That file carries the principal's own columns and nothing else. The columns
 * an administrator fills in here — the sales channel, the installation date,
 * the extension months — and the warranty dates worked out from them are not in
 * it, and clearing the whole row before writing the file's columns back would
 * wipe every one of them on every import. So only the columns the file actually
 * brings are replaced, and the rest of each row is left where it is.
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
      const width = Math.min(values[0].length, target.getLastColumn());
      if (target.getLastRow() > 1) {
        target.getRange(2, 1, target.getLastRow() - 1, width).clearContent();
      }
      const body = values.slice(1).map(function (row) { return row.slice(0, width); });
      if (body.length) target.getRange(2, 1, body.length, width).setValues(body);
      result[spec.key] = body.length;
    });

    clearReferenceCache_();
    // The units that arrived are answered by whatever the rules say about them,
    // and until this runs their warranty columns are blank or belong to the
    // unit that used to sit on that row.
    const recomputed = recomputeUnitWarranty_(null);
    audit_(session, 'MasterDataChange', {
      field: 'units.import',
      newValue: result.warranty + ' warranty rows, ' + result.population + ' population rows'
    });
    result.recomputed = recomputed.changed;
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
