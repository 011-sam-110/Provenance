import { describe, it, expect } from "vitest";
import {
  ROUTE_FLIGHT_DEFAULTS,
  arcAt,
  arcTimeForSec,
  bankFromTurnRate,
  breatheSwellM,
  buildTurnCorners,
  createRouteFlight,
  mergeAntimeridianSegments,
  profileDurationSec,
  sanitizeTrack,
  speedAt,
  startAtNearest,
  stepAltitudeFilter,
  stepBankFilters,
  swellTargetM,
  tangentBearingDeg,
  trackMetrics,
  trackPointAt,
  turnRatePlanAt,
  zoomForAltitude,
} from "@/lib/cinematic/routeFlight";
import { angleDeltaDeg } from "@/lib/cinematic/verbs";

// A right-angled L-shape: east, then north — one clear 90° corner.
const L_PATH: [number, number][] = [
  [0, 0],
  [1, 0],
  [2, 1],
];

describe("sanitizeTrack", () => {
  it("drops non-finite points", () => {
    const out = sanitizeTrack([[0, 0], [NaN, 1], [1, NaN], [2, 2]]);
    expect(out).toEqual([[0, 0], [2, 2]]);
  });

  it("collapses consecutive duplicates", () => {
    const out = sanitizeTrack([[0, 0], [0, 0], [1, 1], [1, 1]]);
    expect(out.length).toBe(2);
  });

  it("clamps latitude to ±85", () => {
    const out = sanitizeTrack([[0, 89], [1, -92]]);
    expect(out[0][1]).toBe(85);
    expect(out[1][1]).toBe(-85);
  });
});

describe("mergeAntimeridianSegments", () => {
  it("unwraps a dateline crossing into one continuous polyline", () => {
    const merged = mergeAntimeridianSegments([
      [[170, 0], [179, 0]],
      [[-179, 0], [-170, 0]],
    ]);
    // 179 → 181 (not -179): every consecutive delta is the shortest one.
    expect(merged.map((p) => p[0])).toEqual([170, 179, 181, 190]);
  });

  it("keeps a non-crossing track unchanged", () => {
    const merged = mergeAntimeridianSegments([[[0, 0], [10, 5], [20, 10]]]);
    expect(merged).toEqual([[0, 0], [10, 5], [20, 10]]);
  });

  it("drops non-finite points while merging", () => {
    const merged = mergeAntimeridianSegments([[[0, 0], [NaN, 1], [10, 0]]]);
    expect(merged.length).toBe(2);
  });
});

describe("trackMetrics / trackPointAt", () => {
  it("measures one degree of latitude as ~111.2 km", () => {
    const m = trackMetrics([[0, 0], [0, 1]]);
    expect(m.totalM).toBeCloseTo(111195, 0);
  });

  it("is monotonic and cumulative", () => {
    const m = trackMetrics(L_PATH);
    expect(m.cumM[0]).toBe(0);
    for (let i = 1; i < m.cumM.length; i++) expect(m.cumM[i]).toBeGreaterThan(m.cumM[i - 1]);
  });

  it("interpolates positions at the cumulative arc", () => {
    const m = trackMetrics([[0, 0], [2, 0]]);
    const mid = trackPointAt([[0, 0], [2, 0]], m, m.totalM / 2);
    expect(mid.lon).toBeCloseTo(1, 9);
    expect(mid.lat).toBeCloseTo(0, 9);
  });

  it("clamps arc positions to the track ends", () => {
    const pts: [number, number][] = [[0, 0], [2, 0]];
    const m = trackMetrics(pts);
    expect(trackPointAt(pts, m, -5).lon).toBe(0);
    expect(trackPointAt(pts, m, 1e9).lon).toBe(2);
  });
});

describe("tangentBearingDeg", () => {
  it("reads 0 for north and 90 for east", () => {
    expect(tangentBearingDeg([0, 0], [0, 1])).toBeCloseTo(0, 6);
    expect(tangentBearingDeg([0, 0], [1, 0])).toBeCloseTo(90, 6);
  });
  it("is 0 for a degenerate segment", () => {
    expect(tangentBearingDeg([0, 0], [0, 0])).toBe(0);
  });
});

