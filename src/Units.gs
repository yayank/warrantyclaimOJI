/**
 * Units.gs — the register of units, and the warranty dates kept on it.
 *
 * WarrantyRules.gs works out a warranty. This decides where the answer is kept
 * and when it is worked out again, which is a separate question and the one
 * that decides what the claims list costs.
 *
 * WHY THE ANSWER IS STORED ON THE UNIT
 *
 * Exactly the discipline the summary columns on a claim row follow, and for the
 * same reason: a screen that resolved every warranty as it drew would read the
 * rules and the population sheet once per row. So the dates are written onto
 * the unit and read from there — and, like the summary columns, they are always
 * recomputed from source and never adjusted, because a copy of the truth is
 * only safe while it has one author.
 *
 * WHY A WHOLE COLUMN AT A TIME
 *
 * setCells_ writes one row cheaply when you already hold it, but nothing here
 * holds a population row: finding one means reading the sheet, and having read
 * it the cheap write is the whole column. Recomputing one unit and recomputing
 * all of them therefore cost the same single read, and there is one code path
 * rather than two that can disagree.
 *
 * WHY THE DATES ARE PARSED BY HAND
 *
 * The import files are written dd/mm/yyyy. To new Date(), "03/09/2025" is
 * 9 March; to the people who typed it, 3 September. Half a year apart, and
 * wrong without a symptom. parseLocalDate_ reads the day first and refuses
 * anything it cannot read that way.
 */

/** Written back by recomputeUnitWarranty_. Nothing else may write these. */
const UNIT_WARRANTY_COLS = [
  'AssemblyMonth',
  'WarrantyStartPrincipal', 'WarrantyEndPrincipal', 'WarrantyBasisPrincipal',
  'WarrantyStartCustomer', 'WarrantyEndCustomer', 'WarrantyBasisCustomer'
];

/* --------------------------------------------------------- reading a date */

const LOCAL_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/;

/**
 * A date from a person or a spreadsheet, as ISO text.
 *
 * Returns { iso, error }. Blank in is blank out with no error — a column
 * nobody filled in is not a mistake. Anything else that cannot be read as
 * dd/mm/yyyy is refused by name, so an import can say which row and why
 * instead of quietly storing a date half a year out.
 *
 * ISO is accepted as well, and only ISO: it is the one other shape that cannot
 * be misread, and it is what the sheet already holds. mm/dd/yyyy is not
 * accepted at any price — "03/09/2025" is a valid date read either way, so
 * accepting both would mean guessing, and guessing is the fault being fixed.
 */
function parseLocalDate_(value) {
  // Not `instanceof Date`: a Date handed over from another context is still a
  // Date, and this is the one place where treating it as a string would read
  // "Tue Sep 03 2025" as unparseable and drop a warranty on the floor.
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return { iso: '', error: 'not a readable date' };
    return {
      iso: value.getFullYear() + '-' + padLeft_(value.getMonth() + 1, 2) + '-' +
        padLeft_(value.getDate(), 2),
      error: ''
    };
  }

  const raw = String(value === null || value === undefined ? '' : value).trim();
  if (!raw) return { iso: '', error: '' };

  const iso = ISO_DATE.exec(raw);
  if (iso) {
    return realDate_(Number(iso[1]), Number(iso[2]), Number(iso[3]), raw);
  }

  const local = LOCAL_DATE.exec(raw);
  if (local) {
    return realDate_(Number(local[3]), Number(local[2]), Number(local[1]), raw);
  }

  return { iso: '', error: '"' + raw + '" is not a date — write it as dd/mm/yyyy' };
}

/** A calendar that agrees the date exists: 31/02 and 13/13 are not dates. */
function realDate_(year, month, day, raw) {
  if (month < 1 || month > 12) {
    return {
      iso: '',
      error: '"' + raw + '" has no month ' + month +
        ' — dates are read day first, as dd/mm/yyyy'
    };
  }
  const lastDay = new Date(year, month, 0).getDate();
  if (day < 1 || day > lastDay) {
    return { iso: '', error: '"' + raw + '" is not a day that exists in that month' };
  }
  return { iso: year + '-' + padLeft_(month, 2) + '-' + padLeft_(day, 2), error: '' };
}

