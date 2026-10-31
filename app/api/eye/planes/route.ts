import { edgeCacheHeaders } from "@/lib/http/cache";
import { clampBox, parseBox, snapBox } from "@/lib/eye/vessels";
import { eyePlanesBody } from "@/lib/eye/planes";
import { readPlanePool } from "@/lib/planes/pool";
import { fetchAircraftSnapshot } from "@/lib/sources/opensky";

export const dynamic = "force-dynamic";

/** The request that triggers a pull pays for it, so this matches /api/planes. */
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/eye/planes?bbox=west,south,east,north: the aircraft around what the God's eye view
 * shows, from everything the plane pull heard, not the worldwide sample /api/planes serves. At
 * most 500, the nearest the middle of the box.
 *
 * The box is snapped outward to a 0.01 degree grid and cut to 1 by 2 degrees about its centre,
 * as /api/eye/vessels does (lib/eye/vessels.ts), so the access log never holds a place finer
 * than about 1 km. It asks adsb.lol for nothing: `fetchAircraftSnapshot` serves the shared
 * stored snapshot and keeps the pull on its own clock, and the whole set is read from memory
 * (lib/planes/pool.ts). After a restart, until the next pull, the answer is the sample's share
 * of the box and says `sampled: true`.
 *
 * Response: { ok, box, clamped, count, sampled, fetchedAt, coverage, planes }, each plane the
 * same row /api/planes serves. Never a 5xx: a failure is a 200 with ok: false. A bad or missing
 * bbox is a 400.
 */
export async function GET(req: Request) {
  const parsed = parseBox(new URL(req.url).searchParams.get("bbox"));
  if (!parsed) {
    return Response.json({ ok: false, error: "bbox=west,south,east,north" }, { status: 400, headers: NO_STORE });
  }
  try {
    const { box, clamped } = clampBox(snapBox(parsed));
    const snapshot = await fetchAircraftSnapshot();
    const body = eyePlanesBody({ box, clamped, snapshot, pool: readPlanePool() });
    // Under a quarter of the 90 s pull, as /api/planes keeps it (PLANES_TTL_MS says why).
    return Response.json(body, { headers: body.ok ? edgeCacheHeaders(20_000) : NO_STORE });
  } catch {
    return Response.json({ ok: false, count: 0, planes: [] }, { headers: NO_STORE });
  }
}
