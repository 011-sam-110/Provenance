import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseAirportsCsv, parseCsv, continentName, AIRPORTS_SOURCE } from "@/lib/signals/airports";

const csv = readFileSync("tests/fixtures/airports.csv", "utf8");

test("CSV parser handles quoted fields containing commas", () => {
  const rows = parseCsv(csv);
  // Row 1 (KSFO) name has an embedded comma inside quotes.
  expect(rows[1][3]).toBe("San Francisco International Airport, Bay");
});

test("keeps only large_airport rows (drops small_airport + heliport)", () => {
  const out = parseAirportsCsv(csv);
  // KSFO, EGLL, NOIA are scheduled large_airport rows; the small_airport, the
  // heliport and the air base without scheduled service are dropped.
  expect(out).toHaveLength(3);
  expect(out.every((f) => f.signalId === "airports")).toBe(true);
  expect(out.some((f) => f.title.includes("Tiny Strip"))).toBe(false);
});

test("drops a large_airport without scheduled service (air base, closed, not yet open)", () => {
  const out = parseAirportsCsv(csv);
  expect(out.some((f) => f.id === "airport:RODN")).toBe(false);
});

test("carries the ICAO code (icao_code, else gps_code) as the live-feed join key", () => {
  const out = parseAirportsCsv(csv);
  expect(out.find((f) => f.id === "airport:KSFO")?.props?.icao).toBe("KSFO");
  expect(out.find((f) => f.id === "airport:NOIA")?.props?.icao).toBe("AGGH");
});

test("maps ident, iata, country and city; tolerates a missing IATA", () => {
  const out = parseAirportsCsv(csv);
  const sfo = out.find((f) => f.id === "airport:KSFO");
  expect(sfo?.lat).toBeCloseTo(37.619, 3);
  expect(sfo?.lon).toBeCloseTo(-122.375, 3);
  expect(sfo?.props?.iata).toBe("SFO");
  expect(sfo?.props?.country).toBe("US");
  expect(sfo?.props?.city).toBe("San Francisco");

  const noIata = out.find((f) => f.id === "airport:NOIA");
  expect(noIata?.props?.iata).toBeUndefined();
  expect(noIata?.props?.country).toBe("SB");
});

test("derives a readable region from the OurAirports continent column", () => {
  const out = parseAirportsCsv(csv);
  expect(out.find((f) => f.id === "airport:KSFO")?.props?.region).toBe("North America");
  expect(out.find((f) => f.id === "airport:EGLL")?.props?.region).toBe("Europe");
  expect(out.find((f) => f.id === "airport:NOIA")?.props?.region).toBe("Oceania");
});

test("continentName maps codes and stays honest on unknowns", () => {
  expect(continentName("AS")).toBe("Asia");
  expect(continentName("sa")).toBe("South America"); // case-insensitive
  expect(continentName("ZZ")).toBe("");
  expect(continentName(undefined)).toBe("");
});

test("registers as an asset directory browsed by IATA (no magnitude)", () => {
  expect(AIRPORTS_SOURCE.kind).toBe("asset");
  expect(AIRPORTS_SOURCE.metric).toBeUndefined();
  expect(AIRPORTS_SOURCE.directory?.codeKey).toBe("iata");
  expect(AIRPORTS_SOURCE.directory?.detailKey).toBe("city");
});
