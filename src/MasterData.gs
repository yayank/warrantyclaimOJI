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
  principals: { sheet: SHEET.PRINCIPALS, key: 'PrincipalID', label: 'Name', prefix: 'PRN' },
  // The product list is keyed by the material code the principal's own file
  // uses, so there is no id to generate: the key is the thing being named.
  products: { sheet: SHEET.PRODUCTS, key: 'Material', label: 'Name' },
  rules: { sheet: SHEET.RULES, key: 'RuleID', label: 'Material', prefix: 'RULE' },
  distributors: { sheet: SHEET.DISTRIBUTORS, key: 'DistributorID', label: 'Name', prefix: 'DST' }
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
  } else if (kind === 'products') {
    readAll_(SHEET.POPULATION).forEach(function (u) {
      const m = String(u.Material || '').trim().toUpperCase();
      if (m) counts[m] = (counts[m] || 0) + 1;
    });
  } else if (kind === 'rules') {
    // How many units the rule stands over. Not how many it currently answers —
    // a rule whose date nobody has filled in yet still governs those units, and
    // showing zero would read as "safe to change".
    const byMaterial = {};
    readAll_(SHEET.POPULATION).forEach(function (u) {
      const m = String(u.Material || '').trim().toUpperCase();
      if (m) byMaterial[m] = (byMaterial[m] || 0) + 1;
    });
    readSheetRows_(SHEET.RULES).forEach(function (r) {
      counts[r.RuleID] = byMaterial[String(r.Material || '').trim().toUpperCase()] || 0;
    });
  } else if (kind === 'distributors') {
    readLive_(SHEET.CLAIMS).forEach(function (c) {
      const d = String(c.DistributorID || '').trim();
      if (d) counts[d] = (counts[d] || 0) + 1;
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

    // Most of these sets generate their own ids, so an "add" can never land on
    // an existing row. The product list is the exception: its key is the
    // material code a person types, and adding one that is already there would
    // silently overwrite the product rather than refusing.
    if (record.__isNew && existing) {
      throw new Error('"' + keyValue + '" is already on the list.');
    }

    if (kind === 'users') validateUsers_(record, existing);
    if (kind === 'products') validateProduct_(record, existing);
    if (kind === 'rules') validateRule_(record, existing);
    if (kind === 'distributors') validateDistributor_(record, existing);

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
      afterRuleChange_(kind);
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
    afterRuleChange_(kind);
    return updated;
  });
}

/**
 * A changed rule changes nothing until the units are worked out again.
 *
 * The dates on a unit row are what every screen reads, and they were worked out
 * under the rule as it stood. Without this, an administrator corrects a term
 * from 12 months to 24, sees no unit move, and has no way at all to find out
 * why. One pass over the register, which is what recomputing a single unit
 * costs anyway.
 */
function afterRuleChange_(kind) {
  if (kind !== 'rules' && kind !== 'products') return;
  recomputeUnitWarranty_(null);
}

/** A product row is the key to every rule, so its code has to be real. */
function validateProduct_(record, existing) {
  const material = String(record.Material || '').trim().toUpperCase();
  if (!material) throw new Error('A product needs a material code.');
  record.Material = material;
  if (!String(record.Name || '').trim()) throw new Error('A product needs a name.');
  const reg = String(record.Regulation || '').trim().toUpperCase();
  if (reg && ['AKD', 'AKL'].indexOf(reg) === -1) {
    throw new Error('Regulation is either AKD or AKL.');
  }
  record.Regulation = reg;
}

function validateDistributor_(record) {
  if (!String(record.Name || '').trim()) throw new Error('A distributor needs a name.');
  const email = String(record.Email || '').trim();
  if (email && email.indexOf('@') === -1) {
    throw new Error('"' + email + '" is not an email address.');
  }
  record.Email = email.toLowerCase();
}

/**
 * A warranty rule, checked before it can start answering for anybody.
 *
 * The last check is the one that matters and the reason this screen exists.
 * Two rules covering the same model, the same side and the same channel over
 * overlapping periods are not a preference the portal can settle: pickRule_
 * will choose one of them, deterministically and invisibly, and the other will
 * appear to have been ignored. So the overlap is refused here, naming the rule
 * it collides with, rather than accepted and resolved in silence.
 *
 * A rule taking either channel does NOT collide with one naming a channel:
 * pickRule_ prefers the specific one on purpose, and that is how a general term
 * with one exception is meant to be written.
 */
