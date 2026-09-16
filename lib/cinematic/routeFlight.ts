// lib/cinematic/routeFlight.ts
// The fly-the-ground-track dolly: pure camera math for flying a camera along a
// satellite's ground track. No React, no MapLibre — the demo page feeds the camera
// structs into map.jumpTo and everything here is unit-tested in
// tests/unit/route-flight.test.ts.
//
// The three flourishes and how each one is built:
//
// (a) Trapezoid speed profile, POSITION BY CLOSED-FORM INTEGRAL. speedAt is a
//     smoothstep ramp in, cruise, smoothstep ramp out. arcAt is its exact
//     analytical integral, so the position is a pure function of flight time —
//     there is NO per-frame accumulation to drift, and a dropped frame simply
//     lands the camera where the integral says it belongs. The joins are C¹:
//     smoothstep's derivative is 0 at both ends, so speed meets the cruise with
//     no corner in the derivative (pinned by a numeric-derivative test).
//
// (b) Banked roll. Each interior track vertex gets a PLANNED turn-rate: a
//     triangular window peaking at the corner, whose time-integral equals the
//     corner angle (so the plan is exactly the turn, spread over the window).
//     Bank is proportional to that planned rate, capped at ~10°, then passed
//     through two cascaded first-order filters. Cascading is what makes roll
//     entry/exit C¹: a first-order filter's response to a ramp input has zero
//     derivative at its start, and two in series round that further. The plan is
//     zero at t=0 (first frame level by construction) and forced to zero for the
//     final settleSec (so the filters drain and the last frame is level — the
//     done frame is also hard-zeroed, see step()).
//
// (c) Altitude shaping. A zero-mean sinusoid (±20 m per 2200 m of arc) that fades
//     out as bank comes in, plus a ~26 m rise into turns, tracked through a
//     SLOWER first-order filter than the bank — the slower time constant is the
//     "swell lags the roll" feel. The result is converted to a zoom delta through
//     zoomForAltitude (MapLibre has no altitude axis; zoom is its altitude).
//
// (d) Gaze lookahead. The camera heading rotates TOWARD a point ~6.5 s ahead on
//     the track using angular exponential smoothing (angleApproachDeg). Never
//     vector-lerped: an antipodal turn is a finite rotation through 180°, with a
//     deterministic side, instead of a zero-length vector and a NaN bearing.

import { approachValue, angleApproachDeg, angleDeltaDeg, clampStepDt } from "@/lib/cinematic/verbs";

export const EARTH_RADIUS_M = 6371008.8;

export const ROUTE_FLIGHT_DEFAULTS = {
  /** Cruise ground speed, m/s. Slow enough to watch the track sweep. */
  cruiseSpeedMs: 1500,
  /** Smoothstep ramp-in/out duration, s. */
  rampTimeSec: 6,
  /** Half-width of a turn's triangular planned-rate window, s (each side). */
  turnWindowSec: 8,
  /** Forced plan-zero tail before the end, so the bank filters drain to level. */
  settleSec: 2,
  /** Bank gain: degrees of bank per °/s of planned turn rate (0.5 → 20°/s = 10°). */
  bankGainDegPerDegPerSec: 0.5,
  /** Bank cap, degrees. */
  maxBankDeg: 10,
  /** First-order rate (1/s) for BOTH cascaded bank stages. */
  bankFilterRate: 0.7,
  /** First-order rate (1/s) for the altitude swell. Slower than the bank's, and
   *  slower than the BANK'S CASCADE too: the two bank stages reach 50% of a step
   *  in ≈1.68/rate seconds, so the swell's ln2/rate must exceed that or the
   *  "swell lags the roll" feel inverts. */
  altitudeFilterRate: 0.25,
  /** Breathing amplitude, m (zero-mean sinusoid). */
  breatheAmplitudeM: 20,
  /** Breathing period, m of arc. */
  breathePeriodM: 2200,
  /** Extra altitude rise into a turn, m (at full bank). */
  turnRiseM: 26,
  /** Gaze lookahead, s of flight time. */
  lookaheadSec: 6.5,
  /** Heading smoothing rate (1/s) toward the gaze point. */
  gazeRate: 0.9,
  /** Locked pitch — MapLibre convention (degrees down from straight overhead). */
  pitchDeg: 32,
  /** Base camera altitude, m. Breathing/rise move around this. */
  baseAltitudeM: 30_000,
  /** Viewport height in px (zooms are derived from altitude; defaults to 1440x900's height). */
  viewportHeightPx: 900,
  /** Vertical field of view, degrees. */
  fovDeg: 60,
} as const;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Smoothstep on [0,1] with C¹ zero-derivative ends; identity outside the unit range. */
export function smoothstep01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const c = clamp(x, 0, 1);
  return c * c * (3 - 2 * c);
}

