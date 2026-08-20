import { expect, test } from "vitest";
import {
  MIN_VERTICES,
  aoiLabel,
  draftCollection,
  ringToFeature,
} from "@/lib/map/aoi";

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