describe("trapezoid speed profile", () => {
  const L = 1000;
  const V = 100;
  const Tr = 2;

  it("duration is ramp + cruise + ramp", () => {
    expect(profileDurationSec(L, V, Tr)).toBe(2 + 8 + 2);
  });

  it("degrades to a peak-only double ramp on short paths", () => {
    expect(profileDurationSec(100, V, Tr)).toBe(2 * Tr);
  });

  it("is zero for any non-positive input", () => {
    expect(profileDurationSec(0, V, Tr)).toBe(0);
    expect(profileDurationSec(L, 0, Tr)).toBe(0);
    expect(profileDurationSec(L, V, 0)).toBe(0);
  });

  it("ramps in from 0, cruises, and ramps out to 0", () => {
    expect(speedAt(0, L, V, Tr)).toBe(0);
    expect(speedAt(Tr, L, V, Tr)).toBeCloseTo(V, 9);
    expect(speedAt(Tr + 4, L, V, Tr)).toBe(V);
    expect(speedAt(2 * Tr + 8, L, V, Tr)).toBe(0);
  });

  it("is C¹ at both ramp/cruise joins (derivative has no corner)", () => {
    const h = 1e-4;
    const left = (speedAt(Tr, L, V, Tr) - speedAt(Tr - h, L, V, Tr)) / h;
    const right = (speedAt(Tr + h, L, V, Tr) - speedAt(Tr, L, V, Tr)) / h;
    expect(Math.abs(left)).toBeLessThan(1e-2);
    expect(Math.abs(right)).toBeLessThan(1e-2);
    const join = Tr + 8;
    const left2 = (speedAt(join, L, V, Tr) - speedAt(join - h, L, V, Tr)) / h;
    const right2 = (speedAt(join + h, L, V, Tr) - speedAt(join, L, V, Tr)) / h;
    expect(Math.abs(left2)).toBeLessThan(1e-2);
    expect(Math.abs(right2)).toBeLessThan(1e-2);
  });

  it("is C¹ at the peak of a peak-only profile", () => {
    const h = 1e-4;
    const mid = Tr;
    const left = (speedAt(mid, 100, V, Tr) - speedAt(mid - h, 100, V, Tr)) / h;
    const right = (speedAt(mid + h, 100, V, Tr) - speedAt(mid, 100, V, Tr)) / h;
    expect(Math.abs(left)).toBeLessThan(1e-2);
    expect(Math.abs(right)).toBeLessThan(1e-2);
  });
});

