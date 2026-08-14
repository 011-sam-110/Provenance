import { fetchAircraftSnapshot } from "@/lib/sources/opensky";
import { describeCoverage } from "@/lib/signals/coverage";
import { edgeCacheControl } from "@/lib/http/cache";

export const dynamic = "force-dynamic";

/**
 * Shared-cache lifetime, deliberately far shorter than the 240 s upstream cadence.
 *
 * This body is the one read response carrying a RELATIVE age (`staleness.ageMs`),
 * and a cached copy freezes that number while the clock keeps running — so the TTL
 * is the maximum amount by which this endpoint can under-report staleness. 20 s
 * against a 240 s refresh keeps that error under 10% of one cycle, which is inside
 * what the staleness gate already tolerates. Do not raise it to "save invocations"
 * without also making the age absolute; the saving is small and the cost is the
 * freshness claim.
 */
const PLANES_TTL_MS = 20_000;

/**
 * Headroom for the adsb.lol fallback sweep, which is rate-limit-paced and budgets
 * itself 14 s (lib/sources/adsb.ts). Only the request that triggers a Data Cache
 * revalidation pays it — at most once per 240 s for the whole deployment — but that
 * request must not be killed mid-sweep, or the cache never commits and the layer
 * stays empty for exactly the reason this fix exists. 30 s is headroom, not a
 * target; `app/api/signals/[id]` already establishes 60 as acceptable here.
 */
export const maxDuration = 30;

/**
 * GET /api/planes — live aircraft (keyless, from a bounded adsb.lol grid sweep) as
 * classified WorldObjects. fetchAircraftSnapshot serves a shared, stored snapshot
 * (Next Data Cache) and handles failure (last-good / empty), so this route never
 * throws and users never trigger their own upstream pull.
 *
 * NOT WORLDWIDE, and do not describe it as such. OpenSky's global `/states/all` was
 * the source until it was removed on licensing grounds (lib/sources/opensky.ts,
 * `fetchAircraftOnce`). The sweep that replaced it is dense over North America and
 * Europe and thin elsewhere. Production had already been served entirely by the
 * sweep for months, so the coverage did not change here — only the code's claim
 * about it did.
 *
 * TRUNCATION HONESTY. The served set is capped at MAX_PLANES (3,000) out of a global
 * snapshot measured at 11,705 positioned aircraft, so `count` alone was the cap
 * passing itself off as a measurement. The snapshot carries the coverage record
 * (lib/signals/coverage.ts) that says how many were available, how many are here and
 * how the survivors were chosen — the same contract the signals API publishes.
 *
 * `coverage` is present ONLY when the snapshot declared it. Its ABSENCE means "not
 * declared" (no successful upstream fetch yet), never "nothing was truncated".
 *
 * STALENESS HONESTY. fetchAircraftSnapshot runs every result through a staleness
 * gate (lib/sources/opensky.ts: decideStaleness/gateSnapshot) before returning it,
 * so this route never has to reason about age itself — it just forwards what the
 * gate decided:
 *   - fresh          → `staleness` absent, `planes` is the live set.
 *   - stale-but-usable → `staleness: {stale: true, ageMs}`, `planes` still populated
 *     — aircraft move, so any consumer showing these positions MUST show the age.
 *   - too old, or never fetched → `planes: []`; `staleness: {reason, ageMs?}` when
 *     there's a reason to give (never served as if the layer were simply quiet).
 *
 * PROVENANCE. `source` names which upstream actually produced these positions.
 * Everything minted now is `"adsb.lol"` (a bounded grid sweep of a community
 * receiver network, dense over North America and Europe and thin elsewhere).
 * `"opensky"` (worldwide, one global snapshot) can still appear on a snapshot the
 * Data Cache kept across the deploy that removed it; that is a correctly-labelled
 * stale snapshot, not a live source, and it ages out on its own. The two are NOT
 * interchangeable in coverage, so a consumer that prints a count without reading
 * this cannot describe it correctly. Absent means no snapshot was served, never
 * "either is fine".
 *
 * Response: { count, source?, coverage?, staleness?, planes }
 */
export async function GET() {
  const { planes, coverage, staleness, source } = await fetchAircraftSnapshot();
  return Response.json(
    {
      count: planes.length,
      ...(source ? { source } : {}),
      ...(coverage ? { coverage: describeCoverage(coverage) } : {}),
      ...(staleness ? { staleness } : {}),
      planes,
    },
    { headers: { "Cache-Control": edgeCacheControl(PLANES_TTL_MS) } },
  );
}
