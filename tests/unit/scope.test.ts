import { describe, it, expect, test } from "vitest";
import {
  withinScope,
  radiusFromBbox,
  coerceSavedScope,
  WORLD_SCOPE,
  aoiScope,
  bboxOfRing,
  pointInRing,
  sanitiseRing,
  type Scope,
} from "@/lib/shell/scope";

describe("withinScope", () => {
  it("world admits everything", () => {
    expect(withinScope(80, 170, WORLD_SCOPE)).toBe(true);
  });
  it("near-me / region admit points inside the radius and reject those outside", () => {
    const s: Scope = { mode: "near-me", center: { lat: 51.5, lon: -0.12 }, radiusKm: 50, label: "Near me" };
    expect(withinScope(51.51, -0.13, s)).toBe(true);   // ~1 km away
    expect(withinScope(48.85, 2.35, s)).toBe(false);   // Paris, far outside
  });
  it("aoi admits points inside the bbox [west,south,east,north]", () => {
    const s: Scope = { mode: "aoi", bbox: [-1, 50, 1, 52], label: "AOI" };
    expect(withinScope(51, 0, s)).toBe(true);
    expect(withinScope(60, 0, s)).toBe(false);
  });
  it("falls back to admit-all on a malformed scope (never hide untestable data)", () => {
    expect(withinScope(0, 0, { mode: "near-me", label: "x" })).toBe(true);
    expect(withinScope(0, 0, { mode: "aoi", label: "x" })).toBe(true);
  });
});

describe("radiusFromBbox", () => {
  it("derives a sensible radius (km) from a place extent", () => {
    expect(radiusFromBbox([-0.5, 51.2, 0.3, 51.7])).toBeGreaterThan(20);
    expect(radiusFromBbox([-0.001, 51.5, 0.001, 51.501])).toBeGreaterThanOrEqual(10); // floor
  });
});

describe("coerceSavedScope", () => {
  it("rehydrates a persisted near-me back to World (never auto-geolocates)", () => {
    expect(coerceSavedScope({ mode: "near-me", center: { lat: 1, lon: 2 }, radiusKm: 50, label: "Near me" }))
      .toEqual(WORLD_SCOPE);
  });
  it("keeps a region scope", () => {
    const r: Scope = { mode: "region", center: { lat: 1, lon: 2 }, radiusKm: 100, label: "Berlin" };
    expect(coerceSavedScope(r)).toEqual(r);
  });
  it("returns World for junk", () => {
    expect(coerceSavedScope(null)).toEqual(WORLD_SCOPE);
    expect(coerceSavedScope({ nope: true })).toEqual(WORLD_SCOPE);
  });
});

// ---------------------------------------------------------------------------
// Polygon AOI. "Hay analistas que solo quieren dibujar una zona en el mapa y ver
// alertas exclusivas de esa area." A rectangle was much less work and is not what
// was asked for: a coastline or a border region is not a rectangle, and a bbox
// around one admits most of what it was drawn to exclude.
// ---------------------------------------------------------------------------

/** An L-shape. Its bbox contains a region the ring itself excludes. */
const L_SHAPE: [number, number][] = [
  [0, 0],
  [4, 0],
  [4, 1],
  [1, 1],
  [1, 4],
  [0, 4],
];

test("pointInRing accepts the inside and rejects the outside", () => {
  expect(pointInRing(0.5, 0.5, L_SHAPE)).toBe(true); // corner of the L
  expect(pointInRing(3, 0.5, L_SHAPE)).toBe(true); // along the foot
  expect(pointInRing(0.5, 3, L_SHAPE)).toBe(true); // up the stem
  expect(pointInRing(10, 10, L_SHAPE)).toBe(false); // nowhere near
});

test("the concave notch is EXCLUDED — this is the whole reason it is not a bbox", () => {
  // (3, 3) sits inside the L's bounding box and outside the L.
  const [w, s, e, n] = bboxOfRing(L_SHAPE);
  expect(3 >= w && 3 <= e && 3 >= s && 3 <= n).toBe(true); // in the box
  expect(pointInRing(3, 3, L_SHAPE)).toBe(false); // out of the area
});

test("bboxOfRing is the envelope, west-south-east-north", () => {
  expect(bboxOfRing(L_SHAPE)).toEqual([0, 0, 4, 4]);
  expect(bboxOfRing([[-10, 50], [5, 60], [-3, 45]])).toEqual([-10, 45, 5, 60]);
});

test("withinScope filters on the polygon, not on its bounding box", () => {
  const scope = aoiScope(L_SHAPE);
  expect(withinScope(0.5, 0.5, scope)).toBe(true);
  expect(withinScope(3, 3, scope)).toBe(false); // in the bbox, out of the area
  expect(withinScope(50, 50, scope)).toBe(false);
});

test("aoiScope precomputes the envelope so the cheap reject is available", () => {
  const scope = aoiScope(L_SHAPE);
  expect(scope.mode).toBe("aoi");
  expect(scope.bbox).toEqual([0, 0, 4, 4]);
  expect(scope.polygon).toHaveLength(6);
});

test("an aoi with a degenerate ring falls back to the bbox rather than hiding everything", () => {
  // Two points is a line, not an area. withinScope must not treat it as one.
  const scope = { mode: "aoi" as const, label: "x", polygon: [[0, 0], [1, 1]] as [number, number][], bbox: [0, 0, 1, 1] as [number, number, number, number] };
  expect(withinScope(0.5, 0.5, scope)).toBe(true); // inside the bbox → admitted
});

test("an aoi with no area at all admits everything, never hides everything", () => {
  // The existing rule for malformed scopes: we never silently hide data we cannot test.
  expect(withinScope(51, 0, { mode: "aoi", label: "x" })).toBe(true);
});

// --- persistence: localStorage is user-writable and this drives what a feed HIDES

test("sanitiseRing rejects anything it would be unsafe to filter on", () => {
  expect(sanitiseRing(null)).toBeNull();
  expect(sanitiseRing([])).toBeNull();
  expect(sanitiseRing([[0, 0], [1, 1]])).toBeNull(); // a line is not an area
  expect(sanitiseRing([[0, 0], [1, 1], "nope"])).toBeNull();
  expect(sanitiseRing([[0, 0], [1, 1], [NaN, 2]])).toBeNull();
  expect(sanitiseRing([[0, 0], [1, 1], [999, 2]])).toBeNull(); // out of range
  expect(sanitiseRing([[0, 0], [1, 1], [2, 2]])).toEqual([[0, 0], [1, 1], [2, 2]]);
});

test("a junk polygon in storage drops the POLYGON, not the whole scope", () => {
  const restored = coerceSavedScope({ mode: "aoi", label: "Drawn area", polygon: [[0, 0]], bbox: [0, 0, 4, 4] });
  expect(restored.mode).toBe("aoi");
  expect(restored.polygon).toBeUndefined();
  // ...and it still admits, rather than filtering the console down to nothing
  // with no way for the user to see why.
  expect(withinScope(2, 2, restored)).toBe(true);
});

test("a valid stored polygon comes back with its envelope recomputed, not trusted", () => {
  const restored = coerceSavedScope({ mode: "aoi", label: "Drawn area", polygon: L_SHAPE, bbox: [-99, -99, 99, 99] });
  expect(restored.bbox).toEqual([0, 0, 4, 4]);
});