/** ∫smoothstep01 = x³ − x⁴/2 on [0,1] (clamped outside). Used by the closed-form arc. */
export function smoothstepIntegral01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const c = clamp(x, 0, 1);
  return c * c * c - (c * c * c * c) / 2;
}

/** Drop non-finite points, clamp latitude to ±85 (web-mercator-safe), and collapse
 *  consecutive duplicates — a degenerate point poisons distances and corners. */
export function sanitizeTrack(points: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [lon, lat] of points) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const cLat = clamp(lat, -85, 85);
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - lon) < 1e-9 && Math.abs(last[1] - cLat) < 1e-9) continue;
    out.push([lon, cLat]);
  }
  return out;
}

/**
 * Flatten antimeridian-split segments into ONE continuous polyline, unwrapping
 * longitudes so consecutive points always differ by the SHORTEST delta. A track
 * crossing the dateline becomes ...179, 180.5, 181... instead of jumping 179 → -179,
 * so distances, tangents and the gaze heading all stay continuous. Each unwrapped
 * longitude is the candidate (lon + k·360) closest to the previous point's value;
 * MapLibre wraps out-of-range centres itself, so rendering needs no special case.
 */
export function mergeAntimeridianSegments(segments: [number, number][][]): [number, number][] {
  const out: [number, number][] = [];
  for (const seg of segments) {
    for (const [lon, lat] of seg) {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      const cLat = clamp(lat, -85, 85);
      if (out.length === 0) {
        out.push([lon, cLat]);
        continue;
      }
      const prevLon = out[out.length - 1][0];
      const k = Math.round((prevLon - lon) / 360); // nearest copy of lon to prevLon
      const unwrapped = lon + k * 360;
      const last = out[out.length - 1];
      if (Math.abs(unwrapped - last[0]) < 1e-9 && Math.abs(cLat - last[1]) < 1e-9) continue;
      out.push([unwrapped, cLat]);
    }
  }
  return out;
}

export interface TrackMetrics {
  /** Cumulative arc length at each vertex, m. cumM[0] === 0. */
  cumM: number[];
  /** Per-segment lengths, m. */
  segM: number[];
  /** Total length, m. */
  totalM: number;
}

/**
 * Polyline lengths in equirectangular metres — the SAME metric the tangents and
 * corner angles below are computed in, so a corner's angle and its arc position
 * can never disagree. Exact enough for segments of a few hundred km (ground-track
 * steps), and cheap enough to run once per flight.
 */
export function trackMetrics(points: [number, number][]): TrackMetrics {
  const cumM: number[] = [0];
  const segM: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const dLon = ((points[i][0] - points[i - 1][0]) * Math.PI) / 180;
    const dLat = ((points[i][1] - points[i - 1][1]) * Math.PI) / 180;
    const latMid = ((points[i][1] + points[i - 1][1]) / 2) * (Math.PI / 180);
    const dx = dLon * Math.cos(latMid);
    const seg = EARTH_RADIUS_M * Math.hypot(dx, dLat);
    segM.push(seg);
    cumM.push(cumM[cumM.length - 1] + seg);
  }
  return { cumM, segM, totalM: cumM[cumM.length - 1] ?? 0 };
}

