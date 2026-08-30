/**
 * Repo.gs — sheet access.
 *
 * Sheets are read whole and written by key, never by row index: rows move when
 * somebody sorts or inserts, so a remembered index silently writes to the wrong
 * claim. Every write takes a document lock and bumps RowVersion, which is what
 * the concurrent-edit guard compares against.
 */

function ss_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActive();
}

function sheet_(name) {
  const s = ss_().getSheetByName(name);
  if (!s) throw new Error('Sheet not found: ' + name + '. Run setUp() once.');
  return s;
}

/**
 * Sheets declared in the schema that the spreadsheet does not have yet.
 * Empty means setUp() has run against the right spreadsheet.
 */
function missingSheets_() {
  const book = ss_();
  return Object.keys(SCHEMA).filter(function (name) { return !book.getSheetByName(name); });
}

/** Which spreadsheet the script is actually pointed at — the first thing to check. */
function boundSpreadsheet_() {
  try {
    const book = ss_();
    return { id: book.getId(), name: book.getName(), url: book.getUrl() };
  } catch (e) {
    return { id: '', name: '', url: '', error: String(e.message || e) };
  }
}

/** Creates any missing sheet with its declared header row. */
function ensureSheets_() {
  const book = ss_();
  Object.keys(SCHEMA).forEach(function (name) {
    let s = book.getSheetByName(name);
    if (!s) {
      s = book.insertSheet(name);
      s.appendRow(SCHEMA[name]);
      s.setFrozenRows(1);
      return;
    }
    if (s.getLastRow() === 0) {
      s.appendRow(SCHEMA[name]);
      s.setFrozenRows(1);
      return;
    }
    // Append columns added by a later revision without disturbing existing data.
    const head = s.getRange(1, 1, 1, Math.max(s.getLastColumn(), 1)).getValues()[0];
    const missing = SCHEMA[name].filter(function (h) { return head.indexOf(h) === -1; });
    if (missing.length) {
      s.getRange(1, head.length + 1, 1, missing.length).setValues([missing]);
    }
  });
}

/** Reads a whole sheet as objects keyed by header name. */
function readAll_(name) {
  const s = sheet_(name);
  const last = s.getLastRow();
  if (last < 2) return [];
  const width = s.getLastColumn();
  const values = s.getRange(1, 1, last, width).getValues();
  const head = values[0];
  const out = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (row.every(function (c) { return c === '' || c === null; })) continue;
    const obj = {};
    for (let c = 0; c < head.length; c++) if (head[c]) obj[head[c]] = row[c];
    obj.__row = r + 1;
    out.push(obj);
  }
  return out;
}

/** Live rows only — anything flagged Deleted stays on the sheet but out of sight. */
function readLive_(name) {
  return readAll_(name).filter(function (r) { return r.Deleted !== true && r.Deleted !== 'TRUE'; });
}

function findBy_(name, field, value) {
  const rows = readAll_(name);
  for (let i = 0; i < rows.length; i++) if (String(rows[i][field]) === String(value)) return rows[i];
  return null;
}

function insert_(name, obj) {
  const s = sheet_(name);
  const head = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
  const row = head.map(function (h) { return obj[h] === undefined ? '' : obj[h]; });
  s.appendRow(row);
  return obj;
}

function insertMany_(name, objs) {
  if (!objs.length) return;
  const s = sheet_(name);
  const head = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
  const rows = objs.map(function (o) {
    return head.map(function (h) { return o[h] === undefined ? '' : o[h]; });
  });
  s.getRange(s.getLastRow() + 1, 1, rows.length, head.length).setValues(rows);
}

/**
 * Writes changed fields onto the row identified by keyField/keyValue.
 * Pass expectedVersion to reject a write made against stale data.
 */