/* --------------------------------------------------- the columns themselves */

/**
 * The seven computed columns for one unit row.
 *
 * Nothing here depends on today, which is what makes running it twice give the
 * same answer twice — the verdict does depend on today, and the verdict is not
 * stored.
 */
function unitWarrantyOf_(row) {
  const unit = unitRowToUnit_(row);
  const parsed = parseSerial_(unit.SerialNumber);
  const principal = resolveWarranty_(unit, WARRANTY_SCOPE.PRINCIPAL, new Date());
  const customer = resolveWarranty_(unit, WARRANTY_SCOPE.CUSTOMER, new Date());

  return {
    AssemblyMonth: parsed ? monthKey_(parsed.year, parsed.month) : '',
    WarrantyStartPrincipal: principal.start,
    WarrantyEndPrincipal: principal.expiry,
    WarrantyBasisPrincipal: principal.basis,
    WarrantyStartCustomer: customer.start,
    WarrantyEndCustomer: customer.expiry,
    WarrantyBasisCustomer: customer.basis
  };
}

/**
 * A population row as the rules engine reads a unit.
 *
 * The dates go through parseLocalDate_ on the way: a cell an administrator
 * typed by hand holds dd/mm/yyyy, and the engine compares dates as ISO text.
 * A cell that will not parse is left empty, which the engine reports as a
 * missing date rather than acting on.
 */
function unitRowToUnit_(row) {
  const r = row || {};
  return {
    SerialNumber: String(r.Batch || '').trim().toUpperCase(),
    Material: String(r.Material || '').trim().toUpperCase(),
    Channel: String(r.Channel || '').trim().toLowerCase(),
    DistributorID: String(r.DistributorID || '').trim(),
    CustomerID: String(r.CustomerID || '').trim(),
    SellingInDate: parseLocalDate_(r.SellingInDate).iso,
    ReceivedAtDistributor: parseLocalDate_(r.ReceivedAtDistributor).iso,
    InstalledAt: parseLocalDate_(r.InstalledAt).iso,
    ExtendedMonthsPrincipal: Number(r.ExtendedMonthsPrincipal) || 0,
    ExtendedMonthsCustomer: Number(r.ExtendedMonthsCustomer) || 0
  };
}

/**
 * Works the warranty columns out again and writes them back.
 *
 * `serials` narrows what is recomputed; leave it out for every unit. Either way
 * the sheet is read once and each column written once, so recomputing after one
 * edit and recomputing after an import of two thousand rows cost the same.
 *
 * A row nobody has to change is written back with exactly what it already had,
 * WarrantyComputedAt included — that stamp says when the answer last moved, not
 * when this last ran, so a rerun that changes nothing leaves nothing to explain.
 */
