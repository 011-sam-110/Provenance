import { edgeCacheHeaders } from "@/lib/http/cache";
import { isTrackId } from "@/lib/planes/trackId";
import { flightTracks, trackBody, TRACK_TTL_MS } from "@/lib/planes/trackStore";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/planes/track?id=plane:abc123: one plane's stored line, from when we first heard it,
 * for the Full flight trail setting (components/shell/inspector/tools/SettingsTool.tsx). The
 * line comes from memory, fed by the pull /api/planes already makes (lib/planes/trackStore.ts),
 * with every plane that pull heard, so this route asks no one for anything.
 *
 * NOT since take-off. A line starts when our pull first heard the plane, and a restart or a
 * deploy starts them all again. Stretches we hold no position for are breaks: `breaks` lists
 * the point where each new part starts, and nothing is drawn across one.
 *
 * COST. Cloudflare passes every `/api/*` path through (`cf-cache-status: DYNAMIC`), so the
 * headers are for whichever cache can act on them, and the saving that is real today is in
 * `trackBody`: a popular plane is built once per pull. It reads the id and no header, and the
 * only record of the request is the access log's address, which /privacy describes. The
 * maintenance curtain covers this path like any other `/api/*`, and no route here has a rate
 * limit except feedback's.
 *
 * Response: { id, firstHeardAt, lastHeardAt, trimmed, points: [[lat, lon, altKm, t]], breaks }.
 * A plane we hold no line for gets an empty `points` and null times. Anything that is not a
 * plane id is a 400.
 */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!isTrackId(id)) {
    return Response.json({ error: "id=plane:abc123" }, { status: 400, headers: NO_STORE });
  }
  return new Response(trackBody(flightTracks(), id), {
    headers: { "Content-Type": "application/json", ...edgeCacheHeaders(TRACK_TTL_MS) },
  });
}
