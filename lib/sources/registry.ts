import type { Camera } from "@/lib/types";
import { fetchRegistry as fetchTfl } from "@/lib/sources/tfl";
import { fetchRegistry as fetchCaltrans } from "@/lib/sources/caltrans";
import { fetchRegistry as fetchScdot } from "@/lib/sources/scdot";
import { fetchRegistry as fetchDigitraffic } from "@/lib/sources/digitraffic";
import { fetchRegistry as fetchCastlerock } from "@/lib/sources/castlerock";
import { fetchRegistry as fetchTripcheck } from "@/lib/sources/tripcheck";
import { fetchRegistry as fetchDriveBc } from "@/lib/sources/drivebc";
import { fetchRegistry as fetchNzta } from "@/lib/sources/nzta";
import { fetchRegistry as fetchIceland } from "@/lib/sources/iceland";
import { fetchRegistry as fetchEstonia } from "@/lib/sources/estonia";
import { fetchRegistry as fetchTrafficScotland } from "@/lib/sources/trafficscotland";
import { fetchRegistry as fetchCetsp } from "@/lib/sources/cetsp";
import { fetchRegistry as fetchSerbiaBorders } from "@/lib/sources/serbia-borders";
import { fetchRegistry as fetchSerbiaTolls } from "@/lib/sources/serbia-tolls";
import { findById, nearest } from "@/lib/sources/select";

/**
 * How long the merged camera set is served before a refresh is kicked off.
 *
 * Exported because the SEO pages' `revalidate` is DERIVED from it rather than typed
 * (lib/seo/registrySnapshot.ts). A camera page cannot be fresher than the registry
 * behind it, so a page window shorter than this buys nothing but re-renders, and one
 * longer than this decides how far behind the registry the page is allowed to sit.
 * Keeping it one number stops the two drifting apart silently.
 */
export const REGISTRY_TTL_MS = 5 * 60 * 1000;

/**
 * How long a feed gets before its round is treated as a timeout, unless it
 * declares its own `budgetMs`. `refresh()` used to await every feed with no
 * ceiling, so the single slowest source set the whole registry rebuild's
 * latency; this bounds that.
 *
 * WHY THIS IS A DEFAULT AND NO LONGER A UNIFORM RULE. Applied to every feed
 * alike, 10s did not bound Castle Rock — it DELETED it. That adapter pages ~143
 * requests across nine 511 systems (see lib/sources/castlerock.ts) and its own
 * measurements are ~18.5s warm and ~40s cold, so it lost this race on every
 * refresh and was absent from production entirely. Not intermittently:
 * structurally, and for as long as the ceiling was uniform.
 *
 * The symptom read like a network problem and was recorded as one — running the
 * adapter DIRECTLY succeeded in 18.5s, so the deployment's egress looked
 * refused. It was not. The ceiling lives here, in `refresh()`, not in the
 * adapter, so a direct call never meets it. The 511 upstreams answer 200 in
 * ~1s and refuse nobody.
 *
 * What the ceiling was protecting is already protected elsewhere: `getRegistry()`
 * is stale-while-revalidate, so a warm caller gets the cached answer INSTANTLY
 * while one shared refresh runs behind it. Only a cold call with no cache waits.
 * So a feed that needs longer costs a slower cold start, not slower requests —
 * and paying for it with two thirds of the camera catalogue was the worse trade.
 *
 * A feed that blows its budget is still treated exactly like any other failure
 * by mergeResults: it keeps its last-good cameras and never silently empties its
 * region. This only stops US WAITING on the feed — the underlying request has no
 * AbortSignal wired through `CameraFeed.fetch()`, so it keeps running
 * server-side until it settles on its own. On serverless that is ~143 abandoned
 * requests still executing per refresh, and it is billed; threading an
 * AbortSignal into each adapter is the fix and is a follow-up, not something
 * this file can do alone.
 */
export const DEFAULT_UPSTREAM_TIMEOUT_MS = 10_000;

/**
 * Race `promise` against a `ms` timer, rejecting with a labelled timeout error
 * if it hasn't settled in time. No network code here — pure apart from the
 * timer — so it's unit-testable without mocking fetch. Handlers are attached
 * directly to `promise` (not left dangling), so a late resolution/rejection
 * after the timeout has already fired is still consumed instead of surfacing
 * as an unhandled rejection.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * One named thunk per feed. The name matters: a failed feed has to be
 * identifiable so its LAST-GOOD cameras can be kept (see mergeResults).
 */
export interface CameraFeed {
  /** Stable id, used only for last-good bookkeeping and the coverage denominator. */
  key: string;
  fetch: () => Promise<Camera[]>;
  /**
   * This feed's own timeout, for the rare source whose honest cost exceeds
   * DEFAULT_UPSTREAM_TIMEOUT_MS. Omit it unless the number is MEASURED — the
   * point of the default is that it still bounds everything else.
   */
  budgetMs?: number;
}

/** The budget one feed gets this round. Pure. */
export function feedBudgetMs(feed: Pick<CameraFeed, "budgetMs">): number {
  return feed.budgetMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS;
}