function recomputeUnitWarranty_(serials) {
  const wanted = serials && serials.length
    ? serials.reduce(function (set, sn) {
      set[String(sn || '').trim().toUpperCase()] = true;
      return set;
    }, {})
    : null;

  const s = sheet_(SHEET.POPULATION);
  const last = s.getLastRow();
  if (last < 2) return { units: 0, changed: 0 };

  const head = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
  const cols = UNIT_WARRANTY_COLS.map(function (name) { return head.indexOf(name); });
  const stampCol = head.indexOf('WarrantyComputedAt');
  const keyCol = head.indexOf('Batch');
  if (keyCol === -1 || stampCol === -1 || cols.indexOf(-1) !== -1) {
    throw new Error('The Population sheet has no warranty columns yet. Run setUp() first.');
  }

  const rows = s.getRange(2, 1, last - 1, head.length).getValues();
  const columns = UNIT_WARRANTY_COLS.map(function () { return []; });
  const stamps = [];
  const now = nowIso_();
  let units = 0;
  let changed = 0;

  rows.forEach(function (raw) {
    const serial = String(raw[keyCol] || '').trim().toUpperCase();
    const keep = !serial || (wanted && !wanted[serial]);
    if (keep) {
      // A blank spacing row, or a unit this call was not asked about. Put back
      // what is there: writing a computed blank over it would turn spacing into
      // data, and would recompute units nobody asked about.
      cols.forEach(function (col, n) { columns[n].push([raw[col]]); });
      stamps.push([raw[stampCol]]);
      return;
    }

    units++;
    const want = unitWarrantyOf_(rowToObject_(head, raw));
    let differs = false;
    UNIT_WARRANTY_COLS.forEach(function (name, n) {
      if (String(raw[cols[n]] === undefined ? '' : raw[cols[n]]) !== String(want[name])) {
        differs = true;
      }
      columns[n].push([want[name]]);
    });
    if (differs) changed++;
    stamps.push([differs ? now : raw[stampCol]]);
  });

  UNIT_WARRANTY_COLS.forEach(function (name, n) {
    s.getRange(2, cols[n] + 1, columns[n].length, 1).setValues(columns[n]);
  });
  s.getRange(2, stampCol + 1, stamps.length, 1).setValues(stamps);

  // The cached index still holds the old dates, and the next warranty question
  // would be answered from it — for half an hour, with nothing on any screen to
  // suggest why.
  cacheRemoveLarge_('populationIndex');
  delete INDEX_MEMO.population;
  return { units: units, changed: changed };
}

/* ==================================================== the register, as a screen */

/**
 * The columns an administrator may set. Everything else on a population row is
 * either the principal's own data or worked out from it.
 */
const UNIT_EDITABLE = ['Material', 'ItemDescription', 'Principal', 'ShipToParty',
  'SellingInDate', 'Channel', 'DistributorID', 'CustomerID',
  'ReceivedAtDistributor', 'InstalledAt',
  'ExtendedMonthsPrincipal', 'ExtendedMonthsCustomer', 'ContractRef', 'WarrantyNote'];

/** Of those, the three that hold a date and must never meet new Date(). */
const UNIT_DATE_FIELDS = ['SellingInDate', 'ReceivedAtDistributor', 'InstalledAt'];

/** The most rows one import call will write. See applyUnitUpdate_. */
const UNIT_IMPORT_MAX = 1000;

/**
 * One unit as the administration screen shows it: what is on the row, what was
 * worked out from it, and — when nothing could be — what is missing.
 *
 * The missing list is the point of the screen. "Manual verification required"
 * on two thousand units is a wall; "no installation date" on two thousand units
 * is an afternoon's work with an end to it.
 */
function unitAdminRow_(row) {
  const unit = unitRowToUnit_(row);
  const principal = resolveWarranty_(unit, WARRANTY_SCOPE.PRINCIPAL, new Date());
  const customer = resolveWarranty_(unit, WARRANTY_SCOPE.CUSTOMER, new Date());

  // A date nobody can read is worse than a blank one: the screen would show the
  // cell as filled in while the engine treats it as empty.
  const unreadable = [];
  UNIT_DATE_FIELDS.forEach(function (f) {
    const raw = row[f];
    if (raw !== '' && raw !== undefined && raw !== null && !parseLocalDate_(raw).iso) {
      unreadable.push(f + ' is not a date the portal can read: "' + raw + '"');
    }
  });

  const missing = unreadable
    .concat(principal.missing || [])
    .concat(customer.missing || []);

  return {
    serialNumber: unit.SerialNumber,
    material: unit.Material,
    product: String(row.ItemDescription || ''),
    principalName: String(row.Principal || '').trim(),
    customerId: unit.CustomerID,
    shipTo: String(row.ShipToParty || ''),
    channel: unit.Channel,
    distributorId: unit.DistributorID,
    distributorName: distributorName_(unit.DistributorID),
    sellingInDate: unit.SellingInDate,
    receivedAtDistributor: unit.ReceivedAtDistributor,
    installedAt: unit.InstalledAt,
    extendedMonthsPrincipal: unit.ExtendedMonthsPrincipal,
    extendedMonthsCustomer: unit.ExtendedMonthsCustomer,
    contractRef: String(row.ContractRef || ''),
    warrantyNote: String(row.WarrantyNote || ''),
    assemblyMonth: String(row.AssemblyMonth || ''),
    warrantyType: principal.type,
    warrantyEndPrincipal: principal.expiry,
    warrantyBasisPrincipal: principal.basis,
    customerWarrantyType: customer.type,
    warrantyEndCustomer: customer.expiry,
    warrantyBasisCustomer: customer.basis,
    computedAt: String(row.WarrantyComputedAt || ''),
    complete: missing.length === 0,
    missing: missing
  };
}

