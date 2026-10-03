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
