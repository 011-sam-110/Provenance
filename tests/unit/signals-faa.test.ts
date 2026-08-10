import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FAA_KINDS,
  airportCodeIndex,
  closureSeverity,
  faaFeatures,
  kindForDelayType,
  parseFaaStatus,
  tagBlocks,
  tagText,
} from "@/lib/signals/faa";

// A verbatim capture of https://nasstatus.faa.gov/api/airport-status-information
// on 2026-08-10. It happens to contain the exact trap this adapter exists to
// avoid: LAX, LAS, PHL and SAN all appear under "Airport Closures" while being
// open to every scheduled airline flight.
const xml = readFileSync(join(process.cwd(), "tests/fixtures/faa-status.xml"), "utf8");

describe("tag helpers", () => {
  it("reads the first tag's text and decodes entities", () => {
    expect(tagText("<a>hello &amp; goodbye</a>", "a")).toBe("hello & goodbye");
    expect(tagText("<a> spaced\n  out </a>", "a")).toBe("spaced out");
    expect(tagText("<a>x</a>", "b")).toBe("");
  });

  it("collects every block of a tag", () => {
    expect(tagBlocks("<x>1</x><x>2</x>", "x")).toEqual(["1", "2"]);
    expect(tagBlocks("<y>1</y>", "x")).toEqual([]);
  });
});

describe("kindForDelayType", () => {
  it("recognises the FAA's block names", () => {
    expect(kindForDelayType("Ground Stop Programs")).toBe("ground-stop");
    expect(kindForDelayType("Airport Closures")).toBe("closure");
    expect(kindForDelayType("Ground Delay Programs")).toBe("ground-delay");
    expect(kindForDelayType("General Arrival/Departure Delay Info")).toBe("delay");
    expect(kindForDelayType("Something New")).toBeNull();
  });
});

describe("closureSeverity — the trap in the real feed", () => {
  // The FAA files partial NOTAM restrictions under "Airport Closures". Rendering a
  // red "Airport closed" pin on LAX because it is shut to unscheduled general
  // aviation would be one of the most misleading things this map could do.
  it("treats CLSD TO <someone> as a restriction, not a closure", () => {
    expect(closureSeverity("!LAX 05/277 LAX AD AP CLSD TO NON SKED TRANSIENT GA ACFT")).toBe("restriction");
    expect(closureSeverity("!HNL 06/658 HNL AD AP CLSD TO F-35 VTOL")).toBe("restriction");
  });

  it("treats a bare closure, or one with exceptions, as a real closure", () => {
    expect(closureSeverity("!SAN 08/007 SAN AD AP CLSD 2608100800-2608101300")).toBe("closure");
    expect(closureSeverity("!ASE 08/011 ASE AD AP CLSD EXC MEDEVAC HELI OPS")).toBe("closure");
  });
});

describe("parseFaaStatus over the real capture", () => {
  const events = parseFaaStatus(xml);

  it("finds the ground stop with its cause", () => {
    const phl = events.find((e) => e.code === "PHL")!;
    expect(phl).toBeTruthy();
    expect(phl.kind).toBe("ground-stop");
    expect(phl.reason).toBe("thunderstorms");
    expect(phl.detail).toContain("until 8:00 am EDT");
  });

  it("does NOT call LAX closed", () => {
    const lax = events.find((e) => e.code === "LAX")!;
    expect(lax.kind).toBe("restriction");
    expect(FAA_KINDS[lax.kind].label).toBe("Partial restriction");
  });

  it("does call a genuinely closed airport closed", () => {
    expect(events.find((e) => e.code === "ASE")!.kind).toBe("closure");
    expect(events.find((e) => e.code === "LMT")!.kind).toBe("closure");
  });

  // SAN appears twice: a real closure in one block, a partial restriction in
  // another. The worse one has to win.
  it("keeps the most severe status when an airport appears more than once", () => {
    expect(events.filter((e) => e.code === "SAN")).toHaveLength(1);
    expect(events.find((e) => e.code === "SAN")!.kind).toBe("closure");
    // PHL is under a ground stop AND a partial restriction; the stop wins.
    expect(events.find((e) => e.code === "PHL")!.kind).toBe("ground-stop");
  });

  it("carries the raw NOTAM through so a reader can check our call", () => {
    expect(events.find((e) => e.code === "LAX")!.reason).toContain("NON SKED TRANSIENT GA");
  });

  it("returns nothing rather than throwing on junk", () => {
    expect(parseFaaStatus("")).toEqual([]);
    expect(parseFaaStatus("<AIRPORT_STATUS_INFORMATION></AIRPORT_STATUS_INFORMATION>")).toEqual([]);
  });
});

describe("faaFeatures", () => {
  const coords = new Map([
    ["PHL", { lat: 39.8719, lon: -75.2411, name: "Philadelphia International Airport" }],
  ]);

  it("places an event at its airport and carries the FAA's own words", () => {
    const [f] = faaFeatures(parseFaaStatus(xml).filter((e) => e.code === "PHL"), coords, "Mon Aug 10 11:22:34 2026 GMT");
    expect(f.id).toBe("faa:PHL");
    expect(f.lat).toBeCloseTo(39.87, 1);
    expect(f.signalId).toBe("faa-airports");
    expect(f.title).toBe("PHL — Ground stop");
    expect(f.props?.reason).toBe("thunderstorms");
    expect(f.props?.airport).toContain("Philadelphia");
    expect(Number(f.props?.magnitude)).toBe(FAA_KINDS["ground-stop"].magnitude);
  });

  // An invented position on an aviation layer would be worse than an omission.
  it("drops an airport it cannot place rather than guessing", () => {
    const out = faaFeatures([{ code: "ZZZ", kind: "closure", reason: "x", detail: "" }], coords, "");
    expect(out).toEqual([]);
  });
});

describe("airportCodeIndex", () => {
  it("indexes large airports by IATA code", () => {
    const csv = [
      "id,ident,type,name,latitude_deg,longitude_deg,continent,iso_country,municipality,iata_code",
      '1,KPHL,large_airport,"Philadelphia International Airport",39.8719,-75.2411,NA,US,Philadelphia,PHL',
      '2,KXYZ,small_airport,"Tiny Field",10,10,NA,US,Nowhere,XYZ',
    ].join("\n");
    const index = airportCodeIndex(csv);
    expect(index.get("PHL")?.name).toContain("Philadelphia");
    // Only large airports are in the upstream parse, so a small field is absent.
    expect(index.get("XYZ")).toBeUndefined();
  });
});

describe("severity ordering", () => {
  it("ranks closure > ground stop > ground delay > delay > restriction", () => {
    const m = (k: keyof typeof FAA_KINDS) => FAA_KINDS[k].magnitude;
    expect(m("closure")).toBeGreaterThan(m("ground-stop"));
    expect(m("ground-stop")).toBeGreaterThan(m("ground-delay"));
    expect(m("ground-delay")).toBeGreaterThan(m("delay"));
    expect(m("delay")).toBeGreaterThan(m("restriction"));
  });
});
