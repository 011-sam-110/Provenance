import { describe, expect, it } from "vitest";
import {
  GAP_MS,
  MAX_SEGMENT_KM,
  STOP_MS,
  bearingDeg,
  classifyStep,
  distanceKm,
  dropOldest,
  heardAt,
  newLine,
  pointAt,
  pointCount,
  stepLine,
  toStoredTrack,
  trimOlderThan,
  type TrackPoint,
} from "@/lib/planes/trackLine";
import { projectAhead } from "@/lib/planes/trail";

const T0 = 1_792_180_000_000;
const PULL_MS = 90_000;
const MAX = 500;

/** A cruise at 250 m/s (22.5 km a pull) along one heading, from a point, one row a pull. */
function cruise(from: TrackPoint, headingDeg: number, pulls: number, kmPerPull = 22.5): TrackPoint[] {
  const out: TrackPoint[] = [];
  let at = from;
  for (let i = 0; i < pulls; i++) {
    const p = projectAhead(at.lat, at.lon, headingDeg, kmPerPull);
    at = { lat: p.lat, lon: p.lon, altKm: from.altKm, t: at.t + PULL_MS };
    out.push(at);
  }
  return out;
}

const start: TrackPoint = { lat: 51.47, lon: -0.45, altKm: 11, t: T0 };

describe("thinning", () => {
  it("costs a straight cruise few points and keeps the end at the newest position", () => {
    const line = newLine(start);
    const path = cruise(start, 75, 240); // 6 hours
    for (const p of path) stepLine(line, p, MAX);
    const last = pointAt(line, pointCount(line) - 1);
    expect(last.lat).toBeCloseTo(path[path.length - 1].lat, 6);
    expect(last.lon).toBeCloseTo(path[path.length - 1].lon, 6);
    expect(last.t).toBe(path[path.length - 1].t);
    // A point every MAX_SEGMENT_KM at most: 5,400 km over 150 km straights, so about 36 + 2,
    // against 241 positions heard.
    expect(pointCount(line)).toBeLessThan(45);
    expect(pointCount(line)).toBeGreaterThanOrEqual(5400 / MAX_SEGMENT_KM);
  });

  it("keeps a straight no longer than MAX_SEGMENT_KM", () => {
    const line = newLine(start);
    for (const p of cruise(start, 200, 120)) stepLine(line, p, MAX);
    for (let i = 1; i < pointCount(line) - 1; i++) {
      expect(distanceKm(pointAt(line, i - 1), pointAt(line, i))).toBeLessThanOrEqual(MAX_SEGMENT_KM + 23);
    }
  });

  it("drops a position within a kilometre of the end of the line", () => {
    const line = newLine(start);
    const near = { ...start, lat: start.lat + 0.001, t: start.t + PULL_MS }; // about 110 m
    expect(stepLine(line, near, MAX)).toBe("skip");
    expect(pointCount(line)).toBe(1);
    // It was still heard, which is what the unheard rule and the gap rule read.
    expect(line.lastHeardAt).toBe(near.t);
  });

  it("gives a turn a point, and only a turn", () => {
    const line = newLine(start);
    const leg1 = cruise(start, 90, 4);
    const leg2 = cruise(leg1[3], 150, 4);
    const steps = [...leg1, ...leg2].map((p) => stepLine(line, p, MAX));
    expect(steps).toEqual(["append", "extend", "extend", "extend", "append", "extend", "extend", "extend"]);
    // Start, the turn and the newest position: 9 heard, 3 kept.
    expect(pointCount(line)).toBe(3);
  });

  it("does not let a slow curve creep away by small steps", () => {
    // 1 degree a pull is under the 2.5 degree tolerance every time. Measured against the
    // previous segment the whole curve would pass as straight, and it would not keep a point.
    const line = newLine(start);
    let at = start;
    let heading = 90;
    for (let i = 0; i < 60; i++) {
      heading += 1;
      const p = projectAhead(at.lat, at.lon, heading, 22.5);
      at = { lat: p.lat, lon: p.lon, altKm: 11, t: at.t + PULL_MS };
      stepLine(line, at, MAX);
    }
    expect(pointCount(line)).toBeGreaterThan(8);
    // And every kept point is one the plane was really at.
    for (let i = 1; i < pointCount(line); i++) expect(pointAt(line, i).t % PULL_MS).toBe(T0 % PULL_MS);
  });

  it("ignores a repeated or older reading", () => {
    const line = newLine(start);
    const [next] = cruise(start, 90, 1);
    stepLine(line, next, MAX);
    expect(stepLine(line, { ...next }, MAX)).toBe("skip");
    expect(stepLine(line, { ...next, t: next.t - 1000, lat: next.lat + 1 }, MAX)).toBe("skip");
    expect(pointCount(line)).toBe(2);
  });

  it("makes the same decision from the pure classifier", () => {
    const head = { lat: 0, lon: 0, t: T0 };
    const pt = (lat: number, lon: number, dt: number): TrackPoint => ({ lat, lon, altKm: 0, t: T0 + dt });
    expect(classifyStep(null, head, Number.NaN, T0, pt(0, 0.2, PULL_MS))).toBe("append");
    const bearing = bearingDeg({ lat: 0, lon: -0.2 }, head);
    expect(classifyStep({ lat: 0, lon: -0.2 }, head, bearing, T0, pt(0, 0.2, PULL_MS))).toBe("extend");
    expect(classifyStep({ lat: 0, lon: -0.2 }, head, bearing, T0, pt(0.2, 0.2, PULL_MS))).toBe("append");
  });
});