function update_(name, keyField, keyValue, changes, expectedVersion) {
  const s = sheet_(name);
  const head = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
  const keyCol = head.indexOf(keyField);
  if (keyCol === -1) throw new Error('Unknown key column ' + keyField);

  const last = s.getLastRow();
  const keys = last > 1 ? s.getRange(2, keyCol + 1, last - 1, 1).getValues() : [];
  let rowIndex = -1;
  for (let i = 0; i < keys.length; i++) {
    if (String(keys[i][0]) === String(keyValue)) { rowIndex = i + 2; break; }
  }
  if (rowIndex === -1) throw new Error(name + ' ' + keyValue + ' not found');

  const current = s.getRange(rowIndex, 1, 1, head.length).getValues()[0];
  const versionCol = head.indexOf('RowVersion');
  if (expectedVersion !== undefined && expectedVersion !== null && versionCol !== -1) {
    const actual = Number(current[versionCol] || 0);
    if (actual !== Number(expectedVersion)) {
      const err = new Error('STALE');
      err.stale = true;
      err.current = rowToObject_(head, current);
      throw err;
    }
  }

  Object.keys(changes).forEach(function (field) {
    const c = head.indexOf(field);
    if (c !== -1) current[c] = changes[field];
  });
  if (versionCol !== -1) current[versionCol] = Number(current[versionCol] || 0) + 1;

  s.getRange(rowIndex, 1, 1, head.length).setValues([current]);
  return rowToObject_(head, current);
}

function rowToObject_(head, row) {
  const obj = {};
  for (let c = 0; c < head.length; c++) if (head[c]) obj[head[c]] = row[c];
  return obj;
}

/** Serialises writes across sessions. Every mutating action goes through this. */
function withLock_(fn) {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) {
    throw new Error('The system is busy saving another change. Please try again.');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/* ---------------------------------------------------------------- settings */

function settings_() {
  const cached = CacheService.getScriptCache().get('settings');
  if (cached) return JSON.parse(cached);

  // Before setUp() has run there is no sheet to read. Settings all have
  // defaults, so an empty map is the honest answer rather than an exception —
  // it lets doGet reach the point where it can explain what is missing.
  if (!ss_().getSheetByName(SHEET.SETTINGS)) return {};

  const map = {};
  readAll_(SHEET.SETTINGS).forEach(function (r) { if (r.Key) map[r.Key] = r.Value; });
  CacheService.getScriptCache().put('settings', JSON.stringify(map), 300);
  return map;
}

function setting_(key, fallback) {
  const v = settings_()[key];
  return (v === undefined || v === '') ? fallback : v;
}

function setSetting_(key, value) {
  const existing = findBy_(SHEET.SETTINGS, 'Key', key);
  if (existing) update_(SHEET.SETTINGS, 'Key', key, { Value: value });
  else insert_(SHEET.SETTINGS, { Key: key, Value: value });
  CacheService.getScriptCache().remove('settings');
}

/* ------------------------------------------------------------ identifiers */

/**
 * Builds the next sequential identifier for today, e.g. CLM-260830-0004.
 * The sheet itself is the counter — a separate counter drifts the moment a
 * write fails halfway.
 */
function nextId_(sheetName, field, prefix) {
  const stamp = Utilities.formatDate(new Date(), TZ, 'yyMMdd');
  const head = prefix + '-' + stamp + '-';
  let max = 0;
  readAll_(sheetName).forEach(function (r) {
    const v = String(r[field] || '');
    if (v.indexOf(head) === 0) {
      const n = parseInt(v.substring(head.length), 10);
      if (!isNaN(n) && n > max) max = n;
    }
  });
  return head + padLeft_(max + 1, 4);
}

function padLeft_(n, width) {
  let s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

function nowIso_() {
  return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss");
}

function todayRef_(isTest) {
  return (isTest ? 'CWT' : 'CW') + Utilities.formatDate(new Date(), TZ, 'ddMMyy');
}

function isTrue_(v) {
  return v === true || v === 'TRUE' || v === 'true';
}
