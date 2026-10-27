// IP location: the AREAS the map draws for a located network. PURE: the caller passes
// the country outlines it already loads (public/geo/countries-110m.geojson).
//
// What may be drawn (the rules are in lib/recon/geo.ts):
//   circle   a city WITH a published accuracy radius: a ring of that radius
//   country  everything else (a country-only answer, or a city with no published
//            radius): the country's outline, never its centre point
// A location whose country has no outline in the file draws nothing: the dossier still
// names it. No feature this module returns is a Point.

import type { GeoLocation } from "@/lib/recon/geo";
import { ringFromCircle } from "@/lib/map/circle";
import { placeFromCountry, zoomForSpan } from "@/lib/shell/askPlace";
import type { ScopeParts } from "@/lib/shell/scope";

/**
 * The closest the map may zoom to a located network. A city circle of a few km would
 * otherwise frame streets, and streets are the claim this tool must never make
 * (MaxMind: "not reliable at any level more precise than a postal code").
 */
export const MAX_IP_ZOOM = 8;

export interface GeoArea {
  shape: "circle" | "country";
  /** ISO alpha-2 of the location it was made for. */
  country: string;
  parts: ScopeParts;
  center: { lat: number; lon: number };
  zoom: number;
}

/**
 * The areas for a list of locations. `outlineOfIso2` answers a country's outline;
 * `nameOf` its display name. Two locations in one country without a radius draw that
 * country once.
 */
export function areasOf(
  locations: readonly GeoLocation[],
  outlineOfIso2: (iso2: string) => GeoJSON.Geometry | null | undefined,
  nameOf: (iso2: string) => string = (c) => c,
): GeoArea[] {
  const out: GeoArea[] = [];
  const countriesDrawn = new Set<string>();
  for (const l of locations) {
    if (!l.countryOnly && l.radiusKm !== null && l.radiusKm > 0) {
      const ring = ringFromCircle({ lat: l.lat, lon: l.lon, radiusKm: l.radiusKm });
      if (ring.length >= 3) {
        out.push({
          shape: "circle",
          country: l.country,
          parts: [[ring]],
          center: { lat: l.lat, lon: l.lon },
          zoom: Math.min(MAX_IP_ZOOM, zoomForSpan((2 * l.radiusKm) / 111)),
        });
        continue;
      }
    }
    if (countriesDrawn.has(l.country)) continue;
    const place = placeFromCountry(nameOf(l.country), outlineOfIso2(l.country));
    if (!place) continue;
    countriesDrawn.add(l.country);
    out.push({
      shape: "country",
      country: l.country,
      parts: place.parts,
      center: place.center,
      zoom: Math.min(MAX_IP_ZOOM, place.zoom),
    });
  }
  return out;
}

/** The areas as polygon features for one map source. Never a Point. */
export function areasToFeatures(areas: readonly GeoArea[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: areas.map((a) => ({
      type: "Feature",
      properties: { shape: a.shape, country: a.country },
      geometry:
        a.parts.length === 1
          ? { type: "Polygon", coordinates: a.parts[0] }
          : { type: "MultiPolygon", coordinates: a.parts },
    })),
  };
}

/** Where the map flies to for these areas: the first one's frame, capped. */
export function viewOfAreas(areas: readonly GeoArea[]): { lat: number; lon: number; zoom: number } | null {
  const first = areas[0];
  if (!first) return null;
  return { lat: first.center.lat, lon: first.center.lon, zoom: Math.min(MAX_IP_ZOOM, first.zoom) };
}
