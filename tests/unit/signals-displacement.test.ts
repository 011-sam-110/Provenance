import { afterEach, expect, test, vi } from "vitest";
import fixture from "@/tests/fixtures/unhcr-displacement.json";
import { normalizeDisplacement, displacementColor, sourceAtForYear, DISPLACEMENT_SOURCE } from "@/lib/signals/displacement";
import { centroidByIso3 } from "@/lib/signals/country-centroids.data";
import { rowLabel, rowMetric } from "@/lib/console/signals/signalCard";
import { readOutcome } from "@/lib/signals/outcome";

test("normalizes UNHCR displacement by country of asylum, skipping non-country rows", () => {
  const out = normalizeDisplacement(fixture as never);
  expect(out).toHaveLength(6); // AFG, BGD, CYP, GBR, ISL, KEN — the "ZZZ" row has no centroid
  expect(new Set(out.map((f) => f.signalId))).toEqual(new Set(["displacement"]));

  const afg = out.find((f) => f.id === "displacement:AFG")!;
  // refugees 20,866 + asylum 370 + idps 3,199,710 = 3,220,946
  expect(afg.props?.totalDisplaced).toBe((3_220_946).toLocaleString());
  expect(afg.props?.refugees).toBe((20_866).toLocaleString());
  expect(afg.props?.crisis).toBe("over 1M");
  expect(afg.color).toBe(displacementColor(3_220_946));
  expect(afg.ts).toBeUndefined(); // annual snapshot

  // Sits at the country centroid (ISO-3 lookup).
  const ctr = centroidByIso3("AFG")!;
  expect(afg.lat).toBe(ctr.lat);
});

test("string/int UNHCR fields coerce; zero-total countries are dropped", () => {
  const rows = [
    { coa_iso: "ISL", refugees: "7879", asylum_seekers: 1081, idps: "0", stateless: 31, year: 2024 },
    { coa_iso: "FRA", refugees: "0", asylum_seekers: "0", idps: "0", stateless: "0", year: 2024 },
  ];
  const out = normalizeDisplacement(rows as never);
  expect(out).toHaveLength(1); // France totals zero → dropped
  expect(out[0].id).toBe("displacement:ISL");
  expect(out[0].props?.crisis).toBeUndefined(); // 8,960 < 500K
});

test("declares a real numeric displaced-count metric that rowMetric resolves", () => {
  const out = normalizeDisplacement(fixture as never);
  const afg = out.find((f) => f.id === "displacement:AFG")!;
  // Sibling numeric prop is a finite number (not the formatted display string).
  expect(afg.props?.displacedCount).toBe(3_220_946);
  expect(Number.isFinite(afg.props?.displacedCount as number)).toBe(true);

  expect(DISPLACEMENT_SOURCE.metric).toEqual({ field: "displacedCount", domain: [0, 5_000_000] });
  const m = rowMetric(afg, DISPLACEMENT_SOURCE.metric);
  // Grouped. An ungrouped "3220946" sat beside a title that had already written
  // the same number as "3,220,946" — one row, one number, two spellings.
  expect(m).toEqual({ value: 3_220_946, domain: [0, 5_000_000], label: "3,220,946" });
});

// UNHCR counts by COUNTRY OF ASYLUM: the people a country hosts (refugees, asylum-seekers)
// plus its own internally displaced. On prod (2026-09-12) the United States read
// "United States — 4,176,592 displaced" — 3,718,945 asylum-seekers + 457,647 refugees +
// 0 IDPs — which reads as four million displaced Americans. The text has to say WHERE the
// people are, not whose they are.
test("the title places the displaced in the country, and the card row keeps only the place", () => {
  const out = normalizeDisplacement(fixture as never);
  const afg = out.find((f) => f.id === "displacement:AFG")!;
  expect(afg.title).toBe(`In Afghanistan — ${(3_220_946).toLocaleString()} displaced`);
  expect(rowLabel(afg.title, rowMetric(afg, DISPLACEMENT_SOURCE.metric))).toBe("In Afghanistan");
});

test("displacement colour ramps by total", () => {
  expect(displacementColor(2_500_000)).toBe("#7f1d1d");
  expect(displacementColor(1_200_000)).toBe("#b91c1c");
  expect(displacementColor(300_000)).toBe("#ea580c");
  expect(displacementColor(60_000)).toBe("#f59e0b");
  expect(displacementColor(1_000)).toBe("#fbbf24");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// THE ROOT of the "LIVE in green over a year-old number" finding: this source's
// refreshMs (a daily cache) only ever measured how recently WE read UNHCR, never
// how old their published statistics are. sourceAtForYear + fetch() wiring it
// through is what lets a freshness chip say "data from 2025" instead of staying
// silent about the gap between a five-second-old fetch and a year-old figure.
test("sourceAtForYear stamps the last instant of that year (UTC) — always in the past, never 'now'", () => {
  const at = sourceAtForYear(2025);
  expect(new Date(at).toISOString()).toBe("2025-12-31T23:59:59.999Z");
  expect(at).toBeLessThan(Date.now());
});

test("fetch() declares the queried year as sourceAt, distinct from the read instant", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ items: fixture }) })),
  );
  const rows = await DISPLACEMENT_SOURCE.fetch();
  const outcome = readOutcome(rows);
  const expectedYear = new Date().getUTCFullYear() - 1;
  expect(outcome?.sourceAt).toBe(sourceAtForYear(expectedYear));
  // The read instant is always later than the data's own year-end stamp — the two
  // clocks freshChip.ts exists to keep separate.
  expect(outcome?.at).toBeGreaterThan(outcome!.sourceAt!);
});

