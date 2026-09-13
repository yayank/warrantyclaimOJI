/**
 * Reports.gs — the warranty we absorb.
 *
 * The board's question is not "how many units are out of warranty". It is how
 * many the principal has stopped covering while we have not, because that is
 * the number that leaves the company. Until the claim carried two warranties
 * that quadrant looked exactly like "out of warranty, sell them the part", and
 * nothing could count it.
 *
 * COUNTS, NOT RUPIAH. There is no price anywhere in this portal — the spare
 * part master carries a name and nothing else — so this reports claims, units
 * and parts. A money column here would have to invent its own figures, and a
 * report the finance office cannot reconcile is worse than no report. Adding
 * prices is its own piece of work and starts at the master list.
 *
 * WHICH PARTS COUNT. Not everything asked for: a rejected part costs nobody
 * anything. What we are on the hook for is what was approved and not rejected,
 * and what has actually gone out is counted beside it — the difference is what
 * is still owed.
 */

/** Every way the same set gets cut, worked out in one pass over it. */
const COST_GROUPS = [
  { key: 'month', label: 'Month', of: function (r) { return String(r.sortDate || '').slice(0, 7); } },
  { key: 'product', label: 'Product', of: function (r) { return r.productName || '(not named)'; } },
  { key: 'principal', label: 'Principal', of: function (r) { return r.principal || '(unattributed)'; } },
  {
    key: 'distributor',
    label: 'Distributor',
    of: function (r) { return r.distributorName || '(sold direct, or not recorded)'; }
  },
  { key: 'customer', label: 'Hospital', of: function (r) { return r.customerName || '(none)'; } }
];

/** A claim that has not been submitted has not cost anybody anything yet. */
function countsAsCost_(row) {
  return row.costBorne && row.status !== STATUS.DRAFT;
}

function costPartsOf_(row) {
  const items = row.items || [];
  return {
    parts: items.filter(function (i) { return i.itemStatus !== ITEM_STATUS.REJECTED; }).length,
    shipped: items.filter(function (i) { return i.itemStatus === ITEM_STATUS.SHIPPED; }).length
  };
}

/**
 * What we have absorbed, cut every way at once.
 *
 * All five cuts come back together because the whole set has already been read
 * to build any one of them; making the screen ask again per cut would be four
 * more reads of the claims sheet to answer a question already answered.
 */
function costReport_(session, filter) {
  requireRole_(session, [ROLE.ADMIN]);
  const f = filter || {};

  // Through listClaims_ so that visibility, the date range and the test-data
  // rule are the same ones the claims screen applies — and with no limit, ever:
  // a report of the first fifty claims is a wrong report, not a short one.
  const wanted = {
    tab: 'all',
    items: 'all',
    from: f.from || '',
    to: f.to || '',
    principal: f.principal || '',
    distributorId: f.distributorId || ''
  };

  // What counts is decided in one place, countsAsCost_, rather than half here
  // in a filter and half there in a rule. Two definitions of the same thing
  // drift, and the one that drifts is the one nobody is testing.
  const rows = listClaims_(session, wanted).rows.filter(countsAsCost_);

  const groups = {};
  COST_GROUPS.forEach(function (g) { groups[g.key] = {}; });
  const serials = {};
  let parts = 0;
  let shipped = 0;

  rows.forEach(function (row) {
    const counted = costPartsOf_(row);
    parts += counted.parts;
    shipped += counted.shipped;
    if (row.serialNumber) serials[row.serialNumber] = true;

    COST_GROUPS.forEach(function (g) {
      const key = g.of(row);
      const bucket = groups[g.key][key] ||
        (groups[g.key][key] = { key: key, claims: 0, parts: 0, shipped: 0, units: {} });
      bucket.claims++;
      bucket.parts += counted.parts;
      bucket.shipped += counted.shipped;
      if (row.serialNumber) bucket.units[row.serialNumber] = true;
    });
  });

  const shape = function (g) {
    return Object.keys(groups[g.key]).map(function (key) {
      const b = groups[g.key][key];
      return {
        key: b.key, claims: b.claims, parts: b.parts, shipped: b.shipped,
        units: Object.keys(b.units).length
      };
    }).sort(function (a, b) {
      // Months read forwards; everything else is a league table, biggest first.
      if (g.key === 'month') return String(a.key).localeCompare(String(b.key));
      return b.parts - a.parts || String(a.key).localeCompare(String(b.key));
    });
  };

  const cuts = {};
  COST_GROUPS.forEach(function (g) { cuts[g.key] = shape(g); });

  return {
    from: f.from || '',
    to: f.to || '',
    totals: {
      claims: rows.length,
      units: Object.keys(serials).length,
      parts: parts,
      shipped: shipped
    },
    groups: COST_GROUPS.map(function (g) { return { key: g.key, label: g.label }; }),
    cuts: cuts,
    rows: rows.map(function (row) {
      const counted = costPartsOf_(row);
      return {
        claimId: row.claimId,
        refNo: row.refNo,
        date: row.submittedAt || row.createdAt,
        status: row.status,
        productName: row.productName,
        serialNumber: row.serialNumber,
        principal: row.principal,
        customerName: row.customerName,
        distributorName: row.distributorName,
        parts: counted.parts,
        shipped: counted.shipped,
        warrantyExpiry: row.warrantyExpiry,
        customerWarrantyExpiry: row.customerWarrantyExpiry
      };
    }).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); })
  };
}

/** The same report as a workbook: one sheet, the cuts above the claims. */
function exportCostReport_(session, filter) {
  const report = costReport_(session, filter);
  const range = (report.from || 'awal') + ' — ' + (report.to || 'kini');

  const rows = [
    ['Warranty absorbed by us', range],
    ['Claims', report.totals.claims, 'Units', report.totals.units,
      'Parts', report.totals.parts, 'Shipped', report.totals.shipped],
    []
  ];

  report.groups.forEach(function (g) {
    rows.push([g.label, 'Claims', 'Units', 'Parts', 'Shipped']);
    report.cuts[g.key].forEach(function (b) {
      rows.push([b.key, b.claims, b.units, b.parts, b.shipped]);
    });
    rows.push([]);
  });

  rows.push(['Claim', 'Reference', 'Date', 'Principal', 'Product', 'Serial number',
    'Hospital', 'Distributor', 'Parts', 'Shipped',
    'Principal warranty ended', 'Our warranty ends']);
  report.rows.forEach(function (r) {
    rows.push([r.claimId, r.refNo, r.date, r.principal, r.productName, r.serialNumber,
      r.customerName, r.distributorName, r.parts, r.shipped,
      r.warrantyExpiry, r.customerWarrantyExpiry]);
  });

  return writeWorkbook_('Biaya-garansi-diserap ' + range, 'Cost borne', rows);
}
