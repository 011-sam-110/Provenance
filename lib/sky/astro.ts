/**
 * The geometry that puts the real sky behind the hero globe.
 *
 * Pure, isomorphic, no DOM, no dependencies — so it is unit-testable in the node
 * environment the rest of `tests/unit/**` runs in, and so the browser pays for a
 * few hundred bytes of trigonometry rather than an astronomy library.
 *
 * THE CLAIM THIS MODULE MAKES. The camera sits outside the Earth looking at its
 * centre, and stars are effectively at infinity. So the sky behind the globe is
 * not "some sky" — it is exactly the sky at the ZENITH OF THE ANTIPODAL POINT:
 *
 *     local sidereal time = GMST(t) + longitude
 *     sky centre          = RA (LST + 180 deg),  Dec (-latitude)
 *
 * That is falsifiable. Point a planetarium app at the antipode of whatever the
 * globe is centred on, at the same UTC, look up, and it should be the same sky.
 *
 * WHY GMST IS IMPLEMENTED HERE rather than taken from `satellite.js`, which is
 * already in the client bundle and exports `gstime`. Two reasons. The formula is
 * five lines and pinning it in a test is worth more than the import. And
 * `next.config.ts` already carries a webpack alias stripping satellite.js's WASM
 * entry points because its top-level await broke the map — reaching for that
 * package from the marketing bundle invites the same class of problem for no gain.
 *
 * DELIBERATELY NOT MODELLED, and the size of each omission:
 *   - Nutation and annual aberration: tens of arcseconds. Roughly a thousandth of
 *     a pixel here. Ignored.
 *   - Proper motion: the worst star in the shipped catalogue is Groombridge 1830
 *     at 0.0588 deg per 30 years (measured by `scripts/gen-sky.mjs`, not assumed).
 *     Ignored.
 *   - Precession: ~0.36 deg since J2000, about six times the worst proper motion
 *     above. NOT ignored — see `precessFromJ2000`.
 */

export type Vec3 = readonly [number, number, number];

export type SkyBasis = {
  /** Direction the camera looks — through the globe, into the sky behind it. */
  readonly forward: Vec3;
  /** Screen up. */
  readonly up: Vec3;
  /** Screen right. */
  readonly right: Vec3;
};

export type SkyPoint = { readonly x: number; readonly y: number };

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
const MS_PER_DAY = 86_400_000;
const MS_PER_CENTURY = MS_PER_DAY * 36_525;

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function normalise(v: Vec3): Vec3 {
  const m = Math.hypot(v[0], v[1], v[2]);
  if (!(m > 0)) return [1, 0, 0];
  return [v[0] / m, v[1] / m, v[2] / m];
}

const wrap360 = (d: number) => ((d % 360) + 360) % 360;

/**
 * Greenwich Mean Sidereal Time, in degrees, for a UTC instant.
 *
 * The standard series (IAU 1982). The leading constant is defined at JD 2451545.0
 * = 2000-01-01 12:00 TT; we feed UTC, which trails TT by ~64s and so costs about
 * 0.27 deg. At the scale this draws — roughly 0.05 deg per pixel — that is around
 * five pixels of rotation, and correcting it would mean shipping a leap-second
 * table that goes stale. Stated rather than silently absorbed.
 */
export function gmstDegrees(date: Date): number {
  const d = (date.getTime() - J2000_MS) / MS_PER_DAY;
  const t = d / 36_525;
  const g =
    280.46061837 + 360.98564736629 * d + 0.000387933 * t * t - (t * t * t) / 38_710_000;
  return wrap360(g);
}

/**
 * Equatorial coordinates to a unit vector.
 *
 * Right-handed frame: x towards RA 0 / Dec 0, y towards RA 90, z towards the north
 * celestial pole. Every handedness question in this file resolves against this
 * definition, so it is the one thing here not to change casually.
 */
export function equatorialToVector(raDeg: number, decDeg: number): Vec3 {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const c = Math.cos(dec);
  return [c * Math.cos(ra), c * Math.sin(ra), Math.sin(dec)];
}

export function vectorToEquatorial(v: Vec3): { raDeg: number; decDeg: number } {
  const n = normalise(v);
  return {
    raDeg: wrap360(Math.atan2(n[1], n[0]) * RAD),
    decDeg: Math.asin(Math.max(-1, Math.min(1, n[2]))) * RAD,
  };
}

export function angularSeparationDeg(a: Vec3, b: Vec3): number {
  const na = normalise(a);
  const nb = normalise(b);
  // Via the cross product rather than acos(dot) — acos loses precision badly for
  // the small separations that matter here (Orion's belt is 1.4 degrees).
  return Math.atan2(Math.hypot(...cross(na, nb)), dot(na, nb)) * RAD;
}

/**
 * Precess a J2000 position to the equinox of `date`.
 *
 * Rigorous rotation via the classical precession angles zeta / z / theta
 * (Lieske et al. 1977, as set out in Meeus, *Astronomical Algorithms*, ch. 21).
 * Being built from rotations, it cannot distort the sky — a test pins that the
 * angle between two stars survives it.
 *
 * Direction matters and is easy to get backwards, so it is pinned too: the equinox
 * precesses westward, which makes the right ascension of a star near the equator
 * INCREASE by about 46 arcsec a year.
 */
