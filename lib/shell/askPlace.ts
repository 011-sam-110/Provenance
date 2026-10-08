// lib/shell/askPlace.ts
// From a place name to the shape the map is cropped to.
//
// The question reader gives a place as words ("Spain", "Madrid"). This file turns a
// resolved place into parts for `placeScope` (lib/shell/scope.ts), and into a view to
// fly to. Three shapes, from the most exact to the least, and each chip says which
// one it is (`note`), because "in Madrid" as a box is not the same claim as "in
// Spain" as a border:
//
//   country  the outline of the country from public/geo/countries-110m.geojson
//            (Natural Earth 110m: a coarse border, and 177 countries)
//   box      the extent the geocoder gives for the place
//   circle   25 km around the point, when the geocoder gives no extent
//
// Pure: the caller does the lookup (the palette's /api/geocode, and the outline
// file that the map already loads) and passes the results in.

import type { GeocodeResult } from "@/lib/geo/geocode";
import { ringFromCircle } from "@/lib/map/circle";
import { bboxOfRing, type ScopeParts } from "@/lib/shell/scope";

/** The radius of the circle for a place with no extent. The chip states it. */
export const PLACE_RADIUS_KM = 25;

export interface ResolvedPlace {
  /** The name on the chip and in "Nothing in <label>". */
  label: string;
  shape: "country" | "box" | "circle";
  parts: ScopeParts;
  /** Where the map flies to when the filter is applied. */
  center: { lat: number; lon: number };
  zoom: number;
  /** One plain sentence that says what the crop is. */
  note: string;
}

/** The parts of a polygon geometry, or null for a geometry that has no area. */
export function partsOfGeometry(geometry: GeoJSON.Geometry | null | undefined): ScopeParts | null {
  if (!geometry) return null;
  if (geometry.type === "Polygon") return [geometry.coordinates as [number, number][][]];
  if (geometry.type === "MultiPolygon") return geometry.coordinates as ScopeParts;
  return null;
}

/**
 * A map zoom that frames a place of this many degrees across. At zoom z the world
 * is 512 * 2^z px wide, so a span of 360 / 2^z degrees is 512 px; the 0.4 on top
 * makes the place about 675 px, which fills a laptop stage and leaves its
 * neighbours in view. Held between a whole-globe view and a street view.
 */
export function zoomForSpan(degrees: number): number {
  if (!(degrees > 0)) return 9;
  const zoom = Math.log2(360 / degrees) + 0.4;
  return Math.round(Math.min(13, Math.max(1.5, zoom)) * 10) / 10;
}

function frame(ring: readonly [number, number][]): { center: { lat: number; lon: number }; zoom: number } {
  const [w, s, e, n] = bboxOfRing(ring);
  return { center: { lat: (s + n) / 2, lon: (w + e) / 2 }, zoom: zoomForSpan(Math.max(e - w, n - s)) };
}

/** A country wider than this is framed by its largest part and not by all of it. */
export const WHOLE_COUNTRY_MAX_SPAN = 60;

/**
 * A country from its outline. The CROP is every part of it. The VIEW is all of it
 * when it fits in 60 degrees (Indonesia, Japan), and its largest part when it does
 * not: the envelope of a country with a part on each side of the date line has its
 * middle on the wrong side of the planet (Russia), and the envelope of one with a
 * far territory has its middle in the sea (the file draws French Guiana as France).
 */
export function placeFromCountry(label: string, outline: GeoJSON.Geometry | null | undefined): ResolvedPlace | null {
  const parts = partsOfGeometry(outline);
  if (!parts || parts.length === 0) return null;
  let largest: [number, number][] | null = null;
  let largestArea = -1;
  for (const part of parts) {
    const outer = part[0];
    if (!outer || outer.length < 3) continue;
    const [w, s, e, n] = bboxOfRing(outer);
    const area = (e - w) * (n - s);
    if (area > largestArea) {
      largestArea = area;
      largest = outer;
    }
  }
  if (!largest) return null;
  const all = parts.flatMap((part) => part[0] ?? []);
  const [w, s, e, n] = bboxOfRing(all);
  const whole = Math.max(e - w, n - s) <= WHOLE_COUNTRY_MAX_SPAN;
  return {
    label,
    shape: "country",
    parts,
    ...frame(whole ? all : largest),
    note: `The map shows only what is inside the border of ${label}. The border is a coarse outline of the land: an item at sea is outside it.`,
  };
}

/**
 * A place from the geocoder. `outlineOf` answers the outline for an ISO alpha-2
 * code when the caller has the country file; with it, a result that IS a country
 * gets its border and not a box around its farthest islands.
 */
export function placeFromGeocode(
  result: GeocodeResult,
  outlineOf?: (iso2: string) => GeoJSON.Geometry | null | undefined,
): ResolvedPlace | null {
  if (result.type === "country" && result.countryCode && outlineOf) {
    const country = placeFromCountry(result.name, outlineOf(result.countryCode));
    if (country) return country;
  }
  if (result.bbox) {
    const [w, s, e, n] = result.bbox;
    // West of east means the extent crosses the date line. The inside test would
    // turn it inside out, so it is refused and the place counts as not found.
    if (!(w < e) || !(s < n)) return null;
    const ring: [number, number][] = [[w, s], [e, s], [e, n], [w, n], [w, s]];
    return {
      label: result.name,
      shape: "box",
      parts: [[ring]],
      ...frame(ring),
      note: `The map shows only what is inside the box around ${result.name}. The box is on the map.`,
    };
  }
  const ring = ringFromCircle({ lat: result.lat, lon: result.lon, radiusKm: PLACE_RADIUS_KM });
  if (ring.length < 3) return null;
  return {
    label: result.name,
    shape: "circle",
    parts: [[ring]],
    center: { lat: result.lat, lon: result.lon },
    zoom: 9,
    note: `The map shows only what is within ${PLACE_RADIUS_KM} km of ${result.name}. The circle is on the map.`,
  };
}
