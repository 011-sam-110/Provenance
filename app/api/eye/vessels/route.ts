import { edgeCacheHeaders } from "@/lib/http/cache";
import { clampBox, eyeVesselsBody, parseBox, snapBox } from "@/lib/eye/vessels";
import { worldVessels } from "@/lib/eye/vesselFeed";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/eye/vessels?bbox=west,south,east,north: the boats around what the God's eye
 * view shows, from anywhere on Earth. At most 500, the nearest the middle of the box.
 *
 * The box is snapped outward to a 0.01 degree grid and cut to 1 by 2 degrees about its
 * centre (lib/eye/vessels.ts), so the access log never holds a place finer than about
 * 1 km and one answer stays small (about 50 KB, against the 467 KB worldwide snapshot
 * /api/signals/ais serves). The vessels are the long-lived AISStream socket's (whole
 * world, Class A and B), Digitraffic's and, once its client exists, BarentsWatch's
 * (lib/eye/vesselFeed.ts). The console's Ships layer does not read this route.
 *
 * Response: { ok, observedAt, stream, feeds, box, clamped, count, coverage, features }.
 * `stream` is off (no key), warming, live or down, and a down socket still serves what
 * was heard inside the last 20 minutes. Never a 5xx: a failure is a 200 with ok: false.
 * A bad or missing bbox is a 400.
 */
export async function GET(req: Request) {
  const parsed = parseBox(new URL(req.url).searchParams.get("bbox"));
  if (!parsed) {
    return Response.json({ ok: false, error: "bbox=west,south,east,north" }, { status: 400, headers: NO_STORE });
  }
  try {
    const { box, clamped } = clampBox(snapBox(parsed));
    const world = await worldVessels();
    const body = eyeVesselsBody({
      box,
      clamped,
      vessels: world.vessels,
      state: world.state,
      digitraffic: world.digitraffic,
      barentswatch: world.barentswatch,
      now: Date.now(),
    });
    // Half the client's 60 s poll, so a poll is never answered with the same body twice.
    return Response.json(body, { headers: body.ok ? edgeCacheHeaders(30_000) : NO_STORE });
  } catch {
    return Response.json({ ok: false, stream: "down", count: 0, features: [] }, { headers: NO_STORE });
  }
}