const SOURCES: CameraFeed[] = [
  { key: "tfl", fetch: fetchTfl },
  { key: "caltrans", fetch: fetchCaltrans },
  { key: "scdot", fetch: fetchScdot },
  { key: "digitraffic", fetch: fetchDigitraffic },
  // The one feed that needs longer than the default, and the reason the default
  // exists rather than a uniform rule. ~143 paginated requests across nine 511
  // systems; measured at ~18.5s warm and ~40s cold. 60s is that worst case plus
  // headroom — not a guess, and not "big enough to be safe". See
  // DEFAULT_UPSTREAM_TIMEOUT_MS above for why this costs a cold start and
  // nothing else.
  { key: "castlerock", fetch: fetchCastlerock, budgetMs: 60_000 },
  { key: "tripcheck", fetch: fetchTripcheck },
  { key: "drivebc", fetch: fetchDriveBc },
  { key: "nzta", fetch: fetchNzta },
  { key: "iceland", fetch: fetchIceland },
  { key: "estonia", fetch: fetchEstonia },
  { key: "trafficscotland", fetch: fetchTrafficScotland },
  // First South American feed. Small (11 cameras) and deliberately so — see
  // lib/sources/cetsp.ts for why the other ~195 snapshot folders on that host
  // are not cameras.
  { key: "cetsp", fetch: fetchCetsp },
  // First Balkan feeds, and two rather than one on purpose: they are separate
  // operators (the interior ministry and the roads company) with separate
  // outages, and mergeResults keeps last-good PER FEED. Folded into a single
  // "serbia" key, a bad round at either portal would mark the other's cameras
  // stale too. Neither declares a budgetMs — both were measured well inside the
  // 10s default (see each adapter's fetchRegistry).
  { key: "mup-rs", fetch: fetchSerbiaBorders },
  { key: "putevi-rs", fetch: fetchSerbiaTolls },
];

export const CAMERA_FEED_COUNT = SOURCES.length;

/** The feed table itself, so a test can assert on the budgets we actually ship. */
export const CAMERA_FEEDS: readonly CameraFeed[] = SOURCES;

/** How the last refresh went, per feed. Published by /api/coverage. */
export interface FeedHealth {
  key: string;
  ok: boolean;
  count: number;
  /** True when `count` is last-good data kept after this feed failed. */
  stale: boolean;
}

let lastGood = new Map<string, Camera[]>();
let health: FeedHealth[] = [];
let cache: { cameras: Camera[]; at: number } | null = null;
let inflight: Promise<Camera[]> | null = null;

/**
 * Merge one refresh round into the camera set.
 *
 * A failed feed KEEPS ITS LAST-GOOD CAMERAS instead of disappearing. This used to
 * take only the fulfilled results and write the smaller set straight back to the
 * cache, so one flaky upstream silently deleted its whole region: an audit caught
 * the same server reporting 19,328 cameras at 11:06 and 14,985 at 12:17 — 4,343
 * gone, with /api/coverage presenting the reduced figure as fact.
 *
 * Losing a feed for one cycle is normal. Losing 4,000 cameras and saying nothing
 * is not. The `stale` flag on each feed's health says which is which.
 */
export function mergeResults(
  results: PromiseSettledResult<Camera[]>[],
  previous: Map<string, Camera[]>,
  feeds: { key: string }[] = SOURCES,
): { cameras: Camera[]; lastGood: Map<string, Camera[]>; health: FeedHealth[] } {
  const nextGood = new Map(previous);
  const nextHealth: FeedHealth[] = [];
  const cameras: Camera[] = [];

  results.forEach((r, i) => {
    const key = feeds[i]?.key ?? `feed-${i}`;
    if (r.status === "fulfilled" && r.value.length > 0) {
      nextGood.set(key, r.value);
      cameras.push(...r.value);
      nextHealth.push({ key, ok: true, count: r.value.length, stale: false });
      return;
    }
    // Failed, or answered with nothing. Serve what this feed last gave us.
    const kept = previous.get(key) ?? [];
    cameras.push(...kept);
    nextHealth.push({ key, ok: false, count: kept.length, stale: kept.length > 0 });
  });

  return { cameras, lastGood: nextGood, health: nextHealth };
}

async function refresh(): Promise<Camera[]> {
  const results = await Promise.allSettled(
    SOURCES.map((f) => withTimeout(f.fetch(), feedBudgetMs(f), f.key)),
  );
  const merged = mergeResults(results, lastGood);
  if (merged.cameras.length === 0) {
    // Cold start with every feed down — surface it rather than caching an empty
    // world as if it were the answer.
    if (!cache) throw new Error("all camera sources failed and no cache is available");
    return cache.cameras;
  }
  lastGood = merged.lastGood;
  health = merged.health;
  cache = { cameras: merged.cameras, at: Date.now() };
  return merged.cameras;
}

/** Per-feed outcome of the last refresh — the coverage denominator. */
export function feedHealth(): FeedHealth[] {
  return health;
}

// Stale-while-revalidate: a fresh cache returns instantly; a stale cache returns
// instantly too while a single shared refresh runs in the background. Only the
// very first (cold) call, with no cache at all, waits for the fetch — important
// now that Castle Rock pages ~100 requests and a cold load can take ~40s.
export async function getRegistry(): Promise<Camera[]> {
  if (cache && Date.now() - cache.at < REGISTRY_TTL_MS) return cache.cameras;
  if (!inflight) {
    inflight = refresh()
      .catch((e) => {
        if (!cache) throw e; // cold + total failure → surface the error
        return cache.cameras; // otherwise keep serving stale
      })
      .finally(() => {
        inflight = null;
      });
  }
  return cache ? cache.cameras : inflight;
}

export async function getCameraById(id: string): Promise<Camera | null> {
  return findById(await getRegistry(), id);
}

export async function nearestTo(lat: number, lon: number, limit = 8) {
  return nearest(await getRegistry(), lat, lon, limit);
}
