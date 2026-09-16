import { describe, it, expect } from "vitest";
import {
  MAX_STEP_DT_SEC,
  ORBIT_DEFAULTS,
  advanceOrbit,
  angleApproachDeg,
  angleDeltaDeg,
  approachValue,
  clampStepDt,
  createMotionOwner,
  destinationPoint,
  orbitRadiusKm,
  wrapLonDeg,
} from "@/lib/cinematic/verbs";

describe("approachValue", () => {
  it("is frame-rate independent: 60 small steps land where 1 big step does", () => {
    const one = approachValue(0, 100, 2, 1);
    let v = 0;
    for (let i = 0; i < 60; i++) v = approachValue(v, 100, 2, 1 / 60);
    expect(v).toBeCloseTo(one, 9);
  });

  it("never overshoots the target, even on a huge dt spike", () => {
    expect(approachValue(0, 100, 2, 10_000)).toBeLessThanOrEqual(100);
    expect(approachValue(100, 0, 2, 10_000)).toBeGreaterThanOrEqual(0);
  });

  it("converges monotonically toward the target", () => {
    let v = 0;
    let prev = -1;
    for (let i = 0; i < 50; i++) {
      v = approachValue(v, 10, 3, 0.1);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
    expect(v).toBeCloseTo(10, 2);
  });

  it("degrades safely: zero/negative rate or dt leaves the value alone", () => {
    expect(approachValue(5, 10, 0, 1)).toBe(5);
    expect(approachValue(5, 10, -1, 1)).toBe(5);
    expect(approachValue(5, 10, 2, 0)).toBe(5);
    expect(approachValue(5, 10, 2, -0.5)).toBe(5);
  });

  it("never lets a NaN target poison the value", () => {
    expect(approachValue(5, NaN, 2, 1)).toBe(5);
    expect(approachValue(NaN, 10, 2, 1)).toBe(0);
  });
});

describe("angleDeltaDeg", () => {
  it("returns the shortest signed delta", () => {
    expect(angleDeltaDeg(0, 10)).toBeCloseTo(10);
    expect(angleDeltaDeg(10, 0)).toBeCloseTo(-10);
    expect(angleDeltaDeg(350, 10)).toBeCloseTo(20);
    expect(angleDeltaDeg(10, 350)).toBeCloseTo(-20);
  });

  it("handles unwrapped headings (no false 720° turns)", () => {
    expect(angleDeltaDeg(700, 10)).toBeCloseTo(30); // 700 ≡ 340
    expect(angleDeltaDeg(10, 730)).toBeCloseTo(0); // 730 ≡ 10
  });

  it("picks a deterministic side at the antipode (-180, not ±)", () => {
    expect(angleDeltaDeg(0, 180)).toBeCloseTo(-180);
    expect(angleDeltaDeg(180, 0)).toBeCloseTo(-180);
  });
});

describe("angleApproachDeg", () => {
  it("rotates toward the target at the smoothing rate", () => {
    const next = angleApproachDeg(0, 90, 2, 0.1);
    expect(next).toBeCloseTo(90 * (1 - Math.exp(-0.2)), 9);
  });

  it("stays finite and continuous through an antipodal turn (never vector-lerps)", () => {
    let h = 0;
    let prev = 0;
    for (let i = 0; i < 200; i++) {
      h = angleApproachDeg(h, 180, 3, 0.05);
      expect(Number.isFinite(h)).toBe(true);
      // Smoothness: each frame moves by at most the full exponential step for 180°.
      expect(Math.abs(angleDeltaDeg(prev, h))).toBeLessThanOrEqual(180 * (1 - Math.exp(-3 * 0.05)) + 1e-9);
      prev = h;
    }
    expect(angleDeltaDeg(h, 180)).toBeCloseTo(0, 3);
  });

  it("is frame-rate independent like approachValue", () => {
    const one = angleApproachDeg(0, 30, 2, 1);
    let h = 0;
    for (let i = 0; i < 60; i++) h = angleApproachDeg(h, 30, 2, 1 / 60);
    expect(h).toBeCloseTo(one, 8);
  });
});

describe("clampStepDt", () => {
  it("clamps tab-hidden dt spikes to the max step", () => {
    expect(clampStepDt(12)).toBe(MAX_STEP_DT_SEC);
  });

  it("passes normal dt through untouched", () => {
    expect(clampStepDt(0.016)).toBe(0.016);
  });

  it("treats negative and NaN dt as zero", () => {
    expect(clampStepDt(-0.1)).toBe(0);
    expect(clampStepDt(NaN)).toBe(0);
    expect(clampStepDt(Infinity)).toBe(MAX_STEP_DT_SEC);
  });
});

describe("destinationPoint", () => {
  it("moves north by distance/R along a meridian", () => {
    const p = destinationPoint(0, 0, 0, 111.195);
    expect(p.lat).toBeCloseTo(1, 2);
    expect(p.lon).toBeCloseTo(0, 6);
  });

  it("moves east along the equator", () => {
    const p = destinationPoint(0, 10, 90, 111.195);
    expect(p.lon).toBeCloseTo(11, 2);
  });

  it("wraps longitude at the dateline", () => {
    const p = destinationPoint(0, 179, 90, 500);
    expect(p.lon).toBeLessThan(-170);
  });

  it("degrades safely on garbage input", () => {
    const p = destinationPoint(50, 10, 45, NaN);
    expect(p.lat).toBe(50);
    expect(p.lon).toBe(10);
  });

  it("clamps latitude to ±85", () => {
    expect(destinationPoint(85, 0, 0, 500).lat).toBeLessThanOrEqual(85);
    expect(destinationPoint(-85, 0, 180, 500).lat).toBeGreaterThanOrEqual(-85);
  });
});

describe("orbitRadiusKm", () => {
  it("equals the base radius at the base zoom", () => {
    expect(orbitRadiusKm(ORBIT_DEFAULTS.baseZoom)).toBeCloseTo(ORBIT_DEFAULTS.baseRadiusKm, 6);
  });

  it("halves per zoom level in (zoom remaps the radius)", () => {
    const at = orbitRadiusKm(ORBIT_DEFAULTS.baseZoom);
    expect(orbitRadiusKm(ORBIT_DEFAULTS.baseZoom + 1)).toBeCloseTo(at / 2, 6);
    expect(orbitRadiusKm(ORBIT_DEFAULTS.baseZoom - 1)).toBeCloseTo(at * 2, 6);
  });

  it("degrades safely on non-finite input", () => {
    expect(orbitRadiusKm(NaN)).toBe(0);
    expect(orbitRadiusKm(3.8, 3.8, NaN)).toBe(0);
  });
});

describe("advanceOrbit", () => {
  it("advances heading at degPerSec with real dt", () => {
    const { state, camera } = advanceOrbit(
      { headingDeg: 0 },
      { lat: 0, lon: 0 },
      { degPerSec: 9, radiusKm: 2100, pitchDeg: 55 },
      0.1, // at MAX_STEP_DT_SEC, so the clamp is not in play
    );
    expect(state.headingDeg).toBeCloseTo(0.9, 6);
    // Bearing points back at the target: heading + 180.
    expect(camera.bearing).toBeCloseTo(180.9, 6);
    expect(camera.pitch).toBe(55);
  });

  it("clamps a tab-hidden dt spike to MAX_STEP_DT_SEC", () => {
    const { state } = advanceOrbit(
      { headingDeg: 0 },
      { lat: 0, lon: 0 },
      { degPerSec: 9, radiusKm: 2100, pitchDeg: 55 },
      60,
    );
    expect(state.headingDeg).toBeCloseTo(9 * MAX_STEP_DT_SEC, 6);
  });

  it("places the camera at the orbit radius from the target", () => {
    const { camera } = advanceOrbit(
      { headingDeg: 0 },
      { lat: 0, lon: 0 },
      { degPerSec: 0, radiusKm: 1111.95, pitchDeg: 55 }, // 10° of arc
      1,
    );
    expect(camera.centerLat).toBeCloseTo(10, 2);
    expect(camera.centerLon).toBeCloseTo(0, 6);
  });

  it("keeps pitch within MapLibre's 0-60 range on garbage input", () => {
    const { camera } = advanceOrbit(
      { headingDeg: 0 },
      { lat: 0, lon: 0 },
      { degPerSec: 9, radiusKm: 100, pitchDeg: NaN },
      1,
    );
    expect(camera.pitch).toBe(ORBIT_DEFAULTS.pitchDeg);
  });
});

describe("createMotionOwner", () => {
  it("issues monotonic tokens", () => {
    const owner = createMotionOwner();
    const t1 = owner.claim();
    const t2 = owner.claim();
    expect(t2).toBeGreaterThan(t1);
  });

  it("a new motion immediately settles the old one", () => {
    const owner = createMotionOwner();
    const t1 = owner.claim();
    expect(owner.owns(t1)).toBe(true);
    const t2 = owner.claim();
    expect(owner.owns(t1)).toBe(false);
    expect(owner.owns(t2)).toBe(true);
  });

  it("invalidate settles the current motion without starting a new one", () => {
    const owner = createMotionOwner();
    const t1 = owner.claim();
    owner.invalidate();
    expect(owner.owns(t1)).toBe(false);
  });

  it("owns nothing before any claim", () => {
    const owner = createMotionOwner();
    expect(owner.owns(1)).toBe(false);
    expect(owner.token()).toBe(0);
  });
});

describe("wrapLonDeg", () => {
  it("passes in-range values through exactly", () => {
    expect(wrapLonDeg(-120.5)).toBe(-120.5);
  });
  it("wraps out-of-range values into [-180, 180)", () => {
    expect(wrapLonDeg(200)).toBeCloseTo(-160, 6);
    expect(wrapLonDeg(-190)).toBeCloseTo(170, 6);
  });
});
