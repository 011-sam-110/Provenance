import { describe, expect, it } from "vitest";
import { haversineKm } from "@/lib/geo/haversine";
import { EYE_PLACES } from "@/lib/eye/places";
import {
  FLY_AHEAD_KM,
  FLY_METRES_PER_SEC,
  ORBIT_DEG_PER_SEC,
  filmClock,
  flyAheadOf,
  flyArrived,
  parseMotion,
  stepFly,
  stepOrbit,
  wallClock,
  type EyePose,
} from "@/lib/eye/motion";

const metres = (a: EyePose, b: { lat: number; lon: number }) => haversineKm(a.lat, a.lon, b.lat, b.lon) * 1000;

describe("parseMotion", () => {
  it("reads the two moves and nothing else", () => {
    expect(parseMotion("orbit")).toBe("orbit");
    expect(parseMotion("fly")).toBe("fly");
    expect(parseMotion(null)).toBeNull();
    expect(parseMotion("spin")).toBeNull();
    expect(parseMotion("ORBIT")).toBeNull();
  });
});

describe("stepOrbit", () => {
  const start: EyePose = { lat: 51.5013, lon: -0.1218, bearing: 32 };

  it("turns the heading at six degrees a second and leaves the middle where it is", () => {
    const next = stepOrbit(start, 1 / 60);
    expect(next.bearing).toBeCloseTo(32 + ORBIT_DEG_PER_SEC / 60, 9);
    expect(next.lat).toBe(start.lat);
    expect(next.lon).toBe(start.lon);
  });

  it("goes all the way round in a minute of frames, whatever the frame rate", () => {
    for (const fps of [30, 60, 120]) {
      let p = start;
      for (let i = 0; i < 60 * fps; i++) p = stepOrbit(p, 1 / fps);
      expect(Math.abs(p.bearing - 32) % 360).toBeLessThan(1e-6);
    }
  });

  it("pauses through a long stall instead of jumping", () => {
    expect(stepOrbit(start, 45).bearing).toBeCloseTo(32 + ORBIT_DEG_PER_SEC * 0.1, 9);
    expect(stepOrbit(start, -1).bearing).toBe(32);
    expect(stepOrbit(start, Number.NaN).bearing).toBe(32);
  });

  it("wraps the heading into [0, 360)", () => {
    expect(stepOrbit({ ...start, bearing: 359.95 }, 0.1).bearing).toBeCloseTo(0.55, 9);
  });
});

describe("stepFly", () => {
  const westminster = EYE_PLACES[0];
  const from: EyePose = { lat: westminster.wide.lat, lon: westminster.wide.lon, bearing: westminster.wide.heading };
  const to = flyAheadOf(from);

  it("ends a short way ahead along the heading", () => {
    expect(metres(from, to)).toBeCloseTo(FLY_AHEAD_KM * 1000, 0);
  });

  it("moves toward the end at the fly-along's ground speed, heading kept", () => {
    const next = stepFly(from, to, 1 / 30);
    expect(metres(from, next)).toBeCloseTo(FLY_METRES_PER_SEC / 30, 3);
    expect(metres(next, to)).toBeLessThan(metres(from, to));
    expect(next.bearing).toBe(from.bearing);
  });

  it("slows over the last stretch and stops on the end, never past it", () => {
    let p = from;
    let last = metres(p, to);
    let frames = 0;
    while (!flyArrived(p, to) && frames < 30 * 60) {
      p = stepFly(p, to, 1 / 30);
      const left = metres(p, to);
      expect(left).toBeLessThanOrEqual(last + 1e-9);
      last = left;
      frames++;
    }
    expect(flyArrived(p, to)).toBe(true);
    // 220 m at 28 m/s, plus the slow last stretch: about the nine seconds of a reel.
    expect(frames / 30).toBeGreaterThan(7);
    expect(frames / 30).toBeLessThan(14);
  });

  it("with no end point, moves ahead along the heading", () => {
    const north: EyePose = { lat: 51.5, lon: -0.12, bearing: 0 };
    const next = stepFly(north, null, 1);
    expect(next.lat).toBeGreaterThan(north.lat);
    expect(next.lon).toBeCloseTo(north.lon, 9);
    expect(metres(north, next)).toBeCloseTo(FLY_METRES_PER_SEC * 0.1, 3); // one clamped step
  });

  it("does nothing on a zero, negative or broken time step", () => {
    expect(stepFly(from, to, 0)).toEqual(from);
    expect(stepFly(from, to, -1)).toEqual(from);
    expect(stepFly(from, to, Number.NaN)).toEqual(from);
  });
});

describe("the view's clock", () => {
  it("in a film, stands still until the film steps it, and moves by the step only", () => {
    const c = filmClock(1_000);
    expect(c.film).toBe(true);
    expect(c.now()).toBe(1_000);
    c.step(1000 / 30);
    c.step(1000 / 30);
    expect(c.now()).toBeCloseTo(1_000 + 2000 / 30, 9);
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) c.step(bad);
    expect(c.now()).toBeCloseTo(1_000 + 2000 / 30, 9);
  });

  it("tells its listeners after each step, and no longer once they leave", () => {
    const c = filmClock(0);
    const seen: number[] = [];
    const leave = c.subscribe(() => seen.push(c.now()));
    c.step(500);
    c.step(500);
    leave();
    c.step(500);
    expect(seen).toEqual([500, 1000]);
  });

  it("live, is the wall clock and never calls a listener", () => {
    expect(wallClock.film).toBe(false);
    expect(Math.abs(wallClock.now() - Date.now())).toBeLessThan(1000);
    let calls = 0;
    wallClock.subscribe(() => calls++)();
    expect(calls).toBe(0);
  });
});
