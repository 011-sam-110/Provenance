import { getWebcams } from "@/lib/webcams/registry";
import { describeWebcamSample } from "@/lib/webcams/fetch";
import { WINDY_SOURCE } from "@/lib/sources/windy";
import { describeCoverage } from "@/lib/signals/coverage";

export const dynamic = "force-dynamic";

/**
 * GET /api/webcams — a global sample of Windy webcams as thin markers (the
 * x-windy-api-key is added server-side; it never reaches the client). Distinct
 * from /api/cameras: webcams are their own layer and never fold into the
 * road-camera count.
 *
 * Image URLs are intentionally omitted here — their tokens are short-lived, so
 * the dossier re-resolves a fresh image per view through /api/webcam-image.
 *
 * TRUNCATION HONESTY. The merged global sample is capped at MAX_WEBCAMS (2000);
 * before this the cap shipped with nothing disclosing it, so `count` was the
 * ceiling wearing the costume of a measurement — the exact defect the coverage
 * contract exists to prevent. `sample.coverage` (lib/signals/coverage.ts,
 * attached in lib/webcams/normalize.ts's toWebcams()) now carries the true
 * pre-cap total, so this can say "2,000 of N" instead of a bare 2,000.
 *
 * DESIGN DECISION — SIGNAL style ("N of M"), not the camera style. Cameras'
 * /api/coverage reports {feeds: {answered, total, stale}} because a camera total
 * is a SUM ACROSS ELEVEN INDEPENDENT NETWORKS, any of which can be down on a
 * given refresh — the denominator that matters there is "how many of our feeds
 * answered". Webcams have exactly ONE upstream (Windy) and no per-feed health
 * dimension to report; the only thing being hidden is a single render cap over
 * one merged pool of rows. That is precisely what lib/signals/coverage.ts's
 * applyCap/coverageCountLabel contract was built for (it already backs
 * /api/planes and /api/signals/<id> for the same reason), so reusing it costs
 * nothing, and inventing a "feeds" shape for a single source would just be
 * duplication with no real denominator to put in it.
 *
 * Returns {count, webcams[], dormant, note, attribution, coverage?}. `note` is a
 * plain sentence describing what actually happened upstream, so an empty layer
 * can always explain itself instead of silently looking like "no webcams exist".
 * `coverage` is present only when the sample declared one (i.e. not dormant) —
 * its absence means "not declared", never "nothing was truncated".
 */
export async function GET() {
  const sample = await getWebcams();
  const thin = sample.webcams.map((w) => ({
    id: w.id,
    title: w.title,
    lat: w.lat,
    lon: w.lon,
    country: w.country,
    region: w.region,
    available: w.available,
    detailUrl: w.detailUrl,
  }));
  return Response.json({
    count: thin.length,
    webcams: thin,
    dormant: sample.dormant,
    note: describeWebcamSample(sample),
    attribution: WINDY_SOURCE.attribution,
    ...(sample.coverage ? { coverage: describeCoverage(sample.coverage) } : {}),
  });
}
