import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PROVIDERS,
  normalizeCityCrime,
  crimeGroup,
  localToEpoch,
  sinceLocal,
  US_CITY_CRIME_SOURCE,
  CHICAGO_DISCLAIMER,
} from "@/lib/signals/crime-us";

// A real capture of 2026-10-16: the first rows each of the eight portal requests
// returned (six for Boston, whose table mixes in service calls).
const fx = JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "crime-us.json"), "utf8")) as {
  capturedAt: string;
  providers: Record<string, unknown>;
};
const NOW = Date.parse(fx.capturedAt);
const provider = (key: string) => PROVIDERS.find((p) => p.key === key)!;
const features = (key: string) => normalizeCityCrime(provider(key).read(fx.providers[key]), NOW);

describe("US city crime", () => {
  it("reads every portal it asks", () => {
    expect(PROVIDERS.map((p) => p.key)).toEqual([
      "sf",
      "seattle",
      "dc",
      "montgomery",
      "chicago-shootings",
      "chicago",
      "boston",
      "kansas-city",
    ]);
    for (const p of PROVIDERS) expect(features(p.key).length, p.key).toBeGreaterThan(0);
  });

  it("reads a floating Socrata time in the city's own zone", () => {
    // San Francisco's 23:24 on 15 Oct is 06:24 UTC on the 16th (PDT, UTC-7).
    expect(new Date(localToEpoch("2026-10-15T23:24:00.000", "America/Los_Angeles")!).toISOString()).toBe(
      "2026-10-16T06:24:00.000Z",
    );
    // After the clocks change in November it is UTC-8.
    expect(new Date(localToEpoch("2026-12-01T12:00:00", "America/Los_Angeles")!).toISOString()).toBe(
      "2026-12-01T20:00:00.000Z",
    );
    expect(localToEpoch("not a time", "America/Chicago")).toBeUndefined();
    expect(sinceLocal(Date.parse("2026-10-16T03:00:00Z"), "America/Los_Angeles", 7)).toBe("2026-10-08");
  });

  it("makes a feature with a time, a block and a group colour", () => {
    const sf = features("sf")[0]!;
    expect(sf.id).toBe("crime-us:sf:160706807055");
    expect(sf.title).toBe("Motor Vehicle Theft — Quesada Ave & Selby St, San Francisco");
    expect(sf.ts).toBe("2026-10-16T06:24:00.000Z");
    expect(sf.props?.category).toBe("Crime against property");
    expect(sf.link).toBe("https://data.sfgov.org/d/wg3w-h783");
    const dc = features("dc")[0]!;
    expect(dc.props?.category).toBe("Crime against a person");
    expect(dc.color).toBe("#dc2626");
  });

  it("drops a record placed at 0,0, which a portal uses for 'unknown'", () => {
    const raw = provider("montgomery").read(fx.providers.montgomery);
    expect(raw.some((r) => r.lat === 0 && r.lon === 0)).toBe(true);
    expect(features("montgomery").every((f) => f.lat !== 0)).toBe(true);
  });

  it("keeps one Chicago marker per case, the shootings row first, with the City's disclaimer", () => {
    const shootings = provider("chicago-shootings").read(fx.providers["chicago-shootings"]);
    const dup = { ...shootings[0]!, offence: "BATTERY", detail: "duplicate from the crimes table" };
    const out = normalizeCityCrime([...shootings, dup], NOW);
    expect(out.filter((f) => f.id === `crime-us:${shootings[0]!.id}`).length).toBe(1);
    expect(out[0]!.props?.offence).toBe("Shooting");
    expect(out[0]!.props?.disclaimer).toBe(CHICAGO_DISCLAIMER);
  });

  it("never asks a portal for race, sex, age or involvement", () => {
    const since = "2026-10-09";
    for (const p of PROVIDERS) {
      const url = decodeURIComponent(p.url(since)).toLowerCase();
      for (const field of ["race", "sex", "age,", "involvement"]) expect(url, `${p.key} asks for ${field}`).not.toContain(field);
    }
  });

  it("drops Boston's service calls, which share its incidents table", () => {
    const out = features("boston");
    expect(out.length).toBeLessThan((fx.providers.boston as { result: { records: unknown[] } }).result.records.length);
    expect(out.every((f) => !/TOWED|ASSIST|INVESTIGATE|WARRANT/i.test(String(f.props?.offence)))).toBe(true);
    expect(out.every((f) => !String(f.props?.block).includes("\n"))).toBe(true);
  });

  it("drops records outside the window and in the future", () => {
    const r = { ...provider("sf").read(fx.providers.sf)[0]! };
    expect(normalizeCityCrime([{ ...r, at: NOW - 30 * 86_400_000 }], NOW)).toEqual([]);
    expect(normalizeCityCrime([{ ...r, at: NOW + 5 * 3_600_000 }], NOW)).toEqual([]);
  });

  it("groups offences the NIBRS way", () => {
    expect(crimeGroup("Weapon Law Violations")).toBe("society");
    expect(crimeGroup("AGGRAVATED ASSAULT")).toBe("person");
    expect(crimeGroup("Theft F/Auto")).toBe("property");
    expect(crimeGroup("Drug/Narcotic Violations")).toBe("society");
    expect(crimeGroup("All Other Offenses")).toBe("other");
  });

  it("is a block-level event layer in Civic safety that credits every department", () => {
    expect(US_CITY_CRIME_SOURCE.precision).toBe("area");
    expect(US_CITY_CRIME_SOURCE.group).toBe("Civic safety");
    for (const name of ["San Francisco", "Seattle", "DC MPD", "Montgomery", "Chicago", "Boston", "Kansas City"]) {
      expect(US_CITY_CRIME_SOURCE.attribution).toContain(name);
    }
  });
});
