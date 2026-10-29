import { edgeCacheHeaders } from "@/lib/http/cache";
import { noticesOf, operatorsAt, roadTitle } from "@/lib/signals/roads";
import {
  CAMERA_ROAD_MAX,
  parseCameraRoadParam,
  pickCameraRoad,
  type CameraAt,
  type CameraRoad,
} from "@/lib/roads/nearCamera";

export const dynamic = "force-dynamic";

/** The answer may be this old at the edge: the operators' own files are read every 1 to 10 min. */
const EDGE_MS = 60_000;

/**
 * GET /api/camera-road?c=<lat>,<lon>,<camera id>[&c=...]: what the road operators say
 * about the road each camera looks at (lib/roads/nearCamera.ts), for the camera detail,
 * the camera wall and the God's eye cards. Up to 40 cameras per request.
 *
 * It reads only the operators whose area holds a camera, through the same shared reads
 * as the three road layers (lib/signals/roads.ts), so it adds no request to any operator
 * that the layers have not made in the same minute. A camera no operator covers answers
 * `{ state: "uncovered" }` at once, with no read.
 *
 * Response: { roads: { [camera id]: CameraRoad } }. Never a 5xx: an operator that does
 * not answer makes its cameras `unread`.
 */
export async function GET(req: Request) {
  const cams = new URL(req.url).searchParams
    .getAll("c")
    .slice(0, CAMERA_ROAD_MAX)
    .map(parseCameraRoadParam)
    .filter((c): c is CameraAt => c != null);
  const roads: Record<string, CameraRoad> = {};
  await Promise.all(
    cams.map(async (cam) => {
      const ops = operatorsAt(cam.lat, cam.lon);
      const reads = ops.length === 0 ? [] : await noticesOf(ops);
      roads[cam.id] = pickCameraRoad(
        cam,
        ops.map((op) => op.name),
        reads.map((r) => ({ operator: r.op.name, credit: r.op.credit, notices: r.notices, readAt: r.readAt })),
        roadTitle,
      );
    }),
  );
  return Response.json({ roads }, { headers: edgeCacheHeaders(EDGE_MS) });
}
