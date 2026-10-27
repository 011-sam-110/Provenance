import { getRegistry, feedHealth, registryAt, CAMERA_FEED_COUNT } from "@/lib/sources/registry";
import { edgeCacheHeaders } from "@/lib/http/cache";
import { getPlayCheckSummary, isLiveCamera, liveGate } from "@/lib/liveness/playcheck";
import { ensurePlayCheck } from "@/lib/liveness/playcheck.server";
import { buildCameraStats } from "@/lib/cameras/stats";
import { OPERATOR_NAMES } from "@/lib/sources/operators";
import webcamManifest from "@/public/webcams/manifest.json";

export const dynamic = "force-dynamic";

// The numbers behind the console's camera stats strip (components/terminal/CameraStats.tsx).
//
// One small object instead of the 7 MB camera list: video and stills (video = the stream
// PLAYED at its last check, decided by the same gate as /api/cameras), countries, the
// operators that answered, the split by region, the stills' stated refresh intervals, the
// play check's own summary, the per-operator rows with their licence text, and the Windy
// webcam count from the committed catalogue. Each figure carries its own time and source:
// the counts are stated at the registry's last refresh, not at the request.
//
// Same shared-cache lifetime as /api/coverage, which is computed from the same registry.
const STATS_TTL_MS = 60_000;

/** The webcam layer's count and harvest time, from the committed manifest. */
function webcams(): { count: number | null; at: number | null } {
  const m = webcamManifest as { harvested?: unknown; generatedAt?: unknown };
  const count = typeof m.harvested === "number" ? m.harvested : null;
  const at = typeof m.generatedAt === "string" ? Date.parse(m.generatedAt) : NaN;
  return { count, at: Number.isFinite(at) ? at : null };
}

export async function GET() {
  const cams = await getRegistry();
  ensurePlayCheck(getRegistry);
  const gate = liveGate();
  const stats = buildCameraStats({
    cams: cams.map((c) => ({
      source: c.source,
      country: c.country,
      live: isLiveCamera(c, gate),
      refreshSeconds: c.refreshSeconds,
      license: c.license,
    })),
    registryAt: registryAt(),
    health: feedHealth(),
    feedCount: CAMERA_FEED_COUNT,
    play: getPlayCheckSummary(cams),
    webcams: webcams(),
    names: OPERATOR_NAMES,
    now: Date.now(),
  });
  return Response.json(stats, { headers: edgeCacheHeaders(STATS_TTL_MS, 300_000) });
}
