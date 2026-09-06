import type { Camera } from "@/lib/types";
import { isLiveStreamUrl } from "@/lib/proxy/hls-allowlist";
import { edgeCacheHeaders } from "@/lib/http/cache";

// The body of GET /api/cameras, and its edge-cache policy.
//
// WHY THIS IS NOT IN THE ROUTE FILE. A Next.js route module may export ONLY the names
// Next recognises - the HTTP verbs plus dynamic, revalidate, runtime, dynamicParams,
// fetchCache, preferredRegion, maxDuration and generateStaticParams. Anything else is a
// HARD BUILD FAILURE ("... is not a valid Route export field"), and `npx tsc --noEmit`
// plus the whole vitest suite pass anyway - the contract is checked only inside
// `next build`, after tsc has already been satisfied. Helpers live here; the route
// imports one function. tests/unit/route-export-contract.test.ts enforces it.

/**
 * Shared-cache lifetime for the camera list. The registry itself is already
 * stale-while-revalidate server-side, so this is about not paying an invocation per
 * visitor, not about protecting the upstreams.
 *
 * 60 s is safe for this body specifically because every time it carries is ABSOLUTE
 * (`lastSampledAt`), so a cached copy cannot under-report a camera's age — the client
 * subtracts from its own clock. Positions and names move on the order of days.
 */
const CAMERAS_TTL_MS = 60_000;

/**
 * The serialised body, held until the registry replaces its array.
 *
 * WHY. This is the fattest thing the deployment serves: 18,948 cameras, 6.44 MB of
 * JSON measured on prod. Building it means allocating 18,948 fresh objects, calling
 * `isLiveStreamUrl` (a `new URL()` parse) once per camera, and running
 * `JSON.stringify` over the result — 24.3 ms of CPU per call on a developer laptop,
 * and a Fluid vCPU is slower. That was paid on EVERY edge-cache miss, and the answer
 * was byte-for-byte the same each time until the registry refreshed.
 *
 * WHY IDENTITY IS THE RIGHT KEY, AND WHY IT IS EXACT. `getRegistry()` hands back
 * `cache.cameras`, and that array is only ever REPLACED — `mergeResults` builds a new
 * one each round and `refresh()` assigns it — never mutated in place after it is
 * published. So `from === cams` is true exactly while the contents are unchanged, and
 * a refresh produces a new reference which recomputes. No TTL to keep in step with
 * the registry's own, and no way for the two to drift apart.
 *
 * This is a memo, not a cache: it holds one entry, and it is per-isolate, so a cold
 * start pays the build once and nothing else does. It also LOWERS peak memory rather
 * than raising it — one retained 6.44 MB string in place of 6.44 MB of garbage per
 * request.
 */
let serialised: { from: Camera[]; body: string } | null = null;

/**
 * The response body for a camera set. Exported for the test, which is the only way
 * to observe the memo: the string it returns is identical either way, so the
 * property worth asserting is that the WORK is not repeated.
 */
export function camerasBody(cams: Camera[]): string {
  if (serialised && serialised.from === cams) return serialised.body;
  // source + live let the client pick the right camera icon (shape = feed,
  // colour = region). `live` = has a stream our /api/hls proxy can play, so the
  // video icon means genuinely-playable live video (not just any mediaType).
  const cameras = cams.map((c) => ({
    id: c.id, name: c.name, lat: c.lat, lon: c.lon, available: c.available,
    source: c.source, country: c.country, live: isLiveStreamUrl(c.streamUrl),
    // Enriched for the focus view (Camera fields the docked widget doesn't need).
    // NOTE: deliberately NO imageUrl/streamUrl — snapshots go through /api/proxy?id=
    // and /api/hls?id= (SSRF allowlist by id), never a raw upstream URL.
    region: c.region, road: c.road, refreshSeconds: c.refreshSeconds,
    attribution: c.attribution, license: c.license, lastSampledAt: c.lastSampledAt,
    // Present on ~992 of ~18,300 rows (Estonia + Finland), absent on the rest, and
    // the absence is the honest answer: nobody measured this road. Undefined is
    // dropped by JSON.stringify, so the body only grows for rows that have one.
    surface: c.surface,
  }));
  const body = JSON.stringify({ count: cameras.length, cameras });
  serialised = { from: cams, body };
  return body;
}

/** Test seam, matching the house pattern in lib/webcams/search.ts. */
export function __resetCamerasBody(): void {
  serialised = null;
}

/** The cache headers this route answers with. Live beside the TTL they are derived from. */
export function camerasCacheHeaders(): Record<string, string> {
  return edgeCacheHeaders(CAMERAS_TTL_MS, 300_000);
}
