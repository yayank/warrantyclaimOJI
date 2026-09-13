/**
 * Visits.gs — when each person was last here, so the list can say what moved.
 *
 * Kept in the script's own properties keyed by the signed-in address, for the
 * reason set out at the top of Views.gs: the web app runs as whoever deployed
 * it, so "user properties" would be that one person's for everybody.
 *
 * TWO STAMPS, NOT ONE
 *
 * `seen` is when the person was last here. `boundary` is what the markers are
 * measured against, and it is deliberately not the same thing: a reload is a
 * new sign-in, and moving the boundary on every sign-in would clear the
 * markers before anybody had finished reading them. So visits closer together
 * than VISIT_GAP count as one visit and the boundary stays put; a longer
 * absence moves it to where the person left off, which is what makes "what
 * moved overnight" the question it answers.
 *
 * The boundary only ever moves when a page opens — session.bootstrap — or when
 * somebody says they have seen it. Never while a list is being drawn.
 */

const VISIT_PREFIX = 'visit:';

/** Below this, a second sign-in is the same visit carrying on: a reload, a second tab. */
const VISIT_GAP_MINUTES = 30;

function visitKey_(session) {
  return VISIT_PREFIX + String(session.email || '').trim().toLowerCase();
}

function visitStore_() {
  return PropertiesService.getScriptProperties();
}

function readVisit_(session) {
  const raw = visitStore_().getProperty(visitKey_(session));
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    // A damaged stamp means the markers are wrong for one visit, which is not
    // worth an error on a screen.
    return {};
  }
}

function writeVisit_(session, visit) {
  visitStore_().setProperty(visitKey_(session), JSON.stringify(visit));
}

/** Minutes between two stamps written by nowIso_, or 0 if either will not parse. */
function minutesBetween_(from, to) {
  const a = new Date(String(from).replace(' ', 'T'));
  const b = new Date(String(to).replace(' ', 'T'));
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
  return (b.getTime() - a.getTime()) / 60000;
}

/**
 * Records that a page has just opened, and answers with the stamp the markers
 * are measured against.
 *
 * The first visit ever marks nothing: a portal that greets somebody with four
 * hundred claims flagged as new has told them nothing at all.
 */
function openVisit_(session) {
  const now = nowIso_();
  const visit = readVisit_(session);

  let boundary;
  if (!visit.seen) {
    boundary = now;
  } else if (minutesBetween_(visit.seen, now) > VISIT_GAP_MINUTES) {
    boundary = visit.seen;
  } else {
    boundary = visit.boundary || visit.seen;
  }

  writeVisit_(session, { boundary: boundary, seen: now });
  return boundary;
}

/** The stamp the markers are measured against, without moving anything. */
function visitSince_(session) {
  return readVisit_(session).boundary || '';
}

/** "I have looked." Moves the boundary to now, so the markers clear. */
function markVisitSeen_(session) {
  const now = nowIso_();
  writeVisit_(session, { boundary: now, seen: now });
  return { since: now };
}

/**
 * Whether this claim changed since the reader was last here.
 *
 * Their own changes never count. Somebody who has just forwarded twelve claims
 * does not need twelve markers telling them so, and a marker that lights up for
 * your own work stops meaning "look at this".
 *
 * The summary columns are written with setCells_, which leaves UpdatedAt and
 * UpdatedBy alone — so recounting a claim's parts never makes it look new.
 */
function isNewToViewer_(claim, session, since) {
  if (!since) return false;
  const at = String(claim.UpdatedAt || '');
  if (!at) return false;
  if (String(claim.UpdatedBy || '').toLowerCase() ===
    String(session.email || '').toLowerCase()) return false;
  return at > since;
}