describe("gaps", () => {
  it("breaks the line after 10 minutes of silence, and draws nothing across it", () => {
    const line = newLine(start);
    const [a, b] = cruise(start, 90, 2);
    stepLine(line, a, MAX);
    stepLine(line, b, MAX);
    // Out of range for a while, at airliner speed: the same flight, so it stays, with a break.
    const far = projectAhead(b.lat, b.lon, 90, 800);
    const back = { lat: far.lat, lon: far.lon, altKm: 11, t: b.t + 60 * 60_000 };
    expect(stepLine(line, back, MAX)).toBe("gap");
    expect(line.breaks).toEqual([2]);
    expect(pointCount(line)).toBe(3);
    expect(line.firstHeardAt).toBe(T0);
  });

  it("does not break a line on two missed pulls", () => {
    const line = newLine(start);
    const path = cruise(start, 90, 6);
    stepLine(line, path[0], MAX);
    expect(stepLine(line, path[3], MAX)).not.toBe("gap");
    expect(line.breaks).toEqual([]);
  });

  it("does not take a thinned straight for a gap", () => {
    // A straight can hold half an hour between kept points. It is heard all the way.
    const line = newLine(start);
    const path = cruise(start, 90, 20, 7);
    for (const p of path) expect(stepLine(line, p, MAX)).not.toBe("gap");
    expect(line.breaks).toEqual([]);
  });

  it("breaks on a jump no aircraft can fly, and the next good position carries on", () => {
    const line = newLine(start);
    const [a, b] = cruise(start, 90, 2);
    stepLine(line, a, MAX);
    stepLine(line, b, MAX);
    const wild = { lat: 10, lon: 80, altKm: 11, t: b.t + PULL_MS };
    expect(stepLine(line, wild, MAX)).toBe("gap");
    const back = projectAhead(b.lat, b.lon, 90, 45);
    expect(stepLine(line, { lat: back.lat, lon: back.lon, altKm: 11, t: wild.t + PULL_MS }, MAX)).toBe("gap");
    expect(line.breaks).toEqual([2, 3]);
  });

  it("resets the straight after a break, so the first step of a part is a real point", () => {
    const line = newLine(start);
    stepLine(line, cruise(start, 90, 1)[0], MAX);
    const far = projectAhead(start.lat, start.lon, 90, 800);
    const back = { lat: far.lat, lon: far.lon, altKm: 11, t: start.t + 60 * 60_000 };
    stepLine(line, back, MAX);
    expect(Number.isNaN(line.bearing)).toBe(true);
    expect(stepLine(line, cruise(back, 90, 1)[0], MAX)).toBe("append");
  });
});

