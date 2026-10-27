import { getRegistry, nearestTo } from "@/lib/sources/registry";
import { isLiveCamera, liveCameraIds } from "@/lib/liveness/playcheck";
import { ensurePlayCheck } from "@/lib/liveness/playcheck.server";
import { clipUrl } from "@/lib/proxy/clip";

export const dynamic = "force-dynamic";

// "Cameras near me" — the nearest road cameras to an arbitrary point (the user's
// geolocation). Computed server-side by reusing the registry's `nearestTo`
// (haversine over the already-cached ~13k camera set) so the client never has to
// download or distance-sort the whole set. Returns thin markers + their distance
// in km; the client opens the dossier (/api/camera/[id]) on click. Never hands out
// raw upstream stream URLs — `live` just tells the UI which player to use.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (
    !Number.isFinite(lat) || !Number.isFinite(lon) ||
    lat < -90 || lat > 90 || lon < -180 || lon > 180
  ) {
    return Response.json({ error: "valid lat and lon query params are required" }, { status: 400 });
  }
  const n = Math.min(Math.max(Number(url.searchParams.get("n")) || 8, 1), 25);

  try {
    const near = await nearestTo(lat, lon, n);
    ensurePlayCheck(getRegistry);
    const live = liveCameraIds();
    const cameras = near.map(({ camera, km }) => ({
      id: camera.id,
      name: camera.name,
      lat: camera.lat,
      lon: camera.lon,
      available: camera.available,
      source: camera.source,
      // Played at its last check, not merely an allowlisted URL (lib/liveness/playcheck.ts).
      live: isLiveCamera(camera, live),
      // The God's eye view's cards: whether /api/proxy?clip=1 has a recording for this
      // camera, how often the operator publishes a picture, and whose picture it is.
      clip: clipUrl(camera.streamUrl) != null,
      refreshSeconds: camera.refreshSeconds,
      attribution: camera.attribution,
      km: Number(km.toFixed(2)),
    }));
    return Response.json({ origin: { lat, lon }, count: cameras.length, cameras });
  } catch {
    // Dormant-safe: registry cold + total source failure → empty, never a 5xx.
    return Response.json({ origin: { lat, lon }, count: 0, cameras: [] });
  }
}
