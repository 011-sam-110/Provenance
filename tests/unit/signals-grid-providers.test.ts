import { describe, expect, it } from "vitest";
// REAL captures, 2026-10-16 between 19:45 and 20:10 UTC:
//   grid-elexon-outturn.json      data.elexon.co.uk/bmrs/api/v1/demand/outturn/summary, last 12 of 575 rows
//   grid-rte-eco2mix.json         ODRÉ eco2mix-national-tr, newest record with a consumption
//   grid-energinet-prodex5min.json  Energi Data Service ElectricityProdex5MinRealtime, 4 newest rows
//   grid-aemo-nem-summary.json    AEMO ELEC_NEM_SUMMARY (the market-notice and price blocks removed)
//   grid-eia930-demand.json       EIA v2 rto/region-data, type D, the newest hour only (67 rows);
//                                 read with EIA's public DEMO_KEY, which is not in the file
//   grid-neso-generation.json     api.carbonintensity.org.uk/generation
import elexon from "@/tests/fixtures/grid-elexon-outturn.json";
import rte from "@/tests/fixtures/grid-rte-eco2mix.json";
import energinet from "@/tests/fixtures/grid-energinet-prodex5min.json";
import aemo from "@/tests/fixtures/grid-aemo-nem-summary.json";
import eia from "@/tests/fixtures/grid-eia930-demand.json";
import neso from "@/tests/fixtures/grid-neso-generation.json";
import {
  eiaQuery,
  parseAemo,
  parseEia,
  parseElexon,
  parseEnerginet,
  parseNesoMix,
  parseRte,
  MAX_READING_AGE_MS,
} from "@/lib/signals/grid-providers";
import { mergeGridLoad, normalizeGridLoad, readingFeature, GRID_LOAD_SOURCE } from "@/lib/signals/entsoe";
import { EIA_BALANCING_AUTHORITIES } from "@/lib/signals/grid-zones.data";

describe("keyless operators", () => {
  it("reads GB demand from Elexon's newest five-minute row", () => {
    const gb = parseElexon(elexon)!;
    expect(gb.id).toBe("grid:elexon:GB");
    expect(gb.mw).toBe(32480);
    expect(new Date(gb.observedAt).toISOString()).toBe("2026-10-16T19:55:00.000Z");
  });

  it("reads France's consumption from RTE éCO2mix", () => {
    const fr = parseRte(rte)!;
    expect(fr.mw).toBe(43093);
    expect(new Date(fr.observedAt).toISOString()).toBe("2026-10-16T19:45:00.000Z");
  });

  it("derives DK1 and DK2 load from production plus net imports", () => {
    const dk = parseEnerginet(energinet);
    expect(dk.map((r) => r.id).sort()).toEqual(["grid:energinet:DK1", "grid:energinet:DK2"]);
    // 20:00 UTC: DK1 2,493.8 MW produced + 130.0 imported; DK2 1,132.3 + 384.4.
    expect(dk.find((r) => r.id.endsWith("DK1"))!.mw).toBe(2624);
    expect(dk.find((r) => r.id.endsWith("DK2"))!.mw).toBe(1517);
    expect(dk[0].extra?.method).toMatch(/derived/);
  });

  it("reads AEMO's five regions and converts AEST to UTC", () => {
    const au = parseAemo(aemo);
    expect(au).toHaveLength(5);
    const nsw = au.find((r) => r.id === "grid:aemo:NSW1")!;
    expect(nsw.mw).toBe(6677);
    expect(new Date(nsw.observedAt).toISOString()).toBe("2026-10-16T20:05:00.000Z");
  });

  it("summarises NESO's GB generation mix, largest first", () => {
    const m = parseNesoMix(neso)!;
    expect(m.mix.split(", ")[0]).toMatch(/^\w+ \d+%$/);
    expect(m.mix).not.toMatch(/ 0%/);
  });

  it("returns nothing for an empty or broken payload", () => {
    expect(parseElexon([])).toBeNull();
    expect(parseRte({ results: [] })).toBeNull();
    expect(parseEnerginet({})).toEqual([]);
    expect(parseAemo({})).toEqual([]);
    expect(parseNesoMix({})).toBeNull();
  });
});

describe("EIA-930", () => {
  it("keeps the balancing authorities and skips EIA's aggregate regions", () => {
    const us = parseEia(eia);
    const codes = us.map((r) => r.id.slice("grid:eia:".length));
    for (const agg of ["CAL", "CAR", "CENT", "FLA", "MIDA", "MIDW", "NE", "NW", "NY", "SE", "SW", "TEN", "TEX", "US48"]) {
      expect(codes, agg).not.toContain(agg);
    }
    expect(codes).toContain("ERCO");
    expect(codes).toContain("PJM");
    expect(us.every((r) => EIA_BALANCING_AUTHORITIES[r.id.slice("grid:eia:".length)])).toBe(true);
    expect(new Date(us[0].observedAt).toISOString()).toBe("2026-10-16T19:00:00.000Z");
  });

  it("asks for demand only, newest first, with the key as a parameter", () => {
    const u = new URL(eiaQuery("k"));
    expect(u.searchParams.get("api_key")).toBe("k");
    expect(u.searchParams.get("facets[type][]")).toBe("D");
    expect(u.searchParams.get("sort[0][direction]")).toBe("desc");
  });
});

describe("mergeGridLoad", () => {
  const now = Date.parse("2026-10-16T20:10:00Z");
  const entsoe = normalizeGridLoad([
    { eic: "10YFR-RTE------C", mw: 53890 },
    { eic: "10Y1001A1001A83F", mw: 61000 }, // Germany
    { eic: "10YGB----------A", mw: 30000 },
  ]);

  it("lets an operator's own reading replace ENTSO-E's copy of the same area", () => {
    const out = mergeGridLoad(entsoe, [parseRte(rte)!, parseElexon(elexon)!], now);
    const ids = out.map((f) => f.id).sort();
    expect(ids).toEqual(["entsoe:10Y1001A1001A83F", "grid:elexon:GB", "grid:rte:FR"]);
  });

  it("keeps ENTSO-E's zone when the operator did not answer", () => {
    expect(mergeGridLoad(entsoe, [], now).map((f) => f.id)).toContain("entsoe:10YFR-RTE------C");
  });

  it("drops a reading older than the age limit", () => {
    const old = { ...parseRte(rte)!, observedAt: now - MAX_READING_AGE_MS - 1 };
    expect(mergeGridLoad([], [old], now)).toEqual([]);
  });

  it("puts the source and the reading time on every marker", () => {
    const f = readingFeature(parseElexon(elexon)!);
    expect(f.signalId).toBe("grid-load");
    expect(f.props?.source).toBe("Elexon (BMRS)");
    expect(f.props?.observedAt).toBe("2026-10-16T19:55:00.000Z");
    expect(f.props?.load).toBe("32,480 MW");
    expect(f.title).toBe("Great Britain — 32.5 GW load");
  });
});

describe("the layer", () => {
  it("is no longer labelled as ENTSO-E only, and credits every operator", () => {
    expect(GRID_LOAD_SOURCE.label).toBe("Electricity grid load");
    for (const credit of ["ENTSO-E", "Elexon", "RTE", "Energinet", "AEMO", "Energy Information Administration", "NESO"]) {
      expect(GRID_LOAD_SOURCE.attribution).toContain(credit);
    }
  });
});
