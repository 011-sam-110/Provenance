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
 * Headroom for the adsb.lol type pull, which is rate-limit-paced and budgets itself
 * 20 s wall clock, retries included (lib/sources/adsb.ts PULL_BUDGET_MS). Only the
 * request that triggers a Data Cache revalidation pays it — at most once per 240 s
 * for the whole deployment — but that request must not be killed mid-pull, or the
 * cache never commits and the layer stays empty. One pull per invocation (see
 * fetchAircraftSnapshot), so 60 is three times the budget; the old 30 sat two
 * seconds above a 14 + 14 s cold path. `app/api/signals/[id]` already runs at 60.
 */
export const maxDuration = 60;

/**
 * GET /api/planes — live aircraft (keyless, from an adsb.lol pull by ICAO type
 * designator) as classified WorldObjects. fetchAircraftSnapshot serves a shared,
 * stored snapshot (Next Data Cache) and handles failure (last-good / empty), so this
 * route never throws and users never trigger their own upstream pull.
 *
 * WORLDWIDE, WITH TWO STATED LIMITS. adsb.lol's `/v2/type/{list}` answers for the
 * whole receiver network in one request, so four paced requests cover the world
 * (~9,700 positioned aircraft on 2026-09-06). Coverage is still a lower bound and
 * the coverage record says why: receivers are wherever volunteers run them, and
 * only listed types are asked for, so an aircraft broadcasting no type code does
 * not appear. Until 2026-09-06 this was a 40-cell point+radius sweep that Vercel's
 * shared egress IP could not get through adsb.lol's rate limit — prod served 1 of
 * 40 cells — which is why the globe showed one or two dense discs.
 *
 * TRUNCATION HONESTY. The served set is capped at MAX_PLANES (3,000) out of that
 * pool, so `count` alone would be the cap passing itself off as a measurement. The
 * survivors are a proportional spatial sample (lib/planes/sample.ts), never a
 * prefix, and the snapshot carries the coverage record (lib/signals/coverage.ts)
 * that says how many were available, how many are here and how the survivors were
 * chosen — the same contract the signals API publishes.
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
 * Everything minted now is `"adsb.lol"` (a community receiver network, pulled by
 * type). `"opensky"` (one global snapshot) can still appear on a snapshot the Data
 * Cache kept across the deploy that removed it; that is a correctly-labelled stale
 * snapshot, not a live source, and it ages out on its own. The two are NOT
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
