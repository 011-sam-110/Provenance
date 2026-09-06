// Edge-cache policy for the read-only API routes.
//
// WHY THIS EXISTS. Every read route was `force-dynamic` with no Cache-Control, so
// the Vercel edge reported X-Vercel-Cache: MISS on every request and each visitor
// cost a serverless invocation. The upstreams were never at risk (Next's Data Cache
// and the per-id caches already dedupe those), but the invocation was paid per
// person. A shared-cache TTL lets the edge answer repeat visitors outright.
//
// THE HONESTY CONSTRAINT. This product's claim is that it tells you how old a
// reading is, so a cache must never outlive the cadence of the data inside it.
// Two rules follow, and both are load-bearing:
//
//   1. The TTL is DERIVED from the source's own declared refresh interval, never
//      invented here. Caching a 60 s feed for 5 minutes would make the freshness
//      indicators lie, which is the one defect this project exists to avoid.
//   2. A body carrying a RELATIVE age (planes ship `staleness.ageMs`) freezes that
//      number while real time keeps moving, so a cached copy under-reports age by
//      up to the TTL. Absolute timestamps (cameras' `lastSampledAt`) do not have
//      this problem — the client subtracts from the current clock. Routes with a
//      relative age must therefore keep a TTL far below the tolerance of the number
//      they carry; see the call sites.
//
// `s-maxage` is a SHARED-cache directive: browsers ignore it, so a visitor's own
// tab still revalidates while the CDN absorbs the fan-out. That is the behaviour we
// want, and it is why this is one header rather than a Cache-Control/CDN-Cache-
// Control pair.

/** Lower bound. A sub-second shared TTL buys nothing and reads as a mistake. */
export const MIN_TTL_SECONDS = 1;

/**
 * Build a `Cache-Control` value for a read-only JSON response.
 *
 * @param ttlMs      how long the edge may serve this without re-asking — pass the
 *                   source's own refresh interval, not a guess.
 * @param staleForMs how long a stale copy may still be served while a refresh runs
 *                   behind it. Defaults to the TTL itself, which keeps the worst
 *                   case at two intervals old and never silently exceeds it.
 */
export function edgeCacheControl(ttlMs: number, staleForMs?: number): string {
  const ttl = toSeconds(ttlMs);
  const swr = toSeconds(staleForMs ?? ttlMs);
  return `public, s-maxage=${ttl}, stale-while-revalidate=${swr}`;
}

/** ms → whole seconds, floored, never below MIN_TTL_SECONDS. Non-finite input is treated as the floor. */
export function toSeconds(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return MIN_TTL_SECONDS;
  return Math.max(MIN_TTL_SECONDS, Math.floor(ms / 1000));
}

// ---------------------------------------------------------------------------
// WHY THERE ARE TWO HEADERS AND NOT ONE.
//
// The comment above says `s-maxage` is one header rather than a Cache-Control /
// CDN-Cache-Control pair. That was wrong, and production had been proving it wrong
// for the whole life of the file. Measured against prod on 2026-09-06:
//
//   /api/proxy    sent `public, max-age=300, s-maxage=300`
//                 served `public, max-age=300`                    <- s-maxage gone
//   /api/signals  sent `public, s-maxage=60, stale-while-revalidate=60`
//                 served `public`                                 <- both gone
//
// `max-age` arrives untouched; the SHARED-cache directives do not. Checked on five
// routes (signals, cameras, planes, webcams, coverage), all five `X-Vercel-Cache:
// MISS`, and the one thing all of them share is `dynamic = "force-dynamic"`.
//
// So every helper below was computing a correct TTL and handing it to the one header
// that gets rewritten before it leaves. The edge answered nobody; each visitor cost
// an invocation, which is the exact charge the file was written to stop. Measured
// over one day at the time of the fix: 108,344 invocations, 12.4 per page load.
//
// `Vercel-CDN-Cache-Control` is read by the Vercel CDN itself and is NOT rewritten.
// Sending the same value under both names is what makes the policy take effect.
//
// THE TTLs ARE UNCHANGED BY THIS. Nothing here caches for longer than it already
// claimed to — the freshness rule at the top of this file still holds, because every
// value still comes from the source's own declared refresh interval.

/** The header name the Vercel CDN reads. Not rewritten by the framework. */
export const CDN_HEADER = "Vercel-CDN-Cache-Control";

/**
 * Cache headers for a read-only JSON response: `edgeCacheControl`'s policy, sent
 * under both names so it reaches the CDN as well as any cache in front of it.
 *
 * Spread this into a `headers` object. Prefer it over calling `edgeCacheControl`
 * directly — a lone `Cache-Control` is the defect this pair exists to prevent.
 */
export function edgeCacheHeaders(ttlMs: number, staleForMs?: number): Record<string, string> {
  const value = edgeCacheControl(ttlMs, staleForMs);
  return { "Cache-Control": value, [CDN_HEADER]: value };
}

/**
 * Cache headers where the browser and the shared caches get DIFFERENT lifetimes.
 *
 * @param browserSeconds  `max-age` — what the visitor's own cache may keep.
 * @param sharedSeconds   `s-maxage` — what the CDN may keep. Usually the longer one.
 */
export function browserAndEdgeHeaders(
  browserSeconds: number,
  sharedSeconds: number,
): Record<string, string> {
  const browser = toSeconds(browserSeconds * 1000);
  const shared = toSeconds(sharedSeconds * 1000);
  return {
    "Cache-Control": `public, max-age=${browser}, s-maxage=${shared}`,
    [CDN_HEADER]: `public, s-maxage=${shared}`,
  };
}

/**
 * Cache headers for an IMAGE frame (the camera proxies).
 *
 * Differs from `edgeCacheHeaders` in keeping a browser `max-age`: a frame is bytes
 * the same tab re-requests on a timer, so the visitor's own cache should answer it
 * and not just the CDN's. `stale-while-revalidate` is deliberately absent — a stale
 * frame is a stale PICTURE of a road and must not outlive its cadence at all.
 *
 * @param ttlSeconds the source's own refresh cadence, in seconds.
 */
export function frameCacheHeaders(ttlSeconds: number): Record<string, string> {
  return browserAndEdgeHeaders(ttlSeconds, ttlSeconds);
}
