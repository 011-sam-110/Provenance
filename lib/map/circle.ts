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
//
// KNOWN, DELIBERATE LIMITATION: a circle that crosses the ±180° seam is REFUSED,
// not approximated. `pointInRing` (`lib/shell/scope.ts`, the only real consumer of
// this ring) does planar ray-casting on raw longitude differences with no
// antimeridian unwrapping — so a straddling ring does not just look odd, it
// INVERTS. Measured for `{ lat: 0, lon: 179.9, radiusKm: 50 }`: the bbox covers
// nearly the whole globe, the centre (zero km away) tests as OUTSIDE, and a point
// 111 km away tests as INSIDE. `crossesAntimeridian` detects this up front and
// `ringFromCircle` returns `[]` for it — an empty ring every caller already
// handles — rather than hand `pointInRing` a shape it cannot judge correctly.
// Teaching the containment path itself about the seam is out of scope here
// (it is shared with the polygon AOI tool and is its own, later task).

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

/** Angular radius (radians) beyond which a circle stops behaving like a local
 *  patch of the sphere: a cap wider than a hemisphere necessarily reaches past
 *  its own antipodal meridian, so it wraps the full 360° of longitude no matter
 *  where it is centred. */
const MAX_ANGULAR_RADIUS = Math.PI / 2;

/** Below this, cos(lat) is close enough to zero that a fixed ground distance
 *  corresponds to an unbounded number of degrees of longitude — every bearing
 *  becomes "east". Treated as crossing rather than divided by (near) zero. */
const MIN_COS_LAT = 1e-6;

/**
 * Whether a circle would cross the ±180° seam.
 *
 * A ring that crosses it cannot be fed to `pointInRing`, which ray-casts on raw
 * longitude differences: measured for a 50 km circle at 179.9°E, the bbox covers
 * nearly the globe, the centre tests as OUTSIDE and a point 111 km away tests as
 * INSIDE. Refusing is the honest answer until the containment path itself
 * understands the seam.
 *
 * Derived from the circle itself, not from `ringFromCircle`'s wrapped output:
 * the unwrapped east/west extent is `lon ± (angularRadius / cos(lat))`, and this
 * reports whether either one leaves [-180, 180]. Also refuses a radius so large
 * the circle spans more than a hemisphere (it wraps regardless of longitude),
 * and a centre close enough to a pole that cos(lat) collapses toward zero.
 */
export function crossesAntimeridian(c: CircleSpec): boolean {
  if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) return false;
  if (!Number.isFinite(c.radiusKm) || c.radiusKm <= 0) return false;

  const angularRadius = c.radiusKm / EARTH_KM;
  if (angularRadius >= MAX_ANGULAR_RADIUS) return true;

  const cosLat = Math.cos((c.lat * Math.PI) / 180);
  if (Math.abs(cosLat) < MIN_COS_LAT) return true;

  const lonHalfSpanDeg = ((angularRadius / cosLat) * 180) / Math.PI;
  const east = c.lon + lonHalfSpanDeg;
  const west = c.lon - lonHalfSpanDeg;
  return east > 180 || west < -180;
}

/**
 * An OPEN ring approximating a circle — first vertex not repeated, `[lon, lat]`
 * pairs, matching what `startDraw`'s `onFinish` hands back.
 *
 * Returns `[]` rather than throwing for a radius that is not a positive finite
 * number: every caller is a pointer handler mid-gesture, and a zero-radius circle
 * is what the very first mousemove of every drag looks like.
 *
 * Also returns `[]` when `crossesAntimeridian(c)` — a straddling ring is not
 * approximated, it is refused, because the only real consumer (`pointInRing`)
 * would silently invert it. Every caller already treats an empty ring as "found
 * nothing here" rather than an error, so this reuses that same contract.
 */
export function ringFromCircle(c: CircleSpec, vertices = CIRCLE_VERTICES): [number, number][] {
  if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) return [];
  if (!Number.isFinite(c.radiusKm) || c.radiusKm <= 0) return [];
  if (crossesAntimeridian(c)) return [];

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