/**
 * Tangent bearing from a to b, in the same equirectangular metric as trackMetrics
 * (0 = north, clockwise). Degenerate (zero-length) input yields 0 rather than NaN.
 */
export function tangentBearingDeg(a: [number, number], b: [number, number]): number {
  const dLon = (b[0] - a[0]) * (Math.PI / 180);
  const dLat = (b[1] - a[1]) * (Math.PI / 180);
  const latMid = ((b[1] + a[1]) / 2) * (Math.PI / 180);
  const x = dLon * Math.cos(latMid);
  const y = dLat;
  if (Math.hypot(x, y) < 1e-12) return 0;
  const deg = (Math.atan2(x, y) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export interface TrackPoint {
  /** Longitude — UNWRAPPED (may exceed ±180 on dateline-crossing tracks). */
  lon: number;
  lat: number;
}

/** Position at arc length s (clamped to the track). Binary search over cumM. */
export function trackPointAt(points: [number, number][], metrics: TrackMetrics, arcM: number): TrackPoint {
  if (points.length === 0) return { lon: 0, lat: 0 };
  const s = Number.isFinite(arcM) ? clamp(arcM, 0, metrics.totalM) : 0;
  if (s <= 0) return { lon: points[0][0], lat: points[0][1] };
  if (s >= metrics.totalM) return { lon: points[points.length - 1][0], lat: points[points.length - 1][1] };
  let lo = 0;
  let hi = metrics.cumM.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (metrics.cumM[mid] <= s) lo = mid;
    else hi = mid;
  }
  const len = metrics.cumM[lo + 1] - metrics.cumM[lo];
  const frac = len > 0 ? (s - metrics.cumM[lo]) / len : 0;
  const a = points[lo];
  const b = points[lo + 1];
  return { lon: a[0] + (b[0] - a[0]) * frac, lat: a[1] + (b[1] - a[1]) * frac };
}

/**
 * Flight duration for a trapezoid profile of length L at cruise V with ramps Tr.
 *
 * If L is too short for the requested cruise+ramps (L/V < Tr), the profile
 * degrades to TWO back-to-back smoothstep ramps meeting at their peaks — duration
 * 2·Tr, effective peak speed L/Tr. That path is still C¹ at the join (both ramp
 * derivatives are 0 there) and still integrates to exactly L.
 */
export function profileDurationSec(lengthM: number, cruiseMs: number, rampSec: number): number {
  if (!(lengthM > 0) || !(cruiseMs > 0) || !(rampSec > 0)) return 0;
  const cruise = lengthM / cruiseMs - rampSec;
  return cruise >= 0 ? rampSec + cruise + rampSec : 2 * rampSec;
}

/** Speed at flight time t for the trapezoid profile (see profileDurationSec). */
export function speedAt(tSec: number, lengthM: number, cruiseMs: number, rampSec: number): number {
  const T = profileDurationSec(lengthM, cruiseMs, rampSec);
  if (T <= 0 || !(tSec > 0) || !Number.isFinite(tSec)) return 0;
  const t = clamp(tSec, 0, T);
  const cruise = lengthM / cruiseMs - rampSec;
  if (cruise >= 0) {
    if (t <= rampSec) return cruiseMs * smoothstep01(t / rampSec);
    if (t <= rampSec + cruise) return cruiseMs;
    return cruiseMs * smoothstep01((T - t) / rampSec);
  }
  const peak = lengthM / rampSec;
  return t <= rampSec ? peak * smoothstep01(t / rampSec) : peak * smoothstep01((T - t) / rampSec);
}

/**
 * Arc position at flight time t — the CLOSED-FORM integral of speedAt.
 *
 * This is the whole drift story: the camera position is a pure function of flight
 * time, so no matter how frames drop or clump, the camera is exactly where the
 * integral says it should be. arcAt(T) === L by construction (ramp-in V·Tr/2 +
 * cruise V·Tc + ramp-out V·Tr/2).
 */
export function arcAt(tSec: number, lengthM: number, cruiseMs: number, rampSec: number): number {
  const T = profileDurationSec(lengthM, cruiseMs, rampSec);
  if (T <= 0) return 0;
  const t = Number.isFinite(tSec) ? clamp(tSec, 0, T) : 0;
  const cruise = lengthM / cruiseMs - rampSec;
  if (cruise >= 0) {
    if (t <= rampSec) return cruiseMs * rampSec * smoothstepIntegral01(t / rampSec);
    if (t <= rampSec + cruise) return (cruiseMs * rampSec) / 2 + cruiseMs * (t - rampSec);
    // Ramp-out contribution: ∫ V·s(u) dt with u = (T−t)/Tr runs the integral of the
    // smoothstep BACKWARD, so the closed form is ½ − S(u), not u − S(u).
    const u = (T - t) / rampSec;
    return (cruiseMs * rampSec) / 2 + cruiseMs * cruise + cruiseMs * rampSec * (0.5 - smoothstepIntegral01(u));
  }
  const peak = lengthM / rampSec;
  if (t <= rampSec) return peak * rampSec * smoothstepIntegral01(t / rampSec);
  const x = (T - t) / rampSec;
  return lengthM * (1 - smoothstepIntegral01(x));
}

/**
 * Inverse of arcAt: flight time at which the arc reaches `arcM`. Bisection over the
 * monotonic closed form — used only to PLACE the turn windows (the plan is sampled
 * per frame by time), so ms-level precision is plenty and the inversion can never
 * drift the camera (the camera never runs on this value).
 */
export function arcTimeForSec(arcM: number, lengthM: number, cruiseMs: number, rampSec: number): number {
  const T = profileDurationSec(lengthM, cruiseMs, rampSec);
  if (T <= 0) return 0;
  if (!(arcM > 0)) return 0;
  if (arcM >= lengthM) return T;
  let lo = 0;
  let hi = T;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (arcAt(mid, lengthM, cruiseMs, rampSec) < arcM) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface TurnCorner {
  /** Flight time of the vertex, s. */
  tSec: number;
  /** Left/right half-widths of the triangular window, s (each ≤ turnWindowSec). */
  leftW: number;
  rightW: number;
  /** Planned-rate peak, °/s — chosen so the window's time-integral equals the corner angle. */
  peakDegPerSec: number;
}

/**
 * One triangular planned-rate window per interior vertex (the first vertex has no
 * incoming tangent and the last has no outgoing one, so neither can "turn").
 *
 * The peak is 2·Δψ/(leftW+rightW) because a triangle's area is height·(a+b)/2 and
 * the area IS the corner angle. Windows are truncated so the plan is exactly zero
 * at t=0 (leftW ≤ tCorner) and at least settleSec before T (rightW ≤ T−settle−t),
 * which is what lets the bank filters drain and the flight END LEVEL.
 */
export function buildTurnCorners(
  points: [number, number][],
  metrics: TrackMetrics,
  speed: { lengthM: number; cruiseMs: number; rampSec: number },
  opts: { windowSec: number; settleSec: number },
): TurnCorner[] {
  const corners: TurnCorner[] = [];
  const T = profileDurationSec(speed.lengthM, speed.cruiseMs, speed.rampSec);
  if (T <= 0 || points.length < 3) return corners;
  const windowSec = opts.windowSec > 0 ? opts.windowSec : 0;
  const settleSec = opts.settleSec > 0 ? opts.settleSec : 0;
  for (let i = 1; i < points.length - 1; i++) {
    const inB = tangentBearingDeg(points[i - 1], points[i]);
    const outB = tangentBearingDeg(points[i], points[i + 1]);
    const dψ = angleDeltaDeg(inB, outB);
    if (Math.abs(dψ) < 1e-6) continue;
    const tCorner = arcTimeForSec(metrics.cumM[i], speed.lengthM, speed.cruiseMs, speed.rampSec);
    const leftW = Math.min(windowSec, Math.max(0, tCorner));
    const rightW = Math.min(windowSec, Math.max(0, T - settleSec - tCorner));
    // BOTH sides must exist: a one-sided window cannot be a triangle, and its
    // peak/width would divide by zero in turnRatePlanAt. Skipping is right — a
    // corner pinned against the flight's edge has no room to roll into.
    if (leftW < 1e-6 || rightW < 1e-6) continue;
    corners.push({ tSec: tCorner, leftW, rightW, peakDegPerSec: (2 * dψ) / (leftW + rightW) });
  }
  return corners;
}

/** Sum of every corner's triangular window at flight time t — the PLANNED turn rate (°/s). */
export function turnRatePlanAt(tSec: number, corners: TurnCorner[]): number {
  let rate = 0;
  for (const c of corners) {
    if (c.leftW <= 0 || c.rightW <= 0) continue; // defensive: buildTurnCorners never emits these
    if (tSec < c.tSec - c.leftW || tSec > c.tSec + c.rightW) continue;
    rate +=
      tSec <= c.tSec
        ? (c.peakDegPerSec * (tSec - (c.tSec - c.leftW))) / c.leftW
        : (c.peakDegPerSec * (c.tSec + c.rightW - tSec)) / c.rightW;
  }
  return rate;
}

/** Planned rate → bank, proportional and capped (the "~10°" cap). */
export function bankFromTurnRate(rateDegPerSec: number, gainDegPerDegPerSec: number, maxBankDeg: number): number {
  if (!Number.isFinite(rateDegPerSec)) return 0;
  return clamp(rateDegPerSec * gainDegPerDegPerSec, -maxBankDeg, maxBankDeg);
}

export interface BankFilterState {
  /** First-stage state. */
  s1: number;
  /** Second-stage state — also the bank itself. */
  s2: number;
}

/**
 * Two cascaded first-order filters on the raw bank. Same rate on both stages.
 * Entry/exit is C¹ because a first-order filter's response to the (ramped,
 * zero-at-zero) plan has zero derivative at its start, and the second stage
 * rounds that response again. First frame is level: states start at 0 and the
 * plan starts at 0.
 */
export function stepBankFilters(prev: BankFilterState, rawBankDeg: number, ratePerSec: number, dtSec: number): BankFilterState {
  const dt = clampStepDt(dtSec);
  const s1 = approachValue(prev.s1, rawBankDeg, ratePerSec, dt);
  const s2 = approachValue(prev.s2, s1, ratePerSec, dt);
  return { s1, s2 };
}

/** Zero-mean sinusoidal breathing over arc distance. breatheSwellM(0) === 0. */
export function breatheSwellM(arcM: number, amplitudeM: number, periodM: number): number {
  if (!(periodM > 0) || !Number.isFinite(arcM)) return 0;
  return amplitudeM * Math.sin((2 * Math.PI * arcM) / periodM);
}

/**
 * The altitude-shaping target: breathing (faded out as bank comes in) plus a rise
 * proportional to how hard the upcoming turn is planned to be. Both effects are
 * zero when level and straight — the flight starts and ends at exactly the base
 * altitude.
 */
export function swellTargetM(
  arcM: number,
  bankDeg: number,
  plannedRateDegPerSec: number,
  cfg: {
    breatheAmplitudeM: number;
    breathePeriodM: number;
    turnRiseM: number;
    maxBankDeg: number;
    bankGainDegPerDegPerSec: number;
  },
): number {
  const bankStrength = cfg.maxBankDeg > 0 ? clamp(Math.abs(bankDeg) / cfg.maxBankDeg, 0, 1) : 0;
  const fade = 1 - bankStrength;
  const turnStrength =
    cfg.maxBankDeg > 0 ? clamp(Math.abs(plannedRateDegPerSec * cfg.bankGainDegPerDegPerSec) / cfg.maxBankDeg, 0, 1) : 0;
  return breatheSwellM(arcM, cfg.breatheAmplitudeM, cfg.breathePeriodM) * fade + cfg.turnRiseM * turnStrength;
}

/**
 * One frame of the altitude filter — a first-order approach on the swell target,
 * held SEPARATE from the bank filters so its rate can be slower: the swell's
 * response lags the roll by construction (the whole "swell lags the roll" feel).
 */
export function stepAltitudeFilter(prevSwellM: number, targetSwellM: number, ratePerSec: number, dtSec: number): number {
  return approachValue(prevSwellM, targetSwellM, ratePerSec, clampStepDt(dtSec));
}

/**
 * MapLibre has no camera-altitude axis, so altitude shaping is expressed as a zoom
 * delta. This is the standard perspective relation: at zoom z the ground resolution
 * is 2πR/(512·2^z) m/px, and the camera height is the resolution the viewport
 * spans across its vertical field of view. Inverted, it gives the zoom whose
 * camera sits at `altitudeM`. Breathing/rise around a base altitude therefore
 * arrive as (honestly tiny) zoom movements — the swell magnitudes are what they
 * are, and the readout reports metres, not zoom.
 */
export function zoomForAltitude(altitudeM: number, latDeg: number, viewportHeightPx: number, fovDeg: number): number {
  if (!(altitudeM > 0) || !Number.isFinite(altitudeM)) return 0;
  const lat = clamp(Number.isFinite(latDeg) ? latDeg : 0, -85, 85);
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const vp = Number.isFinite(viewportHeightPx) && viewportHeightPx > 0 ? viewportHeightPx : 900;
  const fov = Number.isFinite(fovDeg) && fovDeg > 0 && fovDeg < 180 ? fovDeg : 60;
  const denom = 1024 * Math.tan(((fov / 2) * Math.PI) / 180) * altitudeM;
  const z = Math.log2((2 * Math.PI * EARTH_RADIUS_M * vp * cosLat) / denom);
  return clamp(z, 0, 22);
}

export interface RouteFlightConfig {
  cruiseSpeedMs: number;
  rampTimeSec: number;
  turnWindowSec: number;
  settleSec: number;
  bankGainDegPerDegPerSec: number;
  maxBankDeg: number;
  bankFilterRate: number;
  altitudeFilterRate: number;
  breatheAmplitudeM: number;
  breathePeriodM: number;
  turnRiseM: number;
  lookaheadSec: number;
  gazeRate: number;
  pitchDeg: number;
  baseAltitudeM: number;
  viewportHeightPx: number;
  fovDeg: number;
}

export interface RouteFlightState {
  /** Flight time, s (== duration when done). */
  tSec: number;
  /** Arc position, m — closed-form integral of the speed profile. */
  arcM: number;
  /** Camera position (longitude UNWRAPPED across the dateline). */
  posLon: number;
  posLat: number;
  /** Smoothed gaze heading, degrees (unwrapped; may exceed 360). */
  headingDeg: number;
  /** Filtered bank, degrees. Zero on the first and last frames. */
  bankDeg: number;
  /** Internal bank filter states. */
  bank: BankFilterState;
  /** Internal altitude-filter state (metres of swell, NOT altitude). */
  swellM: number;
  /** Camera altitude, m (base + filtered swell; base when done). */
  altitudeM: number;
  /** Derived zoom for jumpTo. */
  zoom: number;
  /** Speed this frame, m/s. */
  speedMs: number;
  /** Planned turn rate this frame, °/s. */
  plannedRateDegPerSec: number;
  /** True once the flight has reached its end (a stable terminal frame). */
  done: boolean;
}

export interface RouteFlightCamera {
  centerLon: number;
  centerLat: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface RouteFlight {
  config: RouteFlightConfig;
  /** The sanitised, unwrapped polyline being flown. */
  points: [number, number][];
  metrics: TrackMetrics;
  corners: TurnCorner[];
  lengthM: number;
  durationSec: number;
  initialState(): RouteFlightState;
  /** Pure frame advance. Safe to call repeatedly on a done state (returns it unchanged). */
  step(state: RouteFlightState, dtSec: number): RouteFlightState;
  camera(state: RouteFlightState): RouteFlightCamera;
  /** A static camera for the reduced-motion pan (no roll, no breathing). */
  panCamera(): RouteFlightCamera;
}

/**
 * Build the flight. Returns null — never throws — when the track cannot be flown:
 * fewer than two valid points, or a zero total length (the dormant-safe empty
 * state the demo page renders when a TLE set is garbage).
 */
export function createRouteFlight(points: [number, number][], config?: Partial<RouteFlightConfig>): RouteFlight | null {
  const cfg: RouteFlightConfig = { ...ROUTE_FLIGHT_DEFAULTS, ...config };
  const pts = sanitizeTrack(points);
  if (pts.length < 2) return null;
  const metrics = trackMetrics(pts);
  if (!(metrics.totalM > 0)) return null;
  const speed = { lengthM: metrics.totalM, cruiseMs: cfg.cruiseSpeedMs, rampSec: cfg.rampTimeSec };
  const durationSec = profileDurationSec(speed.lengthM, speed.cruiseMs, speed.rampSec);
  if (!(durationSec > 0)) return null;
  const corners = buildTurnCorners(pts, metrics, speed, { windowSec: cfg.turnWindowSec, settleSec: cfg.settleSec });

  const initialState = (): RouteFlightState => {
    const pos = { lon: pts[0][0], lat: pts[0][1] };
    // Heading starts ALREADY pointing at the lookahead, so the flight never opens
    // with a corrective swing — the first frame is exactly "looking down the track".
    const gaze = trackPointAt(pts, metrics, arcAt(cfg.lookaheadSec, speed.lengthM, speed.cruiseMs, speed.rampSec));
    const headingDeg = tangentBearingDeg(pts[0], [gaze.lon, gaze.lat]);
    const zoom = zoomForAltitude(cfg.baseAltitudeM, pos.lat, cfg.viewportHeightPx, cfg.fovDeg);
    return {
      tSec: 0,
      arcM: 0,
      posLon: pos.lon,
      posLat: pos.lat,
      headingDeg,
      bankDeg: 0,
      bank: { s1: 0, s2: 0 },
      swellM: 0,
      altitudeM: cfg.baseAltitudeM,
      zoom,
      speedMs: 0,
      plannedRateDegPerSec: 0,
      done: false,
    };
  };

  const step = (state: RouteFlightState, dtSec: number): RouteFlightState => {
    if (state.done) return state;
    const dt = clampStepDt(dtSec);
    let tSec = state.tSec + dt;
    let done = false;
    if (tSec >= durationSec) {
      tSec = durationSec;
      done = true;
    }
    const arcM = arcAt(tSec, speed.lengthM, speed.cruiseMs, speed.rampSec);
    const pos = trackPointAt(pts, metrics, arcM);
    const plannedRateDegPerSec = turnRatePlanAt(tSec, corners);
    const rawBank = bankFromTurnRate(plannedRateDegPerSec, cfg.bankGainDegPerDegPerSec, cfg.maxBankDeg);
    const bank = stepBankFilters(state.bank, rawBank, cfg.bankFilterRate, dt);
    // THE LAST FRAME IS LEVEL, by force: the plan is already zero for the final
    // settleSec (windows are truncated), and hard-zeroing the terminal frame
    // removes whatever residual the filters could not drain in that window.
    const bankDeg = done ? 0 : bank.s2;
    const swellTarget = swellTargetM(arcM, bankDeg, plannedRateDegPerSec, cfg);
    const swellM = stepAltitudeFilter(state.swellM, swellTarget, cfg.altitudeFilterRate, dt);
    const altitudeM = cfg.baseAltitudeM + (done ? 0 : swellM);
    // Gaze: the point ~lookaheadSec ahead in FLIGHT TIME, clamped to the track end
    // so the final approach settles onto the arrival tangent instead of aiming past it.
    const gaze = trackPointAt(pts, metrics, arcAt(tSec + cfg.lookaheadSec, speed.lengthM, speed.cruiseMs, speed.rampSec));
    const desired = tangentBearingDeg([pos.lon, pos.lat], [gaze.lon, gaze.lat]);
    const headingDeg = angleApproachDeg(state.headingDeg, desired, cfg.gazeRate, dt);
    const zoom = zoomForAltitude(altitudeM, pos.lat, cfg.viewportHeightPx, cfg.fovDeg);
    return {
      tSec,
      arcM,
      posLon: pos.lon,
      posLat: pos.lat,
      headingDeg,
      bankDeg,
      bank,
      swellM,
      altitudeM,
      zoom,
      speedMs: speedAt(tSec, speed.lengthM, speed.cruiseMs, speed.rampSec),
      plannedRateDegPerSec,
      done,
    };
  };

  const camera = (state: RouteFlightState): RouteFlightCamera => ({
    centerLon: state.posLon,
    centerLat: state.posLat,
    zoom: state.zoom,
    pitch: clamp(cfg.pitchDeg, 0, 60),
    bearing: ((state.headingDeg % 360) + 360) % 360,
  });

  // prefers-reduced-motion flattens the flourish to a simple eased pan: a single
  // static camera over the track midpoint (locked pitch, tangent bearing, no roll,
  // no breathing) for the page's one easeTo.
  const panCamera = (): RouteFlightCamera => {
    const mid = trackPointAt(pts, metrics, metrics.totalM / 2);
    const after = trackPointAt(pts, metrics, Math.min(metrics.totalM, metrics.totalM / 2 + 1));
    return {
      centerLon: mid.lon,
      centerLat: mid.lat,
      zoom: zoomForAltitude(cfg.baseAltitudeM, mid.lat, cfg.viewportHeightPx, cfg.fovDeg),
      pitch: clamp(cfg.pitchDeg, 0, 60),
      bearing: tangentBearingDeg([mid.lon, mid.lat], [after.lon, after.lat]),
    };
  };

  return {
    config: cfg,
    points: pts,
    metrics,
    corners,
    lengthM: metrics.totalM,
    durationSec,
    initialState,
    step,
    camera,
    panCamera,
  };
}

/**
 * Start the flight at the vertex nearest `(lat, lon)` — the demo flies the
 * satellite's FUTURE track from its current sub-point, not the half orbit behind
 * it. Nearestness uses minimal longitude deltas, so a dateline track compares
 * correctly from either side of the line.
 */
export function startAtNearest(points: [number, number][], lat: number, lon: number): [number, number][] {
  if (points.length < 2) return points.slice();
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < points.length; i++) {
    // The polyline's longitudes are unwrapped (may exceed ±180); compare by the
    // SHORTEST delta against the wrapped target, else a 181° point looks 360° away
    // from a -179° target that is 2° from it.
    const k = Math.round((lon - points[i][0]) / 360);
    const dLon = ((points[i][0] + k * 360 - lon) * Math.PI) / 180;
    const dLat = ((points[i][1] - lat) * Math.PI) / 180;
    const latMid = ((points[i][1] + lat) / 2) * (Math.PI / 180);
    const d = Math.hypot(dLon * Math.cos(latMid), dLat);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best <= points.length - 2 ? points.slice(best) : points.slice(points.length - 2);
}
