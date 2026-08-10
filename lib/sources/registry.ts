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
import { findById, nearest } from "@/lib/sources/select";

const TTL_MS = 5 * 60 * 1000;

/**
 * One named thunk per feed. The name matters: a failed feed has to be
 * identifiable so its LAST-GOOD cameras can be kept (see mergeResults).
 */
export interface CameraFeed {
  /** Stable id, used only for last-good bookkeeping and the coverage denominator. */
  key: string;
  fetch: () => Promise<Camera[]>;
}

const SOURCES: CameraFeed[] = [
  { key: "tfl", fetch: fetchTfl },
  { key: "caltrans", fetch: fetchCaltrans },
  { key: "scdot", fetch: fetchScdot },
  { key: "digitraffic", fetch: fetchDigitraffic },
  { key: "castlerock", fetch: fetchCastlerock },
  { key: "tripcheck", fetch: fetchTripcheck },
  { key: "drivebc", fetch: fetchDriveBc },
  { key: "nzta", fetch: fetchNzta },
  { key: "iceland", fetch: fetchIceland },
  { key: "estonia", fetch: fetchEstonia },
  { key: "trafficscotland", fetch: fetchTrafficScotland },
];

export const CAMERA_FEED_COUNT = SOURCES.length;

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
  const results = await Promise.allSettled(SOURCES.map((f) => f.fetch()));
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
  if (cache && Date.now() - cache.at < TTL_MS) return cache.cameras;
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