/**
 * The unit register, searchable and narrowable.
 *
 * `incomplete` is the filter that turns filling the data in from an open-ended
 * chore into a list that gets shorter. Combined with a distributor or a model it
 * is also a work order: these forty units, this one distributor, one email.
 */
function listUnits_(session, filter) {
  requireRole_(session, [ROLE.ADMIN]);
  const f = filter || {};
  const q = String(f.search || '').trim().toUpperCase();

  let rows = readAll_(SHEET.POPULATION)
    .filter(function (r) { return String(r.Batch || '').trim(); })
    .map(unitAdminRow_);

  if (q) {
    rows = rows.filter(function (r) {
      return [r.serialNumber, r.material, r.product, r.distributorName, r.shipTo,
        r.customerId].join(' ').toUpperCase().indexOf(q) !== -1;
    });
  }
  if (f.material) rows = rows.filter(function (r) { return r.material === f.material; });
  if (f.distributorId) {
    rows = rows.filter(function (r) { return r.distributorId === f.distributorId; });
  }
  if (isTrue_(f.incomplete)) rows = rows.filter(function (r) { return !r.complete; });

  const total = rows.length;
  const incomplete = rows.filter(function (r) { return !r.complete; }).length;
  const offset = Math.max(0, Number(f.offset) || 0);
  const limit = Math.min(Math.max(1, Number(f.limit) || 200), 500);

  return {
    total: total,
    incomplete: incomplete,
    offset: offset,
    rows: rows.slice(offset, offset + limit),
    materials: Object.keys(rows.reduce(function (set, r) {
      if (r.material) set[r.material] = true;
      return set;
    }, {})).sort()
  };
}

/* ------------------------------------------------------------ one unit at a time */

/**
 * Checks one unit's worth of values and hands back what to write.
 *
 * Returns { fields, errors }. Nothing is written from here: the same function
 * runs behind the single-unit form and behind the import preview, so what the
 * preview promises and what the import does cannot drift apart.
 */
function checkUnitFields_(payload, options) {
  const p = payload || {};
  const opts = options || {};
  const errors = [];
  const fields = {};

  UNIT_EDITABLE.forEach(function (name) {
    if (p[name] === undefined) return;               // not offered, not changed

    if (UNIT_DATE_FIELDS.indexOf(name) !== -1) {
      const read = parseLocalDate_(p[name]);
      if (read.error) { errors.push(name + ': ' + read.error); return; }
      fields[name] = read.iso;
      return;
    }

    if (name === 'ExtendedMonthsPrincipal' || name === 'ExtendedMonthsCustomer') {
      const raw = String(p[name] === null || p[name] === undefined ? '' : p[name]).trim();
      if (raw === '') { fields[name] = ''; return; }
      const n = Number(raw);
      if (!isFinite(n) || n < 0 || n !== Math.floor(n)) {
        errors.push(name + ': "' + raw + '" is not a whole number of months');
        return;
      }
      fields[name] = n;
      return;
    }

    fields[name] = String(p[name] === null || p[name] === undefined ? '' : p[name]).trim();
  });

  if (fields.Material !== undefined) fields.Material = String(fields.Material).toUpperCase();
  if (fields.Channel !== undefined) {
    fields.Channel = String(fields.Channel).toLowerCase();
    if (fields.Channel && [SALES_CHANNEL.DIRECT, SALES_CHANNEL.DISTRIBUTOR]
      .indexOf(fields.Channel) === -1) {
      errors.push('Channel: "' + fields.Channel + '" is neither direct nor distributor');
    }
  }

  // A model with no product row has no warranty rule either, so the unit would
  // be filed as unanswerable the moment it was saved.
  if (fields.Material && !opts.skipMaterial && !productsIndex_()[fields.Material]) {
    errors.push('Material: "' + fields.Material + '" is not on the product list');
  }
  if (fields.DistributorID && !distributorsIndex_()[fields.DistributorID]) {
    errors.push('DistributorID: "' + fields.DistributorID + '" is not on the distributor list');
  }

  // Saying it was sold through a distributor without saying which one leaves the
  // claim unable to name both parties, which is the one thing it must do.
  const channel = fields.Channel !== undefined ? fields.Channel : opts.currentChannel;
  const distributor = fields.DistributorID !== undefined
    ? fields.DistributorID : opts.currentDistributor;
  if (channel === SALES_CHANNEL.DISTRIBUTOR && !distributor) {
    errors.push('DistributorID: a unit sold through a distributor has to say which one');
  }

  return { fields: fields, errors: errors };
}

