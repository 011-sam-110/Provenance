import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  normalizeReliefWebCsv,
  normalizeIfrcAppeals,
  mergeEmergencies,
  reliefWebCsvUrl,
  disasterColor,
  RELIEFWEB_SOURCE,
} from "@/lib/signals/reliefweb";

// Captured 2026-10-16 from ReliefWeb's own export on HDX (all 102 active rows + 5 past
// ones; descriptions cut to 240 characters, newlines kept) and from IFRC GO /api/v2/appeal.
const CSV = readFileSync(join(process.cwd(), "tests/fixtures/reliefweb-disasters-list.csv"), "utf8");
const IFRC = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/ifrc-go-appeals.json"), "utf8"));
const NOW = Date.parse("2026-10-16T19:00:00Z");

test("keeps every ongoing and alert disaster from the export, drops the past ones", () => {
  const out = normalizeReliefWebCsv(CSV);
  // The export has no "current" status at all. The old filter (current|alert) kept 3.
  expect(out).toHaveLength(102);
  expect(new Set(out.map((f) => f.props?.status))).toEqual(new Set(["ongoing", "alert"]));
  expect(out.every((f) => f.signalId === "reliefweb" && f.props?.provider === "ReliefWeb")).toBe(true);
});

test("maps the export's columns: ISO-3 upper-cased, own location, type colour, link, glide", () => {
  const som = normalizeReliefWebCsv(CSV).find((f) => f.id === "reliefweb:33516")!;
  expect(som.countryIso3).toBe("SOM");
  expect(som.lat).toBeCloseTo(5.79);
  expect(som.lon).toBeCloseTo(47.33);
  expect(som.color).toBe(disasterColor("EP"));
  expect(som.props?.glide).toBe("EP-2016-000053-SOM");
  expect(som.link).toBe("https://reliefweb.int/disaster/ep-2016-000053-som");
  expect(som.ts).toBe("2026-02-12T13:48:56+00:00");
});

test("a row without a location falls back to the ISO-3 centroid, and one with neither is skipped", () => {
  const head = CSV.split("\n")[0];
  const cols = head.split(",");
  const row = (o: Record<string, string>) => cols.map((c) => o[c] ?? "").join(",");
  const csv = [
    head,
    row({ id: "1", name: "A", status: "ongoing", "primary_country-iso3": "afg", "primary_type-code": "EQ" }),
    row({ id: "2", name: "B", status: "ongoing", "primary_country-iso3": "zzz" }),
  ].join("\n");
  const out = normalizeReliefWebCsv(csv);
  expect(out.map((f) => f.id)).toEqual(["reliefweb:1"]);
  expect(out[0].countryIso3).toBe("AFG");
  expect(Number.isFinite(out[0].lat)).toBe(true);
});

test("IFRC: keeps appeals that have not ended, can be placed and are not anticipatory", () => {
  const out = normalizeIfrcAppeals(IFRC, NOW);
  expect(out.length).toBeGreaterThan(15);
  const ids = new Set(out.map((f) => f.id));
  expect(ids.has("ifrc:8426")).toBe(true); // Zimbabwe Hailstorms, ends 2027-04-30
  expect(ids.has("ifrc:4425")).toBe(false); // Congo cholera, ended 2026-09-30
  expect(ids.has("ifrc:8425")).toBe(false); // "Ecuador - Floods - Imminent", and no country
  expect(ids.has("ifrc:4401")).toBe(false); // "Nigeria - Drought sEAP": anticipatory
  expect(ids.has("ifrc:4670")).toBe(false); // "Honduras - Drought - EAP": anticipatory
  const mmr = out.find((f) => f.id === "ifrc:8419")!;
  expect(mmr.countryIso3).toBe("MMR");
  expect(mmr.link).toBe("https://go.ifrc.org/emergencies/8111");
  expect(mmr.props?.provider).toBe("IFRC GO");
  const eth = out.find((f) => f.id === "ifrc:8418")!;
  expect(eth.color).toBe(disasterColor("DR"));
  expect(eth.ts).toMatch(/^\d{4}-\d\d-\d\dT/);
});

test("merge: an IFRC appeal for the same country, type and month as a ReliefWeb record is dropped", () => {
  const base = { lat: 0, lon: 0, title: "t", signalId: "reliefweb" };
  const rw = [{ ...base, id: "reliefweb:1", countryIso3: "PHL", props: { typeCode: "FL", started: "2026-08-25T00:00:00+00:00" } }];
  const ifrc = [
    { ...base, id: "ifrc:a", countryIso3: "PHL", props: { typeCode: "FL", started: "2026-08-31T00:00:00Z" } }, // same flood
    { ...base, id: "ifrc:b", countryIso3: "PHL", props: { typeCode: "EP", started: "2026-08-31T00:00:00Z" } }, // other type
    { ...base, id: "ifrc:c", countryIso3: "PHL", props: { typeCode: "FL", started: "2026-01-02T00:00:00Z" } }, // months apart
  ];
  expect(mergeEmergencies(rw, ifrc).map((f) => f.id)).toEqual(["reliefweb:1", "ifrc:b", "ifrc:c"]);
});

test("reads the CSV resource URL from the CKAN record, and refuses anything else", () => {
  const url = "https://data.humdata.org/dataset/x/resource/y/download/reliefweb-disasters-list.csv";
  expect(reliefWebCsvUrl({ result: { resources: [{ format: "CSV", name: "reliefweb-disasters-list.csv", url }] } })).toBe(url);
  expect(reliefWebCsvUrl({ result: { resources: [{ format: "JSON", url: "https://x/y.json" }] } })).toBeNull();
  expect(reliefWebCsvUrl(null)).toBeNull();
});

test("the layer needs no key and is country-precise", () => {
  expect(RELIEFWEB_SOURCE.precision).toBe("country");
  expect(RELIEFWEB_SOURCE.attribution).toContain("CC BY 4.0");
  expect(RELIEFWEB_SOURCE.attribution).toContain("IFRC");
});
