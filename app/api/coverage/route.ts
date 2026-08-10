import { getRegistry, feedHealth, CAMERA_FEED_COUNT } from "@/lib/sources/registry";
import { groupCoverage } from "@/lib/coverage";

export const dynamic = "force-dynamic";

// Honest per-source camera coverage: total + currently-online, grouped by source.
// A tiny payload (one row per source) so the Coverage panel never re-fetches the
// full camera registry just to show counts. No streamUrls ever leave here.
//
// The `feeds` block is the denominator, and it is the point. The camera total is
// a SUM ACROSS ELEVEN INDEPENDENT NETWORKS, any of which can be down on any given
// refresh — an audit caught this same endpoint reporting 19,328 at 11:06 and
// 14,985 at 12:17 with no restart, and presenting the smaller number as fact.
// A failed feed now keeps its last-good cameras (see lib/sources/registry), and
// this says which feeds answered, so a consumer can qualify the number instead of
// quoting a degraded total as though it were a measurement.
export async function GET() {
  const cams = await getRegistry();
  const coverage = groupCoverage(cams.map((c) => ({ source: c.source, available: c.available })));
  const health = feedHealth();
  const answered = health.filter((h) => h.ok).length;
  return Response.json({
    generatedAt: Date.now(),
    ...coverage,
    feeds: {
      answered,
      total: CAMERA_FEED_COUNT || health.length,
      // Feeds serving last-good data because this round failed. Their cameras are
      // still counted in `total` above, so the caller can say so.
      stale: health.filter((h) => h.stale).map((h) => h.key),
      detail: health,
    },
  });
}
