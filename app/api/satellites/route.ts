import { fetchTLEs, isSatelliteGroup, SATELLITE_GROUPS } from "@/lib/sources/celestrak";
import { edgeCacheHeaders } from "@/lib/http/cache";

export const dynamic = "force-dynamic";

/** A good TLE set is cacheable for an hour; CelesTrak itself updates about every 2 h. */
const OK_TTL_MS = 60 * 60 * 1000;
const OK_STALE_MS = 2 * 60 * 60 * 1000;
/** An empty or failed answer is held only briefly, so recovery shows up soon. */
const MISS_TTL_MS = 5 * 60 * 1000;

// Returns the raw TLE set for the requested group. The client propagates these
// locally (satellite.js) so the satellites revolve smoothly instead of jumping
// on each poll. ?group= must be one of SATELLITE_GROUPS (default "visual").
//
// An upstream failure is still a 200 with `error: "celestrak_unavailable"`, never
// a 5xx. Only an unknown group is refused, with 400, before any upstream work.
export async function GET(req: Request) {
  const group = new URL(req.url).searchParams.get("group") ?? "visual";
  if (!isSatelliteGroup(group)) {
    return Response.json(
      { error: "unknown_group", group, allowed: SATELLITE_GROUPS },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const satellites = await fetchTLEs(group);
    const headers = satellites.length > 0 ? edgeCacheHeaders(OK_TTL_MS, OK_STALE_MS) : edgeCacheHeaders(MISS_TTL_MS);
    return Response.json({ count: satellites.length, source: "celestrak", group, satellites }, { headers });
  } catch {
    return Response.json(
      { count: 0, source: "celestrak", group, satellites: [], error: "celestrak_unavailable" },
      { status: 200, headers: edgeCacheHeaders(MISS_TTL_MS) },
    );
  }
}
