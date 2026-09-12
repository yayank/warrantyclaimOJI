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
