import { describeWebcamSample, type WebcamSample } from "@/lib/webcams/fetch";
import { WINDY_SOURCE } from "@/lib/sources/windy";
import { describeCoverage } from "@/lib/signals/coverage";
import { edgeCacheControl } from "@/lib/http/cache";

// The body of GET /api/webcams, and its edge-cache policy.
//
// WHY THIS IS NOT IN THE ROUTE FILE. A Next.js App Router route module may only export
// the names Next recognises - the HTTP verbs plus dynamic, revalidate, runtime,
// dynamicParams, fetchCache, preferredRegion, maxDuration and generateStaticParams.
// Anything else is a HARD BUILD FAILURE:
//
//     Type error: Route "app/api/webcams/route.ts" does not match the required types
//     of a Next.js Route. "webcamsBody" is not a valid Route export field.
//
// and - this is the part worth knowing - `npx tsc --noEmit` and the whole vitest suite
// pass anyway. The route-export contract is checked only inside `next build`, during
// "Linting and checking validity of types", AFTER tsc has already been satisfied. So a
// helper exported from a route file for a test to import looks completely green locally
// and fails the deployment. Helpers live here; the route imports one function.

/**
 * Shared-cache lifetime, and the reasoning is NOT the registry's.
 *
 * lib/webcams/registry.ts holds its sample for 8 minutes, deliberately under Windy's
 * ~10-minute image-token expiry. That ceiling protects TOKENS, and there are none in
 * this response: the route ships thin markers and the dossier re-resolves a fresh
 * image per view through /api/webcam-image. So the token clock does not bind here.
 *
 * What does bind is honesty, and this body is the easy case — it carries no timestamp
 * at all, absolute or relative, so a cached copy cannot under-report anything's age.
 * Compare /api/planes, whose `staleness.ageMs` is relative and freezes under a cache;
 * that is why its TTL is 20 s and this one can be the same 60 s as /api/cameras. What
 * moves in this body is a webcam's position, title and `available` flag, on the order
 * of the 8-minute sample behind it.
 *
 * As with /api/cameras this is about not paying an invocation per visitor, not about
 * protecting the upstream — getWebcams() already shields Windy.
 */
const WEBCAMS_TTL_MS = 60_000;

/**
 * The serialised body, held until the registry publishes a new sample.
 *
 * WHY. 2,000 webcams, 425 KB of JSON measured on prod, rebuilt on every request
 * because this route had no cache header at all — so the edge never answered one and
 * every visitor cost an invocation AND a full re-serialisation. The answer was
 * byte-for-byte the same each time until the 8-minute sample rolled over.
 *
 * WHY IDENTITY IS THE RIGHT KEY. `getWebcams()` returns `cache.sample`, and
 * `refresh()` only ever REPLACES that object — including on the failure path, where it
 * rewrites the timestamp but re-uses the same sample rather than mutating it. So
 * `from === sample` is true exactly while the contents are unchanged, and a new sample
 * recomputes. Nothing in the body depends on the clock: `describeWebcamSample` and
 * `describeCoverage` are both pure over the sample, so there is no second expiry to
 * keep in step.
 *
 * Same shape as the memo in app/api/cameras/route.ts. One entry, per isolate, and it
 * lowers peak memory rather than raising it — one retained string instead of 425 KB of
 * garbage per request.
 */
let serialised: { from: WebcamSample; body: string } | null = null;

/**
 * GET /api/webcams — a global sample of Windy webcams as thin markers (the
 * x-windy-api-key is added server-side; it never reaches the client). Distinct
 * from /api/cameras: webcams are their own layer and never fold into the
 * road-camera count.
 *
 * Image URLs are intentionally omitted here — their tokens are short-lived, so
 * the dossier re-resolves a fresh image per view through /api/webcam-image.
 *
 * TRUNCATION HONESTY. The merged global sample is capped at MAX_WEBCAMS (2000);
 * before this the cap shipped with nothing disclosing it, so `count` was the
 * ceiling wearing the costume of a measurement — the exact defect the coverage
 * contract exists to prevent. `sample.coverage` (lib/signals/coverage.ts,
 * attached in lib/webcams/normalize.ts's toWebcams()) now carries the true
 * pre-cap total, so this can say "2,000 of N" instead of a bare 2,000.
 *
 * DESIGN DECISION — SIGNAL style ("N of M"), not the camera style. Cameras'
 * /api/coverage reports {feeds: {answered, total, stale}} because a camera total
 * is a SUM ACROSS ELEVEN INDEPENDENT NETWORKS, any of which can be down on a
 * given refresh — the denominator that matters there is "how many of our feeds
 * answered". Webcams have exactly ONE upstream (Windy) and no per-feed health
 * dimension to report; the only thing being hidden is a single render cap over
 * one merged pool of rows. That is precisely what lib/signals/coverage.ts's
 * applyCap/coverageCountLabel contract was built for (it already backs
 * /api/planes and /api/signals/<id> for the same reason), so reusing it costs
 * nothing, and inventing a "feeds" shape for a single source would just be
 * duplication with no real denominator to put in it.
 *
 * Returns {count, webcams[], dormant, note, attribution, coverage?}. `note` is a
 * plain sentence describing what actually happened upstream, so an empty layer
 * can always explain itself instead of silently looking like "no webcams exist".
 * `coverage` is present only when the sample declared one (i.e. not dormant) —
 * its absence means "not declared", never "nothing was truncated".
 */
export function webcamsBody(sample: WebcamSample): string {
  if (serialised && serialised.from === sample) return serialised.body;
  // `city` and `categories` survive lib/webcams/normalize.ts but used to be dropped
  // here. They are what lets a caller filter to squares, promenades and old towns
  // instead of matching on title text — the difference between finding the
  // pedestrian-zone cameras this layer is mostly useful for and guessing at them.
  const thin = sample.webcams.map((w) => ({
    id: w.id,
    title: w.title,
    lat: w.lat,
    lon: w.lon,
    country: w.country,
    region: w.region,
    city: w.city,
    categories: w.categories,
    available: w.available,
    detailUrl: w.detailUrl,
  }));
  const body = JSON.stringify({
    count: thin.length,
    webcams: thin,
    dormant: sample.dormant,
    note: describeWebcamSample(sample),
    attribution: WINDY_SOURCE.attribution,
    ...(sample.coverage ? { coverage: describeCoverage(sample.coverage) } : {}),
  });
  serialised = { from: sample, body };
  return body;
}

/** Test seam, matching the house pattern in lib/webcams/search.ts. */
export function __resetWebcamsBody(): void {
  serialised = null;
}

/** The Cache-Control this route answers with. Lives beside the TTL it is derived from. */
export function webcamsCacheControl(): string {
  return edgeCacheControl(WEBCAMS_TTL_MS, 300_000);
}
