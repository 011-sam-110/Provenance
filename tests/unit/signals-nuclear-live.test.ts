import { readFileSync } from "node:fs";
import { afterEach, expect, test } from "vitest";
import {
  applyNuclearLive,
  parseEiaOutages,
  parseIesoXml,
  parseNrcStatus,
  parsePnRows,
  settlementPeriod,
  type EiaRow,
  type PnRow,
} from "@/lib/signals/nuclear.live";
import { BMU_SITE, EIA_PLANT_SITE, IESO_SITE, NRC_UNIT_SITE } from "@/lib/signals/nuclear-units.data";
import { NUCLEAR_SOURCE, nuclearSnapshotFeatures, __resetNuclearCache, __setNuclearLiveBudget } from "@/lib/signals/nuclear";

// Fixtures are verbatim slices of live answers captured on 2026-10-16: the NRC
// 365-day report, Elexon's PN for settlement period 43, IESO's output report, and
// EIA's facility outages (read with EIA's public DEMO_KEY).
const nrc = readFileSync("tests/fixtures/nrc-reactor-status.txt", "utf8");
const pn = JSON.parse(readFileSync("tests/fixtures/elexon-pn.json", "utf8")) as { data: PnRow[] };
const ieso = readFileSync("tests/fixtures/ieso-genoutput.xml", "utf8");
const eia = JSON.parse(readFileSync("tests/fixtures/eia-nuclear-outages.json", "utf8")) as { response: { data: EiaRow[] } };

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.EIA_API_KEY;
  __resetNuclearCache();
  __setNuclearLiveBudget(6_000);
});

test("NRC: newest day only, and only units with a plant to put them on", () => {
  const r = parseNrcStatus(nrc);
  expect(r.every((x) => x.at === "2026-10-16" && x.source === "NRC")).toBe(true);
  expect(r.map((x) => x.unit).sort()).toEqual(["Arkansas Nuclear 1", "Braidwood 1", "Braidwood 2", "Wolf Creek 1"]);
  // Fermi 2 has no OSM plant row: its reading is dropped, it never makes a pin.
  expect(r.some((x) => x.unit === "Fermi 2")).toBe(false);
  expect(r.find((x) => x.unit === "Braidwood 1")?.pct).toBe(100);
});

test("Elexon: generating units only, MW from the notified level", () => {
  const r = parsePnRows(pn.data, Date.parse("2026-10-16T20:10:00Z"));
  const by = new Map(r.map((x) => [x.unit, x]));
  expect(by.get("T_HEYM11")?.mw).toBe(480);
  expect(by.get("T_SIZB-1")?.mw).toBe(599);
  expect(by.get("T_HEYM28")?.mw).toBe(0);
  expect(by.has("T_HEYM2-D")).toBe(false); // station demand, not a generator
  expect(by.has("E_BARNB-1")).toBe(false); // not nuclear
  expect(by.get("T_HRTL-1")?.site).toBe("way/4800321");
});

test("IESO: the latest hour's MW per listed nuclear unit", () => {
  const r = parseIesoXml(ieso);
  expect(r.map((x) => x.unit).sort()).toEqual(["BRUCEA-G2", "DARLINGTON-G1"]);
  expect(r.every((x) => x.source === "IESO" && typeof x.mw === "number" && x.at.startsWith("2026-10-16 hour"))).toBe(true);
});

test("EIA: newest day per plant; two EIA plants on one OSM site add up", () => {
  const o = parseEiaOutages(eia.response.data);
  const salem = o.find((x) => x.site === EIA_PLANT_SITE["2410"]);
  expect(EIA_PLANT_SITE["2410"]).toBe(EIA_PLANT_SITE["6118"]); // Salem + Hope Creek: one OSM row
  expect(salem?.outageMw).toBeCloseTo(1601.36, 2);
  expect(o.find((x) => x.site === EIA_PLANT_SITE["566"])?.outageMw).toBeCloseTo(1252.2, 1);
});

