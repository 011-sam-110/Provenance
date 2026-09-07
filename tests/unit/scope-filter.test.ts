import { expect, test } from "vitest";
import { filterToScope } from "@/lib/scopeFilter";
import { aoiScope, WORLD_SCOPE } from "@/lib/shell/scope";

const RING: [number, number][] = [
  [36.0, 49.8],
  [36.5, 49.8],
  [36.5, 50.2],
  [36.0, 50.2],
];

const AT = (p: { lat: number; lon: number }) => p;
const INSIDE = { lat: 50.0, lon: 36.2 };
const OUTSIDE = { lat: 51.5, lon: -0.1 };

test("the world scope filters nothing and returns the SAME array", () => {
  const items = [INSIDE, OUTSIDE];
  expect(filterToScope(items, WORLD_SCOPE, AT)).toBe(items);
});

test("an aoi scope keeps only what is inside the ring", () => {
  const out = filterToScope([INSIDE, OUTSIDE], aoiScope(RING), AT);
  expect(out).toEqual([INSIDE]);
});

test("an item with no position is DROPPED inside an area, not silently kept", () => {
  const out = filterToScope([INSIDE, { lat: NaN, lon: NaN }], aoiScope(RING), (p) =>
    Number.isFinite(p.lat) ? p : null,
  );
  expect(out).toEqual([INSIDE]);
});

test("an item with no position is KEPT under the world scope", () => {
  const items = [{ lat: NaN, lon: NaN }];
  expect(filterToScope(items, WORLD_SCOPE, () => null)).toBe(items);
});

test("an empty list stays empty rather than throwing", () => {
  expect(filterToScope([], aoiScope(RING), AT)).toEqual([]);
});
