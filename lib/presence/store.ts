// Who is on the site right now — the smallest thing that can answer that honestly.
//
// ── WHY THIS EXISTS AT ALL, AND WHY IT IS NOT VERCEL WEB ANALYTICS ─────────
// `<Analytics/>` posts to `/_vercel/insights`, which only exists on Vercel, and
// the Analytics API it feeds is a DAILY aggregate behind a plan limit — it
// cannot answer "in the last three minutes" at any price. So a live count was
// never going to come from there, and on a self-hosted box it stops existing
// entirely.
//
// ── THE ONE ASSUMPTION, STATED LOUDLY ─────────────────────────────────────
// THIS IS PROCESS-LOCAL MEMORY. It is correct on a single Node process — which
// is exactly what the app is on the Lightsail box, one systemd unit behind Caddy
// — and it is WRONG on serverless, where each instance holds its own map and the
// count becomes "whatever one cold lambda happened to see". It does not fail
// loudly there; it just under-reports, which is the worst kind of wrong for a
// number shown to the public. If this app is ever fanned out across processes,
// this file is the thing that has to become a shared store, and `count()` is the
// only function that has to change.
//
// It is also DELIBERATELY NOT PERSISTED. A restart resets the count to zero and
// it refills within one heartbeat interval. Persisting presence would mean
// keeping a record of visits on disk, which is the thing this is designed not to
// do.
//
// ── WHAT IS STORED ABOUT A VISITOR ────────────────────────────────────────
// A random id the browser makes up for the tab session, and a timestamp. No IP,
// no user agent, no route, no cookie, nothing derived from the person. The id is
// meaningless off this page, is thrown away when the tab closes, and is evicted
// here within WINDOW_MS of the last heartbeat. It exists to stop one visitor
// being counted twice, and it can do nothing else.

/** How recently a visitor must have checked in to count as "online". */
export const WINDOW_MS = 3 * 60 * 1000;

/**
 * Below this, the count is not published AT ALL — `count()` returns null and the
 * pill does not render.
 *
 * The threshold is a product decision (do not advertise a quiet room) but the
 * NULL is a privacy one: a site with four people on it should not be telling
 * each of them that there are four, and returning the real number with a
 * "don't show this" flag would put it in a response anyone can read. The small
 * number never leaves the server.
 *
 * Overridable so the pill can be seen deliberately on a preview — at 25 it is a
 * Reddit-spike number for this site, not a Tuesday, so without this nobody would
 * ever confirm it renders. Set PRESENCE_MIN_ONLINE=1 on a preview deployment.
 */
export const DEFAULT_MIN_ONLINE = 25;

export function minOnline(env: Record<string, string | undefined> = process.env): number {
  // TRIMMED AND EMPTY-CHECKED BEFORE `Number`, and that is not defensive
  // padding — `Number("")` is 0, which is finite and non-negative, so a variable
  // declared but left blank (`PRESENCE_MIN_ONLINE=` in a .env, the single most
  // likely way for this to be wrong) would set the threshold to ZERO and publish
  // the pill to every visitor on an empty site. A junk value has to fall back to
  // the SAFE end, not the loud one.
  const raw = (env.PRESENCE_MIN_ONLINE ?? "").trim();
  if (raw === "") return DEFAULT_MIN_ONLINE;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MIN_ONLINE;
}

/** visitor id → the epoch ms of their last heartbeat. */
const seen = new Map<string, number>();

/**
 * A visitor id is only ever an opaque token from the client, so it is bounded
 * and character-checked before it can become a map key. Without this, a caller
 * could grow the map without limit by posting long or endless distinct ids —
 * the eviction below is time-based, so nothing else caps its size.
 */
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Drop everyone whose last heartbeat has fallen out of the window. */
function evict(now: number): void {
  for (const [id, at] of seen) if (now - at > WINDOW_MS) seen.delete(id);
}

/**
 * Record that a visitor is here. Returns false for an id this will not store,
 * so the route can answer 400 rather than silently doing nothing.
 *
 * `now` is injected rather than read from the clock so the window can be tested
 * without waiting three minutes for it.
 */
export function heartbeat(id: string, now: number = Date.now()): boolean {
  if (!ID_RE.test(id)) return false;
  evict(now);
  seen.set(id, now);
  return true;
}

/**
 * How many visitors are inside the window — or null when that is below the
 * threshold, which is the case the caller must not be able to distinguish from
 * "nobody".
 */
export function count(now: number = Date.now(), floor: number = minOnline()): number | null {
  evict(now);
  return seen.size >= floor ? seen.size : null;
}

/** The raw size, for tests and for nothing else. Never send this to a client. */
export function sizeForTest(now: number = Date.now()): number {
  evict(now);
  return seen.size;
}

/** Test-only: empty the map between cases. */
export function __resetPresence(): void {
  seen.clear();
}
