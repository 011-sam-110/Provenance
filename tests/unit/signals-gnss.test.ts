import { readFileSync } from "node:fs";
import { afterEach, expect, test } from "vitest";
import * as h3 from "h3-js";
import {
  augurLayer,
  circleRing,
  notamTime,
  parseAugurInterference,
  parseGnssNotams,
  parseQCoord,
  __resetAugur,
} from "@/lib/signals/augur";
import { augurCellsToFeatures, GPS_JAMMING_SOURCE, type H3Index, type H3Lib } from "@/lib/signals/gpsjam";
import { gnssNotamFeatures, GNSS_NOTAMS_SOURCE } from "@/lib/signals/gnss-notams";
import {
  liveCellsToFeatures,
  sightings,
  windowCells,
  GPS_JAMMING_LIVE_SOURCE,
  __resetGpsjamLive,
  type LiveAircraft,
} from "@/lib/signals/gpsjam-live";
import { readCoverage } from "@/lib/signals/coverage";

// augur-layers.json is a verbatim slice of the live AUGUR document read on
// 2026-10-16 (the interference layer for 15 Oct cut to a few parts per level, five
// NOTAM features, and an empty decoy layer). adsb-nacp.json is a slice of one live
// adsb.lol answer: six airborne aircraft with NACp 0, one PARKED at Denver with NACp 0,
// and healthy aircraft.
const augur = JSON.parse(readFileSync("tests/fixtures/augur-layers.json", "utf8")) as unknown;
const adsb = JSON.parse(readFileSync("tests/fixtures/adsb-nacp.json", "utf8")) as { ac: LiveAircraft[] };
const H3 = h3 as unknown as H3Lib & H3Index;
const NOW = Date.parse("2026-10-16T12:00:00Z");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  __resetAugur();
  __resetGpsjamLive();
});

// --- AUGUR ----------------------------------------------------------------------

test("finds AUGUR layers by name, never by position", () => {
  expect(augurLayer(augur, "GNSS INTERFERENCE")?.time_scope).toBe("15 Oct 2026");
  expect(augurLayer(augur, "EGNOS & GNSS NOTAMs")).toBeDefined();
  expect(augurLayer(augur, "NOPE")).toBeUndefined();
  expect(augurLayer({ not: "an array" }, "GNSS")).toBeUndefined();
});

test("interference: one anchor per High and Medium part; Low and Coverage are left out", () => {
  const i = parseAugurInterference(augur)!;
  expect(i.day).toBe("15 Oct 2026");
  expect(i.parts.filter((p) => p.level === "High")).toHaveLength(3);
  expect(i.parts.filter((p) => p.level === "Medium")).toHaveLength(2);
  expect(i.parts.some((p) => (p.level as string) === "Low")).toBe(false);
  // The first High part is on the Romanian Black Sea coast.
  expect(i.parts[0].lat).toBeGreaterThan(43);
  expect(i.parts[0].lon).toBeGreaterThan(28);
});

test("AUGUR cells land on the H3-4 grid and skip cells GPSJAM already shows", () => {
  const i = parseAugurInterference(augur)!;
  const all = augurCellsToFeatures(i, H3);
  expect(all.length).toBeGreaterThan(0);
  expect(all.length).toBeLessThanOrEqual(5);
  expect(all.every((f) => f.signalId === "gpsJamming" && f.geometry?.type === "Polygon")).toBe(true);
  expect(all.every((f) => f.props?.measuredBy === "EUROCONTROL AUGUR" && f.props?.interferencePct === undefined)).toBe(true);
  const firstHex = all[0].id.replace("augur:", "");
  const skipped = augurCellsToFeatures(i, H3, new Set([firstHex]));
  expect(skipped.some((f) => f.id === all[0].id)).toBe(false);
  expect(skipped).toHaveLength(all.length - 1);
});

test("gpsJamming fetch(): AUGUR cells join GPSJAM's, and the coverage counts both", async () => {
  const csv = readFileSync("tests/fixtures/gpsjam-h3.csv", "utf8");
  globalThis.fetch = (async (url: string) =>
    String(url).includes("augur")
      ? new Response(JSON.stringify(augur))
      : new Response(csv)) as unknown as typeof fetch;
  const out = await GPS_JAMMING_SOURCE.fetch();
  const gpsjam = out.filter((f) => f.id.startsWith("gpsjam:"));
  const eurocontrol = out.filter((f) => f.id.startsWith("augur:"));
  expect(gpsjam).toHaveLength(3);
  expect(eurocontrol.length).toBeGreaterThan(0);
  expect(readCoverage(out)?.returned).toBe(out.length);
  expect(GPS_JAMMING_SOURCE.attribution).toMatch(/EUROCONTROL/);
});

// --- NOTAMs ---------------------------------------------------------------------

test("Q-line coordinates and NOTAM times parse", () => {
  const [lat, lon] = parseQCoord("5546N02229E")!;
  expect(lat).toBeCloseTo(55.7667, 3);
  expect(lon).toBeCloseTo(22.4833, 3);
  expect(parseQCoord("5202N00331W")![1]).toBeCloseTo(-3.5167, 3);
  expect(parseQCoord("garbage")).toBeNull();
  expect(notamTime("2610160800")).toBe("2026-10-16T08:00:00Z");
});

