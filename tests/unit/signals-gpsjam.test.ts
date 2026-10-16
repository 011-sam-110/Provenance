import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  parseGpsjamCsv,
  gpsjamCellsToFeatures,
  gpsjamColor,
  gpsjamRatio,
  GPS_JAMMING_SOURCE,
  type H3Lib,
} from "@/lib/signals/gpsjam";
import { rowMetric } from "@/lib/console/signals/signalCard";

const csv = readFileSync("tests/fixtures/gpsjam-h3.csv", "utf8");

// Fixture rows (good,bad), ratio = (bad - 1) / total (GPSJAM's FAQ rule):
// 5/45 (r=.88), 40/10 (r=.18), 2/2 (sample 4 < 10), 98/2 (r=.01 < .1),
// 30/30 (r=29/60=.483). Defaults: minSample 10, minRatio 0.1.
test("parses CSV, drops under-sampled + low-ratio cells, sorts by ratio desc", () => {
  const cells = parseGpsjamCsv(csv);
  expect(cells.map((c) => c.hex)).toEqual([
    "8400537ffffffff", // 0.88
    "84003a7ffffffff", // 0.483
    "84003a1ffffffff", // 0.18
  ]);
  expect(cells[0].ratio).toBeCloseTo(0.88, 5);
  expect(cells[1].ratio).toBeCloseTo(29 / 60, 5);
});

test("respects the hard cap", () => {
  expect(parseGpsjamCsv(csv, { cap: 1 })).toHaveLength(1);
});

test("builds Polygon features from H3 cells via an injected h3 impl", () => {
  // Stub h3: a square ring + a fixed centre, so the mapping is deterministic.
  const h3: H3Lib = {
    cellToBoundary: () => [
      [10, 20],
      [11, 20],
      [11, 21],
      [10, 21],
      [10, 20],
    ],
    cellToLatLng: () => [20.5, 10.5], // [lat, lon]
  };
  const cells = parseGpsjamCsv(csv);
  const feats = gpsjamCellsToFeatures(cells, h3, "2026-06-26");
  expect(feats).toHaveLength(3);
  const f = feats[0];
  expect(f.signalId).toBe("gpsJamming");
  expect(f.geometry?.type).toBe("Polygon");
  expect(f.lat).toBe(20.5);
  expect(f.lon).toBe(10.5);
  expect(f.props?.interference).toBe("88%");
  expect(f.props?.interferencePct).toBe(88);
  expect(f.props?.aircraft).toBe(50);
  expect(f.props?.day).toBe("2026-06-26");
  expect(f.color).toBe(gpsjamColor(0.88));
});

test("declares a real interference-% metric that rowMetric resolves", () => {
  const h3: H3Lib = {
    cellToBoundary: () => [
      [10, 20],
      [11, 20],
      [11, 21],
      [10, 21],
      [10, 20],
    ],
    cellToLatLng: () => [20.5, 10.5],
  };
  const feats = gpsjamCellsToFeatures(parseGpsjamCsv(csv), h3, "2026-06-26");
  expect(GPS_JAMMING_SOURCE.metric).toEqual({ field: "interferencePct", domain: [0, 100], unit: "%" });
  const m = rowMetric(feats[0], GPS_JAMMING_SOURCE.metric);
  expect(m).toEqual({ value: 88, domain: [0, 100], label: "88%" });
  // second cell (ratio 29/60) resolves to 48%
  expect(rowMetric(feats[1], GPS_JAMMING_SOURCE.metric)?.value).toBe(48);
});

test("uses GPSJAM's own (bad - 1) / total rule, clamped at 0", () => {
  expect(gpsjamRatio(0, 1)).toBe(0); // one bad aircraft alone is not interference
  expect(gpsjamRatio(9, 1)).toBe(0);
  expect(gpsjamRatio(8, 2)).toBeCloseTo(0.1, 10);
  expect(gpsjamRatio(0, 0)).toBe(0);
});

test("attribution names both upstream networks", () => {
  expect(GPS_JAMMING_SOURCE.attribution).toMatch(/airplanes\.live/);
  expect(GPS_JAMMING_SOURCE.attribution).toMatch(/ADS-B Exchange/);
});

test("colour deepens with interference ratio", () => {
  expect(gpsjamColor(0.05)).toBe("#f59e0b");
  expect(gpsjamColor(0.6)).toBe("#b91c1c");
});