export function precessFromJ2000(v: Vec3, date: Date): Vec3 {
  const t = (date.getTime() - J2000_MS) / MS_PER_CENTURY;
  if (t === 0) return v;

  const arcsec = 1 / 3600;
  const zeta = (2306.2181 * t + 0.30188 * t * t + 0.017998 * t * t * t) * arcsec * DEG;
  const z = (2306.2181 * t + 1.09468 * t * t + 0.018203 * t * t * t) * arcsec * DEG;
  const theta = (2004.3109 * t - 0.42665 * t * t - 0.041833 * t * t * t) * arcsec * DEG;

  const { raDeg, decDeg } = vectorToEquatorial(v);
  const ra0 = raDeg * DEG;
  const dec0 = decDeg * DEG;

  const cosDec0 = Math.cos(dec0);
  const sinDec0 = Math.sin(dec0);
  const cosRaZeta = Math.cos(ra0 + zeta);
  const sinRaZeta = Math.sin(ra0 + zeta);

  const A = cosDec0 * sinRaZeta;
  const B = Math.cos(theta) * cosDec0 * cosRaZeta - Math.sin(theta) * sinDec0;
  const C = Math.sin(theta) * cosDec0 * cosRaZeta + Math.cos(theta) * sinDec0;

  const ra = Math.atan2(A, B) + z;
  const dec = Math.asin(Math.max(-1, Math.min(1, C)));
  return equatorialToVector(ra * RAD, dec * RAD);
}

/**
 * The camera basis for a globe centred on (lngDeg, latDeg) at sidereal time
 * `gmstDeg`, optionally rolled by the map's bearing.
 *
 * `forward` is the anti-observer direction, so the frame is centred on the sky the
 * Earth is occluding. `up` is the north celestial pole flattened into the view
 * plane, which is what "north is up" means for a sky. `right` is
 * `forward x up` — see the handedness test in `tests/unit/sky-astro.test.ts`, which
 * derives from this that increasing RA runs LEFTWARD across the screen, the
 * mirror-of-a-map property every real star chart has.
 */
export function skyBasis(opts: {
  lngDeg: number;
  latDeg: number;
  gmstDeg: number;
  bearingDeg?: number;
}): SkyBasis {
  const lst = opts.gmstDeg + opts.lngDeg;
  const observer = equatorialToVector(lst, opts.latDeg);
  const forward: Vec3 = [-observer[0], -observer[1], -observer[2]];

  const pole: Vec3 = [0, 0, 1];
  const along = dot(pole, forward);
  let up = normalise([
    pole[0] - along * forward[0],
    pole[1] - along * forward[1],
    pole[2] - along * forward[2],
  ]);
  // Looking straight along the polar axis (a globe centred on a pole) leaves the
  // north direction undefined. Fall back to a fixed reference rather than emitting
  // NaN across the whole sky.
  if (!Number.isFinite(up[0]) || Math.abs(along) > 0.999999) {
    const ref: Vec3 = [1, 0, 0];
    const a = dot(ref, forward);
    up = normalise([ref[0] - a * forward[0], ref[1] - a * forward[1], ref[2] - a * forward[2]]);
  }
  let right = normalise(cross(forward, up));

  const bearing = opts.bearingDeg ?? 0;
  if (bearing) {
    // Roll the frame about the view axis. MapLibre's bearing is degrees
    // counter-clockwise from north, so a positive bearing turns the sky the same
    // way it turns the globe. The hero starts at bearing 0 and only a right-drag
    // moves it, so this path is exercised rarely — the sign is confirmed against
    // the live globe rather than asserted here.
    const b = bearing * DEG;
    const cb = Math.cos(b);
    const sb = Math.sin(b);
    const newUp: Vec3 = [
      up[0] * cb - right[0] * sb,
      up[1] * cb - right[1] * sb,
      up[2] * cb - right[2] * sb,
    ];
    up = normalise(newUp);
    right = normalise(cross(forward, up));
  }

  return { forward, up, right };
}

/**
 * The scale factor that maps `degrees` away from the sky centre onto `pixels`.
 *
 * Pair with `projectSky`. Kept separate so the hero can state its wide-angle
 * choice as one number in one place.
 */
export function stereographicScale(degrees: number, pixels: number): number {
  const halfAngle = (degrees * DEG) / 2;
  const t = Math.tan(halfAngle);
  if (!(t > 0)) return 0;
  return pixels / (2 * t);
}

/**
 * Project a celestial direction into screen offsets from the sky centre.
 *
 * STEREOGRAPHIC, not gnomonic, and that is a real choice rather than a default.
 * The hero shows a deliberately wide sky, so stars run 40-70 degrees off axis; a
 * gnomonic (true perspective) projection stretches badly out there and diverges at
 * 90. Stereographic is conformal — small shapes keep their proportions, so a
 * constellation still looks like itself near the edge of the frame — and it is
 * what star charts have used since antiquity.
 *
 * Returns null for directions behind the camera, so callers drop them rather than
 * folding the far half of the sky back into the frame.
 */
export function projectSky(v: Vec3, basis: SkyBasis, scale: number): SkyPoint | null {
  const n = normalise(v);
  const f = dot(n, basis.forward);
  if (f <= -0.999) return null; // at or past the projection pole
  const k = (2 * scale) / (1 + f);
  return {
    x: k * dot(n, basis.right),
    // Screen y grows downward; the basis is in world orientation, so flip here and
    // only here.
    y: -k * dot(n, basis.up),
  };
}
