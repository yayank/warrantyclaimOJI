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

/**
 * Creates any missing sheet with its declared header row, and repairs one whose
 * first row turned out to be data. Returns the names of the sheets repaired, so
 * setUp() can say what it touched.
 */
function ensureSheets_() {
  const book = ss_();
  const repaired = [];
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
    // A sheet that never had a header row is rewritten whole, so the value in
    // row 1 stays a value.
    if (adoptHeaderless_(s, name)) { repaired.push(name); return; }

    // Append columns added by a later revision without disturbing existing data.
    const head = s.getRange(1, 1, 1, Math.max(s.getLastColumn(), 1)).getValues()[0];
    const missing = SCHEMA[name].filter(function (h) { return head.indexOf(h) === -1; });
    if (!missing.length) return;

    s.getRange(1, head.length + 1, 1, missing.length).setValues([missing]);

    // Rows that predate the column have nothing in it, and an empty Active reads
    // as deactivated — which would lock out everyone already registered. Adding
    // a column must not revoke anybody's access.
    const activeAt = missing.indexOf('Active');
    const rows = s.getLastRow() - 1;
    if (activeAt !== -1 && rows > 0) {
      const column = head.length + activeAt + 1;
      const values = [];
      for (let i = 0; i < rows; i++) values.push([true]);
      s.getRange(2, column, rows, 1).setValues(values);
    }
  });
  return repaired;
}

/**
 * Puts a proper header on a sheet whose first row is data.
 *
 * The customer and spare-part lists came out of the old workbook as one bare
 * column, so `PT. Asri Trisna Mandiri` sits where a column name is expected.
 * Adding the declared columns beside it leaves Name empty on all 1386 rows and
 * the dropdown renders 1386 blank entries. Here the unlabelled columns are read
 * as the values they are and moved under the header ADOPT names for them.
 *
 * Only the run of columns *before* the first recognised one is adopted, which
 * covers both a sheet that still has no header and one this ran on before the
 * fix — there the value is in column A and the declared columns follow it. A
 * column added after them is somebody's own and is left alone.
 *
 * Returns true when it rewrote the sheet; idempotent, since a sheet it has
 * repaired starts with a recognised column.
 */
function adoptHeaderless_(s, name) {
  const plan = ADOPT[name];
  if (!plan) return false;

  const schema = SCHEMA[name];
  const width = Math.max(s.getLastColumn(), 1);
  const head = s.getRange(1, 1, 1, width).getValues()[0]
    .map(function (h) { return String(h).trim(); });

  const lead = [];
  for (let i = 0; i < head.length; i++) {
    if (schema.indexOf(head[i]) !== -1) break;
    lead.push(i);
  }
  if (!lead.length) return false;
  // All blank means there is no stray value to rescue, only empty columns.
  if (!lead.some(function (i) { return head[i] !== ''; })) return false;
  if (lead.length > plan.length) {
    throw new Error('The ' + name + ' sheet starts with ' + lead.length + ' column(s) this ' +
      'version does not recognise (' + lead.map(function (i) {
        return head[i] || 'blank column ' + (i + 1);
      }).join(', ') + '). Expected columns are: ' + schema.join(', ') +
      '. Give them those names, or move them after the declared columns, then run setUp() again.');
  }

  const values = s.getRange(1, 1, s.getLastRow(), head.length).getValues();
  const records = [];

  values.forEach(function (row, r) {
    const rec = {};
    // In row 1 the recognised columns hold their own names, not data.
    if (r > 0) {
      head.forEach(function (h, c) {
        if (h && lead.indexOf(c) === -1) rec[h] = row[c];
      });
    }
    lead.forEach(function (c, i) {
      const v = row[c];
      if (v !== '' && v !== null) rec[plan[i]] = v;
    });
    const empty = schema.every(function (f) {
      return rec[f] === undefined || rec[f] === '' || rec[f] === null;
    });
    if (!empty) records.push(rec);
  });

  const rows = records.map(function (rec) {
    return schema.map(function (f) {
      // A row that predates the column would otherwise read as deactivated and
      // vanish from every list.
      if (f === 'Active' && (rec[f] === undefined || rec[f] === '')) return true;
      return rec[f] === undefined ? '' : rec[f];
    });
  });

  s.clearContents();
  s.getRange(1, 1, 1, schema.length).setValues([schema]);
  if (rows.length) s.getRange(2, 1, rows.length, schema.length).setValues(rows);
  s.setFrozenRows(1);
  return true;
}