describe("a new flight", () => {
  it("starts when a plane comes back near where it stopped, after a stop out of range", () => {
    const line = newLine(start);
    for (const p of cruise(start, 90, 8)) stepLine(line, p, MAX);
    const last = pointAt(line, pointCount(line) - 1);
    // A turnaround of 50 minutes, last heard on approach, next heard climbing out 30 km away.
    const out = projectAhead(last.lat, last.lon, 200, 30);
    const back = { lat: out.lat, lon: out.lon, altKm: 2, t: last.t + 50 * 60_000 };
    expect(stepLine(line, back, MAX)).toBe("new-flight");
    expect(pointCount(line)).toBe(1);
    expect(line.firstHeardAt).toBe(back.t);
    expect(line.breaks).toEqual([]);
  });

  it("starts when a plane heard standing still for the whole stop moves on", () => {
    const line = newLine(start);
    let t = start.t;
    // Heard on the stand, not moving, for 30 minutes.
    for (let i = 0; i < 20; i++) {
      t += PULL_MS;
      expect(stepLine(line, { ...start, altKm: 0, t }, MAX)).toBe("skip");
    }
    expect(t - start.t).toBeGreaterThanOrEqual(STOP_MS);
    const away = projectAhead(start.lat, start.lon, 90, 2);
    expect(stepLine(line, { lat: away.lat, lon: away.lon, altKm: 0, t: t + PULL_MS }, MAX)).toBe("new-flight");
  });

  it("does not start at an ocean crossing outside receiver range", () => {
    const line = newLine(start);
    const [a] = cruise(start, 280, 1);
    stepLine(line, a, MAX);
    const far = projectAhead(a.lat, a.lon, 280, 3000);
    const back = { lat: far.lat, lon: far.lon, altKm: 11, t: a.t + 4 * 3_600_000 };
    expect(stepLine(line, back, MAX)).toBe("gap");
    expect(line.firstHeardAt).toBe(T0);
    expect(pointCount(line)).toBe(3);
  });

  it("does not start at a touch-and-go, which keeps moving", () => {
    const line = newLine(start);
    let at = start;
    for (let i = 0; i < 30; i++) {
      const p = projectAhead(at.lat, at.lon, i * 40, 3);
      at = { lat: p.lat, lon: p.lon, altKm: 0.3, t: at.t + PULL_MS };
      expect(stepLine(line, at, MAX)).not.toBe("new-flight");
    }
  });

  it("does not start for a short stop", () => {
    const line = newLine(start);
    const away = projectAhead(start.lat, start.lon, 90, 5);
    const back = { lat: away.lat, lon: away.lon, altKm: 0, t: start.t + STOP_MS - 60_000 };
    expect(stepLine(line, back, MAX)).toBe("gap");
    expect(back.t - start.t).toBeGreaterThanOrEqual(GAP_MS);
  });
});

describe("caps", () => {
  it("holds one line to its cap, oldest out, with the end kept", () => {
    const line = newLine(start);
    let at = start;
    let heading = 0;
    for (let i = 0; i < 40; i++) {
      heading += 45;
      const p = projectAhead(at.lat, at.lon, heading, 22.5);
      at = { lat: p.lat, lon: p.lon, altKm: 11, t: at.t + PULL_MS };
      stepLine(line, at, 10);
      expect(pointCount(line)).toBeLessThanOrEqual(10);
    }
    expect(pointAt(line, 9).t).toBe(at.t);
    expect(line.trimmed).toBe(true);
    expect(line.firstHeardAt).toBe(T0);
  });

  it("moves the breaks when the oldest points go", () => {
    const line = newLine(start);
    line.data.push(1, 1, 0, T0 + 1, 2, 2, 0, T0 + 2, 3, 3, 0, T0 + 3, 4, 4, 0, T0 + 4);
    line.breaks = [1, 3];
    dropOldest(line, 2);
    expect(pointCount(line)).toBe(3);
    expect(line.breaks).toEqual([1]);
    dropOldest(line, 1);
    expect(line.breaks).toEqual([]);
  });

  it("never drops the end of a line", () => {
    const line = newLine(start);
    dropOldest(line, 5);
    expect(pointCount(line)).toBe(1);
    trimOlderThan(line, T0 + 1_000_000);
    expect(pointCount(line)).toBe(1);
  });

  it("trims by age to the points inside the window", () => {
    const line = newLine(start);
    line.data.push(1, 1, 0, T0 + 1000, 2, 2, 0, T0 + 2000);
    trimOlderThan(line, T0 + 500);
    expect(pointCount(line)).toBe(2);
    expect(line.trimmed).toBe(true);
    trimOlderThan(line, T0 + 500);
    expect(pointCount(line)).toBe(2);
  });
});

describe("heardAt", () => {
  it("takes the position's own age off the snapshot's instant", () => {
    expect(heardAt(T0, 12.5)).toBe(T0 - 12_500);
  });
  it("uses the instant when a row carries no age", () => {
    expect(heardAt(T0, undefined)).toBe(T0);
    expect(heardAt(T0, "12")).toBe(T0);
    expect(heardAt(T0, -1)).toBe(T0);
  });
});

describe("toStoredTrack", () => {
  it("is empty for a plane we hold no line for", () => {
    expect(toStoredTrack("plane:abc123", undefined)).toEqual({
      id: "plane:abc123",
      firstHeardAt: null,
      lastHeardAt: null,
      trimmed: false,
      points: [],
      breaks: [],
    });
  });
  it("sends rounded places and exact times", () => {
    const line = newLine({ lat: 51.123456789, lon: -0.987654321, altKm: 10.6789, t: T0 });
    expect(toStoredTrack("plane:abc123", line).points).toEqual([[51.12346, -0.98765, 10.68, T0]]);
  });
});
