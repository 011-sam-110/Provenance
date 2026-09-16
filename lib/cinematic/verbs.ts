// lib/cinematic/verbs.ts
// Pure camera verbs for GEV-style cinematic motion. No React, no MapLibre — this
// file is node-testable and the demo page feeds its output into map.jumpTo.
//
// WHY THE MATH IS PORTED AND NOT THE CODE. GEV's src/cameraVerbs.js advances every
// value per frame with `value += (target - value) * k` where k is a constant. A
// constant k is frame-rate COUPLED: a 30 Hz display converges half as fast as 60 Hz,
// and a dropped frame (or a background-tab rAF stall) moves the camera twice as far
// on the next tick. `approachValue` below uses k = 1 - exp(-rate * dt) instead, so
// convergence is a function of WALL TIME. Two properties follow and both are pinned
// by tests/unit/cinematic-verbs.test.ts:
//   1. Frame-rate independence: N steps of dt/N land exactly where 1 step of dt does.
//   2. No overshoot: k is in (0, 1] for any dt, so the value is always between the
//      previous value and the target — a huge dt spike decays toward the target,
//      never THROUGH it (tab-hidden dt spikes are also clamped, see clampStepDt).

/** Per-frame dt clamp. A background tab stops rAF; on resume the first dt can be
 *  tens of seconds and a closed-form integral would teleport the camera. Clamping
 *  makes the camera pause-and-resume instead. Negative/NaN dt is treated as 0. */
export const MAX_STEP_DT_SEC = 0.1;

export function clampStepDt(dtSec: number, maxSec = MAX_STEP_DT_SEC): number {
  if (Number.isNaN(dtSec) || dtSec <= 0) return 0;
  // Infinity is the same story as any other spike: clamp it, don't pause and don't teleport.
  return Math.min(dtSec, Math.max(0, maxSec));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Move `current` toward `target` by the frame-rate-independent factor
 * 1 - exp(-rate * dt). The rate is per second (1/rate = time constant).
 *
 * Degenerate inputs degrade safely rather than throwing: a non-positive rate or dt
 * leaves the value untouched, and a non-finite target keeps the current value
 * (a NaN would otherwise poison every downstream frame).
 */
export function approachValue(current: number, target: number, rate: number, dtSec: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(target)) {
    return Number.isFinite(current) ? current : 0;
  }
  if (!(rate > 0) || !(dtSec > 0)) return current;
  const k = 1 - Math.exp(-rate * dtSec);
  return current + (target - current) * k;
}

/**
 * Shortest signed angle from `fromDeg` to `toDeg`, in (-180, 180]. Both inputs may
 * be UNWRAPPED (any finite magnitude — orbit headings grow without bound, so a naive
 * `to - from` would see a 720° "turn" that is really zero).
 *
 * The antipodal case (exactly ±180°) returns -180 deterministically. Why this
 * matters: gaze smoothing rotates TOWARD the target by this delta, so an exactly
 * opposite heading has to pick a side ONCE and stick to it — a value that flickered
 * between +180 and -180 would oscillate the camera every frame.
 */
export function angleDeltaDeg(fromDeg: number, toDeg: number): number {
  if (!Number.isFinite(fromDeg) || !Number.isFinite(toDeg)) return 0;
  const d = (((toDeg - fromDeg) % 360) + 360) % 360; // → [0, 360)
  return d >= 180 ? d - 360 : d;
}

/**
 * Rotate a heading TOWARD a target heading using angular exponential smoothing.
 *
 * NEVER vector-lerp: lerping a bearing is lerping the sine/cosine components, which
 * collapses to a zero-length vector at the antipode and produces NaN bearings. Here
 * the step is always `angleDelta * k`, a finite rotation through the shortest arc,
 * so an antipodal turn stays safe and the heading may grow without bound (no
 * wraparound snap — MapLibre normalises bearings itself).
 */
export function angleApproachDeg(currentDeg: number, targetDeg: number, rate: number, dtSec: number): number {
  if (!Number.isFinite(currentDeg) || !Number.isFinite(targetDeg)) {
    return Number.isFinite(currentDeg) ? currentDeg : 0;
  }
  if (!(rate > 0) || !(dtSec > 0)) return currentDeg;
  const k = 1 - Math.exp(-rate * dtSec);
  return currentDeg + angleDeltaDeg(currentDeg, targetDeg) * k;
}

/** Normalise longitude into [-180, 180). In-range values pass through exactly
 *  (no float drift); only genuinely out-of-range values are wrapped. */
