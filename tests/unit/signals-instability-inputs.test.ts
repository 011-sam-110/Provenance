import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ucdpMonthlyCsvUrls,
  iso3FromUcdpCountry,
  ucdpFatalitiesByIso3,
  informSeverityXlsxUrl,
  informSeverityHdxUrl,
  informSeverityByIso3,
  informRiskGroups,
  informRiskByIso3,
  worldBankByIso3,
  structuralBaseline,
  iodaCriticalAlertsByIso3,
} from "@/lib/signals/instability-inputs";
import { readXlsxSheet, zipDirectory, parseSheetRows } from "@/lib/signals/xlsx";
import { parseCsv } from "@/lib/signals/airports";

// Fixtures captured 2026-10-16 from the live upstreams:
//   ucdp-candidate-ged-2026-08.csv   GEDEvent_v26_0_8.csv, first 3 events per country (long text cut)
//   inform-severity-2026-08.xlsx     the August 2026 workbook cut to its country sheet
//   inform-risk-2026-mid.json        countries/Scores, WorkflowId 515, IndicatorId INFORM
//   worldbank-wgi-pv.json            GOV_WGI_PV.EST, mrv=1
//   worldbank-population.json        SP.POP.TOTL, mrv=1
//   ioda-alerts-country.json         /v2/outages/alerts, 24 h, entityType=country
const fx = (name: string) => readFileSync(join(process.cwd(), "tests/fixtures", name));
const json = (name: string) => JSON.parse(fx(name).toString("utf8"));
const buf = (name: string) => {
  const b = fx(name);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

test("UCDP: picks the newest two MONTHLY candidate files, skipping the quarterly rollup", () => {
  const html = `
    <a href="https://ucdp.uu.se/downloads/candidateged/GEDEvent_v26_01_26_06.csv">Q</a>
    <a href="https://ucdp.uu.se/downloads/candidateged/GEDEvent_v26_0_7.csv">Jul</a>
    <a href="https://ucdp.uu.se/downloads/candidateged/GEDEvent_v26_0_8.csv">Aug</a>
    <a href="https://ucdp.uu.se/downloads/candidateged/GEDEvent_v25_0_12.csv">Dec</a>`;
  expect(ucdpMonthlyCsvUrls(html)).toEqual([
    "https://ucdp.uu.se/downloads/candidateged/GEDEvent_v26_0_8.csv",
    "https://ucdp.uu.se/downloads/candidateged/GEDEvent_v26_0_7.csv",
  ]);
  // The yearly rollover: v27_0_1 is newer than v26_0_12.
  expect(ucdpMonthlyCsvUrls("candidateged/GEDEvent_v26_0_12.csv candidateged/GEDEvent_v27_0_1.csv", 1)).toEqual([
    "https://ucdp.uu.se/downloads/candidateged/GEDEvent_v27_0_1.csv",
  ]);
  expect(ucdpMonthlyCsvUrls("no links")).toEqual([]);
});

test("UCDP: every country name in the August release resolves to an ISO-3", () => {
  const rows = parseCsv(fx("ucdp-candidate-ged-2026-08.csv").toString("utf8"));
  const ci = rows[0].indexOf("country");
  const names = new Set(rows.slice(1).map((r) => r[ci]).filter(Boolean));
  expect(names.size).toBe(50);
  for (const n of names) expect(iso3FromUcdpCountry(n), n).toMatch(/^[A-Z]{3}$/);
  // Gleditsch-Ward style names with a former name in brackets.
  expect(iso3FromUcdpCountry("Yemen (North Yemen)")).toBe("YEM");
  expect(iso3FromUcdpCountry("DR Congo (Zaire)")).toBe("COD");
  expect(iso3FromUcdpCountry("Russia (Soviet Union)")).toBe("RUS");
  expect(iso3FromUcdpCountry("Myanmar (Burma)")).toBe("MMR");
  expect(iso3FromUcdpCountry("Ivory Coast")).toBe("CIV");
  expect(iso3FromUcdpCountry("United States of America")).toBe("USA");
  expect(iso3FromUcdpCountry("")).toBeUndefined();
});

test("UCDP: sums the best fatality estimate per country, and loses no country of the release", () => {
  const by = ucdpFatalitiesByIso3([fx("ucdp-candidate-ged-2026-08.csv").toString("utf8")]);
  // The fixture keeps 3 events for each of the release's 50 countries; in 2 of them
  // those 3 events record no deaths.
  expect(by.size).toBe(48);
  expect(by.get("UKR")).toBe(5020);
  expect(by.get("SSD")).toBe(109);
  // Two releases add up.
  const twice = ucdpFatalitiesByIso3([fx("ucdp-candidate-ged-2026-08.csv").toString("utf8"), fx("ucdp-candidate-ged-2026-08.csv").toString("utf8")]);
  expect(twice.get("UKR")).toBe(10040);
  expect(ucdpFatalitiesByIso3(["not,a,ucdp,file"]).size).toBe(0);
});

test("INFORM Severity: the newest workbook is the highest YYYYMM, whatever the file is called", () => {
  const html = `
    <a href="/inform-index/Portals/0/InfoRM/Severity/2026/202606_INFORM_Severity_-_June_2026__2_.xlsx">x</a>
    <a href="/inform-index/Portals/0/InfoRM/Severity/2026/202608 INFORM Severity - August 2026.xlsx">y</a>
    <a href="/inform-index/Portals/0/InfoRM/Severity/2025/202512_inform_severity_mid_december_2025.xlsx">z</a>`;
  expect(informSeverityXlsxUrl(html)).toBe(
    "https://drmkc.jrc.ec.europa.eu/inform-index/Portals/0/InfoRM/Severity/2026/202608%20INFORM%20Severity%20-%20August%202026.xlsx",
  );
  expect(informSeverityXlsxUrl("<p>nothing</p>")).toBeNull();
});

test("INFORM Severity: the newest workbook on ACAPS's HDX record", () => {
  const url = (n: string) => `https://data.humdata.org/dataset/x/resource/${n}/download/${n}.xlsx`;
  const pkg = {
    result: {
      resources: [
        { name: "202608 INFORM Severity - August 2026.xlsx", format: "XLSX", url: url("aug") },
        { name: "202609 INFORM Severity - September 2026.xlsx", format: "XLSX", url: url("sep") },
        { name: "INFORM Severity methodology.pdf", format: "PDF", url: url("pdf") },
      ],
    },
  };
  expect(informSeverityHdxUrl(pkg)).toBe(url("sep"));
  expect(informSeverityHdxUrl({ result: { resources: [] } })).toBeNull();
  expect(informSeverityHdxUrl(null)).toBeNull();
});

test("INFORM Severity: reads the country sheet of the real workbook", async () => {
  const rows = await readXlsxSheet(buf("inform-severity-2026-08.xlsx"), "INFORM Severity - country");
  expect(rows).not.toBeNull();
  const sev = informSeverityByIso3(rows!);
  expect(sev.get("AFG")).toBe(9.2);
  expect(sev.get("BFA")).toBe(8.4);
  expect(sev.get("BDI")).toBe(5.2);
  expect(sev.size).toBeGreaterThan(50);
  for (const v of sev.values()) {
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThanOrEqual(10);
  }
  // A sheet name that is not there is null, never a guess.
  expect(await readXlsxSheet(buf("inform-severity-2026-08.xlsx"), "No such sheet")).toBeNull();
  expect(informSeverityByIso3([["no", "header"]]).size).toBe(0);
});

test("xlsx: the central directory lists the parts, and cells land in their columns", () => {
  const dir = zipDirectory(buf("inform-severity-2026-08.xlsx"));
  expect(dir.has("xl/workbook.xml")).toBe(true);
  expect(dir.has("xl/sharedStrings.xml")).toBe(true);
  expect(zipDirectory(new ArrayBuffer(10)).size).toBe(0);
  const rows = parseSheetRows(
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><v>4.5</v></c><c r="D1" t="inlineStr"><is><t>a &amp; b</t></is></c></row>',
    ["first"],
  );
  expect(rows).toEqual([["first", "", "4.5", "a & b"]]);
});

test("INFORM Risk: the newest global group first, and a score per country", () => {
  expect(
    informRiskGroups(["INFORM_SAHEL", "INFORM2025", "INFORM2025_Mid", "INFORM2026", "INFORM2026_Mid", "INFORM_LAC"]),
  ).toEqual(["INFORM2026_Mid", "INFORM2026", "INFORM2025_Mid", "INFORM2025"]);
  expect(informRiskGroups(null)).toEqual([]);
  const risk = informRiskByIso3(json("inform-risk-2026-mid.json"));
  expect(risk.get("AFG")).toBe(7.8);
  expect(risk.size).toBeGreaterThan(180);
});

test("World Bank: newest value per country, aggregates dropped", () => {
  const wgi = worldBankByIso3(json("worldbank-wgi-pv.json"));
  expect(wgi.get("ISR")).toBeCloseTo(-0.913622);
  expect(wgi.get("DEU")).toBeCloseTo(0.2082813);
  expect([...wgi.keys()].every((k) => /^[A-Z]{3}$/.test(k))).toBe(true);
  const pop = worldBankByIso3(json("worldbank-population.json"));
  expect(pop.has("AFE")).toBe(false); // "Africa Eastern and Southern" is not a country
  expect(pop.get("DEU")).toBeGreaterThan(80_000_000);
  expect(worldBankByIso3({ message: "error" }).size).toBe(0);
});

test("structural baseline averages INFORM Risk and WGI on their ramps; either alone counts", () => {
  const s = structuralBaseline(
    new Map([["AFG", 7.8], ["DEU", 2.0]]),
    new Map([["AFG", -2.0], ["DEU", 0.6], ["BRB", 1.28]]),
  );
  expect(s.get("AFG")).toBeCloseTo(((7.8 - 2) / 6 + 1) / 2);
  expect(s.get("DEU")).toBe(0);
  expect(s.get("BRB")).toBe(0); // WGI only, stable
  expect(structuralBaseline(null, null).size).toBe(0);
});

test("IODA: counts only CRITICAL country alerts", () => {
  const live = iodaCriticalAlertsByIso3(json("ioda-alerts-country.json"));
  expect(live.size).toBeGreaterThan(10);
  expect(live.get("SSD")).toBe(2); // South Sudan: two critical alerts in the capture
  expect(live.has("NER")).toBe(false); // Niger: "normal" only
  expect(iodaCriticalAlertsByIso3({}).size).toBe(0);
});
