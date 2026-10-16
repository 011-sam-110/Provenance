/**
 * Flight routes from Virtual Radar Server's CC0 standing data (lib/sources/vrsRoutes.ts),
 * which replaced adsbdb's route lookup on 2026-10-16: adsbdb's route data may not be
 * published without its author's permission.
 *
 * Fixtures in tests/fixtures/vrs/ are verbatim lines (header + a few rows, BOM kept)
 * from github.com/vradarserver/standing-data, fetched 2026-10-16.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  fetchVrsRoute,
  normaliseCallsign,
  parseAirlines,
  parseAirports,
  parseRoutes,
  resetVrsCache,
  splitCsvLine,
  VRS_TTL_MS,
} from "@/lib/sources/vrsRoutes";

const fx = (name: string) => readFileSync(resolve(__dirname, "../fixtures/vrs", name), "utf8");
const RAW = "https://raw.githubusercontent.com/vradarserver/standing-data/main";
const FILES: Record<string, string> = {
  [`${RAW}/routes/schema-01/B/BAW-all.csv`]: fx("BAW-all.csv"),
  [`${RAW}/airports/schema-01/E/EG.csv`]: fx("EG.csv"),
  [`${RAW}/airports/schema-01/K/KJ.csv`]: fx("KJ.csv"),
  [`${RAW}/airports/schema-01/Y/YS.csv`]: fx("YS.csv"),
  [`${RAW}/airlines/schema-01/airlines.csv`]: fx("airlines.csv"),
};

function deps(clock = { t: 0 }) {
  const asked: string[] = [];
  return {
    asked,
    clock,
    deps: {
      now: () => clock.t,
      fetchText: async (url: string) => {
        asked.push(url);
        return url in FILES ? FILES[url] : ""; // a missing file is an empty answer, as a 404 is
      },
    },
  };
}

afterEach(() => resetVrsCache());

describe("normaliseCallsign (routes/schema-01/README.md)", () => {
  it("strips the ADS-B padding and leading zeros", () => {
    expect(normaliseCallsign("BAW117  ")).toEqual({ code: "BAW", number: "117", callsign: "BAW117" });
    expect(normaliseCallsign("baw0117")?.callsign).toBe("BAW117");
  });

  it("puts a zero back when stripping leaves nothing or only letters", () => {
    expect(normaliseCallsign("BAW0")?.callsign).toBe("BAW0");
    expect(normaliseCallsign("BAW0A")?.callsign).toBe("BAW0A");
  });

  it("allows one or two trailing letters and at most four characters", () => {
    expect(normaliseCallsign("EZY12AB")?.callsign).toBe("EZY12AB");
    expect(normaliseCallsign("BAW12345")).toBeNull();
    expect(normaliseCallsign("BAW1A2")).toBeNull();
  });

  it("refuses a registration callsign or a two-character code, which have no route here", () => {
    expect(normaliseCallsign("GABCD")).toBeNull();
    expect(normaliseCallsign("N628TS")).toBeNull();
    expect(normaliseCallsign("BA117")).toBeNull();
  });
});

describe("the CSV readers", () => {
  it("keeps a comma inside quotes, and a doubled quote as one", () => {
    expect(splitCsvLine('EGMD,Lydd Airport,EGMD,LYX,"Lydd, Ashford",GB')).toEqual(
      ["EGMD", "Lydd Airport", "EGMD", "LYX", "Lydd, Ashford", "GB"],
    );
    expect(splitCsvLine('a,"say ""hi""",b')).toEqual(["a", 'say "hi"', "b"]);
  });

  it("reads routes in flight order, a multi-stop one included", () => {
    const r = parseRoutes(fx("BAW-all.csv"));
    expect(r.get("BAW117")).toEqual(["EGLL", "KJFK"]);
    expect(r.get("BAW15")).toEqual(["EGLL", "WSSS", "YSSY"]);
  });

  it("reads airports past the byte-order mark, and airlines with a quoted name", () => {
    const a = parseAirports(fx("EG.csv"));
    expect(a.get("EGLL")).toEqual({
      iata: "LHR", icao: "EGLL", name: "London Heathrow Airport", municipality: "London", countryIso: "GB",
      lat: 51.4706, lon: -0.461941,
    });
    expect(a.get("EGMD")?.municipality).toBe("Lydd, Ashford");
    const l = parseAirlines(fx("airlines.csv"));
    expect(l.get("BAW")).toBe("British Airways");
    expect(l.get("ACR")).toMatch(/^Aerocenter, Escuela/);
  });
});

describe("fetchVrsRoute", () => {
  it("answers a callsign with its airline, origin and destination", async () => {
    const h = deps();
    const r = await fetchVrsRoute("BAW117  ", h.deps);
    expect(r).toMatchObject({
      callsign: "BAW117",
      airline: "British Airways",
      origin: { icao: "EGLL", iata: "LHR", municipality: "London" },
      destination: { icao: "KJFK", iata: "JFK", countryIso: "US" },
    });
  });

  it("takes the first and last airport of a multi-stop route", async () => {
    const r = await fetchVrsRoute("BAW15", deps().deps);
    expect(r?.origin?.icao).toBe("EGLL");
    expect(r?.destination?.icao).toBe("YSSY");
  });

  it("returns null for a callsign the airline file does not list, and for an airline with no file", async () => {
    expect(await fetchVrsRoute("BAW9999", deps().deps)).toBeNull();
    expect(await fetchVrsRoute("ZZZ1", deps().deps)).toBeNull();
  });

  it("reads each file once a day, not once a click", async () => {
    const h = deps();
    await fetchVrsRoute("BAW117", h.deps);
    const first = h.asked.length;
    await fetchVrsRoute("BAW1", h.deps);
    expect(h.asked.length).toBe(first);
    h.clock.t += VRS_TTL_MS + 1;
    await fetchVrsRoute("BAW1", h.deps);
    expect(h.asked.length).toBeGreaterThan(first);
  });

  it("is dormant-safe: an unreachable upstream is null, and is asked again next time", async () => {
    let calls = 0;
    const down = { now: () => 0, fetchText: async () => (calls++, null) };
    expect(await fetchVrsRoute("BAW117", down)).toBeNull();
    expect(await fetchVrsRoute("BAW117", down)).toBeNull();
    expect(calls).toBe(2);
  });
});
