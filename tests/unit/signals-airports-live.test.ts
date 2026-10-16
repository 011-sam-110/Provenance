import { readFileSync } from "node:fs";
import { afterEach, expect, test } from "vitest";
import { parseAirportsCsv, parseCsv, AIRPORTS_SOURCE, __resetAirportsCache } from "@/lib/signals/airports";
import {
  applyAirportLive,
  closureSeverity,
  hongKongDate,
  parseAvinorXml,
  parseFaaStatus,
  parseHkiaBoard,
  parseMetarRows,
  parseTafXml,
  type HkiaDay,
} from "@/lib/signals/airports.live";

// Every fixture is a verbatim slice of a live answer captured on 2026-10-16:
// the AWC METAR and TAF caches (rows for KSFO, EGLL, KBOS, UUBW), the FAA NAS
// status XML, Avinor's Oslo board, and HKIA's departures.
const metarCsv = readFileSync("tests/fixtures/awc-metars.csv", "utf8");
const tafXml = readFileSync("tests/fixtures/awc-tafs.xml", "utf8");
const faaXml = readFileSync("tests/fixtures/faa-nas-status.xml", "utf8");
const avinorXml = readFileSync("tests/fixtures/avinor-osl.xml", "latin1");
const hkia = JSON.parse(readFileSync("tests/fixtures/hkia-departures.json", "utf8")) as HkiaDay[];
const directory = parseAirportsCsv(readFileSync("tests/fixtures/airports.csv", "utf8"));

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  __resetAirportsCache();
});

test("METAR: reads flight category, raw report and observation time per station", () => {
  const m = parseMetarRows(parseCsv(metarCsv));
  expect(m.get("KSFO")?.category).toBe("VFR");
  expect(m.get("KSFO")?.raw).toMatch(/^METAR KSFO /);
  expect(m.get("KSFO")?.at).toBe("2026-10-16T18:56:00.000Z");
  expect(m.get("UUBW")?.category).toBe("LIFR");
  expect(m.has("ZZZZ")).toBe(false);
});

test("TAF: keeps the raw forecast and its issue time", () => {
  const t = parseTafXml(tafXml);
  expect(t.get("KSFO")?.raw).toMatch(/^TAF /);
  expect(t.get("KSFO")?.issued).toMatch(/^2026-10-16T/);
  expect(t.get("EGLL")).toBeDefined();
});

test("FAA: one event per airport, the most severe winning, restrictions demoted", () => {
  const events = parseFaaStatus(faaXml);
  const by = new Map(events.map((e) => [e.code, e]));
  // LAS has a ground stop AND a ground delay programme: the stop wins.
  expect(by.get("LAS")?.kind).toBe("ground-stop");
  expect(by.get("LAS")?.detail).toBe("until 1:15 pm PDT");
  expect(by.get("DCA")?.kind).toBe("ground-delay");
  expect(by.get("DCA")?.detail).toMatch(/avg 44 minutes/);
  expect(by.get("FLL")?.kind).toBe("delay");
  // "AD AP CLSD TO NON SKED TRANSIENT GA ACFT": airlines fly; not a closure.
  expect(by.get("LAX")?.kind).toBe("restriction");
  // SNA's "CLSD DLY 0630-1315" is its nightly curfew, not a closure; its delay wins.
  expect(by.get("SNA")?.kind).toBe("delay");
});

test("closureSeverity: a bare CLSD is a closure; CLSD TO / CLSD DLY are restrictions", () => {
  expect(closureSeverity("!XYZ 10/001 XYZ AD AP CLSD")).toBe("closure");
  expect(closureSeverity("AD AP CLSD TO NON SKED TRANSIENT GA ACFT")).toBe("restriction");
  expect(closureSeverity("AD AP CLSD DLY 0630-1315")).toBe("restriction");
});

test("Avinor: counts flights, the delayed flag and cancellations", () => {
  const b = parseAvinorXml(avinorXml);
  expect(b).toMatchObject({ source: "Avinor", tracked: 7, delayed: 3, cancelled: 1 });
  expect(b.at).toMatch(/^2026-10-16T/);
});

test("HKIA: delay is the stated time minus the schedule, across midnight", () => {
  const b = parseHkiaBoard(hkia);
  // 10 flights carry a status. Late by 15+ min: 15:15 → 00:27 next day, 22:30 → est
  // 11:45 next day, 23:55 → 00:24 (29 min), 00:20 → est 02:45, 00:25 → 00:42 (17 min).
  expect(b).toMatchObject({ tracked: 10, delayed: 5, cancelled: 1 });
});

test("hongKongDate is UTC+8", () => {
  expect(hongKongDate(Date.parse("2026-10-16T17:00:00Z"))).toBe("2026-10-17");
  expect(hongKongDate(Date.parse("2026-10-16T15:59:00Z"))).toBe("2026-10-16");
});

test("applyAirportLive joins by ICAO, IATA and the FAA's K-less code, and never drops a pin", () => {
  const live = {
    metar: parseMetarRows(parseCsv(metarCsv)),
    taf: parseTafXml(tafXml),
    faa: [{ code: "SFO", kind: "ground-stop" as const, reason: "wind", detail: "until 1:15 pm PDT" }],
    boards: new Map([["LHR", parseAvinorXml(avinorXml)]]),
  };
  const out = applyAirportLive(directory, live);
  expect(out).toHaveLength(directory.length);
  const sfo = out.find((f) => f.id === "airport:KSFO");
  expect(sfo?.props?.flightCategory).toBe("VFR");
  expect(sfo?.props?.taf).toMatch(/^TAF /);
  expect(sfo?.props?.faaStatus).toBe("Ground stop");
  expect(sfo?.props?.faaReason).toBe("wind");
  expect(sfo?.color).toBe("#dc2626");
  const lhr = out.find((f) => f.id === "airport:EGLL");
  expect(lhr?.props?.flights).toBe("3 of 7 delayed (flagged delayed by Avinor), 1 cancelled");
  // No feed covers Honiara: the pin is untouched, not marked calm.
  const noia = out.find((f) => f.id === "airport:NOIA");
  expect(noia).toBe(directory.find((f) => f.id === "airport:NOIA"));
});

test("fetch(): every live feed down still serves the whole directory", async () => {
  const csv = readFileSync("tests/fixtures/airports.csv", "utf8");
  globalThis.fetch = (async (url: string) =>
    String(url).includes("ourairports")
      ? new Response(csv, { status: 200 })
      : new Response("down", { status: 503 })) as unknown as typeof fetch;
  const out = await AIRPORTS_SOURCE.fetch();
  expect(out).toHaveLength(3);
  expect(out.every((f) => f.props?.flightCategory === undefined)).toBe(true);
});

test("fetch(): a gzip METAR cache is decoded and joined", async () => {
  const csv = readFileSync("tests/fixtures/airports.csv", "utf8");
  const gz = await new Response(
    new Blob([metarCsv]).stream().pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer();
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes("ourairports")) return new Response(csv, { status: 200 });
    if (u.includes("metars.cache")) return new Response(gz, { status: 200 });
    return new Response("down", { status: 503 });
  }) as unknown as typeof fetch;
  const out = await AIRPORTS_SOURCE.fetch();
  expect(out.find((f) => f.id === "airport:KSFO")?.props?.flightCategory).toBe("VFR");
});