/**
 * Creates or updates one unit, then works its warranty out again.
 *
 * The recompute is not optional and not deferred: the dates on the row are what
 * every screen reads, and leaving them at yesterday's answer after changing the
 * date they were counted from is the whole failure this design exists to avoid.
 */
function saveUnit_(session, payload) {
  requireRole_(session, [ROLE.ADMIN]);
  const p = payload || {};
  const serial = String(p.Batch || p.serialNumber || '').trim().toUpperCase();
  if (!serial) throw new Error('A unit needs a serial number.');

  return withLock_(function () {
    const existing = findBy_(SHEET.POPULATION, 'Batch', serial);
    if (p.isNew && existing) {
      throw new Error(serial + ' is already on the register.');
    }
    if (!p.isNew && !existing) throw new Error(serial + ' is not on the register.');

    const checked = checkUnitFields_(p, {
      currentChannel: existing ? String(existing.Channel || '').toLowerCase() : '',
      currentDistributor: existing ? String(existing.DistributorID || '').trim() : ''
    });
    if (checked.errors.length) throw new Error(checked.errors.join('; '));

    if (existing) {
      const before = {};
      Object.keys(checked.fields).forEach(function (k) { before[k] = existing[k]; });
      setCells_(SHEET.POPULATION, 'Batch', serial, checked.fields);
      Object.keys(checked.fields).forEach(function (k) {
        if (String(before[k] === undefined ? '' : before[k]) === String(checked.fields[k])) return;
        audit_(session, 'MasterDataChange', {
          field: 'unit.' + serial + '.' + k,
          oldValue: before[k], newValue: checked.fields[k]
        });
      });
    } else {
      const row = Object.assign({ Batch: serial, DeliveryQuantity: 1 }, checked.fields);
      insert_(SHEET.POPULATION, row);
      audit_(session, 'MasterDataChange', {
        field: 'unit.' + serial, newValue: 'registered'
      });
    }

    clearReferenceCache_();
    recomputeUnitWarranty_([serial]);
    resolveUnitRequests_(session);
    return unitAdminRow_(findBy_(SHEET.POPULATION, 'Batch', serial));
  });
}

/* ------------------------------------------------------------------ in bulk */

/**
 * What an import would do, said before it does any of it.
 *
 * Every row is checked and nothing is written. A row the portal will not accept
 * comes back with its line number and the reason, because "the import failed"
 * on a two thousand row file is not something anybody can act on.
 *
 * A serial number the register has never heard of is refused rather than
 * created. This fills columns in on units that exist; adding a unit is a
 * decision with a person behind it, and it has a form of its own.
 */
