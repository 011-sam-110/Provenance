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
//   3. The stop rule (below): the first failed call halts every call to CelesTrak.
//   4. A group allowlist (see SATELLITE_GROUPS), checked by the route, so an
//      arbitrary ?group= string cannot create upstream calls or cache entries.
//
// THE STOP RULE (2026-10-16). CelesTrak's usage policy: "M2M (machine-to-machine)
// software should immediately stop querying when it receives any non-HTTP 200
// responses", and report the problem to a person. Dr Kelso's reply about this box gave
// the numbers: its IP went into the firewall on 2026-09-08 08:36 UTC after 29 HTTP 500s
// in 12 minutes, and the trigger is 25 in 2 hours (50 for a 301, 403 or 404). The old
// guard 3, a 10-minute failure hold, did not meet the rule: with two groups it still
// allowed 24 failed calls every 2 hours, for as long as the fault lasted.
// So the FIRST failed call of any kind (a status other than 200, a redirect, a timeout,
// a refused connection) HALTS every call from this process to CelesTrak, for every
// group, until the process restarts. A restart is a person's act here: a deploy after a
// merge, or `systemctl restart provenance`. The halt writes one line to the journal and
// sends one Telegram message to the owner (lib/ops/notify.ts). While halted, callers get
// the relayed set if one is fresh, else our last-good set, else the halt error. Calls
// are also serial across groups, so a start against a broken upstream costs ONE failed
// call, not one per group. Redirects are not followed: a 301 is an answer to stop on.
//
// THE RELAY FALLBACK (2026-10-16). CelesTrak firewalls the production server's IP: the
// box got no TCP answer for about a month while the same URL answered 200 from anywhere
// else, and the layer sat empty. provenance-1 now fetches the same two groups (at most
// every 2 h, CelesTrak's own update cadence) and pushes them through POST
// /api/relay/celestrak (lib/relay). This module serves WHICHEVER COPY IS FRESHER, by the
// time each was read from CelesTrak, and the 2 h TTL applies to both: while a relayed
// set is under 2 h old nobody here dials CelesTrak at all, which is also the polite
// thing to do from an address CelesTrak has blocked.

import { notifyOwner } from "@/lib/ops/notify";
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

const url = (group: string) =>
  `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=tle`;

/** Names this site in CelesTrak's logs, so its operator can tell who is calling. */
const USER_AGENT = "Provenance/1 (+https://provenance-online.com)";

const TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const cache = new Map<string, { at: number; records: TleRecord[] }>();
const inflight = new Map<string, Promise<TleRecord[]>>();
/**
 * The stop state lives on globalThis, not in this module: Next bundles each route on its
 * own, so a second importer would get a second module, and the rule is for the PROCESS.
 * `halted` is set by the first failed call and cleared only by a restart (see THE STOP
 * RULE). `queue` is the tail of the one-call-at-a-time chain, across groups.
 */
const STOP = Symbol.for("provenance.celestrak.stop");
type StopState = { halted?: { at: number; error: Error }; queue: Promise<unknown> };
const g = globalThis as unknown as { [STOP]?: StopState };
const stop = (): StopState => (g[STOP] ??= { queue: Promise.resolve() });
/** Parsed relay text per group, memoised on the push it came from. */
const relayParsed = new Map<string, { receivedAt: number; value: { at: number; records: TleRecord[] } | undefined }>();

/** Exposed for tests: clears the module-level caches between cases. */
export function __resetCelestrakCache(): void {
  cache.clear();
  inflight.clear();
  g[STOP] = undefined;
  relayParsed.clear();
}

/** When and why this process stopped calling CelesTrak, or undefined while it may. */
export function celestrakHalt(): { at: number; reason: string } | undefined {
  const { halted } = stop();
  return halted && { at: halted.at, reason: halted.error.message };
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

  // After a halt nobody here asks CelesTrak again.
  const { halted } = stop();
  if (halted) {
    if (best) return best.records;
    throw halted.error;
  }

  // No await before the set, so every concurrent caller finds the same promise.
  let pending = inflight.get(group);
  if (!pending) {
    pending = refresh(group).finally(() => inflight.delete(group));
    inflight.set(group, pending);
  }
  return pending;
}

/** Queues one call behind any call already out, for any group. */
function refresh(group: string): Promise<TleRecord[]> {
  const state = stop();
  const run = state.queue.then(() => attempt(group));
  state.queue = run.catch(() => undefined);
  return run;
}

async function attempt(group: string): Promise<TleRecord[]> {
  // The call ahead in the queue may have failed while this one waited.
  if (!stop().halted) {
    try {
      const res = await fetch(url(group), {
        headers: { Accept: "text/plain", "User-Agent": USER_AGENT },
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.status !== 200) {
        // CelesTrak's error bodies say why (a 403 names the limit), so the person gets them.
        const said = (await res.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 300);
        halt(group, `HTTP ${res.status}${said ? `: ${said}` : ""}`);
      } else {
        const records = parseTle(await res.text());
        cache.set(group, { at: Date.now(), records });
        return records;
      }
    } catch (e) {
      halt(group, e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    }
  }
  // Halted: serve our stale set or the relayed one, whichever is fresher. Looked up NOW
  // rather than before the fetch, because a push can land during the 8 s this call took
  // to time out.
  const fallback = freshest(group, Date.now());
  if (fallback) return fallback.records;
  throw stop().halted!.error;
}

function halt(group: string, reason: string): void {
  stop().halted = { at: Date.now(), error: new Error(`CelesTrak halted: GROUP=${group} ${reason}`) };
  console.error(
    `[celestrak] HALTED: GROUP=${group} ${reason}. No more calls to CelesTrak until this process restarts. Read the cause before you restart.`,
  );
  void notifyOwner(
    `Provenance stopped calling CelesTrak.\n\nGROUP=${group}: ${reason}\n\nCelesTrak's usage policy says to stop at the first non-200 answer, so the server makes no more calls until it restarts. Find the cause before you restart it: https://celestrak.org/usage-policy.php`,
  );
}
