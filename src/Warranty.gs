/**
 * Warranty.gs — principal warranty from the serial number.
 *
 * The serial number carries the assembly month, and that is the only reliable
 * starting point: measured from the selling-in date the same units scatter
 * across 13-22 months, while assembly + 22 months matches 1,112 of the 1,113
 * XT units on file.
 *
 * The Status column on the warranty sheet is never read — 221 of its rows no
 * longer agree with their own exp date. For C-format units the exp column is
 * ignored too: it holds the selling date plus exactly 35 days on all 1,497 rows,
 * a blanket figure that reflects no warranty rule at all.
 */

const XT_PATTERN = /^([A-Z]{2})(\d{2})(\d{2})(\d+)$/;
const C_PATTERN = /^C(\d{2})([A-L])P([A-Z])(\d+)$/;

/** Returns {family, year, month} or null when the serial number is unreadable. */
function parseSerial_(serial) {
  const sn = String(serial || '').trim().toUpperCase();
  if (!sn) return null;

  const c = C_PATTERN.exec(sn);
  if (c) {
    return {
      family: 'C',
      year: 2000 + Number(c[1]),
      month: c[2].charCodeAt(0) - 64, // A = January … L = December
      productCode: c[3]
    };
  }

  const x = XT_PATTERN.exec(sn);
  if (x) {
    const month = Number(x[3]);
    if (month < 1 || month > 12) return null;
    return { family: x[1], year: 2000 + Number(x[2]), month: month };
  }
  return null;
}

function addMonths_(year, month, count) {
  const total = year * 12 + (month - 1) + count;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

function monthLabel_(year, month) {
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return names[month - 1] + ' ' + year;
}

function monthKey_(year, month) {
  return year + '-' + padLeft_(month, 2);
}

/** A warranty running to a month covers that whole month. */
function endOfMonth_(year, month) {
  return new Date(year, month, 0, 23, 59, 59);
}

/**
 * Determines the principal warranty for a serial number.
 * Returns {type, expiry, basis, assemblyMonth, daysRemaining, source}.
 */
function determineWarranty_(serial, today) {
  const now = today || new Date();
  const parsed = parseSerial_(serial);

  if (!parsed) {
    return {
      type: WARRANTY_TYPE.MANUAL,
      expiry: '',
      assemblyMonth: '',
      basis: 'Serial number format not recognised — administrator to verify',
      daysRemaining: null,
      source: 'unrecognised'
    };
  }

  const assembly = monthKey_(parsed.year, parsed.month);

  // Locally assembled units: the three month cover applies to the components the
  // principal shipped, and that shipping date exists nowhere in the data.
  if (parsed.family === 'C') {
    return {
      type: WARRANTY_TYPE.MANUAL,
      expiry: '',
      assemblyMonth: assembly,
      basis: 'Locally assembled unit (assembled ' + monthLabel_(parsed.year, parsed.month) +
        ') — administrator to verify component warranty',
      daysRemaining: null,
      source: 'local-assembly'
    };
  }

  if (parsed.family !== 'XT') {
    return {
      type: WARRANTY_TYPE.MANUAL,
      expiry: '',
      assemblyMonth: assembly,
      basis: 'Unknown serial number prefix "' + parsed.family + '" — administrator to verify',
      daysRemaining: null,
      source: 'unknown-prefix'
    };
  }

  const computed = addMonths_(parsed.year, parsed.month, XT_WARRANTY_MONTHS);
  let expiry = computed;
  let basis = 'assembled ' + monthLabel_(parsed.year, parsed.month) + ' + ' +
    XT_WARRANTY_MONTHS + ' months = valid until ' + monthLabel_(computed.year, computed.month);
  let source = 'formula';

  // The reference table records exceptions the formula cannot know about, so it
  // wins where the two disagree.
  const listed = warrantyTableExpiry_(serial);
  if (listed && (listed.year !== computed.year || listed.month !== computed.month)) {
    expiry = listed;
    basis = 'warranty table exception — valid until ' + monthLabel_(listed.year, listed.month) +
      ' (formula would give ' + monthLabel_(computed.year, computed.month) + ')';
    source = 'table';
  }

  const last = endOfMonth_(expiry.year, expiry.month);
  const active = now <= last;
  const days = Math.ceil((last.getTime() - now.getTime()) / 86400000);

  return {
    type: active ? WARRANTY_TYPE.PRINCIPAL : WARRANTY_TYPE.OUT,
    expiry: monthKey_(expiry.year, expiry.month),
    assemblyMonth: assembly,
    basis: basis,
    daysRemaining: active ? days : null,
    source: source
  };
}

/** Looks the serial number up in the reference table, reading only its exp date. */
function warrantyTableExpiry_(serial) {
  const index = warrantyIndex_();
  const hit = index[String(serial || '').trim().toUpperCase()];
  if (!hit) return null;
  const m = /^(\d{1,2})\/(\d{4})$/.exec(String(hit));
  if (!m) return null;
  return { year: Number(m[2]), month: Number(m[1]) };
}

function warrantyIndex_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('warrantyIndex');
  if (hit) return JSON.parse(hit);

  const index = {};
  readAll_(SHEET.WARRANTY).forEach(function (r) {
    const sn = String(r.Batch || '').trim().toUpperCase();
    if (sn && !index[sn]) index[sn] = r.Expired;
  });
  try {
    cache.put('warrantyIndex', JSON.stringify(index), 1800);
  } catch (e) {
    // Larger than the cache entry limit; recomputed each call instead.
  }
  return index;
}

