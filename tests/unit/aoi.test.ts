import { expect, test } from "vitest";
import {
  MIN_VERTICES,
  RADIUS_RING_STEPS,
  aoiLabel,
  circleRing,
  draftCollection,
  formatRadius,
  radiusDraft,
  radiusLabel,
  ringToFeature,
} from "@/lib/map/aoi";
import { haversineKm } from "@/lib/geo/haversine";

const RING: [number, number][] = [
  [-6, 50],
  [4, 50],
  [4, 58],
  [-6, 58],
];

test("a ring is closed for the fill layer — an open ring paints nothing", () => {
  const f = ringToFeature(RING);
  expect(f.geometry.type).toBe("Polygon");
  const outer = (f.geometry as GeoJSON.Polygon).coordinates[0];
  expect(outer).toHaveLength(RING.length + 1);
  expect(outer[outer.length - 1]).toEqual(outer[0]);
});

test("the stored ring stays OPEN — the closing vertex is a rendering detail", () => {
  // The scope persists what the user placed. Storing a duplicated closing vertex
  // would make "4 points" read as 5 everywhere the count is shown.
  expect(RING).toHaveLength(4);
  expect(aoiLabel(RING)).toBe("Drawn area (4 points)");
});

test("the draft shows a vertex dot per placed point, and a line once there are two", () => {
  const one = draftCollection([[0, 0]]);
  expect(one.features.map((f) => f.geometry.type)).toEqual(["Point"]);

  const two = draftCollection([[0, 0], [1, 1]]);
  expect(two.features.map((f) => f.geometry.type)).toEqual(["Point", "Point", "LineString"]);

  const four = draftCollection(RING);
  expect(four.features.filter((f) => f.geometry.type === "Point")).toHaveLength(4);
});

test("an empty draft is an empty collection, not a malformed feature", () => {
  expect(draftCollection([]).features).toEqual([]);
});

test("the label names the vertex count and never invents a place name", () => {
  // A drawn area has no name. Guessing one from a centroid would be a claim the
  // product cannot support, which is the one thing it must not do.
  expect(aoiLabel(RING)).toMatch(/^Drawn area \(\d+ points\)$/);
  expect(aoiLabel(RING)).not.toMatch(/England|Europe|North|Region/);
});

test("three vertices is the floor, because two is a line", () => {
  expect(MIN_VERTICES).toBe(3);
  // Below the floor the ring is not closed — nothing should try to fill it.
  const outer = (ringToFeature([[0, 0], [1, 1]]).geometry as GeoJSON.Polygon).coordinates[0];
  expect(outer).toHaveLength(2);
});

// ── the radius tool ──────────────────────────────────────────────────────────
//
// A radius is a circle the user drew and a RING everything downstream stores,
// paints and filters on — see the DrawTool note in lib/map/aoi.ts. So the thing
// worth pinning is that the ring really is the circle: every vertex the same
// distance from the centre, by the same haversine metric withinScope filters with.

test("every vertex of a drawn circle is the radius away from its centre", () => {
  const centre: [number, number] = [-0.13, 51.51]; // London
  const ring = circleRing(centre, 25);
  expect(ring).toHaveLength(RADIUS_RING_STEPS);
  for (const [lon, lat] of ring) {
    expect(haversineKm(centre[1], centre[0], lat, lon)).toBeCloseTo(25, 2);
  }
});

test("...and that still holds at 78°N, which is where the flat formula breaks", () => {
  // `lon + km / (111 * cos(lat))` degenerates as cos(lat) → 0: at this latitude it
  // stretches the east-west axis by roughly 1/cos(78) ≈ 4.8x, so the "circle" comes
  // out as a lens several tens of km wide. This test is the reason the spherical
  // destination formula is in there, and it fails loudly if anyone simplifies it.
  const centre: [number, number] = [15.6, 78.2]; // Longyearbyen
  for (const [lon, lat] of circleRing(centre, 100)) {
    expect(haversineKm(centre[1], centre[0], lat, lon)).toBeCloseTo(100, 1);
  }
});

test("a circle drawn on the antimeridian keeps every longitude in range", () => {
  // The ring still has vertices either side of the line — that is a real shared
  // limitation of the polygon tool and bboxOfRing, not something this fixes. What
  // it must not do is emit 181.4, which no consumer of a lon/lat pair expects.
  for (const [lon] of circleRing([179.5, 12], 200)) {
    expect(lon).toBeGreaterThanOrEqual(-180);
    expect(lon).toBeLessThanOrEqual(180);
  }
});

test("the ring is stored OPEN, exactly like a hand-drawn one", () => {
  const ring = circleRing([0, 0], 10);
  expect(ring[0]).not.toEqual(ring[ring.length - 1]);
  // ...and ringToFeature is what closes it, for the circle as for the polygon.
  const outer = (ringToFeature(ring).geometry as GeoJSON.Polygon).coordinates[0];
  expect(outer[outer.length - 1]).toEqual(outer[0]);
});

test("a radius is written at a precision that does not hide the difference", () => {
  expect(formatRadius(0.437)).toBe("437 m");
  expect(formatRadius(2.34)).toBe("2.3 km");
  expect(formatRadius(437)).toBe("437 km");
  // The label states the gesture and never a place name, same rule as aoiLabel.
  expect(radiusLabel(12)).toBe("Drawn radius (12 km)");
  expect(radiusLabel(12)).not.toMatch(/London|Europe|Region/);
});

test("the draft is centre-only until the pointer has moved", () => {
  // Nothing to draw a circle from yet. A zero-radius ring would paint a dot-sized
  // smudge under the centre marker and read as a rendering fault.
  const idle = radiusDraft([0, 0], 0);
  expect(idle.features.map((f) => f.geometry.type)).toEqual(["Point"]);

  const sized = radiusDraft([0, 0], 5);
  expect(sized.features.map((f) => f.geometry.type)).toEqual(["Point", "LineString"]);
  // Closed, because this one is drawn as a LINE and an open circle shows the seam.
  const line = (sized.features[1].geometry as GeoJSON.LineString).coordinates;
  expect(line).toHaveLength(RADIUS_RING_STEPS + 1);
  expect(line[line.length - 1]).toEqual(line[0]);
});
