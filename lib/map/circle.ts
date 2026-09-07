// A circle, as a ring. The pure half of the Streets area gesture.
//
// WHY THIS IS NOT IN lib/map/aoi.ts. That module owns a click-per-vertex polygon
// gesture and belongs to another workstream. Centre-and-drag is a different
// gesture, not a mode of that one. What the two share is their OUTPUT — an open
// [lon, lat][] ring — so everything downstream (camerasInRing, aoiScope,
// withinScope, filterToScopes) consumes either without knowing which drew it.
//
// NO RADIUS SURVIVES THIS MODULE. The ring is the interface; a centre+radius pair
// is an input to it and is never stored, never persisted and never added to
// InspectorArea. That keeps one geometry type in the system rather than two.

/** Mean Earth radius, km. The same figure MapLibre and turf use. */
const EARTH_KM = 6371.0088;

export interface CircleSpec {
  lat: number;
  lon: number;
  radiusKm: number;
}

/**
 * Vertices in a generated ring.
 *
 * 64 puts the worst-case chord error at 1 - cos(pi/64) = 0.12% of the radius,
 * which on a 5 km circle is about 6 m — below the positional accuracy of the
 * camera coordinates themselves, so the polygon is not the limiting factor.
 * Raising it costs `pointInRing` work on every containment test for no gain
 * anyone can see.
 */
export const CIRCLE_VERTICES = 64;

/** Great-circle distance in km. */
export function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dp = ((b.lat - a.lat) * Math.PI) / 180;
  const dl = ((b.lon - a.lon) * Math.PI) / 180;
  const h =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Fold a longitude into [-180, 180]. The antimeridian is a seam in the number
 *  line, not in the world, and a ring that runs to 180.4 is silently empty. */
function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/**
 * An OPEN ring approximating a circle — first vertex not repeated, `[lon, lat]`
 * pairs, matching what `startDraw`'s `onFinish` hands back.
 *
 * Returns `[]` rather than throwing for a radius that is not a positive finite
 * number: every caller is a pointer handler mid-gesture, and a zero-radius circle
 * is what the very first mousemove of every drag looks like.
 */
export function ringFromCircle(c: CircleSpec, vertices = CIRCLE_VERTICES): [number, number][] {
  if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) return [];
  if (!Number.isFinite(c.radiusKm) || c.radiusKm <= 0) return [];

  const n = Math.max(3, Math.floor(vertices));
  const lat = (c.lat * Math.PI) / 180;
  const lon = (c.lon * Math.PI) / 180;
  const ang = c.radiusKm / EARTH_KM;

  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const bearing = (2 * Math.PI * i) / n;
    // Standard destination-point formula. Done on the sphere rather than by
    // scaling degrees, because a degree of longitude is not a fixed distance —
    // a "circle" built by dividing by cos(lat) is an ellipse everywhere but the
    // equator, and visibly wrong by 60 degrees north.
    const vlat = Math.asin(
      Math.sin(lat) * Math.cos(ang) + Math.cos(lat) * Math.sin(ang) * Math.cos(bearing),
    );
    const vlon =
      lon +
      Math.atan2(
        Math.sin(bearing) * Math.sin(ang) * Math.cos(lat),
        Math.cos(ang) - Math.sin(lat) * Math.sin(vlat),
      );
    const degLat = (vlat * 180) / Math.PI;
    out.push([wrapLon((vlon * 180) / Math.PI), Math.max(-90, Math.min(90, degLat))]);
  }
  return out;
}
