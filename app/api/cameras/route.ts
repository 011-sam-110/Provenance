import { getRegistry } from "@/lib/sources/registry";
import { isLiveStreamUrl } from "@/lib/proxy/hls-allowlist";
import { edgeCacheControl } from "@/lib/http/cache";

export const dynamic = "force-dynamic";

/**
 * Shared-cache lifetime for the camera list. The registry itself is already
 * stale-while-revalidate server-side, so this is about not paying an invocation per
 * visitor, not about protecting the upstreams.
 *
 * 60 s is safe for this body specifically because every time it carries is ABSOLUTE
 * (`lastSampledAt`), so a cached copy cannot under-report a camera's age — the client
 * subtracts from its own clock. Positions and names move on the order of days.
 */
const CAMERAS_TTL_MS = 60_000;

export async function GET() {
  const cams = await getRegistry();
  // source + live let the client pick the right camera icon (shape = feed,
  // colour = region). `live` = has a stream our /api/hls proxy can play, so the
  // video icon means genuinely-playable live video (not just any mediaType).
  const cameras = cams.map((c) => ({
    id: c.id, name: c.name, lat: c.lat, lon: c.lon, available: c.available,
    source: c.source, country: c.country, live: isLiveStreamUrl(c.streamUrl),
    // Enriched for the focus view (Camera fields the docked widget doesn't need).
    // NOTE: deliberately NO imageUrl/streamUrl — snapshots go through /api/proxy?id=
    // and /api/hls?id= (SSRF allowlist by id), never a raw upstream URL.
    region: c.region, road: c.road, refreshSeconds: c.refreshSeconds,
    attribution: c.attribution, license: c.license, lastSampledAt: c.lastSampledAt,
  }));
  return Response.json(
    { count: cameras.length, cameras },
    { headers: { "Cache-Control": edgeCacheControl(CAMERAS_TTL_MS, 300_000) } },
  );
}
