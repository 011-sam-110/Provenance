// Transport for NSW's Live Traffic hazards (New South Wales, Australia), mapped to
// RoadNotice and nothing else. Pure, so tests/unit/roads-nsw.test.ts holds it against
// real rows.
//
// THE FEED. Live Traffic NSW publishes one GeoJSON file per kind of hazard, keyless, at
// www.livetraffic.com/traffic/hazards/<kind>.json. Each file names its own rights:
// copyright Transport for NSW, licence the "Live Traffic Hazards" dataset on the
// Transport Open Data Hub, which is Creative Commons Attribution (read 27 Oct 2026). The
// Hub's own copy of the same data needs a free key; these files do not.
//
// CLOSED IS PER PERIOD. A hazard lists periods, each with a closure type and a road
// extent. ROAD_CLOSURE alone does not mean closed: on 27 Oct 2026, 784 of 987 such
// periods said the road was only "Affected". A hazard is closed only where a period's
// road extent is "Closed".
//
// LINES. Most hazards are a point. Some carry the road as Google-encoded polylines
// (`encodedPolylines`), which decodePolyline turns back into [lon, lat] lines.
//
// THE OPERATOR'S WORDS. The category is TfNSW's own ("SCHEDULED ROADWORK" reads
// "Scheduled roadwork"). TfNSW gives no severity, only an `isMajor` flag, so the
// severity reads "Major" or "Not major" and nothing finer.

import type { RoadNotice } from "@/lib/roads/notice";

export const NSW_FEEDS = ["roadwork", "incident", "flood", "fire", "majorevent", "alpine"] as const;
export type NswFeed = (typeof NSW_FEEDS)[number];
export const nswFeedUrl = (feed: NswFeed) => `https://www.livetraffic.com/traffic/hazards/${feed}.json`;
export const NSW_CREDIT = "Contains data from Transport for NSW (Live Traffic NSW), Creative Commons Attribution";
export const NSW_NAME = "Transport for NSW";
export const NSW_HOME = "https://www.livetraffic.com/";

/**
 * Pure: a Google-encoded polyline to [lon, lat] points (precision 5). A string that
 * ends mid-number yields the points before it.
 */
export function decodePolyline(encoded: string, precision = 5): [number, number][] {
  const factor = 10 ** precision;
  const out: [number, number][] = [];
  let i = 0;
  let lat = 0;
  let lon = 0;
  const next = (): number | null => {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      if (i >= encoded.length) return null;
      b = encoded.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < encoded.length) {
    const dLat = next();
    const dLon = next();
    if (dLat == null || dLon == null) break;
    lat += dLat;
    lon += dLon;
    out.push([lon / factor, lat / factor]);
  }
  return out;
}

/** "SCHEDULED ROADWORK" -> "Scheduled roadwork"; a word with a digit keeps its case ("4WD"). */
export function nswWords(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const w = words.map((x) => (/\d/.test(x) ? x : x.toLowerCase())).join(" ");
  return w.charAt(0).toUpperCase() + w.slice(1);
}

const isLonLat = (p: unknown): p is [number, number] =>
  Array.isArray(p) &&
  p.length >= 2 &&
  Number.isFinite(p[0]) &&
  Number.isFinite(p[1]) &&
  Math.abs(p[1] as number) <= 90 &&
  Math.abs(p[0] as number) <= 180;

const text = (v: unknown): string => (typeof v === "string" && v.trim() && v.trim() !== "null" ? v.trim() : "");

/** Pure: one Live Traffic NSW hazards file to road notices. Ended hazards are dropped; it never throws. */
export function normalizeNswHazards(raw: unknown, feed: NswFeed): RoadNotice[] {
  const features = (raw as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];
  const out: RoadNotice[] = [];
  for (const f of features as Record<string, unknown>[]) {
    const p = (f?.properties ?? null) as Record<string, unknown> | null;
    if (!p || p.ended === true) continue;
    const id = typeof f.id === "number" || typeof f.id === "string" ? String(f.id) : "";
    const pt = (f.geometry as { coordinates?: unknown } | undefined)?.coordinates;
    if (!id || !isLonLat(pt)) continue;

    const periods = (Array.isArray(p.periods) ? p.periods : []) as Record<string, unknown>[];
    const closedPeriod = periods.find((x) => x?.roadextent === "Closed");
    const dir = text(closedPeriod?.direction).toLowerCase();
    const closure = closedPeriod ? (dir ? `Closed, ${dir}` : "Closed") : undefined;

    const lines: [number, number][][] = [];
    for (const pl of (Array.isArray(p.encodedPolylines) ? p.encodedPolylines : []) as Record<string, unknown>[]) {
      if (typeof pl?.coords !== "string") continue;
      const line = decodePolyline(pl.coords).filter(isLonLat);
      if (line.length >= 2) lines.push(line);
    }

    const road = ((Array.isArray(p.roads) ? p.roads : [])[0] ?? {}) as Record<string, unknown>;
    const street = text(road.mainStreet);
    const where = [street, text(road.locationQualifier), text(road.crossStreet)].filter(Boolean).join(" ");
    const location = [where, text(road.suburb)].filter(Boolean).join(", ");
    const advice = text(p.otherAdvice).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    const category = text(p.mainCategory) ? nswWords(text(p.mainCategory)) : "Hazard";
    const sub = text(p.subCategoryA);
    const updated = typeof p.lastUpdated === "number" && Number.isFinite(p.lastUpdated) ? new Date(p.lastUpdated).toISOString() : undefined;

    out.push({
      id: `${feed}/${id}`,
      kind: feed === "roadwork" ? "works" : "incident",
      category,
      ...(sub ? { subCategory: nswWords(sub) } : {}),
      severity: p.isMajor === true ? "Major" : "Not major",
      ...(closure ? { closure } : {}),
      ...(location ? { location } : {}),
      ...(street ? { street } : {}),
      ...(advice ? { description: advice } : {}),
      lat: pt[1],
      lon: pt[0],
      openLines: closure ? [] : lines,
      closedLines: closure ? lines : [],
      ...(updated ? { updated } : {}),
    });
  }
  return out;
}
