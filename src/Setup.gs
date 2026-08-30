/**
 * Setup.gs — first run and data migration.
 *
 * setUp() is safe to run more than once: it creates what is missing and leaves
 * everything else alone.
 */

/** Run once from the Apps Script editor after binding the spreadsheet. */
function setUp() {
  ensureSheets_();
  seedSettings_();
  seedProductionCustomer_();
  assignMasterIds_();
  const folder = rootFolder_();
  return [
    'Sheets ready.',
    'Drive root: ' + folder.getName() + ' (' + folder.getId() + ')',
    'Next: put your OAuth Client ID in Settings!GoogleClientId, add yourself to the users sheet',
    'as Administrator, deploy the web app, paste its URL into Settings!AppUrl, then run',
    'installTriggers().'
  ].join('\n');
}

function seedSettings_() {
  const defaults = {};
  defaults[SETTING_KEY.CLIENT_ID] = '';
  defaults[SETTING_KEY.ROOT_FOLDER] = '';
  defaults[SETTING_KEY.DIGEST_HOUR] = '17';
  defaults[SETTING_KEY.APP_URL] = '';

  const existing = {};
  readAll_(SHEET.SETTINGS).forEach(function (r) { existing[r.Key] = true; });
  Object.keys(defaults).forEach(function (k) {
    if (!existing[k]) insert_(SHEET.SETTINGS, { Key: k, Value: defaults[k] });
  });
  CacheService.getScriptCache().remove('settings');
}

function seedProductionCustomer_() {
  const found = readAll_(SHEET.CUSTOMER).some(function (c) { return c.Name === PRODUCTION_CUSTOMER; });
  if (found) return;
  insert_(SHEET.CUSTOMER, {
    CustomerID: nextMasterId_(MASTER.customers),
    Name: PRODUCTION_CUSTOMER,
    Active: true
  });
}

/**
 * Gives every customer and spare part an ID. Claims reference the ID from then
 * on, which is what keeps a later rename from stranding the history — the very
 * thing that left four part names in the old Log sheet with no master entry.
 */
function assignMasterIds_() {
  [MASTER.customers, MASTER.parts].forEach(function (def) {
    const rows = readAll_(def.sheet);
    const sheet = sheet_(def.sheet);
    const head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const keyCol = head.indexOf(def.key) + 1;
    const activeCol = head.indexOf('Active') + 1;

    let max = 0;
    rows.forEach(function (r) {
      const m = new RegExp('^' + def.prefix + '-(\\d+)$').exec(String(r[def.key] || ''));
      if (m) max = Math.max(max, Number(m[1]));
    });

    rows.forEach(function (r) {
      if (!r[def.key]) {
        max++;
        sheet.getRange(r.__row, keyCol).setValue(def.prefix + '-' + padLeft_(max, 3));
      }
      if (activeCol && r.Active === '') sheet.getRange(r.__row, activeCol).setValue(true);
    });
  });
}

/**
 * Migrates the historical Log sheet into Claims and ClaimItems.
 *
 * Old rows are preserved as they were recorded: the part name is copied across
 * even where no master entry matches, because the point of the history is what
 * was actually claimed, not what the master list says today.
 */
