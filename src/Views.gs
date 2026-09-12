/**
 * Views.gs — the filter combinations somebody runs every morning, kept.
 *
 * WHERE THESE LIVE, AND WHY NOT WHERE YOU WOULD EXPECT
 *
 * The obvious home is PropertiesService.getUserProperties(). It is the wrong
 * one here: the web app is deployed with executeAs USER_DEPLOYING, so every
 * visitor's code runs as the person who deployed it, and "user properties"
 * would be that one person's for everybody. One administrator would see
 * another's presets, and saving would overwrite them.
 *
 * So the script's own properties are used, with the signed-in address in the
 * key. That address is the real one even when a Tester is simulating another
 * role, which is right: a preset belongs to the person, not to the hat they
 * are wearing this minute.
 *
 * Nothing here is authority. A view carries filters, and every filter is
 * applied by listClaims_ against what that session is allowed to see — so a
 * view cannot show anybody a claim they could not have reached by typing the
 * filters in by hand.
 */

const VIEW_PREFIX = 'views:';

/** Twenty is past the point where a list is quicker than setting the filters. */
const VIEW_MAX = 20;
const VIEW_NAME_MAX = 60;

/**
 * The fields a view carries. Anything else in the payload is dropped rather
 * than stored: the value is written by the browser, and a property that grows
 * without limit is a property that one day will not save.
 */
const VIEW_FILTERS = ['statuses', 'warrantyTypes', 'customerId', 'customerName',
  'principal', 'from', 'to'];

/** Of those, the ones that hold a list. A missing one is an empty list, not ''. */
const VIEW_LISTS = ['statuses', 'warrantyTypes'];

function viewsKey_(session) {
  return VIEW_PREFIX + String(session.email || '').trim().toLowerCase();
}

function viewStore_() {
  return PropertiesService.getScriptProperties();
}

/** One person's views, oldest first. Never throws on a damaged value. */
function readViews_(session) {
  const raw = viewStore_().getProperty(viewsKey_(session));
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // A property that will not parse is not worth losing the screen over.
    return [];
  }
  return Array.isArray(parsed) ? parsed.filter(function (v) { return v && v.name; }) : [];
}

function writeViews_(session, views) {
  viewStore_().setProperty(viewsKey_(session), JSON.stringify(views));
}

function listViews_(session) {
  return { views: readViews_(session) };
}

/** Trims a browser's idea of a filter down to what may be stored. */
function cleanViewFilters_(filters) {
  const f = filters || {};
  const out = {};
  VIEW_FILTERS.forEach(function (key) {
    const v = f[key];
    if (VIEW_LISTS.indexOf(key) !== -1) {
      out[key] = (Array.isArray(v) ? v : [])
        .slice(0, 20).map(function (s) { return String(s).slice(0, 80); });
      return;
    }
    out[key] = String(v === undefined || v === null ? '' : v).slice(0, 120);
  });
  return out;
}

/**
 * Stores the filters on screen under a name.
 *
 * Saving under a name that already exists replaces it, in place: that is what
 * "save" means when the name is the same, and appending a second entry with
 * the same name would leave two identical-looking rows in the list.
 */
function saveView_(session, payload) {
  const p = payload || {};
  const name = String(p.name || '').trim().slice(0, VIEW_NAME_MAX);
  if (!name) throw new Error('Give the view a name.');

  return withLock_(function () {
    const views = readViews_(session);
    const view = {
      name: name,
      tab: String(p.tab || 'all').slice(0, 30),
      group: String(p.group || 'status').slice(0, 30),
      filters: cleanViewFilters_(p.filters)
    };

    const at = views.map(function (v) { return v.name.toLowerCase(); })
      .indexOf(name.toLowerCase());
    if (at !== -1) {
      views[at] = view;
    } else {
      if (views.length >= VIEW_MAX) {
        throw new Error('You already have ' + VIEW_MAX +
          ' saved views. Delete one before saving another.');
      }
      views.push(view);
    }

    writeViews_(session, views);
    return { views: views, saved: name };
  });
}

function deleteView_(session, payload) {
  const name = String((payload || {}).name || '').trim();
  if (!name) throw new Error('Which view?');

  return withLock_(function () {
    const views = readViews_(session).filter(function (v) {
      return v.name.toLowerCase() !== name.toLowerCase();
    });
    writeViews_(session, views);
    return { views: views, deleted: name };
  });
}
