// A response-body cache that lives on the ORIGIN, in front of the work that builds
// a body rather than in front of the bytes that leave.
//
// WHY THIS EXISTS, MEASURED. Five days of the Caddy access log (2026-09-07 to 09-11)
// say the box answered 1,218,502 requests and sent 275.9 GB, 98.1% of it from
// `/api/*`. Two routes are 73% of that, and they had opposite problems:
//
//   /api/cameras  113.9 GB over ~4,800 calls/day. `camerasBody` already memoises on
//                 the registry array's identity, so the CPU was paid once — but the
//                 body itself was rebuilt into a fresh Response every request and
//                 nothing above it cached anything.
//   /api/planes    86.5 GB over 33,181 calls. NO memo of any kind: every request ran
//                 `JSON.stringify` over ~3,000 aircraft to produce 1.27 MB that was
//                 byte-identical to the last one until the 240 s upstream tick.
//
// Nothing in front helps. Cloudflare answers `cf-cache-status: DYNAMIC` on every
// `/api/*` path because its default cache is keyed on file extension and these have
// none, so a shared-cache TTL on the response reaches no cache that will act on it.
// The only cache this deployment actually controls is this one.
//
// THE SHAPE IS "SERVE, THEN REFRESH", NOT "REFRESH, THEN SERVE". A request that
// arrives after the tick has elapsed is answered from the copy already in hand and
// starts the rebuild behind itself. It does not wait for it. That is the whole point:
// the refresh is paid by nobody, on a schedule that traffic sets, and a slow or
// failing upstream cannot turn into a slow response. Only a COLD cache blocks, once,
// because there is genuinely nothing else to send.
//
// WHAT THIS IS NOT. It is not a freshness story. `app/(site)/privacy` and the whole
// signals contract turn on a reading's age being reported honestly, so:
//
//   * A cached body may only carry ABSOLUTE instants. A body carrying a RELATIVE age
//     ("120000 ms old") freezes that number while the clock keeps moving, and every
//     request served from cache under-reports staleness by however long the entry has
//     been held. `/api/planes` carried exactly that and is why it ships `fetchedAt`
//     now; see the route.
//   * `ttlMs` is the SOURCE'S OWN CADENCE, never a number picked to cut a bill. A
//     layer that refreshes every 60 s is not cacheable for five minutes at any price.
//     `lib/http/cache.ts` states the same rule for the shared-cache headers and it is
//     the same rule; this file just applies it one layer further in.
//
// `version` is the stronger of the two invalidations and should be preferred where
// the data has a natural one. `/api/cameras` passes the registry array, which is only
// ever REPLACED, so identity changes exactly when the contents do. `/api/planes`
// passes the snapshot's `fetchedAt`. A TTL is then a ceiling rather than the
// mechanism, which is what keeps a cached body from outliving its own cadence when an
// upstream quietly stops ticking.

interface Entry {
  body: string;
  builtAt: number;
  version: unknown;
  /**
   * True while a rebuild is in flight, so a burst of requests triggers exactly one.
   *
   * A BOOLEAN SET BEFORE THE CALL, not the promise the call returns, and that
   * ordering is the whole point. `build` may throw synchronously, in which case the
   * async wrapper runs to completion — `finally` included — BEFORE the assignment of
   * its own promise. Storing the promise therefore wrote a settled value back over
   * the `null` that `finally` had just written, the flag never cleared, and every
   * later refresh returned early: one failed upstream fetch froze the entry at its
   * last good body forever. Caught by the retry test, not by reading the code.
   */
  refreshing: boolean;
}

const entries = new Map<string, Entry>();

/**
 * In-flight COLD builds, kept OUT of `entries` on purpose.
 *
 * The first draft put a placeholder Entry in `entries` while the cold build ran, and
 * the second concurrent caller found it and was served its empty body as though it
 * were an answer. Two separate maps make that unrepresentable: an entry in `entries`
 * has always been built, so there is no state in which a caller can read a body that
 * does not exist yet.
 */
