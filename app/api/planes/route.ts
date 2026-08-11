import { fetchAircraftSnapshot } from "@/lib/sources/opensky";
import { describeCoverage } from "@/lib/signals/coverage";

export const dynamic = "force-dynamic";

/**
 * GET /api/planes — live aircraft worldwide (keyless, from OpenSky's global
 * `/states/all` snapshot) as classified WorldObjects. fetchAircraftSnapshot serves a
 * shared, stored snapshot (Next Data Cache) and handles failure (last-good / empty),
 * so this route never throws and users never trigger their own upstream pull.
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
 * Response: { count: number, coverage?: SignalCoverage, planes: WorldObject[] }
 */
export async function GET() {
  const { planes, coverage } = await fetchAircraftSnapshot();
  return Response.json({
    count: planes.length,
    ...(coverage ? { coverage: describeCoverage(coverage) } : {}),
    planes,
  });
}