/** Reads a whole sheet as objects keyed by header name. */
/**
 * A cell value as the rest of the application expects to see it.
 *
 * A timestamp this application writes as text — "2026-08-30T11:53:50" — is a
 * date-time as far as Sheets is concerned, and it is free to store it as one and
 * hand back a Date. That breaks two things at once. Timestamps are compared as
 * strings all over the server (the sort order of the claims list, the date
 * filters, the change detection in saveClaim_), and a Date stringifies to
 * "Sat Aug 30 2026 …", which sorts and compares as nonsense. Worse,
 * google.script.run refuses a Date anywhere in a return value: the call fails
 * and hands the page null, so a single coerced cell empties the whole screen.
 *
 * Reading is the one place every value passes through, so it is converted here
 * rather than at each field that happens to hold a date today.
 */
function cellValue_(v) {
  if (v instanceof Date) {
    return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, TZ, "yyyy-MM-dd'T'HH:mm:ss");
  }
  return v;
}

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
    for (let c = 0; c < head.length; c++) if (head[c]) obj[head[c]] = cellValue_(row[c]);
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

/**
 * Writes one cell without touching RowVersion.
 *
 * A note the server makes for its own benefit — where a claim's Drive folder
 * ended up — is not an edit anybody made, and bumping the version for it would
 * make the copy the browser is already holding stale: it would upload a file
 * and then be told its claim had moved on.
 */
function setCell_(name, keyField, keyValue, field, value) {
  const s = sheet_(name);
  const head = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
  const keyCol = head.indexOf(keyField);
  const col = head.indexOf(field);
  if (keyCol === -1 || col === -1) return false;

  const last = s.getLastRow();
  const keys = last > 1 ? s.getRange(2, keyCol + 1, last - 1, 1).getValues() : [];
  for (let i = 0; i < keys.length; i++) {
    if (String(keys[i][0]) === String(keyValue)) {
      s.getRange(i + 2, col + 1).setValue(value);
      return true;
    }
  }
  return false;
}

function rowToObject_(head, row) {
  const obj = {};
  for (let c = 0; c < head.length; c++) if (head[c]) obj[head[c]] = cellValue_(row[c]);
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

/* ------------------------------------------------------------------- cache */

/**
 * A cache entry larger than CacheService will take, split across numbered keys.
 *
 * Both unit indexes are past the 100KB an entry may hold, so the put failed
 * silently and every single call rebuilt the index by reading 2,610 rows from
 * the sheet again — on every save, and on every serial number lookup as it is
 * typed. Splitting the JSON is what makes the cache actually hold them.
 */
const CACHE_CHUNK = 90000;
const CACHE_MAX_CHUNKS = 40;

function chunkKeys_(key, count) {
  const keys = [];
  for (let i = 0; i < count; i++) keys.push(key + ':' + i);
  return keys;
}

function cacheGetLarge_(key) {
  const cache = CacheService.getScriptCache();
  const head = cache.get(key + ':n');
  if (!head) return null;

  const count = Number(head);
  if (!count || count > CACHE_MAX_CHUNKS) return null;
  const parts = cache.getAll(chunkKeys_(key, count));

  let text = '';
  for (let i = 0; i < count; i++) {
    const part = parts[key + ':' + i];
    // Chunks expire independently, and half an index is worse than none.
    if (part === undefined || part === null) return null;
    text += part;
  }
  try { return JSON.parse(text); } catch (e) { return null; }
}

function cachePutLarge_(key, value, seconds) {
  const text = JSON.stringify(value);
  const entries = {};
  let count = 0;
  let at = 0;

  while (at < text.length) {
    let end = Math.min(at + CACHE_CHUNK, text.length);
    // Never split a surrogate pair: the halves must survive as written.
    if (end < text.length) {
      const code = text.charCodeAt(end - 1);
      if (code >= 0xD800 && code <= 0xDBFF) end--;
    }
    if (count >= CACHE_MAX_CHUNKS) return;   // too large to be worth holding
    entries[key + ':' + count] = text.substring(at, end);
    count++;
    at = end;
  }

  entries[key + ':n'] = String(count);
  try {
    CacheService.getScriptCache().putAll(entries, seconds);
  } catch (e) {
    // The cache is an optimisation; losing it costs time, never correctness.
  }
}

function cacheRemoveLarge_(key) {
  const cache = CacheService.getScriptCache();
  const head = cache.get(key + ':n');
  const count = head ? Number(head) : 0;
  const keys = chunkKeys_(key, count > CACHE_MAX_CHUNKS ? CACHE_MAX_CHUNKS : count);
  keys.push(key + ':n');
  keys.push(key);        // an entry written before chunking existed
  try { cache.removeAll(keys); } catch (e) { /* best effort */ }
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
