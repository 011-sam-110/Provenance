import { getWebcams } from "@/lib/webcams/registry";
import { describeWebcamSample } from "@/lib/webcams/fetch";
import { WINDY_SOURCE } from "@/lib/sources/windy";

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
 * Returns {count, webcams[], dormant, note, attribution}. `note` is a plain
 * sentence describing what actually happened upstream, so an empty layer can
 * always explain itself instead of silently looking like "no webcams exist".
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
  });
}
