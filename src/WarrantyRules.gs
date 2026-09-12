/**
 * WarrantyRules.gs — the warranty terms, read from a sheet instead of a constant.
 *
 * Before this file the portal answered every warranty question with
 * XT_WARRANTY_MONTHS: 22 months from the assembly month, for every unit whose
 * serial number began with XT. That is one product's rule applied to a whole
 * portfolio. In reality each model carries its own term, the months are counted
 * from four different dates depending on which principal wrote the policy, and
 * there are two tiers to answer rather than one — what the principal still
 * covers for us, and what we still cover for whoever bought the unit.
 *
 * WHY THE RULES ARE DATA
 *
 * Adding a model must not need a deployment. The terms live in the
 * WarrantyRules sheet, one row per model per side per channel, and this file
 * only decides which row applies and does the arithmetic.
 *
 * WHY THE EFFECTIVE WINDOW IS MATCHED AGAINST THE UNIT, NOT AGAINST TODAY
 *
 * A policy that changed this year says nothing about a unit sold three years
 * ago. So EffectiveFrom/To are compared with the unit's own basis date. Enter
 * next year's terms today and nothing already on file moves.
 *
 * WHY A MISSING DATE IS AN ANSWER
 *
 * If the rule counts from the installation date and the unit has none, this
 * says so and stops. It never falls back to another date that happens to be
 * present — a warranty computed from the wrong date is wrong quietly, and
 * quietly wrong is what the portal is being fixed for. The owner decided this
 * on 12 Sep 2026; it is not an implementation preference.
 */

/** How the answer is phrased for a person, per basis. */
const BASIS_VERB = {};
BASIS_VERB[WARRANTY_BASIS.ASSEMBLY] = 'assembled';
BASIS_VERB[WARRANTY_BASIS.SELLING_IN] = 'shipped by the principal';
BASIS_VERB[WARRANTY_BASIS.RECEIVED] = 'received by the distributor';
BASIS_VERB[WARRANTY_BASIS.INSTALLATION] = 'installed';

/** What to say is missing, per basis. Actionable: it names the field to fill. */
const BASIS_MISSING = {};
BASIS_MISSING[WARRANTY_BASIS.ASSEMBLY] =
  'no assembly month — the serial number is not in a recognised format';
BASIS_MISSING[WARRANTY_BASIS.SELLING_IN] = 'no selling-in date on the unit';
BASIS_MISSING[WARRANTY_BASIS.RECEIVED] =
  'no date recorded for when the distributor received the unit';
BASIS_MISSING[WARRANTY_BASIS.INSTALLATION] =
  'no installation (BAST) date on the unit';

/* ------------------------------------------------------------- the indexes */

/**
 * Both indexes are held the way warrantyIndex_ is: memoised for the execution,
 * cached for the next one. Read readSheetRows_ rather than readAll_ — these
 * sheets do not exist until setUp() has run again on a spreadsheet that
 * predates them, and sheet_() throws on a sheet that is not there.
 */
function productsIndex_() {
  if (INDEX_MEMO.products) return INDEX_MEMO.products;

  const cached = cacheGetLarge_('productsIndex');
  if (cached) { INDEX_MEMO.products = cached; return cached; }

  const index = {};
  readSheetRows_(SHEET.PRODUCTS).forEach(function (r) {
    const material = String(r.Material || '').trim().toUpperCase();
    if (!material || index[material]) return;
    if (r.Active === false || String(r.Active).toUpperCase() === 'FALSE') return;
    index[material] = {
      name: String(r.Name || ''),
      principal: String(r.Principal || '').trim(),
      regulation: String(r.Regulation || '').trim(),
      serialPattern: String(r.SerialPattern || '').trim()
    };
  });
  cachePutLarge_('productsIndex', index, 1800);
  INDEX_MEMO.products = index;
  return index;
}

function ruleKey_(material, scope) {
  return String(material || '').trim().toUpperCase() + '|' +
    String(scope || '').trim().toLowerCase();
}