function previewUnitUpdate_(session, payload) {
  requireRole_(session, [ROLE.ADMIN]);
  const rows = (payload && payload.rows) || [];
  const known = {};
  readAll_(SHEET.POPULATION).forEach(function (r) {
    const sn = String(r.Batch || '').trim().toUpperCase();
    if (sn) known[sn] = r;
  });

  const accepted = [];
  const rejected = [];
  const seen = {};

  rows.forEach(function (row, i) {
    const line = Number(row.__line) || (i + 2);
    const serial = String(row.Batch || '').trim().toUpperCase();
    if (!serial) {
      rejected.push({ line: line, serial: '', reasons: ['no serial number in this row'] });
      return;
    }
    if (!known[serial]) {
      rejected.push({
        line: line, serial: serial,
        reasons: [serial + ' is not on the unit register — register it first']
      });
      return;
    }
    if (seen[serial]) {
      rejected.push({
        line: line, serial: serial,
        reasons: ['the same serial number appears earlier in this file, on line ' + seen[serial]]
      });
      return;
    }
    seen[serial] = line;

    const current = known[serial];
    const checked = checkUnitFields_(row, {
      currentChannel: String(current.Channel || '').toLowerCase(),
      currentDistributor: String(current.DistributorID || '').trim()
    });
    if (checked.errors.length) {
      rejected.push({ line: line, serial: serial, reasons: checked.errors });
      return;
    }

    const changes = {};
    Object.keys(checked.fields).forEach(function (k) {
      const was = current[k] === undefined ? '' : current[k];
      if (String(was) !== String(checked.fields[k])) {
        changes[k] = { from: String(was), to: String(checked.fields[k]) };
      }
    });

    accepted.push({
      line: line, serial: serial,
      fields: checked.fields,
      changed: Object.keys(changes).length,
      changes: changes
    });
  });

  return {
    total: rows.length,
    accepted: accepted.length,
    unchanged: accepted.filter(function (a) { return !a.changed; }).length,
    rejected: rejected,
    sample: accepted.filter(function (a) { return a.changed; }).slice(0, 20),
    max: UNIT_IMPORT_MAX
  };
}

/**
 * Writes what the preview accepted.
 *
 * One pass over the sheet and one write per column, whatever the file's size —
 * a round trip per row would not finish two thousand units inside the six
 * minutes an execution gets. A file larger than UNIT_IMPORT_MAX arrives in
 * waves, each one complete in itself, so an import that stops halfway has
 * written half the units properly rather than all of them badly.
 */
function applyUnitUpdate_(session, payload) {
  requireRole_(session, [ROLE.ADMIN]);
  const p = payload || {};
  const rows = (p.rows || []).slice(0, UNIT_IMPORT_MAX);

  return withLock_(function () {
    const checked = previewUnitUpdate_(session, { rows: rows });
    if (checked.rejected.length) {
      throw new Error('This batch still has ' + checked.rejected.length +
        ' row(s) the portal will not accept. Run the preview again.');
    }

    const accepted = {};
    rows.forEach(function (row) {
      const serial = String(row.Batch || '').trim().toUpperCase();
      if (!serial) return;
      const one = checkUnitFields_(row, {});
      accepted[serial] = one.fields;
    });

    const s = sheet_(SHEET.POPULATION);
    const last = s.getLastRow();
    const head = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
    const keyCol = head.indexOf('Batch');
    const grid = s.getRange(2, 1, Math.max(0, last - 1), head.length).getValues();

    const touched = {};
    let written = 0;
    grid.forEach(function (raw) {
      const serial = String(raw[keyCol] || '').trim().toUpperCase();
      const fields = serial ? accepted[serial] : null;
      if (!fields) return;
      written++;
      Object.keys(fields).forEach(function (name) {
        const col = head.indexOf(name);
        if (col === -1) return;
        raw[col] = fields[name];
        touched[name] = true;
      });
    });

    // One write per column that actually changed, rather than one per row.
    Object.keys(touched).forEach(function (name) {
      const col = head.indexOf(name);
      s.getRange(2, col + 1, grid.length, 1).setValues(grid.map(function (raw) {
        return [raw[col]];
      }));
    });

    audit_(session, 'MasterDataChange', {
      field: 'units.update',
      newValue: written + ' unit(s), ' + Object.keys(touched).join(', ')
    });

    clearReferenceCache_();
    const recomputed = recomputeUnitWarranty_(Object.keys(accepted));
    resolveUnitRequests_(session);
    return {
      written: written,
      columns: Object.keys(touched),
      recomputed: recomputed.changed,
      remaining: Math.max(0, (p.rows || []).length - rows.length)
    };
  });
}

