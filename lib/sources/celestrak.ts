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
//
// THE RELAY FALLBACK (2026-10-16). CelesTrak firewalls the production server's IP: the
// box got no TCP answer for about a month while the same URL answered 200 from anywhere
// else, and the layer sat empty. provenance-1 now fetches the same two groups (at most
// every 2 h, CelesTrak's own update cadence) and pushes them through POST
// /api/relay/celestrak (lib/relay). This module serves WHICHEVER COPY IS FRESHER, by the
// time each was read from CelesTrak, and the 2 h TTL applies to both: while a relayed
// set is under 2 h old nobody here dials CelesTrak at all, which is also the polite
// thing to do from an address CelesTrak has blocked.

import { RELAY_FEEDS } from "@/lib/relay/feeds";
import { readRelay } from "@/lib/relay/store";

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
/** Parsed relay text per group, memoised on the push it came from. */
const relayParsed = new Map<string, { receivedAt: number; value: { at: number; records: TleRecord[] } | undefined }>();

/** Exposed for tests: clears the module-level caches between cases. */
export function __resetCelestrakCache(): void {
  cache.clear();
  failures.clear();
  inflight.clear();
  relayParsed.clear();
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

/**
 * The relayed copy of one group, parsed, stamped with the time provenance-1 read it from
 * CelesTrak. Undefined when nothing has been relayed, when the group is missing from the
 * push, or when the push is older than the feed's max age (a set that old has drifted
 * too far to draw, and a stale relay should not outlive the fault it covered).
 */
export function relayedTLEs(group: string, now = Date.now()): { at: number; records: TleRecord[] } | undefined {
  if (!isSatelliteGroup(group)) return undefined;
  const snap = readRelay("celestrak");
  const text = snap?.data.groups[group];
  if (!snap || !text) return undefined;
  if (now - snap.fetchedAt > RELAY_FEEDS.celestrak.maxAgeMs) return undefined;
  const memo = relayParsed.get(group);
  if (memo && memo.receivedAt === snap.receivedAt) return memo.value;
  const records = parseTle(text);
  const value = records.length > 0 ? { at: snap.fetchedAt, records } : undefined;
  relayParsed.set(group, { receivedAt: snap.receivedAt, value });
  return value;
}

/** Our own last-good set or the relayed one, whichever CelesTrak issued later. */
function freshest(group: string, now: number): { at: number; records: TleRecord[] } | undefined {
  const own = cache.get(group);
  const relayed = relayedTLEs(group, now);
  if (!own) return relayed;
  if (!relayed) return own;
  return relayed.at > own.at ? relayed : own;
}

export async function fetchTLEs(group = "visual"): Promise<TleRecord[]> {
  const now = Date.now();
  const best = freshest(group, now);
  if (best && now - best.at < TTL_MS) return best.records;

  // Inside the failure hold nobody re-asks CelesTrak.
  const failed = failures.get(group);
  if (failed && now - failed.at < FAILURE_HOLD_MS) {
    if (best) return best.records;
    throw failed.error;
  }

  // No await before the set, so every concurrent caller finds the same promise.
  let pending = inflight.get(group);
  if (!pending) {
    pending = refresh(group).finally(() => inflight.delete(group));
    inflight.set(group, pending);
  }
  return pending;
}

async function refresh(group: string): Promise<TleRecord[]> {
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
    // Network blip, upstream error or a firewalled IP: serve our stale set or the relayed
    // one, whichever is fresher. Looked up NOW rather than before the fetch, because a
    // push can land during the 8 s this attempt took to time out.
    const fallback = freshest(group, Date.now());
    if (fallback) return fallback.records;
    throw error;
  }
}
