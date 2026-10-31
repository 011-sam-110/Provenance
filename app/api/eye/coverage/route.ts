import { getRegistry } from "@/lib/sources/registry";
import { ensurePlayCheck } from "@/lib/liveness/playcheck.server";
import { coverageCacheHeaders, coverageCellsBody, coveragePointsBody } from "@/lib/eye/coverageBody";
import { parseBox } from "@/lib/eye/vessels";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/eye/coverage: where the cameras are, for the person on the console's map
 * (components/console/EyePerson.tsx). With no query it answers the whole index, about 130 KB
 * gzipped, one row per 0.1 degree cell: [lat, lon, cameras, played, still's camera id, region].
 * The browser asks once, on the first hover or focus of the person, and every later search runs
 * on its own copy, so a drag sends no location to any server.
 *
 * ?bbox=west,south,east,north answers the exact cameras in a box, at most 2,000, the nearest the
 * middle, once per carry at zoom 9 and closer, because a 0.1 degree cell is too coarse to draw
 * there. It is the view, not the pointer, snapped outward to the cell grid.
 *
 * Dormant-safe: a failure, or a registry with nothing in it yet, is a 200 with ok: false and no
 * rows, not stored, and the person then opens where it is dropped. Never a 5xx. A bad bbox is a 400.
 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("bbox");
  const box = raw === null ? null : parseBox(raw);
  if (raw !== null && !box) {
    return Response.json({ ok: false, error: "bbox=west,south,east,north" }, { status: 400, headers: NO_STORE });
  }
  try {
    const cams = await getRegistry();
    // Starts the play check once per process, so `played` comes from it (see /api/near).
    ensurePlayCheck(getRegistry);
    if (cams.length === 0) return Response.json({ ok: false, regions: [], cells: [], total: 0, points: [] }, { headers: NO_STORE });
    if (box) return Response.json(coveragePointsBody(cams, box), { headers: coverageCacheHeaders() });
    return new Response(coverageCellsBody(cams), {
      headers: { "Content-Type": "application/json", ...coverageCacheHeaders() },
    });
  } catch {
    return Response.json({ ok: false, regions: [], cells: [], total: 0, points: [] }, { headers: NO_STORE });
  }
}