/* ============================================ units the register has never seen */

/**
 * Opens — or refreshes — the request to register a unit.
 *
 * One row per draft, not one per serial number: two engineers finding the same
 * unregistered machine each have a claim waiting, and each has to be told when
 * it can go through. Pressing Submit again on the same draft updates the row it
 * already has rather than filling the queue with copies of one request.
 */
function openUnitRequest_(session, claim) {
  const serial = String(claim.SerialNumber || '').trim().toUpperCase();
  const existing = readSheetRows_(SHEET.UNIT_REQUESTS).filter(function (r) {
    return String(r.ClaimID) === String(claim.ClaimID) &&
      r.Status === UNIT_REQUEST_STATUS.OPEN;
  })[0];

  const fields = {
    SerialNumber: serial,
    ProductGuess: String(claim.ProductName || ''),
    CustomerID: String(claim.CustomerID || ''),
    CustomerName: String(claim.CustomerName || ''),
    DistributorID: String(claim.DistributorID || ''),
    Note: String(claim.ProblemDescription || '').slice(0, 500),
    DriveFolderId: String(claim.DriveFolderId || ''),
    ClaimID: String(claim.ClaimID),
    Status: UNIT_REQUEST_STATUS.OPEN,
    RequestedBy: session.email,
    RequestedByName: session.name || session.email,
    RequestedAt: nowIso_()
  };

  let row;
  if (existing) {
    setCells_(SHEET.UNIT_REQUESTS, 'RequestID', existing.RequestID, fields);
    row = Object.assign({}, existing, fields);
  } else {
    row = Object.assign({ RequestID: nextId_(SHEET.UNIT_REQUESTS, 'RequestID', 'UR') },
      fields, { HandledBy: '', HandledAt: '', Outcome: '' });
    insert_(SHEET.UNIT_REQUESTS, row);
  }

  audit_(session, 'UnitRequest', {
    claimId: claim.ClaimID, field: 'unit.' + serial,
    newValue: 'registration requested', isTest: isTrue_(claim.IsTest)
  });

  // Both, and the owner asked for both: the queue is where it gets worked, the
  // email is what stops it waiting a day for somebody to open that screen.
  // Somebody is standing in front of a broken machine.
  sendMail_({
    code: TEMPLATE.UNIT_REQUEST,
    to: adminEmails_(),
    claimIds: [claim.ClaimID],
    isTest: isTrue_(claim.IsTest),
    testRedirectTo: session.email,
    linkQuery: 'page=master&kind=requests',
    linkLabel: 'Open the registration queue',
    data: {
      SerialNumber: serial,
      ProductGuess: row.ProductGuess || 'not known',
      Customer: row.CustomerName,
      Distributor: distributorName_(row.DistributorID) || 'sold direct, or not recorded',
      ClaimID: row.ClaimID,
      RequesterName: row.RequestedByName,
      RequestedAt: formatDate_(row.RequestedAt),
      Note: row.Note
    }
  });

  return row;
}

/** The queue, and by default only what is still waiting. */
function listUnitRequests_(session, filter) {
  requireRole_(session, [ROLE.ADMIN]);
  const f = filter || {};
  const rows = readSheetRows_(SHEET.UNIT_REQUESTS).filter(function (r) {
    return f.all ? true : r.Status === UNIT_REQUEST_STATUS.OPEN;
  });
  return {
    open: readSheetRows_(SHEET.UNIT_REQUESTS).filter(function (r) {
      return r.Status === UNIT_REQUEST_STATUS.OPEN;
    }).length,
    rows: rows.map(function (r) {
      return {
        requestId: r.RequestID,
        serialNumber: r.SerialNumber,
        productGuess: r.ProductGuess,
        customerName: r.CustomerName,
        distributorName: distributorName_(r.DistributorID),
        note: r.Note,
        claimId: r.ClaimID,
        status: r.Status,
        requestedBy: r.RequestedBy,
        requestedByName: r.RequestedByName,
        requestedAt: r.RequestedAt,
        handledBy: r.HandledBy,
        handledAt: r.HandledAt,
        outcome: r.Outcome
      };
    }).sort(function (a, b) {
      return String(a.requestedAt).localeCompare(String(b.requestedAt));
    })
  };
}