/**
 * Product description and owning principal for a serial number, both taken from
 * the population sheet. The portal serves several principals, and which one a
 * unit belongs to decides who may see the claim and who receives it.
 */
function populationIndex_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('populationIndex');
  if (hit) return JSON.parse(hit);

  const index = {};
  readAll_(SHEET.POPULATION).forEach(function (r) {
    const sn = String(r.Batch || '').trim().toUpperCase();
    if (!sn || index[sn]) return;
    index[sn] = {
      product: String(r.ItemDescription || ''),
      principal: String(r.Principal || '').trim()
    };
  });
  try {
    cache.put('populationIndex', JSON.stringify(index), 1800);
  } catch (e) { /* oversized; recomputed next call */ }
  return index;
}

function productName_(serial) {
  const hit = populationIndex_()[String(serial || '').trim().toUpperCase()];
  return hit ? hit.product : '';
}

/**
 * Which principal owns this unit. An empty result is deliberate: a claim that
 * cannot be attributed is never routed to a principal on a guess — the
 * administrator assigns it instead.
 */
function principalFor_(serial) {
  const hit = populationIndex_()[String(serial || '').trim().toUpperCase()];
  return hit && hit.principal ? hit.principal : UNASSIGNED_PRINCIPAL;
}

/**
 * Everything the claim form shows the moment a serial number is typed: product,
 * warranty verdict with its working shown, and any open claim on the same unit.
 */
function lookupSerial_(session, serial) {
  const warranty = determineWarranty_(serial);
  const sn = String(serial || '').trim().toUpperCase();

  const openClaims = readLive_(SHEET.CLAIMS).filter(function (c) {
    return String(c.SerialNumber || '').trim().toUpperCase() === sn &&
      [STATUS.CLOSED, STATUS.DRAFT].indexOf(c.Status) === -1 &&
      isTrue_(c.IsTest) === session.isTester;
  });

  const items = readLive_(SHEET.ITEMS);
  const openParts = {};
  openClaims.forEach(function (c) {
    items.filter(function (i) { return i.ClaimID === c.ClaimID; }).forEach(function (i) {
      // A part rejected or already shipped is settled — re-claiming it is legitimate.
      if ([ITEM_STATUS.REJECTED, ITEM_STATUS.SHIPPED].indexOf(i.ItemStatus) !== -1) return;
      openParts[i.PartID] = { claimId: c.ClaimID, status: c.Status, partName: i.PartName };
    });
  });

  return {
    serial: sn,
    productName: productName_(sn),
    principal: principalFor_(sn),
    warranty: warranty,
    openClaims: openClaims.map(function (c) {
      return { claimId: c.ClaimID, status: c.Status, customer: c.CustomerName };
    }),
    openParts: openParts
  };
}