// --- 2026-10-16: oip, UNRWA and Eurostat -------------------------------------

import population2025 from "@/tests/fixtures/unhcr-population-2025.json";
import unrwa2025 from "@/tests/fixtures/unhcr-unrwa-2025.json";
import tpFixture from "@/tests/fixtures/eurostat-migr-asytpsm.json";
import ftFixture from "@/tests/fixtures/eurostat-migr-asyappctzm.json";
import { eurostatLatestByIso3, attachEurostat, UNHCR_ATTRIBUTION } from "@/lib/signals/displacement";

const ROWS = (population2025 as unknown as { items: never[] }).items;
const UNRWA = (unrwa2025 as unknown as { items: never[] }).items;

test("other people in need of international protection (oip) count in the total", () => {
  const col = normalizeDisplacement(ROWS).find((f) => f.id === "displacement:COL")!;
  // refugees 1,464 + asylum 17,421 + IDPs 7,157,716 + oip 2,810,778 (captured 2026-10-16)
  expect(col.props?.displacedCount).toBe(1_464 + 17_421 + 7_157_716 + 2_810_778);
  expect(col.props?.otherInNeedOfProtection).toBe((2_810_778).toLocaleString());
  // "-" is UNHCR's "none": the US row carries no oip prop and an unchanged total.
  const usa = normalizeDisplacement(ROWS).find((f) => f.id === "displacement:USA")!;
  expect(usa.props?.otherInNeedOfProtection).toBeUndefined();
  expect(usa.props?.displacedCount).toBe(457_647 + 3_718_945);
});

test("UNRWA refugees create the missing Palestine marker and add to Jordan, Lebanon and Syria", () => {
  const without = normalizeDisplacement(ROWS);
  expect(without.find((f) => f.id === "displacement:PSE")).toBeUndefined();
  const out = normalizeDisplacement(ROWS, 1000, UNRWA);
  const pse = out.find((f) => f.id === "displacement:PSE")!;
  expect(pse.countryIso3).toBe("PSE");
  expect(pse.props?.palestineRefugeesUnrwa).toBe((2_484_580).toLocaleString());
  expect(pse.props?.displacedCount).toBeGreaterThanOrEqual(2_484_580);
  const jor = out.find((f) => f.id === "displacement:JOR")!;
  const jorBefore = without.find((f) => f.id === "displacement:JOR")!;
  expect(Number(jor.props?.displacedCount) - Number(jorBefore.props?.displacedCount)).toBe(2_398_179);
  // UNRWA's "Unknown" row (495,764) has no country and makes no marker.
  expect(out.length).toBe(without.length + 1);
});

test("Eurostat JSON-stat decodes to the newest month per country, skipping the EU aggregate", () => {
  const tp = eurostatLatestByIso3(tpFixture);
  expect(tp.has("DEU")).toBe(true);
  expect(tp.has("POL")).toBe(true);
  expect(tp.has("GRC")).toBe(true); // Eurostat's EL
  expect([...tp.keys()].some((k) => k.startsWith("EU"))).toBe(false);
  for (const v of tp.values()) expect(v.month).toMatch(/^2026-0[789]$/);
  const ft = eurostatLatestByIso3(ftFixture);
  expect(ft.has("MNE")).toBe(true); // outside the EU, still placed
  expect(ft.has("GBR")).toBe(false); // "UK" is listed, but with no value in any of the 3 months
  // Newest month WITH a value: Germany has no September figure yet, so August.
  expect(tp.get("DEU")).toEqual({ value: 1_295_205, month: "2026-08" });
  expect(eurostatLatestByIso3(null).size).toBe(0);
  expect(eurostatLatestByIso3({ id: ["geo"], size: [1], value: {} }).size).toBe(0);
});

test("Eurostat figures ride on the markers as props and never change the UNHCR total", () => {
  const feats = normalizeDisplacement(ROWS);
  const before = feats.find((f) => f.id === "displacement:DEU")!.props?.displacedCount;
  attachEurostat(feats, eurostatLatestByIso3(tpFixture), eurostatLatestByIso3(ftFixture));
  const deu = feats.find((f) => f.id === "displacement:DEU")!;
  expect(deu.props?.displacedCount).toBe(before);
  expect(deu.props?.tempProtectionNow).toBeDefined();
  expect(String(deu.props?.tempProtectionMonth)).toMatch(/^2026-\d\d$/);
  expect(deu.props?.firstTimeAsylumApplicants).toBeDefined();
  // A country outside Eurostat gets nothing.
  expect(feats.find((f) => f.id === "displacement:COL")!.props?.tempProtectionNow).toBeUndefined();
});

test("attribution uses the wording UNHCR's dataset terms require", () => {
  expect(UNHCR_ATTRIBUTION).toContain("UNHCR Refugee Population Statistics Database");
  expect(UNHCR_ATTRIBUTION).toContain("terms-use-datasets");
});
