import type { SignalFeature } from "@/lib/signals/types";
import { markCoverage } from "@/lib/signals/coverage";

// USGS earthquakes — past 24h, all magnitudes. One of the catalogues the earthquakes
// layer reads (lib/signals/earthquakes.ts fetches it and merges it with the others).
// Keyless GeoJSON FeatureCollection,
// the canonical real-time seismic feed. Each feature's geometry is a Point whose
// THIRD coordinate is depth in km (coordinates = [lon, lat, depthKm]). We surface
// magnitude, depth, place and time, colour + size the marker by magnitude.
// Endpoint shape confirmed live 2026-06-27.
//
// No local render cap — USGS already limits to events in the past 24h, a naturally
// bounded window. Measured 2026-10-16: 175 events, 154 of them from US networks.


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

/**
 * The coverage rule, stated as what the feed is rather than what it is not.
 *
 * It used to say "all earthquakes in the past 24 hours". Measured 2026-10-16: 154 of
 * 175 events came from US regional networks, and outside the US only about M4 and
 * up appeared, while INGV listed 48 Italian events and GeoNet 46 New Zealand ones in
 * the same day. The feed is the USGS ComCat catalogue, complete to about M2.5 in the
 * US and about M4.5 elsewhere.
 */
export const USGS_COVERAGE_RULE =
  "USGS ComCat events in the past 24 hours (complete to about M2.5 in the US, about M4.5 elsewhere)";

/**
 * Is this ComCat event type an earthquake? USGS lists explosions, quarry blasts,
 * mining explosions, ice quakes and other events in the same feed. A missing type
 * is read as an earthquake, which is what the feed's default is.
 */
export function isUsgsEarthquake(type: string | null | undefined): boolean {
  const t = (type ?? "").trim().toLowerCase();
  return t === "" || t === "earthquake";
}

/**
 * Pure: USGS FeatureCollection → SignalFeature[]. Skips non-finite coords.
 *
 * Drops every event whose type is not an earthquake: on 2026-10-16, 4 of 175 rows were
 * explosions or quarry blasts and drew in the quake colour. `keepNonQuakes` keeps
 * them (with `props.type` set) for a caller that needs to know a blast happened.
 */
export function normalizeUsgs(
  geojson: { features?: UsgsFeature[] },
  opts: { keepNonQuakes?: boolean } = {},
): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const f of geojson.features ?? []) {
    const p = f.properties ?? {};
    if (!opts.keepNonQuakes && !isUsgsEarthquake(p.type)) continue;
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
    rule: USGS_COVERAGE_RULE,
  });
}