test("applyNuclearLive puts readings on the plant, by OSM id, and touches nothing else", () => {
  const base = nuclearSnapshotFeatures();
  const readings = [...parseNrcStatus(nrc), ...parsePnRows(pn.data, Date.parse("2026-10-16T20:10:00Z"))];
  const out = applyNuclearLive(base, readings, parseEiaOutages(eia.response.data));
  expect(out).toHaveLength(base.length);
  const braidwood = out.find((f) => f.id === `nuclear:${NRC_UNIT_SITE["Braidwood 1"]}`);
  expect(braidwood?.props?.powerPct).toBe(100);
  expect(braidwood?.props?.liveUnits).toBe("Braidwood 1 100%, Braidwood 2 100%");
  expect(braidwood?.props?.liveSource).toBe("NRC");
  const heysham = out.find((f) => f.id === `nuclear:${BMU_SITE.T_HEYM11}`);
  expect(heysham?.props?.outputNowMw).toBe(480 + 395 + 550 + 0);
  expect(heysham?.props?.unitsGenerating).toBe(3);
  const millstone = out.find((f) => f.id === `nuclear:${EIA_PLANT_SITE["566"]}`);
  expect(millstone?.props?.outageMw).toBe(1252);
  // A plant no feed covers is the same object it was.
  const kk = base.find((f) => f.title.includes("Kashiwazaki"))!;
  expect(out.find((f) => f.id === kk.id)).toBe(kk);
});

test("every join target is a plant the snapshot actually has", () => {
  const ids = new Set(nuclearSnapshotFeatures().map((f) => f.id.replace(/^nuclear:/, "")));
  for (const table of [NRC_UNIT_SITE, EIA_PLANT_SITE, BMU_SITE, IESO_SITE]) {
    for (const [unit, site] of Object.entries(table)) expect(ids.has(site), `${unit} → ${site}`).toBe(true);
  }
});

test("settlementPeriod counts half hours from UK local midnight", () => {
  // 20:10 UTC in BST = 21:10 local → period 43 (Elexon served 43 for 20:00-20:30 UTC).
  expect(settlementPeriod(Date.parse("2026-10-16T20:10:00Z"))).toEqual({ date: "2026-10-16", period: 43 });
  // Winter: 12:00 UTC = 12:00 GMT → period 25.
  expect(settlementPeriod(Date.parse("2026-12-01T12:00:00Z"))).toEqual({ date: "2026-12-01", period: 25 });
  // Clock-change day (25 Oct, a 50-period day): 12:00 UTC is 13 h after local midnight (23:00 UTC).
  expect(settlementPeriod(Date.parse("2026-10-25T12:00:00Z"))).toEqual({ date: "2026-10-25", period: 27 });
});

test("fetch(): live feeds land on the pins; EIA is not asked without its key", async () => {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    asked.push(u);
    if (u.includes("nrc.gov")) return new Response(nrc);
    if (u.includes("elexon")) return new Response(JSON.stringify(pn));
    if (u.includes("ieso")) return new Response(ieso);
    return new Response("down", { status: 503 });
  }) as unknown as typeof fetch;
  const out = await NUCLEAR_SOURCE.fetch();
  expect(out.find((f) => f.id === `nuclear:${NRC_UNIT_SITE["Braidwood 1"]}`)?.props?.powerPct).toBe(100);
  expect(out.find((f) => f.id === `nuclear:${IESO_SITE["BRUCEA-G2"]}`)?.props?.liveSource).toBe("IESO");
  expect(asked.some((u) => u.includes("api.eia.gov"))).toBe(false);
});

test("fetch(): with EIA_API_KEY set, EIA is asked and its outage lands", async () => {
  process.env.EIA_API_KEY = "test-key";
  globalThis.fetch = (async (url: string) =>
    String(url).includes("api.eia.gov")
      ? new Response(JSON.stringify(eia))
      : new Response("down", { status: 503 })) as unknown as typeof fetch;
  const out = await NUCLEAR_SOURCE.fetch();
  expect(out.find((f) => f.id === `nuclear:${EIA_PLANT_SITE["566"]}`)?.props?.outageMw).toBe(1252);
});

test("fetch(): a hanging live feed costs at most the live budget", async () => {
  __setNuclearLiveBudget(50);
  globalThis.fetch = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
  const t0 = Date.now();
  const out = await NUCLEAR_SOURCE.fetch();
  expect(out.length).toBeGreaterThan(150);
  expect(Date.now() - t0).toBeLessThan(500);
});
