// Per-camera freshness — the honest "is THIS feed actually live?" maths for the
// dossier countdown. Cameras are fetched once (not polled), so "freshness" is
// only what's derivable from the camera record + the client's own refresh cycle:
//   • a countdown to the next client-side frame pull (refreshSeconds), and
//   • the age of the upstream sample IF the record carries `lastSampledAt`.
//
// Pure + DOM-free so it mirrors lib/freshness.ts (freshnessAgeMs/classifyFreshness)
// and is trivially unit-tested. The dossier wires these to a 1s useNow() tick.

/**
 * ms until the next frame refresh, cycling within (0, refreshMs]. The dossier's
 * <CameraImage> busts its URL every `refreshSeconds`, so this counts down and
 * wraps in lockstep with that cycle (modulo keeps it correct even if a tick is
 * missed). Returns a full period at the exact cycle boundary rather than 0.
 */
export function msUntilRefresh(loadedAt: number, refreshSeconds: number, now: number): number {
  const refreshMs = Math.max(1, refreshSeconds) * 1000;
  const into = Math.max(0, now - loadedAt) % refreshMs;
  return into === 0 ? refreshMs : refreshMs - into;
}

/** Fraction [0,1] of the current refresh cycle already elapsed — the progress bar. */
export function refreshProgress(loadedAt: number, refreshSeconds: number, now: number): number {
  const refreshMs = Math.max(1, refreshSeconds) * 1000;
  const remaining = msUntilRefresh(loadedAt, refreshSeconds, now);
  const elapsed = (refreshMs - remaining) / refreshMs;
  return elapsed < 0 ? 0 : elapsed > 1 ? 1 : elapsed;
}

/** "next frame in 7s" countdown label from remaining ms (whole seconds, ≥ 0). */
export function formatCountdown(ms: number): string {
  return `${Math.max(0, Math.ceil(ms / 1000))}s`;
}

/**
 * Age (ms) since the upstream sample ISO timestamp, or null if the record has no
 * `lastSampledAt` or it can't be parsed. Never negative (clock skew → 0).
 */
export function sampledAgeMs(lastSampledAt: string | undefined | null, now: number): number | null {
  if (!lastSampledAt) return null;
  const t = Date.parse(lastSampledAt);
  return Number.isFinite(t) ? Math.max(0, now - t) : null;
}

/**
 * The cache-buster, quantised to a global window instead of a per-mount counter.
 *
 * `?_=` exists so a browser cannot serve a frame older than the operator's own
 * publish interval. But an INCREMENTING value mints a fresh CDN key on every
 * refresh — measured on prod, `_=0` twice is a HIT and `_=1` is a MISS — so every
 * viewer pays an origin fetch that nobody else can share. Flooring the clock into
 * refresh-sized buckets gives one value per window that all clients agree on: the
 * first request in a window fills the cache and the rest hit it, while the value
 * still changes as soon as a genuinely newer frame could exist.
 *
 * It is also mount-independent, which is what lets a tile unmount and come back
 * without resetting to bucket 0 and pinning itself to a frame from whenever it
 * first loaded.
 */
export function frameBucket(nowMs: number, refreshSeconds: number): number {
  const secs = Number.isFinite(refreshSeconds) && refreshSeconds > 0 ? refreshSeconds : 60;
  return Math.floor(nowMs / (secs * 1000));
}