test("NOTAMs: jamming ones in force, one per FIR + number, at the Q-line circle", () => {
  const n = parseGnssNotams(augur, NOW);
  const ids = n.map((x) => x.id).sort();
  // EVRR is repeated on two aerodromes in the fixture: one NOTAM. The non-jamming
  // LPV-minima NOTAM is left out. One Madrid aerodrome carries two LECM NOTAMs.
  expect(ids).toEqual(["EGTT 1629/26", "EVRR 3951/26", "LECM 0046/26", "LECM 0057/26"]);
  const riga = n.find((x) => x.fir === "EVRR")!;
  expect(riga.radiusNm).toBe(165);
  expect(riga.text).toMatch(/GNSS SIGNAL INTERFERENCE/);
  expect(riga.text.startsWith("3951/26")).toBe(false);
});

test("NOTAMs: one that has ended, or not started, is not in force", () => {
  // EGTT 1629/26 runs 2026-10-16 08:00 to 15:00 UTC.
  expect(parseGnssNotams(augur, Date.parse("2026-10-16T16:00:00Z")).some((x) => x.fir === "EGTT")).toBe(false);
  expect(parseGnssNotams(augur, Date.parse("2026-10-16T07:00:00Z")).some((x) => x.fir === "EGTT")).toBe(false);
});

test("NOTAM features are circles of the stated radius, anchored at the centre", () => {
  const f = gnssNotamFeatures(parseGnssNotams(augur, NOW));
  const riga = f.find((x) => x.props?.fir === "EVRR")!;
  expect(riga.signalId).toBe("gnss-notams");
  expect(riga.geometry?.type).toBe("Polygon");
  const ring = (riga.geometry as { coordinates: [number, number][][] }).coordinates[0];
  expect(ring[0]).toEqual(ring[ring.length - 1]);
  // 165 NM = 305.6 km north of the centre: about 2.75 degrees of latitude.
  const north = Math.max(...ring.map(([, lat]) => lat));
  expect(north - riga.lat).toBeCloseTo(2.75, 1);
  expect(GNSS_NOTAMS_SOURCE.precision).toBe("area");
});

test("circleRing closes and wraps longitude", () => {
  const r = circleRing(0, 179.9, 60);
  expect(r[0]).toEqual(r[r.length - 1]);
  expect(r.every(([lon]) => lon >= -180 && lon <= 180)).toBe(true);
});

test("gnss-notams fetch(): a dead AUGUR is an honest empty layer", async () => {
  globalThis.fetch = (async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
  expect(await GNSS_NOTAMS_SOURCE.fetch()).toEqual([]);
});

// --- live NACp grid ---------------------------------------------------------------

test("sightings: airborne aircraft with a NACp only; a parked NACp-0 aircraft is not jamming", () => {
  const s = sightings(adsb.ac, H3);
  expect(s.has("ac3053")).toBe(false); // on the ground at Denver with NACp 0
  expect(s.has("a47fd9")).toBe(false); // no NACp
  expect(s.get("3c65da")?.bad).toBe(true); // NACp 0 at FL390 over the Baltic
  expect(s.get("86d9d2")?.bad).toBe(false); // NACp 9
});

test("windowCells: GPSJAM's rule over the window, each aircraft once per cell", () => {
  // Synthetic sightings (cell ids are placeholders): 6 aircraft, 3 bad → (3-1)/6 = 33%.
  const snap1 = new Map(["a", "b", "c", "d", "e", "f"].map((id, i) => [id, { cell: "X", bad: i < 3 }]));
  // A second snapshot of the same aircraft must not double the count.
  const snap2 = new Map(["a", "b"].map((id) => [id, { cell: "X", bad: true }]));
  const cells = windowCells([snap1, snap2]);
  expect(cells).toHaveLength(1);
  expect(cells[0]).toMatchObject({ hex: "X", good: 3, bad: 3 });
  expect(cells[0].ratio).toBeCloseTo(2 / 6, 5);
  // Under 5 aircraft is not enough to say anything.
  expect(windowCells([new Map(["a", "b", "c", "d"].map((id) => [id, { cell: "Y", bad: true }]))])).toEqual([]);
});

test("live features carry the window and the metric the layer declares", () => {
  const hex = h3.latLngToCell(55.5, 15.8, 4);
  const feats = liveCellsToFeatures([{ hex, good: 4, bad: 3, ratio: 2 / 7 }], H3, "last 30 min");
  expect(feats[0].signalId).toBe("gpsJammingLive");
  expect(feats[0].props).toMatchObject({ interferencePct: 29, aircraft: 7, window: "last 30 min" });
  expect(GPS_JAMMING_LIVE_SOURCE.metric?.field).toBe("interferencePct");
});

test("gpsJammingLive fetch(): a refused read is an honest empty layer, not an error", async () => {
  globalThis.fetch = (async () => new Response("Enhance your calm", { status: 420 })) as unknown as typeof fetch;
  expect(await GPS_JAMMING_LIVE_SOURCE.fetch()).toEqual([]);
});
