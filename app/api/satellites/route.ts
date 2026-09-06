import { fetchTLEs, TTL_MS } from "@/lib/sources/celestrak";
import { edgeCacheHeaders } from "@/lib/http/cache";

export const dynamic = "force-dynamic";

// Returns the raw TLE set for the requested group. The client propagates these
// locally (satellite.js) so the satellites revolve smoothly instead of jumping
// on each poll. ?group=visual (default) | stations | active | starlink | ...
//
// The edge TTL is celestrak's own hold time. This route had NO Cache-Control at all,
// so it took Vercel's `max-age=0, must-revalidate` default and missed on every
// request - 4,391 invocations in a production day for a body that is identical for
// every visitor asking for the same group.
export async function GET(req: Request) {
  const group = new URL(req.url).searchParams.get("group") ?? "visual";
  try {
    const satellites = await fetchTLEs(group);
    return Response.json(
      { count: satellites.length, source: "celestrak", group, satellites },
      { headers: edgeCacheHeaders(TTL_MS) },
    );
  } catch {
    return Response.json(
      { count: 0, source: "celestrak", group, satellites: [], error: "celestrak_unavailable" },
      // A failure is never cached: a cached empty set keeps asserting "celestrak is
      // down" for the whole window, long after it recovers. Same rule as
      // /api/signals/<id>.
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}