/**
 * Rules grouped by material and side, so picking one never scans the sheet.
 *
 * A row with an unusable Months is left out rather than guessed at. It will
 * surface as "no rule on file", which sends somebody to look at the sheet —
 * better than a number nobody can account for. The rules screen validates this
 * at the point of entry so it should not arise.
 */
function rulesIndex_() {
  if (INDEX_MEMO.rules) return INDEX_MEMO.rules;

  const cached = cacheGetLarge_('rulesIndex');
  if (cached) { INDEX_MEMO.rules = cached; return cached; }

  const index = {};
  readSheetRows_(SHEET.RULES).forEach(function (r) {
    if (r.Active === false || String(r.Active).toUpperCase() === 'FALSE') return;

    const material = String(r.Material || '').trim().toUpperCase();
    const scope = String(r.Scope || '').trim().toLowerCase();
    const basis = String(r.Basis || '').trim().toLowerCase();
    const months = Number(r.Months);

    if (!material) return;
    if (scope !== WARRANTY_SCOPE.PRINCIPAL && scope !== WARRANTY_SCOPE.CUSTOMER) return;
    if (!BASIS_VERB[basis]) return;
    if (!months || months < 0 || months !== Math.floor(months)) return;

    let channel = String(r.Channel || '').trim().toLowerCase();
    if (channel !== SALES_CHANNEL.DIRECT && channel !== SALES_CHANNEL.DISTRIBUTOR) {
      channel = SALES_CHANNEL.ANY;
    }

    const key = ruleKey_(material, scope);
    if (!index[key]) index[key] = [];
    index[key].push({
      ruleId: String(r.RuleID || ''),
      material: material,
      scope: scope,
      channel: channel,
      basis: basis,
      months: months,
      from: dateKey_(r.EffectiveFrom),
      to: dateKey_(r.EffectiveTo)
    });
  });

  cachePutLarge_('rulesIndex', index, 1800);
  INDEX_MEMO.rules = index;
  return index;
}

/** Both indexes, dropped so the next read sees what was just written. */
function forgetWarrantyRules_() {
  delete INDEX_MEMO.products;
  delete INDEX_MEMO.rules;
  cacheRemoveLarge_('productsIndex');
  cacheRemoveLarge_('rulesIndex');
}

/* ------------------------------------------------------------------- dates */

/**
 * A date as a sortable key, whatever shape the cell arrived in.
 *
 * Sheets hands back a Date for anything it decided was a date, cellValue_ turns
 * that into "2025-03-03T00:00:00", and a hand-typed cell is plain text. All
 * three have to compare with each other, so everything is cut back to
 * YYYY-MM-DD and a bare month is padded to its first day.
 */
function dateKey_(value) {
  const raw = String(value === null || value === undefined ? '' : value).trim();
  if (!raw) return '';
  const iso = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(raw);
  if (!iso) return '';
  return iso[1] + '-' + iso[2] + '-' + (iso[3] || '01');
}

/** Whether the unit's basis date falls inside a rule's window. */
function withinWindow_(at, from, to) {
  // No date to test with: the window cannot rule the row out, and the missing
  // date is reported separately rather than being disguised as "no rule".
  if (!at) return true;
  const key = dateKey_(at);
  if (from && key < from) return false;
  if (to && key > lastDayOf_(to)) return false;
  return true;
}

/** A window that ends in a month ends at the end of that month. */
function lastDayOf_(key) {
  const parts = String(key).split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = new Date(y, m, 0);
  return parts[0] + '-' + padLeft_(m, 2) + '-' + padLeft_(d.getDate(), 2);
}

/**
 * The date a rule counts from, at the precision the source has it.
 *
 * The assembly month is a month and nothing more — the serial number does not
 * carry a day — so it comes back as YYYY-MM and the arithmetic below keeps it
 * that way. Everything else is a real date.
 */
