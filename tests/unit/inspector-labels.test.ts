import { expect, test } from "vitest";
import { areaSummary, ringAreaKm2, type InspectorArea } from "@/lib/shell/inspector";

const RING: [number, number][] = [
  [36.0, 49.8],
  [36.5, 49.8],
  [36.5, 50.2],
  [36.0, 50.2],
];

const AREA: InspectorArea = {
  id: "area:1",
  label: "Kharkiv corridor",
  polygon: RING,
  bbox: [36, 49.8, 36.5, 50.2],
  createdAt: 1,
  sources: { planes: true, conflict: true },
};

test("ringAreaKm2 is within 5% of the true spherical area of a known box", () => {
  // 0.5deg lon x 0.4deg lat at ~50N. Reference computed from the spherical excess
  // formula: ~35.8km x 44.5km = ~1,593 km2.
  const km2 = ringAreaKm2(RING);
  expect(km2).toBeGreaterThan(1_500);
  expect(km2).toBeLessThan(1_700);
});

test("ringAreaKm2 refuses a degenerate ring rather than returning a fake number", () => {
  expect(ringAreaKm2([[0, 0], [1, 1]])).toBe(0);
});

test("areaSummary counts the sources actually on, not the keys present", () => {
  expect(areaSummary({ ...AREA, sources: { planes: true, conflict: false } })).toMatch(/^1 source /);
});

test("areaSummary pluralises and rounds", () => {
  expect(areaSummary(AREA)).toMatch(/^2 sources · [\d,]+ km²$/);
});

test("areaSummary states zero honestly rather than hiding it", () => {
  expect(areaSummary({ ...AREA, sources: {} })).toMatch(/^No sources · /);
});
