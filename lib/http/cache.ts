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