describe("arcAt (closed-form integral)", () => {
  const L = 1000;
  const V = 100;
  const Tr = 2;

  it("lands EXACTLY on the track length at the end (no per-frame drift)", () => {
    expect(arcAt(12, L, V, Tr)).toBe(L);
  });

  it("is a pure function of time: numeric integration of speed agrees with it", () => {
    // Simpson over fine steps — the closed form must match the physics it integrates.
    const T = profileDurationSec(L, V, Tr);
    const n = 10_000;
    const h = T / n;
    let sum = speedAt(0, L, V, Tr) + speedAt(T, L, V, Tr);
    for (let i = 1; i < n; i++) {
      sum += speedAt(i * h, L, V, Tr) * (i % 2 === 0 ? 2 : 4);
    }
    const numeric = (sum * h) / 3;
    expect(arcAt(T, L, V, Tr)).toBeCloseTo(numeric, 6);
  });

  it("is monotonic and clamped outside the flight", () => {
    expect(arcAt(-1, L, V, Tr)).toBe(0);
    expect(arcAt(99, L, V, Tr)).toBe(L);
    let prev = -1;
    for (let t = 0; t <= 12; t += 0.25) {
      const s = arcAt(t, L, V, Tr);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it("integrates the peak-only profile to its exact length too", () => {
    expect(arcAt(2 * Tr, 100, V, Tr)).toBeCloseTo(100, 9);
  });
});

describe("arcTimeForSec", () => {
  it("inverts arcAt", () => {
    const L = 1000;
    const V = 100;
    const Tr = 2;
    for (const t of [0.5, 1.9, 2.1, 6, 11.9]) {
      expect(arcTimeForSec(arcAt(t, L, V, Tr), L, V, Tr)).toBeCloseTo(t, 5);
    }
  });

  it("clamps to the flight bounds", () => {
    expect(arcTimeForSec(-1, 1000, 100, 2)).toBe(0);
    expect(arcTimeForSec(1e9, 1000, 100, 2)).toBe(12);
  });
});

describe("turn plan", () => {
  const metrics = trackMetrics(L_PATH);
  const speed = { lengthM: metrics.totalM, cruiseMs: 1500, rampSec: 6 };

  it("peaks at the corner and integrates to the corner angle", () => {
    const corners = buildTurnCorners(L_PATH, metrics, speed, { windowSec: 8, settleSec: 2 });
    expect(corners.length).toBe(1);
    const c = corners[0];
    expect(c.tSec).toBeGreaterThan(0);
    // The plan's time-integral equals the turn the SAME metric measures at the
    // corner (equirectangular: the L's "east then north" is ≈45.001°, not 90°).
    const dψ = angleDeltaDeg(
      tangentBearingDeg(L_PATH[0], L_PATH[1]),
      tangentBearingDeg(L_PATH[1], L_PATH[2]),
    );
    const n = 20_000;
    const from = c.tSec - c.leftW;
    const to = c.tSec + c.rightW;
    const h = (to - from) / n;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += turnRatePlanAt(from + i * h, corners) * h;
    expect(sum).toBeCloseTo(dψ, 1);
    // Peak value sits at the corner time.
    expect(turnRatePlanAt(c.tSec, corners)).toBeCloseTo(c.peakDegPerSec, 9);
  });

  it("is exactly zero at the first and last moments", () => {
    const corners = buildTurnCorners(L_PATH, metrics, speed, { windowSec: 8, settleSec: 2 });
    expect(turnRatePlanAt(0, corners)).toBe(0);
    expect(turnRatePlanAt(profileDurationSec(metrics.totalM, 1500, 6), corners)).toBe(0);
  });

  it("skips corners with no room to roll into", () => {
    // Settle window so large no corner fits → no corners, plan is identically 0.
    const none = buildTurnCorners(L_PATH, metrics, speed, { windowSec: 0.01, settleSec: 1e6 });
    expect(none.length).toBe(0);
  });
});

describe("bank filters", () => {
  it("caps bank at ~10°", () => {
    expect(bankFromTurnRate(1000, ROUTE_FLIGHT_DEFAULTS.bankGainDegPerDegPerSec, ROUTE_FLIGHT_DEFAULTS.maxBankDeg)).toBe(10);
    expect(bankFromTurnRate(-1000, ROUTE_FLIGHT_DEFAULTS.bankGainDegPerDegPerSec, ROUTE_FLIGHT_DEFAULTS.maxBankDeg)).toBe(-10);
  });

  it("enters with zero derivative (C¹ roll entry, first frame level)", () => {
    const rate = 0.7;
    const dt = 1e-3;
    const one = stepBankFilters({ s1: 0, s2: 0 }, 10, rate, dt);
    // Response to a step through two cascaded stages is O(dt²) — the derivative at
    // entry is 0, which is exactly what "no snap" needs.
    expect(one.s2).toBeLessThan(10 * rate * rate * dt * dt * 1.5);
  });

  it("is frame-rate independent for small frames (cascade sampling error is O(dt))", () => {
    const rate = 0.7;
    let a = { s1: 0, s2: 0 };
    for (let i = 0; i < 100; i++) a = stepBankFilters(a, 5, rate, 0.01);
    let b = { s1: 0, s2: 0 };
    for (let i = 0; i < 200; i++) b = stepBankFilters(b, 5, rate, 0.005);
    // Halving the frame changes the answer by O(dt) — the exponential-Euler form
    // is exact for a constant input on one stage, but the second stage samples a
    // moving s1. The bound is the honest one and shrinks as frames shorten.
    expect(Math.abs(a.s2 - b.s2)).toBeLessThan(0.02);
  });

  it("drains back to level when the plan goes quiet", () => {
    let b = { s1: 8, s2: 7 };
    // 20 s of zero input: the cascade needs ~ln(100)/rate twice over to fall below
    // a tenth of a degree — 10 s is not enough (this is what settleSec trades on).
    for (let i = 0; i < 400; i++) b = stepBankFilters(b, 0, 0.7, 0.05);
    expect(Math.abs(b.s2)).toBeLessThan(1e-3);
  });
});

describe("altitude shaping", () => {
  it("breathing is zero-mean over one period and zero at the start", () => {
    expect(breatheSwellM(0, 20, 2200)).toBeCloseTo(0, 9);
    const n = 10_000;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += breatheSwellM((2200 / n) * i, 20, 2200) / n;
    expect(Math.abs(sum)).toBeLessThan(0.05);
  });

  it("fades breathing out as bank comes in and adds the 26 m rise into turns", () => {
    const cfg = ROUTE_FLIGHT_DEFAULTS;
    // Bank at the cap → breathing term is fully faded (here: quarter period, sin=1).
    const fadedQuarter = swellTargetM(550, cfg.maxBankDeg, 0, cfg);
    expect(fadedQuarter).toBeCloseTo(0, 6);
    // Full-strength planned turn, level bank → pure 26 m rise.
    const fullTurn = swellTargetM(0, 0, 20, cfg);
    expect(fullTurn).toBeCloseTo(cfg.turnRiseM, 6);
    // No turn, level bank, quarter period → pure breathing.
    const breathe = swellTargetM(550, 0, 0, cfg);
    expect(breathe).toBeCloseTo(cfg.breatheAmplitudeM, 6);
  });

  it("the altitude filter lags the roll (slower rate)", () => {
    const bankHalf = Math.log(2) / ROUTE_FLIGHT_DEFAULTS.bankFilterRate;
    const swellHalf = Math.log(2) / ROUTE_FLIGHT_DEFAULTS.altitudeFilterRate;
    expect(swellHalf).toBeGreaterThan(bankHalf);
    let b = { s1: 0, s2: 0 };
    let s = 0;
    let bankDone = -1;
    let swellDone = -1;
    for (let i = 1; i <= 400; i++) {
      b = stepBankFilters(b, 10, ROUTE_FLIGHT_DEFAULTS.bankFilterRate, 0.05);
      s = stepAltitudeFilter(s, 10, ROUTE_FLIGHT_DEFAULTS.altitudeFilterRate, 0.05);
      if (bankDone < 0 && b.s2 >= 5) bankDone = i;
      if (swellDone < 0 && s >= 5) swellDone = i;
    }
    expect(bankDone).toBeGreaterThan(0);
    expect(swellDone).toBeGreaterThan(bankDone);
  });
});

describe("zoomForAltitude", () => {
  it("halves the altitude per zoom level (higher = wider)", () => {
    const z1 = zoomForAltitude(30_000, 0, 900, 60);
    const z2 = zoomForAltitude(60_000, 0, 900, 60);
    expect(z2).toBeCloseTo(z1 - 1, 9);
  });

  it("accounts for mercator latitude (cos factor)", () => {
    const equator = zoomForAltitude(30_000, 0, 900, 60);
    const at60 = zoomForAltitude(30_000, 60, 900, 60);
    expect(at60).toBeCloseTo(equator - 1, 9); // cos(60°) = 0.5
  });

  it("clamps to the map's zoom range on garbage input", () => {
    expect(zoomForAltitude(NaN, 0, 900, 60)).toBe(0);
    expect(zoomForAltitude(1e9, 0, 900, 60)).toBe(0);
  });
});

describe("createRouteFlight", () => {
  it("returns null for unflyable tracks (0-length, 1-point, all-NaN)", () => {
    expect(createRouteFlight([])).toBeNull();
    expect(createRouteFlight([[0, 0]])).toBeNull();
    expect(createRouteFlight([[0, 0], [0, 0]])).toBeNull();
    expect(createRouteFlight([[NaN, NaN], [NaN, NaN]])).toBeNull();
  });

  it("starts level, stays monotonic, and ENDS LEVEL", () => {
    const flight = createRouteFlight(L_PATH);
    expect(flight).not.toBeNull();
    if (!flight) return;
    let state = flight.initialState();
    expect(state.bankDeg).toBe(0); // first frame level
    expect(state.altitudeM).toBe(ROUTE_FLIGHT_DEFAULTS.baseAltitudeM);
    let prevArc = 0;
    let steps = 0;
    while (!state.done && steps < 1_000_000) {
      state = flight.step(state, 0.25);
      expect(state.arcM).toBeGreaterThanOrEqual(prevArc);
      prevArc = state.arcM;
      steps++;
    }
    expect(state.done).toBe(true);
    expect(state.arcM).toBe(flight.lengthM); // closed-form landing — zero drift
    expect(state.bankDeg).toBe(0); // last frame level
    expect(state.altitudeM).toBe(ROUTE_FLIGHT_DEFAULTS.baseAltitudeM);
    // Terminal state is stable: stepping further changes nothing.
    const again = flight.step(state, 1);
    expect(again).toEqual(state);
  });

  it("clamps a tab-hidden dt spike instead of teleporting", () => {
    const flight = createRouteFlight(L_PATH);
    expect(flight).not.toBeNull();
    if (!flight) return;
    const state = flight.step(flight.initialState(), 100);
    // 100 s of tab-hidden time arrives as one clamped step: ≤ MAX dt of speed.
    expect(state.arcM).toBeLessThanOrEqual(ROUTE_FLIGHT_DEFAULTS.cruiseSpeedMs * 0.1 * 1.5);
  });

  it("keeps the gaze heading finite and smooth through a 180° reversal (never vector-lerps)", () => {
    const reversal: [number, number][] = [
      [0, 0],
      [1, 0],
      [0, 0], // turn around
    ];
    const flight = createRouteFlight(reversal);
    expect(flight).not.toBeNull();
    if (!flight) return;
    let state = flight.initialState();
    let prevHeading = state.headingDeg;
    let steps = 0;
    while (!state.done && steps < 5000) {
      state = flight.step(state, 0.05);
      expect(Number.isFinite(state.headingDeg)).toBe(true);
      // No frame may swing more than the exponential step of a full 180°.
      expect(Math.abs(angleDeltaDeg(prevHeading, state.headingDeg))).toBeLessThanOrEqual(180 * (1 - Math.exp(-0.9 * 0.05)) + 1e-6);
      prevHeading = state.headingDeg;
      steps++;
    }
  });

  it("flies a dateline-crossing track with continuous position and heading", () => {
    const track = mergeAntimeridianSegments([
      [[170, 0], [179, 0]],
      [[-179, 0], [-170, 0]],
    ]);
    const flight = createRouteFlight(track, { cruiseSpeedMs: 3000 });
    expect(flight).not.toBeNull();
    if (!flight) return;
    let state = flight.initialState();
    let prevLon = state.posLon;
    let prevBearing = flight.camera(state).bearing;
    let crossed = false;
    let steps = 0;
    while (!state.done && steps < 1_000_000) {
      state = flight.step(state, 0.05);
      const cam = flight.camera(state);
      expect(Math.abs(state.posLon - prevLon)).toBeLessThan(3000 * 0.05 * 1.6 + 1); // no 360° jump
      const d = Math.abs(angleDeltaDeg(prevBearing, cam.bearing));
      expect(d).toBeLessThan(30); // no ±180 flip across the line
      if (prevLon < 180 && state.posLon > 180) crossed = true;
      prevLon = state.posLon;
      prevBearing = cam.bearing;
      steps++;
    }
    expect(crossed).toBe(true);
  });

  it("panCamera (reduced motion) is a single static camera with locked pitch", () => {
    const flight = createRouteFlight(L_PATH);
    expect(flight).not.toBeNull();
    if (!flight) return;
    const cam = flight.panCamera();
    expect(cam.pitch).toBe(ROUTE_FLIGHT_DEFAULTS.pitchDeg);
    expect(Number.isFinite(cam.zoom)).toBe(true);
    expect(Number.isFinite(cam.bearing)).toBe(true);
  });
});

describe("startAtNearest", () => {
  it("starts the flight at the vertex nearest the target", () => {
    const pts: [number, number][] = [[0, 0], [10, 0], [20, 0]];
    const out = startAtNearest(pts, 0, 10.2);
    expect(out[0]).toEqual([10, 0]);
  });

  it("is dateline-aware (181° unwrapped is 2° from a -179° target)", () => {
    const pts: [number, number][] = [[170, 0], [181, 0], [190, 0]];
    const out = startAtNearest(pts, 0, -179);
    expect(out[0][0]).toBe(181);
  });

  it("never returns fewer than two points", () => {
    const pts: [number, number][] = [[0, 0], [10, 0]];
    expect(startAtNearest(pts, 0, 100).length).toBe(2);
  });
});
