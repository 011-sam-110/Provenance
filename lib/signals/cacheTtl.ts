// Cache lifetime policy for /api/signals/<id>.
//
// Lives here rather than in the route because a Next route module may only export
// the known handlers and route config — exporting a helper from it fails the
// generated route type check.

/** How long an EMPTY result is allowed to sit in the cache before we ask again. */
export const EMPTY_RETRY_MS = 5 * 60 * 1000;

/**
 * Cache lifetime for a just-fetched signal result.
 *
 * A populated answer is held for the source's own refresh interval. An EMPTY one is
 * held for at most `EMPTY_RETRY_MS`, because an adapter is dormant-safe and returns
 * `[]` for two very different reasons: the world is genuinely quiet, or the upstream
 * just failed. Nothing at this layer can tell those apart, and caching the second
 * case for the full interval is expensive — submarine cables refresh every 6 hours,
 * so one slow cold load blanked that layer for six hours across the whole app while
 * the upstream was healthy the entire time. Re-asking a quiet layer every 5 minutes
 * is far cheaper than being wrong for a working day.
 *
 * Never EXTENDS an interval: a fast layer that is legitimately quiet keeps its own
 * cadence.
 */
export function cacheTtlMs(refreshMs: number, isEmpty: boolean): number {
  return isEmpty ? Math.min(refreshMs, EMPTY_RETRY_MS) : refreshMs;
}
