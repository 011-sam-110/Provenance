import { describe, it, expect } from "vitest";
import {
  COUNTRY_CENTROIDS,
  COUNTRY_NAME_ALIASES,
  centroidByIso2,
  centroidByIso3,
  centroidByName,
} from "@/lib/signals/country-centroids.data";

// This suite guards two failure modes that are both SILENT at runtime (no
// warning, no count, nothing) because every country-aggregated layer
// (cyber threat, displacement, food security, the Instability Index) just
// `continue`s past a lookup miss:
//   1. A country missing from the dataset entirely -> every signal for it is
//      dropped from every layer that keys off ISO codes.
//   2. A country present under the WRONG name -> dropped from any layer that
//      keys off names (ACLED, GDELT) even though the row nominally exists.

describe("COUNTRY_CENTROIDS — dataset completeness", () => {
  it("every entry has a usable, plausible lat/lon (fails the whole dataset if one regresses)", () => {
    const bad: string[] = [];
    for (const c of COUNTRY_CENTROIDS) {
      const latOk = typeof c.lat === "number" && Number.isFinite(c.lat) && c.lat >= -90 && c.lat <= 90;
      const lonOk = typeof c.lon === "number" && Number.isFinite(c.lon) && c.lon >= -180 && c.lon <= 180;
      // (0, 0) is "Null Island" — a real ocean point, never a real country's
      // representative centroid in this dataset. A silent default landing here
      // would put a country in the sea and present it as fact.
      const notNullIsland = !(c.lat === 0 && c.lon === 0);
      if (!latOk || !lonOk || !notNullIsland) bad.push(`${c.iso2}/${c.iso3} (${c.name}): lat=${c.lat} lon=${c.lon}`);
    }
    expect(bad).toEqual([]);
  });

  it("every entry has well-formed, non-empty iso2/iso3/name fields", () => {
    const bad: string[] = [];
    for (const c of COUNTRY_CENTROIDS) {
      if (!/^[A-Z]{2}$/.test(c.iso2)) bad.push(`bad iso2: "${c.iso2}" (${c.name})`);
      if (!/^[A-Z]{3}$/.test(c.iso3)) bad.push(`bad iso3: "${c.iso3}" (${c.name})`);
      if (!c.name || !c.name.trim()) bad.push(`empty name for ${c.iso2}/${c.iso3}`);
    }
    expect(bad).toEqual([]);
  });

  it("has no duplicate iso2 or iso3 codes (a duplicate silently shadows the earlier row in the lookup Maps)", () => {
    const iso2Seen = new Map<string, number>();
    const iso3Seen = new Map<string, number>();
    for (const c of COUNTRY_CENTROIDS) {
      iso2Seen.set(c.iso2, (iso2Seen.get(c.iso2) ?? 0) + 1);
      iso3Seen.set(c.iso3, (iso3Seen.get(c.iso3) ?? 0) + 1);
    }
    const dupeIso2 = [...iso2Seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
    const dupeIso3 = [...iso3Seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
    expect(dupeIso2).toEqual([]);
    expect(dupeIso3).toEqual([]);
  });

  it("grew to include the sovereign-state and FCDO-referenced-territory gaps fixed in this pass", () => {
    // 243 rows before this fix; 7 added (South Sudan + the 6 fcdoSlugs.data.ts
    // territories that were also silently unresolvable). A regression that
    // drops any of them should shrink this below the fixed floor.
    expect(COUNTRY_CENTROIDS.length).toBeGreaterThanOrEqual(250);
  });
});

describe("centroidByIso2 / centroidByIso3 — pinned regression: the gaps this pass fixed", () => {
  it("South Sudan (the confirmed bug) now resolves by both ISO2 and ISO3", () => {
    const byIso2 = centroidByIso2("SS");
    const byIso3 = centroidByIso3("SSD");
    expect(byIso2).toBeDefined();
    expect(byIso3).toBeDefined();
    expect(byIso2).toEqual(byIso3);
    expect(byIso2?.name).toBe("South Sudan");
    // Verified centroid (Wikipedia infobox): 7°N 30°E.
    expect(byIso2?.lat).toBeCloseTo(7.0, 1);
    expect(byIso2?.lon).toBeCloseTo(30.0, 1);
  });

  it.each([
    ["CW", "CUW", "Curaçao"],
    ["SX", "SXM", "Sint Maarten (Dutch part)"],
    ["MF", "MAF", "Saint Martin (French part)"],
    ["BL", "BLM", "Saint Barthélemy"],
    ["BQ", "BES", "Bonaire, Sint Eustatius and Saba"],
    ["XK", "XKX", "Kosovo"],
  ])("%s/%s (%s) resolves by ISO2 and ISO3 with a plausible, non-null-island coordinate", (iso2, iso3, name) => {
    const byIso2 = centroidByIso2(iso2);
    const byIso3 = centroidByIso3(iso3);
    expect(byIso2, `centroidByIso2("${iso2}") should resolve`).toBeDefined();
    expect(byIso3, `centroidByIso3("${iso3}") should resolve`).toBeDefined();
    expect(byIso2).toEqual(byIso3);
    expect(byIso2?.name).toBe(name);
    expect(Number.isFinite(byIso2?.lat)).toBe(true);
    expect(Number.isFinite(byIso2?.lon)).toBe(true);
    expect(byIso2?.lat === 0 && byIso2?.lon === 0).toBe(false);
  });

  it("lookups are case-insensitive (upstreams are inconsistent about case)", () => {
    expect(centroidByIso2("ss")?.iso3).toBe("SSD");
    expect(centroidByIso3("ssd")?.iso2).toBe("SS");
  });

  it("unknown codes still resolve to undefined, not a fabricated fallback", () => {
    expect(centroidByIso2("ZZ")).toBeUndefined();
    expect(centroidByIso3("ZZZ")).toBeUndefined();
  });
});

describe("centroidByName — alias resolution (a name mismatch drops a country as silently as a missing row)", () => {
  it("resolves exact canonical names case-insensitively, unchanged", () => {
    expect(centroidByName("Ethiopia")?.iso3).toBe("ETH");
    expect(centroidByName("ethiopia")?.iso3).toBe("ETH");
    expect(centroidByName("SOUTH SUDAN")?.iso3).toBe("SSD");
  });

  it.each([
    ["Libya", "LBY"], // canonical name here is "Libyan Arab Jamahiriya"
    ["Taiwan", "TWN"],
    ["West Bank", "PSE"],
    ["Gaza Strip", "PSE"],
    ["Palestine", "PSE"],
    ["Vietnam, Republic Of", "VNM"], // GDELT's historical GNS entry
    ["South Korea", "KOR"], // canonical name here is "Korea, Republic of"
    ["North Korea", "PRK"],
    ["Vietnam", "VNM"], // canonical name here is "Viet Nam"
    ["Myanmar", "MMR"],
    ["Democratic Republic of Congo", "COD"],
    ["Republic of Congo", "COG"],
    ["Syria", "SYR"],
    ["Russia", "RUS"],
    ["Eswatini", "SWZ"], // canonical name here is "Swaziland"
    ["Czechia", "CZE"],
    ["North Macedonia", "MKD"],
    ["Cabo Verde", "CPV"],
    ["East Timor", "TLS"],
  ])('resolves the known upstream spelling "%s" -> %s', (alias, iso3) => {
    expect(centroidByName(alias)?.iso3).toBe(iso3);
  });

  it("alias matching is case-insensitive", () => {
    expect(centroidByName("libya")?.iso3).toBe("LBY");
    expect(centroidByName("LIBYA")?.iso3).toBe("LBY");
    expect(centroidByName("west BANK")?.iso3).toBe("PSE");
  });

  it("every value in COUNTRY_NAME_ALIASES resolves to a real centroid (no dangling alias)", () => {
    const dangling = Object.entries(COUNTRY_NAME_ALIASES)
      .filter(([, iso3]) => !centroidByIso3(iso3))
      .map(([alias, iso3]) => `${alias} -> ${iso3}`);
    expect(dangling).toEqual([]);
  });

  it("an unrecognised name resolves to undefined, not a fabricated fallback", () => {
    expect(centroidByName("Wakanda")).toBeUndefined();
    expect(centroidByName("")).toBeUndefined();
  });
});
