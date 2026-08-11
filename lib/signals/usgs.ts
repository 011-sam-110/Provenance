import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { markCoverage } from "@/lib/signals/coverage";

// USGS earthquakes — past 24h, all magnitudes. Keyless GeoJSON FeatureCollection,
// the canonical real-time seismic feed. Each feature's geometry is a Point whose
// THIRD coordinate is depth in km (coordinates = [lon, lat, depthKm]). We surface
// magnitude, depth, place and time, colour + size the marker by magnitude.
// Endpoint shape confirmed live 2026-06-27.
//
// No local render cap — USGS already limits to events in the past 24h, a naturally
// bounded window. Typical result: 30–50 global earthquakes/day.

const ENDPOINT =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";

export const USGS_ATTRIBUTION = "Earthquake data © U.S. Geological Survey (USGS)";

interface UsgsFeature {
  id?: string;
  properties?: {
    mag?: number | null;
    place?: string | null;
    time?: number | null; // epoch ms
    url?: string | null;
    title?: string | null;
    magType?: string | null;
    type?: string | null; // "earthquake", "quarry blast", …
  } | null;
  geometry?: { type?: string; coordinates?: (number | null)[] } | null;
}

/** Yellow → red ramp by Richter magnitude (small = calm lime, great = deep red). */
export function magnitudeColor(mag: number): string {
  if (mag >= 6) return "#dc2626";
  if (mag >= 5) return "#f97316";
  if (mag >= 4) return "#fb923c";
  if (mag >= 2.5) return "#facc15";
  return "#a3e635";
}

/** Pure: USGS FeatureCollection → SignalFeature[]. Skips non-finite coords. */
export function normalizeUsgs(geojson: { features?: UsgsFeature[] }): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const f of geojson.features ?? []) {
    const p = f.properties ?? {};
    const c = f.geometry?.coordinates;
    if (!c) continue;
    // Number(null) is 0, so guard null/undefined explicitly before coercing.
    const lon = c[0] == null ? Number.NaN : Number(c[0]);
    const lat = c[1] == null ? Number.NaN : Number(c[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    const id = (f.id ?? "").toString().trim();
    if (!id) continue;
    const mag = typeof p.mag === "number" && Number.isFinite(p.mag) ? p.mag : 0;
    const depthKm = Number.isFinite(Number(c[2])) ? Number(c[2]) : null;
    const place = p.place?.trim() || "Unknown location";
    out.push({
      id: `usgs:${id}`,
      lat,
      lon,
      title: p.title?.trim() || `M ${mag.toFixed(1)} — ${place}`,
      signalId: "earthquakes",
      color: magnitudeColor(mag),
      link: p.url ?? `https://earthquake.usgs.gov/earthquakes/eventpage/${id}`,
      ts: typeof p.time === "number" ? new Date(p.time).toISOString() : undefined,
      props: {
        // `magnitude` (numeric) is the documented radius driver (see types.ts).
        magnitude: Number(mag.toFixed(1)),
        depth: depthKm != null ? `${depthKm.toFixed(1)} km` : "—",
        place,
        type: p.type ?? "earthquake",
      },
    });
  }
  // USGS already limits to the past 24h, so this is a complete dataset without local truncation.
  return markCoverage(out, {
    noun: "events",
    rule: "all earthquakes in the past 24 hours",
  });
}

export const EARTHQUAKES_SOURCE: SignalSource = {
  id: "earthquakes",
  label: "Earthquakes",
  group: "Natural hazards",
  color: "#f97316",
  refreshMs: 60_000, // USGS regenerates the summary feed ~minutely
  attribution: USGS_ATTRIBUTION,
  metric: { field: "magnitude", domain: [2, 8] }, // Richter → magnitude bar (lime→red ramp)
  async fetch() {
    try {
      const res = await fetch(ENDPOINT, {
        headers: { "User-Agent": "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return [];
      const json = (await res.json()) as { features?: UsgsFeature[] };
      return normalizeUsgs(json);
    } catch {
      return []; // dormant-safe: never throw, just yield nothing
    }
  },
};
