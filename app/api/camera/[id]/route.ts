import { getCameraById, getRegistry, nearestTo } from "@/lib/sources/registry";
import { isLiveCamera } from "@/lib/liveness/playcheck";
import { ensurePlayCheck } from "@/lib/liveness/playcheck.server";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const camera = await getCameraById(decodeURIComponent(id));
  if (!camera) return new Response("camera not found", { status: 404 });
  ensurePlayCheck(getRegistry);
  const nearby = (await nearestTo(camera.lat, camera.lon, 8))
    .filter((n) => n.camera.id !== camera.id)
    .slice(0, 6)
    .map((n) => ({ id: n.camera.id, name: n.camera.name, km: Number(n.km.toFixed(2)) }));
  // Never hand the raw upstream stream URL to the client — video is fetched
  // exclusively through the closed /api/hls proxy. `live` tells the UI to use
  // the video player: true only when the stream played at its last check
  // (lib/liveness/playcheck.ts). mediaType is kept for display.
  const safe = { ...camera, live: isLiveCamera(camera) };
  delete (safe as { streamUrl?: string }).streamUrl;
  return Response.json({ camera: safe, nearby });
}