function basisDate_(unit, basis) {
  const u = unit || {};
  if (basis === WARRANTY_BASIS.ASSEMBLY) {
    const parsed = parseSerial_(u.SerialNumber || u.Batch || '');
    return parsed ? monthKey_(parsed.year, parsed.month) : '';
  }
  if (basis === WARRANTY_BASIS.SELLING_IN) return dateKey_(u.SellingInDate);
  if (basis === WARRANTY_BASIS.RECEIVED) return dateKey_(u.ReceivedAtDistributor);
  if (basis === WARRANTY_BASIS.INSTALLATION) return dateKey_(u.InstalledAt);
  return '';
}

/** Jan 2025 written for a person; a full date keeps its day. */
function dateLabel_(key) {
  const parts = String(key).split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
    'Oct', 'Nov', 'Dec'];
  const month = names[Number(parts[1]) - 1] || '?';
  if (parts.length < 3) return month + ' ' + parts[0];
  return Number(parts[2]) + ' ' + month + ' ' + parts[0];
}

/**
 * The end of cover, and the last instant of it.
 *
 * A month-based warranty covers the whole of its final month, which is what the
 * portal has always done. A date-based one runs to the same day of the month N
 * months later and covers that whole day; a start of 31 January lands on the
 * last day of the shorter month rather than spilling into the next one.
 */
function warrantyEnd_(start, months) {
  const parts = String(start).split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);

  if (parts.length < 3) {
    const end = addMonths_(y, m, months);
    return {
      key: monthKey_(end.year, end.month),
      last: endOfMonth_(end.year, end.month)
    };
  }

  const d = Number(parts[2]);
  const moved = addMonths_(y, m, months);
  const lastOfMonth = new Date(moved.year, moved.month, 0).getDate();
  const day = Math.min(d, lastOfMonth);
  return {
    key: moved.year + '-' + padLeft_(moved.month, 2) + '-' + padLeft_(day, 2),
    last: new Date(moved.year, moved.month - 1, day, 23, 59, 59)
  };
}

/* ------------------------------------------------------------ picking a rule */

/**
 * The rule that applies to this unit, or null.
 *
 * A rule naming a channel beats one that takes either; between two equally
 * specific rules the one that came into effect later wins, and a tie there is
 * broken by the later RuleID so the same sheet always gives the same answer.
 *
 * The unit is passed whole rather than a single date because the window is
 * matched against the basis date, and which date that is only becomes known
 * once a candidate rule is in hand. Two rules on the same model may count from
 * two different dates.
 */
function pickRule_(material, scope, channel, unit) {
  const list = rulesIndex_()[ruleKey_(material, scope)] || [];
  const want = String(channel || '').trim().toLowerCase();

  let best = null;
  list.forEach(function (rule) {
    if (rule.channel !== SALES_CHANNEL.ANY && rule.channel !== want) return;
    if (!withinWindow_(basisDate_(unit, rule.basis), rule.from, rule.to)) return;
    if (!best || rankRule_(rule) > rankRule_(best)) best = rule;
  });
  return best;
}

function rankRule_(rule) {
  // Specific channel first, then the later effective date, then the later id.
  return (rule.channel === SALES_CHANNEL.ANY ? '0' : '1') + '|' +
    (rule.from || '0000-00-00') + '|' + rule.ruleId;
}

/**
 * Why nothing was picked, in words somebody can act on.
 *
 * "Manual verification required" on its own tells a person that the portal has
 * given up, not what to do about it. This says which of the four things is
 * wrong: no rule at all, no rule for this channel, a unit that does not say
 * which channel it is, or a unit older than any rule on file.
 */
function whyNoRule_(material, scope, channel, unit) {
  const all = rulesIndex_()[ruleKey_(material, scope)] || [];
  const side = scope === WARRANTY_SCOPE.CUSTOMER ? 'customer' : 'principal';
  if (!all.length) {
    return ['no ' + side + ' warranty rule on file for material "' + material + '"'];
  }

  const want = String(channel || '').trim().toLowerCase();
  const forChannel = all.filter(function (r) {
    return r.channel === SALES_CHANNEL.ANY || r.channel === want;
  });
  if (!forChannel.length) {
    if (!want) {
      return ['the unit does not say whether it was sold direct or through a ' +
        'distributor, and every ' + side + ' rule for "' + material + '" names a channel'];
    }
    return ['no ' + side + ' rule for material "' + material + '" sold ' +
      (want === SALES_CHANNEL.DISTRIBUTOR ? 'through a distributor' : 'direct')];
  }

  const at = basisDate_(unit, forChannel[0].basis);
  return ['no ' + side + ' rule for material "' + material + '" covers ' +
    (at ? dateLabel_(at) : 'this unit') + ' — the rules on file start ' +
    dateLabel_(forChannel[0].from || '0000-01-01')];
}