const coldBuilds = new Map<string, Promise<string>>();

export interface OriginCacheOptions {
  /** Cache key. One per route; include any parameter the body varies on. */
  key: string;
  /**
   * The source's own refresh cadence in milliseconds. A ceiling on how long a body
   * may be served, NOT a bill-shaped number — see the header of this file.
   */
  ttlMs: number;
  /**
   * Optional invalidation stronger than the clock: any value whose change means the
   * body is out of date. Compared with `Object.is`, so pass a reference that is
   * replaced rather than mutated, or a scalar such as a fetch instant.
   */
  version?: unknown;
  /** Builds the body. Called at most once per tick, never concurrently per key. */
  build: () => string | Promise<string>;
  /** Injectable clock, for the test. */
  now?: () => number;
}

/**
 * The body for this key: the cached one where it is still current, otherwise the
 * cached one plus a rebuild started behind this request.
 *
 * Awaits only on a cold cache. A rebuild that throws leaves the previous body in
 * place and is retried on the next request that finds the entry stale — a failing
 * upstream degrades to "the last good answer, held longer", never to a 5xx, which is
 * the same dormant-safe contract every adapter in this project already keeps.
 */
export async function cachedBody(opts: OriginCacheOptions): Promise<string> {
  const now = opts.now ?? Date.now;
  const existing = entries.get(opts.key);

  if (!existing) return coldBuild(opts, now);

  const versionChanged = "version" in opts && !Object.is(existing.version, opts.version);
  const expired = now() - existing.builtAt >= opts.ttlMs;

  if (versionChanged || expired) startRefresh(existing, opts, now);

  return existing.body;
}

/**
 * The first caller for a key builds and waits; everyone arriving during that build
 * waits on the SAME promise rather than starting their own. Without this, a cold
 * start under load runs one full build per concurrent request — the exact thundering
 * herd the cache exists to prevent, at the one moment it is most expensive.
 */
async function coldBuild(opts: OriginCacheOptions, now: () => number): Promise<string> {
  const pending = coldBuilds.get(opts.key);
  if (pending) return pending;

  const build = (async () => {
    try {
      const body = await opts.build();
      entries.set(opts.key, {
        body,
        builtAt: now(),
        version: opts.version,
        refreshing: false,
      });
      return body;
    } finally {
      // Cleared whether it resolved or threw, so a failed cold start is retried by
      // the next request rather than every later caller awaiting the same rejection.
      coldBuilds.delete(opts.key);
    }
  })();

  coldBuilds.set(opts.key, build);
  return build;
}

/** Start a rebuild behind the caller, unless one is already running for this key. */
function startRefresh(entry: Entry, opts: OriginCacheOptions, now: () => number): void {
  if (entry.refreshing) return;
  entry.refreshing = true;

  void (async () => {
    try {
      const body = await opts.build();
      entry.body = body;
      entry.builtAt = now();
      entry.version = opts.version;
    } catch {
      // Hold the previous body. Deliberately silent: a failed refresh is the
      // upstream's problem and the adapters below already record it; logging here
      // would duplicate that once per tick per layer.
    } finally {
      entry.refreshing = false;
    }
  })();
}

/**
 * Drop one key, or everything. The test seam, matching the house pattern
 * (`__resetCamerasBody`). Not used in the served path.
 */
export function __resetOriginCache(key?: string): void {
  if (key === undefined) {
    entries.clear();
    coldBuilds.clear();
  } else {
    entries.delete(key);
    coldBuilds.delete(key);
  }
}

/** What the cache is holding, for `/admin/analytics`. Never part of a response body. */
export function originCacheStats(): Array<{ key: string; bytes: number; ageMs: number }> {
  const now = Date.now();
  return [...entries.entries()].map(([key, e]) => ({
    key,
    bytes: e.body.length,
    ageMs: now - e.builtAt,
  }));
}
