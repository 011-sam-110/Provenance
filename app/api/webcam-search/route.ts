import type { NextRequest } from "next/server";
import { searchWebcams } from "@/lib/webcams/search";
import { bboxAround, parseBbox, bboxSpan, DEFAULT_RADIUS_KM } from "@/lib/webcams/bbox";
import { WINDY_SOURCE } from "@/lib/sources/windy";

export const dynamic = "force-dynamic";

/**
 * GET /api/webcam-search — what Windy has in one area, right now.
 *
 * WHY THIS EXISTS. /api/webcams serves a GLOBAL sample assembled from 14 fixed
 * region boxes × 2 pages × 50 rows (50 is the free-tier ceiling) — an unranked ~2%
 * of the catalogue. Measured on prod 2026-08-15, that sample holds 0 webcams for
 * Madrid, Paris, Barcelona and Amsterdam. Windy's own answer for the Madrid box is
 * 528, including Puerta del Sol. A user searching for a city has to reach the live
 * endpoint or the search simply lies to them.
 *
 *   ?bbox=north,east,south,west     an explicit box
 *   ?lat=&lon=[&radiusKm=]          a box built around a point (what the geocoder feeds)
 *
 * Returns {webcams[], total, count, dormant, note, attribution}. `total` is WINDY'S
 * count for the box, never our page size — printing the page size as a total is the
 * coverage lie lib/signals/coverage.ts exists to prevent.
 *
 * The API key stays server-side; the client only ever sees this route. Image URLs
 * are omitted for the same reason /api/webcams omits them: their tokens are
 * short-lived, so a tile re-resolves through /api/webcam-image instead.
 *
 * Dormant-safe: no key, a rejected key or an unreachable upstream all resolve to an
 * empty list with an honest note — never a 5xx, never invented webcams.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  let bbox = parseBbox(sp.get("bbox"));

  if (!bbox) {
    const lat = Number(sp.get("lat"));
    const lon = Number(sp.get("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return Response.json(
        { error: "pass bbox=north,east,south,west or lat=&lon=" },
        { status: 400 },
      );
    }
    const radiusKm = Number(sp.get("radiusKm"));
    bbox = bboxAround(lat, lon, Number.isFinite(radiusKm) ? radiusKm : DEFAULT_RADIUS_KM);
  }

  // A box this large cannot be answered honestly: the free tier caps offset at 1000,
  // so we would return a page from an unknowable position in a huge set and have no
  // way to say which part of the world the user is actually seeing.
  const span = bboxSpan(bbox);
  if (span.lat > 30 || span.lon > 60) {
    return Response.json(
      { error: "area too large — zoom in", maxSpan: { lat: 30, lon: 60 } },
      { status: 400 },
    );
  }

  const result = await searchWebcams(bbox);

  const thin = result.webcams.map((w) => ({
    id: w.id,
    title: w.title,
    lat: w.lat,
    lon: w.lon,
    country: w.country,
    region: w.region,
    city: w.city,
    categories: w.categories,
    available: w.available,
    detailUrl: w.detailUrl,
  }));

  return Response.json({
    bbox,
    count: thin.length,
    // Windy's own number for this box. When it exceeds `count`, the caller has a
    // page of a larger set and must say so rather than print `count` as the answer.
    total: result.total,
    webcams: thin,
    dormant: result.dormant,
    note: result.note,
    attribution: WINDY_SOURCE.attribution,
  });
}
