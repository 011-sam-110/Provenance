import { expect, test } from "vitest";
import fixture from "@/tests/fixtures/aurora-ovation.json";
import live from "@/tests/fixtures/aurora-ovation-live.json";
import {
  normalizeAurora,
  downsampleAurora,
  auroraColor,
  wrapLon,
  AURORA_SOURCE,
  type OvationGrid,
} from "@/lib/signals/aurora";
import { rowMetric } from "@/lib/console/signals/signalCard";

const grid = fixture as unknown as OvationGrid;
/** A verbatim excerpt of the live 2026-08-10 NOAA OVATION run (peak 22%). */
const liveGrid = live as unknown as OvationGrid;

test("keeps cells at/above the floor, brightest first", () => {
  const out = normalizeAurora(grid); // default floor 5%
  // The 2% polar cell is dropped; 18% loses its bucket to the 25% neighbour.
  expect(out.map((f) => f.props?.probability)).toEqual(["40%", "30%", "25%", "22%", "12%", "9%"]);
  expect(out.every((f) => f.signalId === "aurora")).toBe(true);
});

test("downsamples to one point per bucket, keeping the bucket's peak", () => {
  const out = normalizeAurora(grid);
  // [10,60,18] and [11,61,25] fall in the same 8°x4° bucket → only the peak survives.
  expect(out.some((f) => f.props?.probabilityPct === 25)).toBe(true);
  expect(out.some((f) => f.props?.probabilityPct === 18)).toBe(false);
  // The survivor keeps its OWN coordinates, not a bucket centre.
  const kept = out.find((f) => f.props?.probabilityPct === 25);
  expect(kept?.lon).toBe(11);
  expect(kept?.lat).toBe(61);
});

test("downsampleAurora is deterministic and honours the bucket size", () => {
  const coords: [number, number, number][] = [
    [0, 60, 10],
    [7, 61, 30], // same 8x4 bucket as [0,60] → the 30% peak wins
    [8, 60, 20], // next longitude bucket → survives separately
  ];
  expect(downsampleAurora(coords, 5, 8, 4)).toEqual([
    [7, 61, 30],
    [8, 60, 20],
  ]);
  // A 1°x1° bucket is a no-op thinner: every cell keeps its own bucket.
  expect(downsampleAurora(coords, 5, 1, 1)).toHaveLength(3);
});

test("wraps longitude 0..359 into -180..180 and tags forecast time", () => {
  const out = normalizeAurora(grid);
  const top = out[0]; // [200, 65, 40]
  expect(top.lon).toBe(-160); // 200 - 360
  expect(top.lat).toBe(65);
  expect(top.color).toBe(auroraColor(40));
  expect(top.title).toBe("Aurora 40% likely");
  expect(top.ts).toBe("2026-06-27T05:45:00Z");
  expect(top.props?.observed).toBe("2026-06-27T05:02:00Z");
  expect(out.some((f) => f.lon === -1)).toBe(true); // 359 → -1
  expect(wrapLon(180)).toBe(180);
  expect(wrapLon(181)).toBe(-179);
});

test("hard-caps the point count regardless of how active the grid is", () => {
  const out = normalizeAurora(grid, { cap: 3 });
  expect(out).toHaveLength(3);
  expect(out.map((f) => f.props?.probability)).toEqual(["40%", "30%", "25%"]);
});

test("colour ramp brightens with probability", () => {
  expect(auroraColor(6)).toBe("#15803d");
  expect(auroraColor(20)).toBe("#34d399");
  expect(auroraColor(95)).toBe("#ecfdf5");
});

test("exposes a finite numeric probability prop for the metric bar", () => {
  const top = normalizeAurora(grid)[0]; // 40%
  expect(top.props?.probabilityPct).toBe(40);
  expect(typeof top.props?.probabilityPct).toBe("number");
  expect(top.props?.probability).toBe("40%");
});

test("source metric resolves to the real probability value + domain", () => {
  expect(AURORA_SOURCE.metric).toEqual({ field: "probabilityPct", domain: [0, 100], unit: "%" });
  const top = normalizeAurora(grid)[0]; // 40%
  expect(rowMetric(top, AURORA_SOURCE.metric)).toEqual({ value: 40, domain: [0, 100], label: "40%" });
});

test("registers as a spatial forecast whose bands match real OVATION values", () => {
  expect(AURORA_SOURCE.kind).toBe("forecast");
  expect(AURORA_SOURCE.forecast?.spatial).toBe(true);
  expect(AURORA_SOURCE.forecast?.quietNote).toMatch(/aurora/i);
  // The lowest band must sit at (or below) the render floor, else the map can show
  // cells the forecast headline calls nothing.
  const lowestBand = AURORA_SOURCE.forecast?.bands?.[0].min ?? 0;
  const floorCell = Math.min(...normalizeAurora(liveGrid).map((f) => Number(f.props?.probabilityPct)));
  expect(lowestBand).toBeLessThanOrEqual(floorCell);
});

// --- regression: the real feed, at the probabilities it really emits -----------

test("REGRESSION: the live OVATION grid produces features (a 50% floor produced none)", () => {
  const out = normalizeAurora(liveGrid);
  expect(out.length).toBeGreaterThan(50);
  // The bug: this excerpt's peak is 21% (22% across the full run), so the old
  // ">= 50%" filter emptied a perfectly healthy 920 KB payload.
  expect(normalizeAurora(liveGrid, { minProbability: 50 })).toHaveLength(0);
  expect(Math.max(...out.map((f) => Number(f.props?.probabilityPct)))).toBeLessThan(50);
});

test("REGRESSION: live output is bounded, in-range and spans both hemispheres", () => {
  const out = normalizeAurora(liveGrid);
  expect(out.length).toBeLessThanOrEqual(400);
  expect(out.every((f) => f.lon >= -180 && f.lon <= 180)).toBe(true);
  expect(out.every((f) => f.lat >= -90 && f.lat <= 90)).toBe(true);
  expect(out.every((f) => Number(f.props?.probabilityPct) >= 5)).toBe(true);
  expect(out.some((f) => f.lat > 40)).toBe(true); // northern oval
  expect(out.some((f) => f.lat < -40)).toBe(true); // southern oval
  expect(new Set(out.map((f) => f.id)).size).toBe(out.length); // ids unique
  expect(out[0].ts).toBe("2026-08-10T11:10:00Z");
});