function migrateLegacyLog() {
  ensureSheets_();
  const book = ss_();
  const legacy = book.getSheetByName('Log');
  if (!legacy) return 'No Log sheet found — nothing to migrate.';
  if (readAll_(SHEET.CLAIMS).length) return 'Claims already contains data — migration skipped.';

  const values = legacy.getRange(1, 1, legacy.getLastRow(), legacy.getLastColumn()).getValues();
  const head = values[0].map(function (h) { return String(h).trim(); });
  const col = function (name) { return head.indexOf(name); };

  const customers = {};
  readAll_(SHEET.CUSTOMER).forEach(function (c) { customers[String(c.Name).trim()] = c; });
  const parts = {};
  readAll_(SHEET.PART).forEach(function (p) { parts[String(p.Name).trim().toLowerCase()] = p; });

  const claims = [];
  const items = [];
  const byRef = {};
  let seq = 0;

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const serial = String(row[col('SN')] || '').trim();
    if (!serial) continue;

    const customerName = String(row[col('Customer')] || '').trim();
    const partName = String(row[col('Sparepart')] || '').trim();
    const refNo = String(row[col('No Ref')] || '').trim();
    const problem = String(row[col('Problem')] || '').trim();

    // Rows sharing a reference number and serial number were one claim.
    const groupKey = refNo + '|' + serial;
    let claim = byRef[groupKey];

    if (!claim) {
      seq++;
      const requested = row[col('Request date')];
      const stamp = requested instanceof Date
        ? Utilities.formatDate(requested, TZ, 'yyMMdd')
        : Utilities.formatDate(new Date(), TZ, 'yyMMdd');
      const warranty = determineWarranty_(serial, requested instanceof Date ? requested : new Date());
      const customer = customers[customerName];

      claim = {
        ClaimID: 'CLM-' + stamp + '-' + padLeft_(seq, 4),
        RefNo: refNo,
        IsTest: /^q?wert|^123456/i.test(problem),
        CustomerID: customer ? customer.CustomerID : '',
        CustomerName: customerName,
        SerialNumber: serial.toUpperCase(),
        ProductName: productName_(serial),
        AssemblyMonth: warranty.assemblyMonth,
        WarrantyType: warranty.type,
        WarrantyExpiry: warranty.expiry,
        WarrantyBasis: warranty.basis,
        WarrantyOverridden: false,
        WarrantyOverrideReason: '',
        ProblemDescription: problem,
        WorkOrderNo: String(row[col('Work order')] || '').trim(),
        Status: legacyStatus_(String(row[col('Status')] || '').trim()),
        RequesterEmail: String(row[col('Email Requestor')] || '').trim().toLowerCase(),
        RequesterName: String(row[col('Email Requestor')] || '').trim(),
        CreatedAt: requested instanceof Date ? Utilities.formatDate(requested, TZ, "yyyy-MM-dd'T'HH:mm:ss") : '',
        SubmittedAt: requested instanceof Date ? Utilities.formatDate(requested, TZ, "yyyy-MM-dd'T'HH:mm:ss") : '',
        ForwardedAt: '', PrincipalNotifiedAt: '', ClosedAt: '',
        ReturnReason: String(row[col('reason')] || '').trim(),
        DriveFolderId: '',
        Deleted: false, DeletedBy: '', DeletedAt: '',
        UpdatedAt: nowIso_(), UpdatedBy: 'migration', RowVersion: 1
      };
      byRef[groupKey] = claim;
      claims.push(claim);
    }

    const master = parts[partName.toLowerCase()];
    items.push({
      ItemID: claim.ClaimID.replace('CLM-', 'ITM-') + '-' + padLeft_(
        items.filter(function (i) { return i.ClaimID === claim.ClaimID; }).length + 1, 2),
      ClaimID: claim.ClaimID,
      PartID: master ? master.PartID : '',
      PartName: partName,
      Qty: Number(row[col('qty')] || 1) || 1,
      ItemStatus: legacyItemStatus_(String(row[col('Status')] || '').trim()),
      DecisionBy: String(row[col('Approval')] || '').trim(),
      DecisionAt: '', DecisionReason: String(row[col('reason')] || '').trim(),
      AvailabilityDate: row[col('available date')] instanceof Date
        ? Utilities.formatDate(row[col('available date')], TZ, 'yyyy-MM-dd') : '',
      DocumentRefNo: String(row[col('Ref No Doc')] || '').trim(),
      ForwardedAt: '', ForwardedTo: '', ShippedAt: '', ShippedBy: '',
      PartReturnNote: String(row[col('Part return')] || '').trim(), PartReturnAt: '',
      Deleted: false, UpdatedAt: nowIso_(), UpdatedBy: 'migration', RowVersion: 1
    });
  }

  insertMany_(SHEET.CLAIMS, claims);
  insertMany_(SHEET.ITEMS, items);

  const orphans = items.filter(function (i) { return !i.PartID && i.PartName; });
  return [
    'Migrated ' + claims.length + ' claims and ' + items.length + ' items.',
    orphans.length
      ? orphans.length + ' item(s) kept a part name with no master entry: ' +
        orphans.map(function (i) { return i.PartName; }).filter(unique_).join(', ')
      : 'Every part name matched a master entry.'
  ].join('\n');
}

function unique_(v, i, arr) { return arr.indexOf(v) === i; }

function legacyStatus_(raw) {
  const s = String(raw).toLowerCase();
  if (s === 'approved') return STATUS.FULFILMENT;
  if (s === 'rejected') return STATUS.CLOSED;
  if (s === 'in review') return STATUS.IN_REVIEW;
  if (s === 'submitted') return STATUS.SUBMITTED;
  return STATUS.SUBMITTED;
}

function legacyItemStatus_(raw) {
  const s = String(raw).toLowerCase();
  if (s === 'approved') return ITEM_STATUS.APPROVED;
  if (s === 'rejected') return ITEM_STATUS.REJECTED;
  return ITEM_STATUS.PENDING;
}
