// Server-side cache for the live webcam search.
//
// The road-camera registry already uses a fresh-or-revalidate cache with inflight
// dedup (lib/sources/registry.ts); the webcam path never had one, which is why
// /api/webcam-image spends the Windy key on every miss. This gives the search the
// same treatment before it ever ships: identical boxes share one upstream call, and
// a burst of keystrokes costs one request rather than one per keystroke.
//
// Windy publishes no request ceiling we can read (docs/API_KEYS.md records none), so
// the cache is the only thing standing between a busy search box and an unknown
// quota. That is a reason to be conservative, not a reason to guess.

import { fetchWebcamsInBbox } from "@/lib/sources/windy";
import { bboxKey, type Bbox } from "@/lib/webcams/bbox";
import type { Webcam } from "@/lib/types";

export interface WebcamSearchResult {
  webcams: Webcam[];
  /** Windy's own count for the box — never our page size. */
  total: number;
  dormant: boolean;
  note: string | null;
}

/** Windy's image tokens last ~10 minutes; a LIST of webcams in an area is far more
 *  stable than that, but reusing the same window keeps one number in one place. */
const TTL_MS = 10 * 60 * 1000;
/** Enough for a session of searching without becoming a memory leak on a long-lived
 *  serverless instance. */
const MAX_ENTRIES = 120;

interface Entry {
  at: number;
  value: WebcamSearchResult;
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<WebcamSearchResult>>();

function evictIfNeeded(): void {
  if (cache.size <= MAX_ENTRIES) return;
  // Insertion-ordered Map: the oldest key is the first one out.
  const oldest = cache.keys().next();
  if (!oldest.done) cache.delete(oldest.value);
}

/** Test-only: drop the module-level memory between cases. */
export function __resetWebcamSearchCache(): void {
  cache.clear();
  inflight.clear();
}

export async function searchWebcams(bbox: Bbox): Promise<WebcamSearchResult> {
  const key = bboxKey(bbox);

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const pending = inflight.get(key);
  if (pending) return pending;

  const p = fetchWebcamsInBbox(bbox)
    .then((value) => {
      // Only cache an answer we actually got. Caching a transport failure for ten
      // minutes would turn one bad moment into a ten-minute outage for that area,
      // and a dormant key is a configuration state that can change under us.
      if (!value.dormant && value.note === null) {
        cache.set(key, { at: Date.now(), value });
        evictIfNeeded();
      }
      return value;
    })
    .catch(
      (): WebcamSearchResult => ({
        webcams: [],
        total: 0,
        dormant: false,
        note: "Could not reach Windy for this area.",
      }),
    )
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, p);
  return p;
}