/** How many are waiting, for the badge, without building the list. */
function openUnitRequestCount_() {
  return readSheetRows_(SHEET.UNIT_REQUESTS).filter(function (r) {
    return r.Status === UNIT_REQUEST_STATUS.OPEN;
  }).length;
}

function closeUnitRequest_(session, request, status, outcome, message) {
  const stamp = nowIso_();
  setCells_(SHEET.UNIT_REQUESTS, 'RequestID', request.RequestID, {
    Status: status, HandledBy: session.email, HandledAt: stamp, Outcome: outcome
  });
  audit_(session, 'UnitRequest', {
    claimId: request.ClaimID, field: 'unit.' + request.SerialNumber,
    oldValue: UNIT_REQUEST_STATUS.OPEN, newValue: status
  });
  sendMail_({
    code: TEMPLATE.UNIT_REQUEST_DONE,
    to: [request.RequestedBy],
    claimIds: [request.ClaimID],
    testRedirectTo: session.email,
    linkQuery: 'page=claim&id=' + request.ClaimID,
    linkLabel: 'Open the draft',
    data: {
      SerialNumber: request.SerialNumber,
      ClaimID: request.ClaimID,
      Outcome: outcome,
      Message: message,
      HandledBy: session.email,
      HandledAt: formatDate_(stamp)
    }
  });
}

/**
 * Closes every open request whose unit now exists.
 *
 * Deliberately not tied to the unit form: a unit can arrive through the form,
 * through the CSV update, or in the principal's own workbook, and a request
 * left open behind any one of those routes is a draft nobody ever hears about
 * again. So this asks the register rather than trusting the caller, and every
 * path that can add a unit calls it.
 */
function resolveUnitRequests_(session) {
  const open = readSheetRows_(SHEET.UNIT_REQUESTS).filter(function (r) {
    return r.Status === UNIT_REQUEST_STATUS.OPEN;
  });
  if (!open.length) return { resolved: 0 };

  let resolved = 0;
  open.forEach(function (request) {
    if (!isRegisteredUnit_(request.SerialNumber)) return;
    resolved++;
    closeUnitRequest_(session, request, UNIT_REQUEST_STATUS.REGISTERED, 'registered',
      'The unit has been registered. Your draft can now be submitted as it stands — ' +
      'nothing needs typing again.');
  });
  return { resolved: resolved };
}

/**
 * Turns a request down: the serial number is wrong, or the unit is not ours.
 *
 * The draft is left exactly where it is. It belongs to whoever wrote it, and
 * deciding what to do with it — correct the serial number, or abandon it — is
 * theirs, not the administrator's.
 */
function rejectUnitRequest_(session, payload) {
  requireRole_(session, [ROLE.ADMIN]);
  const reason = String((payload || {}).reason || '').trim();
  if (!reason) throw new Error('Turning a request down has to say why.');

  return withLock_(function () {
    const request = findBy_(SHEET.UNIT_REQUESTS, 'RequestID', (payload || {}).requestId);
    if (!request) throw new Error('Request not found.');
    if (request.Status !== UNIT_REQUEST_STATUS.OPEN) {
      throw new Error('That request has already been handled.');
    }
    closeUnitRequest_(session, request, UNIT_REQUEST_STATUS.REJECTED, 'not registered',
      'This unit was not registered: ' + reason + ' Your draft is still there — ' +
      'correct the serial number and submit it again.');
    return listUnitRequests_(session, {});
  });
}