/* ----------------------------------------------------------- the verdict */

function warrantyLabel_(scope, active) {
  if (active === null) return WARRANTY_TYPE.MANUAL;
  if (scope === WARRANTY_SCOPE.CUSTOMER) {
    return active ? CUSTOMER_WARRANTY_TYPE.IN : CUSTOMER_WARRANTY_TYPE.OUT;
  }
  return active ? WARRANTY_TYPE.PRINCIPAL : WARRANTY_TYPE.OUT;
}

function extendedMonths_(unit, scope) {
  const u = unit || {};
  const raw = scope === WARRANTY_SCOPE.CUSTOMER
    ? u.ExtendedMonthsCustomer : u.ExtendedMonthsPrincipal;
  const n = Number(raw);
  // Extended warranty only ever pushes an end date outwards. A negative figure
  // is somebody's typo, not a shortened warranty.
  return n > 0 && n === Math.floor(n) ? n : 0;
}

function manualVerdict_(scope, missing, rule) {
  return {
    type: WARRANTY_TYPE.MANUAL,
    active: null,
    start: '',
    expiry: '',
    basis: missing.join('; '),
    months: rule ? rule.months : null,
    source: rule ? 'rule' : 'none',
    ruleId: rule ? rule.ruleId : '',
    daysRemaining: null,
    missing: missing
  };
}

/**
 * One side of one unit's warranty.
 *
 * Returns the end date, never a status: "still under warranty" is a different
 * answer tomorrow morning, so what gets stored is the date and what gets shown
 * is computed from it. `missing` is empty on a real answer and says what to go
 * and fill in when there is not one.
 */
function resolveWarranty_(unit, scope, today) {
  const u = unit || {};
  const now = today || new Date();
  const material = String(u.Material || '').trim().toUpperCase();

  if (!material) {
    return manualVerdict_(scope, ['no material code on the unit'], null);
  }

  const channel = String(u.Channel || '').trim().toLowerCase();
  const rule = pickRule_(material, scope, channel, u);
  if (!rule) {
    return manualVerdict_(scope, whyNoRule_(material, scope, channel, u), null);
  }

  const start = basisDate_(u, rule.basis);
  if (!start) {
    return manualVerdict_(scope, [BASIS_MISSING[rule.basis] || 'no date to count from'], rule);
  }

  const extra = extendedMonths_(u, scope);
  const months = rule.months + extra;
  const end = warrantyEnd_(start, months);
  const active = now.getTime() <= end.last.getTime();

  const basis = BASIS_VERB[rule.basis] + ' ' + dateLabel_(start) + ' + ' +
    rule.months + ' months' +
    (extra ? ' + ' + extra + ' months extended' : '') +
    ' = valid until ' + dateLabel_(end.key);

  return {
    type: warrantyLabel_(scope, active),
    active: active,
    start: start,
    expiry: end.key,
    basis: basis,
    months: months,
    source: 'rule',
    ruleId: rule.ruleId,
    daysRemaining: active
      ? Math.ceil((end.last.getTime() - now.getTime()) / 86400000) : null,
    missing: []
  };
}

/**
 * The unit as the engine needs to see it, from the population index.
 *
 * One shape, built in one place — unitRowToUnit_ in Units.gs — whether the row
 * came from the cached index or was just read off the sheet. Two readings of
 * the same row is how a screen and a recompute end up disagreeing about a date.
 */
function unitOf_(serial) {
  const hit = populationIndex_()[String(serial || '').trim().toUpperCase()];
  return hit && hit.unit ? hit.unit : null;
}
