// CelesTrak GP/TLE source. Returns classic 3-line TLEs for the requested group
// (default "visual" = the brightest, recognisable satellites incl. the ISS).
// TLEs drift slowly, so we cache per-group for a couple of hours and serve the
// stale set if CelesTrak is briefly unreachable. No API key.
//
// FOUR GUARDS, because the landing page asks for this on EVERY visit. Measured
// 2026-09-14 during a traffic spike: /api/satellites took 10.4 s to answer
// `celestrak_unavailable` and nothing held that answer, so every visitor started a
// new upstream attempt. CelesTrak blocks addresses that over-fetch, so that pattern
// can turn a short outage into a ban.
//   1. A timeout on the fetch, so a hung upstream cannot hold a request open.
//   2. Single-flight per group: concurrent misses share ONE in-flight fetch.
//   3. A failure hold: after a failure, nobody re-asks for FAILURE_HOLD_MS. Callers
//      get the last-good set if there is one, otherwise the held error.
//   4. A group allowlist (see SATELLITE_GROUPS), checked by the route, so an
//      arbitrary ?group= string cannot create upstream calls or cache entries.

export interface TleRecord {
  name: string;
  noradId: string;
  line1: string;
  line2: string;
}

/**
 * The groups a client may ask for. Every caller in the app requests "visual"
 * (HeroGlobe, and useSatellites through its default and the satellites widget's
 * defaultConfig). "stations" is kept because the route has always documented it and
 * it is small. The large groups ("active", "starlink") are deliberately absent: no
 * UI requests them, and each one is a multi-megabyte CelesTrak download.
 */
export const SATELLITE_GROUPS = ["visual", "stations"] as const;
export type SatelliteGroup = (typeof SATELLITE_GROUPS)[number];

export function isSatelliteGroup(group: string): group is SatelliteGroup {
  return (SATELLITE_GROUPS as readonly string[]).includes(group);
}

export const FETCH_TIMEOUT_MS = 8_000;
export const FAILURE_HOLD_MS = 10 * 60 * 1000;

const url = (group: string) =>
  `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=tle`;

const TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const cache = new Map<string, { at: number; records: TleRecord[] }>();
const failures = new Map<string, { at: number; error: Error }>();
const inflight = new Map<string, Promise<TleRecord[]>>();

/** Exposed for tests: clears the module-level caches between cases. */
export function __resetCelestrakCache(): void {
  cache.clear();
  failures.clear();
  inflight.clear();
}

/** Parse classic 3-line TLE text (name / line1 / line2 triplets). Robust to
 *  trailing whitespace and blank lines as emitted by CelesTrak. */
export function parseTle(text: string): TleRecord[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.length > 0);

  const out: TleRecord[] = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i];
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];
    // Triplets must be aligned; if they aren't, the feed is malformed — stop.
    if (!line1.startsWith("1 ") || !line2.startsWith("2 ")) break;
    out.push({ name: name.trim(), noradId: line1.slice(2, 7).trim(), line1, line2 });
  }
  return out;
}

export async function fetchTLEs(group = "visual"): Promise<TleRecord[]> {
  const now = Date.now();
  const hit = cache.get(group);
  if (hit && now - hit.at < TTL_MS) return hit.records;

  // Inside the failure hold nobody re-asks CelesTrak.
  const failed = failures.get(group);
  if (failed && now - failed.at < FAILURE_HOLD_MS) {
    if (hit) return hit.records;
    throw failed.error;
  }

  // No await before the set, so every concurrent caller finds the same promise.
  let pending = inflight.get(group);
  if (!pending) {
    pending = refresh(group, hit).finally(() => inflight.delete(group));
    inflight.set(group, pending);
  }
  return pending;
}

async function refresh(group: string, hit: { records: TleRecord[] } | undefined): Promise<TleRecord[]> {
  try {
    const res = await fetch(url(group), {
      headers: { Accept: "text/plain" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`CelesTrak fetch failed: ${res.status}`);
    const records = parseTle(await res.text());
    cache.set(group, { at: Date.now(), records });
    failures.delete(group);
    return records;
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    failures.set(group, { at: Date.now(), error });
    if (hit) return hit.records; // network blip or upstream error — serve stale
    throw error;
  }
}