export function wrapLonDeg(lon: number): number {
  if (lon >= -180 && lon < 180) return lon;
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

const EARTH_RADIUS_KM = 6371.0088;

/**
 * Destination point: start at (lat, lon), travel `distanceKm` along `bearingDeg`.
 * Standard spherical formula — exact enough at orbit radii (≤ a few thousand km).
 * Latitude is clamped to ±85 so the formula never runs at a pole, where longitude
 * is undefined and the atan2 argument degenerates.
 */
export function destinationPoint(
  latDeg: number,
  lonDeg: number,
  bearingDeg: number,
  distanceKm: number,
): { lat: number; lon: number } {
  const lat = clamp(Number.isFinite(latDeg) ? latDeg : 0, -85, 85);
  const lon = Number.isFinite(lonDeg) ? lonDeg : 0;
  if (!(distanceKm > 0) || !Number.isFinite(distanceKm) || !Number.isFinite(bearingDeg)) {
    return { lat, lon };
  }
  const d = Math.min(distanceKm / EARTH_RADIUS_KM, Math.PI); // an antipode is degenerate; clamp
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;
  const θ = (bearingDeg * Math.PI) / 180;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
  return {
    lat: clamp((φ2 * 180) / Math.PI, -85, 85),
    lon: wrapLonDeg((λ2 * 180) / Math.PI),
  };
}

export const ORBIT_DEFAULTS = {
  /** Heading advance around the target, degrees per second. */
  degPerSec: 9,
  /** Zoom at which the orbit radius equals baseRadiusKm. */
  baseZoom: 3.8,
  /** Ground distance from the camera to the target at baseZoom, in km. */
  baseRadiusKm: 2100,
  /** Locked pitch (MapLibre convention: degrees tilted down from straight overhead). */
  pitchDeg: 55,
} as const;

/**
 * Orbit radius as a function of zoom.
 *
 * WHY zoom must remap the radius. If the orbit held a FIXED ground radius, zooming
 * in would shove the target out of frame (the same ground distance becomes more
 * screen pixels), and the orbit would read as "fighting" the zoom gesture. Scaling
 * the radius by 2^(baseZoom - zoom) keeps the target at the same screen position at
 * every zoom: double the zoom = half the ground distance = same apparent size.
 */
export function orbitRadiusKm(zoom: number, baseZoom: number = ORBIT_DEFAULTS.baseZoom, baseRadiusKm: number = ORBIT_DEFAULTS.baseRadiusKm): number {
  if (!Number.isFinite(zoom) || !Number.isFinite(baseZoom) || !Number.isFinite(baseRadiusKm) || baseRadiusKm <= 0) {
    return 0;
  }
  return clamp(baseRadiusKm * 2 ** (baseZoom - zoom), 1, 20_000);
}

export interface OrbitTarget {
  lat: number;
  lon: number;
}

export interface OrbitOptions {
  /** Heading advance in °/s. */
  degPerSec: number;
  /** Ground distance camera→target, km (feed orbitRadiusKm). */
  radiusKm: number;
  /** Locked pitch. */
  pitchDeg: number;
}

export interface OrbitState {
  /** Unwrapped heading: direction FROM the target TO the camera, ° clockwise from north. */
  headingDeg: number;
}

/** One frame of orbit camera — exactly what map.jumpTo needs. */
export interface OrbitCamera {
  centerLon: number;
  centerLat: number;
  /** Direction the camera looks (back at the target): heading + 180. */
  bearing: number;
  pitch: number;
}

/**
 * Advance the orbit one frame. Heading advances at degPerSec with REAL dt (clamped
 * for tab stalls); the camera position is recomputed around the LATEST target
 * position, so a moving target (a satellite sub-point) is followed without any
 * extra state. Zoom is deliberately NOT owned here: the caller keeps whatever zoom
 * the user last set and remaps the radius from it, so orbit and zoom never fight.
 */
export function advanceOrbit(
  prev: OrbitState,
  target: OrbitTarget,
  opts: OrbitOptions,
  dtSec: number,
): { state: OrbitState; camera: OrbitCamera } {
  const dt = clampStepDt(dtSec);
  const tLat = clamp(Number.isFinite(target.lat) ? target.lat : 0, -85, 85);
  const tLon = Number.isFinite(target.lon) ? target.lon : 0;
  const degPerSec = Number.isFinite(opts.degPerSec) ? opts.degPerSec : 0;
  const radiusKm = Number.isFinite(opts.radiusKm) && opts.radiusKm > 0 ? opts.radiusKm : 1;
  const pitch = clamp(Number.isFinite(opts.pitchDeg) ? opts.pitchDeg : ORBIT_DEFAULTS.pitchDeg, 0, 60);

  const heading = prev.headingDeg + degPerSec * dt;
  const center = destinationPoint(tLat, tLon, heading % 360, radiusKm);
  const bearing = (((heading + 180) % 360) + 360) % 360;
  return {
    state: { headingDeg: heading },
    camera: { centerLon: center.lon, centerLat: center.lat, bearing, pitch },
  };
}

export interface MotionOwner {
  /** Start a new motion. Returns its token; every earlier token is now stale. */
  claim(): number;
  /** The token of the currently-owning motion (0 = nothing has ever run). */
  token(): number;
  /** Is `t` still the current motion? A loop checks this each frame and stops when false. */
  owns(t: number): boolean;
  /** Settle the current motion without starting a new one (the Stop button). */
  invalidate(): void;
}

/**
 * One-active-motion ownership, reduced to a monotonic counter.
 *
 * Every motion gets a token from claim(). The token is monotonic, so no stale frame
 * can ever mistake itself for current: a new motion, a user pointer/wheel gesture,
 * or an explicit stop all call claim()/invalidate(), and every in-flight rAF loop
 * that checks owns(token) sees "settled" on its very next frame. One counter is the
 * WHOLE mechanism — there is no registry to leak, no handle to forget to release,
 * and an abandoned motion costs nothing but one dead frame.
 */
export function createMotionOwner(): MotionOwner {
  let current = 0;
  return {
    claim() {
      current += 1;
      return current;
    },
    token() {
      return current;
    },
    owns(t: number) {
      return t === current && current > 0;
    },
    invalidate() {
      current += 1;
    },
  };
}