function validateRule_(record, existing) {
  const material = String(record.Material || '').trim().toUpperCase();
  if (!material) throw new Error('A rule has to say which model it is for.');
  if (!productsIndex_()[material]) {
    throw new Error('"' + material + '" is not on the product list. Add the product first.');
  }
  record.Material = material;

  const scope = String(record.Scope || '').trim().toLowerCase();
  if ([WARRANTY_SCOPE.PRINCIPAL, WARRANTY_SCOPE.CUSTOMER].indexOf(scope) === -1) {
    throw new Error('Scope is either "principal" or "customer".');
  }
  record.Scope = scope;

  const basis = String(record.Basis || '').trim().toLowerCase();
  const bases = [WARRANTY_BASIS.ASSEMBLY, WARRANTY_BASIS.SELLING_IN,
    WARRANTY_BASIS.RECEIVED, WARRANTY_BASIS.INSTALLATION];
  if (bases.indexOf(basis) === -1) {
    throw new Error('Basis is one of: ' + bases.join(', ') + '.');
  }
  record.Basis = basis;

  let channel = String(record.Channel || '').trim().toLowerCase();
  if (!channel) channel = SALES_CHANNEL.ANY;
  if ([SALES_CHANNEL.DIRECT, SALES_CHANNEL.DISTRIBUTOR, SALES_CHANNEL.ANY]
    .indexOf(channel) === -1) {
    throw new Error('Channel is "direct", "distributor", or blank for either.');
  }
  record.Channel = channel;

  const months = Number(record.Months);
  if (!isFinite(months) || months <= 0 || months !== Math.floor(months)) {
    throw new Error('Months has to be a whole number above zero.');
  }
  record.Months = months;

  const from = parseLocalDate_(record.EffectiveFrom);
  if (from.error) throw new Error('Effective from: ' + from.error);
  const to = parseLocalDate_(record.EffectiveTo);
  if (to.error) throw new Error('Effective to: ' + to.error);
  if (from.iso && to.iso && from.iso > to.iso) {
    throw new Error('The rule cannot stop being effective before it starts.');
  }
  record.EffectiveFrom = from.iso;
  record.EffectiveTo = to.iso;

  if (record.Active === '' || record.Active === undefined) record.Active = true;
  if (!isTrue_(record.Active)) return;              // a retired rule answers nobody

  const clash = overlappingRule_(record, existing);
  if (clash) {
    throw new Error('This overlaps ' + clash.RuleID + ' (' + clash.Material + ', ' +
      clash.Scope + ', ' + (clash.Channel || '*') + ', ' +
      describeWindow_(clash.EffectiveFrom, clash.EffectiveTo) +
      '). Two rules covering the same period would leave the portal choosing ' +
      'between them without saying so — close one of them off first.');
  }
}

function describeWindow_(from, to) {
  if (!from && !to) return 'no end dates';
  if (!from) return 'up to ' + to;
  if (!to) return 'from ' + from;
  return from + ' to ' + to;
}

/** The active rule this one would compete with, or null. */
function overlappingRule_(record, existing) {
  const mine = {
    from: record.EffectiveFrom || '0000-01-01',
    to: record.EffectiveTo || '9999-12-31'
  };
  const hits = readSheetRows_(SHEET.RULES).filter(function (r) {
    if (existing && String(r.RuleID) === String(existing.RuleID)) return false;
    if (!isTrue_(r.Active)) return false;
    if (String(r.Material || '').trim().toUpperCase() !== record.Material) return false;
    if (String(r.Scope || '').trim().toLowerCase() !== record.Scope) return false;
    const channel = String(r.Channel || '').trim().toLowerCase() || SALES_CHANNEL.ANY;
    if (channel !== record.Channel) return false;

    const theirs = {
      from: dateKey_(r.EffectiveFrom) || '0000-01-01',
      to: dateKey_(r.EffectiveTo) || '9999-12-31'
    };
    return mine.from <= theirs.to && theirs.from <= mine.to;
  });
  return hits[0] || null;
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

  // A distributor account belongs to the company, not to a person, and there
  // is exactly one of them. Two accounts for one distributor would each see
  // only what it filed itself — the company's history split down the middle,
  // with nothing on any screen to say why.
  const distributor = String(record.Distributor || '').trim();
  record.Distributor = distributor;
  if (distributor) {
    if (record.Role !== ROLE.REQUESTER) {
      throw new Error('Only a Requester account can belong to a distributor. ' +
        'Clear the distributor, or set the role to ' + ROLE.REQUESTER + '.');
    }
    if (!distributorsIndex_()[distributor]) {
      throw new Error('"' + distributor + '" is not on the distributor list.');
    }
    if (isTrue_(record.Active)) {
      const taken = readAll_(SHEET.USERS).filter(function (u) {
        return String(u.Distributor || '').trim() === distributor &&
          isTrue_(u.Active) &&
          String(u.Email || '').toLowerCase() !== email;
      })[0];
      if (taken) {
        throw new Error(distributorName_(distributor) + ' already has an account: ' +
          taken.Email + '. Deactivate that one first — a distributor has one ' +
          'account, and it is the company\'s rather than a person\'s.');
      }
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
    // Units arriving in the principal's own file close the requests waiting on
    // them just as surely as ones typed in by hand.
    resolveUnitRequests_(session);
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
