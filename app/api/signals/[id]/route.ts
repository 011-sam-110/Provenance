import { getSignal } from "@/lib/signals/registry";
import { describeCoverage, readCoverage } from "@/lib/signals/coverage";
import type { SignalFeature } from "@/lib/signals/types";
import { cacheTtlMs } from "@/lib/signals/cacheTtl";
import { edgeCacheControl } from "@/lib/http/cache";
import { publishOutcome } from "@/lib/signals/outcome";

export const dynamic = "force-dynamic";
// Most adapters are a single fast upstream call. A few (e.g. submarine cables,
// which enriches ~700 keyless per-cable JSONs on a cold, 24h-cached load) need a
// wider ceiling; this is a MAX, so cheap layers are unaffected.
export const maxDuration = 60;

// Generic signals proxy: GET /api/signals/<id> → getSignal(id).fetch().
//
// Dormant-safe by construction:
//   • unknown id            → 404
//   • upstream fetch failure → the adapter resolves to [] (never throws), so we
//     respond {count:0, features:[]} — never a 5xx.
// A short per-id server cache (keyed to the source's own refreshMs) shields the
// upstream from bursts when several clients toggle the same layer.
//
// TRUNCATION HONESTY. Several adapters can only draw the top N of what upstream
// offered (fire-active keeps 1,500 of tens of thousands of VIIRS pixels; gpsJamming
// keeps 400 cells; conflict keeps 300 places). `count` alone made those caps read
// as measurements. When an adapter declares coverage (lib/signals/coverage.ts) the
// response carries it — how many were available, how many are here, whether a cap
// was applied, and a plain-English note — so no consumer has to guess.
//
// `coverage` is present ONLY when the adapter declared it. Its ABSENCE means "not
// declared", never "nothing was truncated" — do not render "complete" off a
// missing record.

interface Cached {
  at: number;
  features: SignalFeature[];
  /**
   * The outcome as the adapter reported it, captured at fetch time.
   *
   * Stored separately because the Symbol side-channel does NOT survive a structured
   * clone or a JSON round trip, and because a cache hit must report the ORIGINAL
   * upstream read instant rather than the moment it was replayed. Re-deriving
   * `observedAt` on a hit would make a six-hour-old reading look brand new on every
   * request, which is precisely the "age of the response, not age of the data"
   * failure this whole change exists to remove.
   */
  outcome: ReturnType<typeof publishOutcome>;
}
const cache = new Map<string, Cached>();


/**
 * `{ok, observedAt, count, features}` plus the adapter's coverage record.
 *
 * `ok` and `observedAt` are ALWAYS present, unlike `coverage`. That asymmetry is
 * deliberate: an absent coverage record honestly means "this layer declares no
 * denominator", whereas an absent outcome would leave a consumer to guess, and the
 * guess everyone makes is "fine". `publishOutcome` therefore resolves undeclared to
 * `ok: false, degradedReason: "not declared"` rather than omitting the field.
 */
function payload(features: SignalFeature[], outcome: ReturnType<typeof publishOutcome>) {
  const coverage = readCoverage(features);
  return {
    ...outcome,
    count: features.length,
    ...(coverage ? { coverage: describeCoverage(coverage) } : {}),
    features,
  };
}

/**
 * The shared-cache lifetime is the SAME value the in-process cache above uses, so
 * the edge and the server expire together. Deriving both from `cacheTtlMs` means a
 * layer's cadence is declared once, on the adapter, and a new layer inherits correct
 * caching with no route edit — the property the whole registry is built on.
 *
 * The empty-result rule carries over for free: a layer returning nothing is held for
 * at most EMPTY_RETRY_MS, so a dormant upstream is re-asked promptly instead of a
 * six-hour blank being pinned at the edge.
 */
function cacheHeaders(refreshMs: number, features: SignalFeature[], ok: boolean) {
  // A failure is never cached. `cacheTtlMs`'s EMPTY_RETRY_MS already shortens an
  // empty result to minutes rather than hours, but "short" is still wrong here: a
  // cached degraded body keeps asserting a specific `observedAt` and a specific
  // reason for the whole window, so a five-minute outage would be reported for five
  // minutes after it ended. no-store means the next request re-asks upstream and the
  // layer recovers as soon as the upstream does.
  if (!ok) return { "Cache-Control": "no-store" };
  return {
    "Cache-Control": edgeCacheControl(cacheTtlMs(refreshMs, features.length === 0)),
  };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const source = getSignal(id);
  if (!source) return new Response("unknown signal", { status: 404 });

  const hit = cache.get(id);
  // A DEGRADED entry is held for the short empty-retry window, not the layer's full
  // cadence — even when it carries last-good rows. This used to key on
  // `features.length === 0` alone, which meant a failure that still had features was
  // replayed from this cache for the whole refresh window (up to 24h on some
  // layers). The route's `no-store` header then only stopped the EDGE caching it,
  // so the claim that "the next request re-asks upstream" was simply false for that
  // case: the in-process cache answered first and never re-asked.
  const holdBriefly = hit ? hit.features.length === 0 || !hit.outcome.ok : false;
  if (hit && Date.now() - hit.at < cacheTtlMs(source.refreshMs, holdBriefly)) {
    return Response.json(payload(hit.features, hit.outcome), {
      headers: cacheHeaders(source.refreshMs, hit.features, hit.outcome.ok),
    });
  }

  let features: SignalFeature[] = [];
  let outcome: ReturnType<typeof publishOutcome>;
  try {
    features = await source.fetch();
    outcome = publishOutcome(features);
  } catch (err) {
    // Belt-and-braces: a misbehaving adapter must never surface as a 5xx. It also
    // must not surface as a healthy empty layer — an adapter that THREW is the most
    // degraded state there is, so say so rather than inheriting the last-good
    // outcome along with the last-good features.
    features = hit?.features ?? [];
    // observedAt is the ORIGINAL upstream read behind these fallback rows, taken
    // from the previous outcome rather than from `hit.at` (when the cache was
    // written) or Date.now() (when we gave up). Serving last-good rows under a
    // fresh-looking stamp is the same age-of-response-not-age-of-data lie this
    // change exists to remove.
    outcome = {
      ok: false,
      observedAt: hit?.outcome.observedAt ?? Date.now(),
      // An adapter that threw tells us nothing about provenance, so do not inherit
      // the previous basis — "live" is the honest default for an unknown read.
      basis: "live",
      degradedReason: "adapter threw",
    };
    console.warn(`[signals:${id}] adapter threw:`, err);
  }
  cache.set(id, { at: Date.now(), features, outcome });
  return Response.json(payload(features, outcome), {
    headers: cacheHeaders(source.refreshMs, features, outcome.ok),
  });
}
