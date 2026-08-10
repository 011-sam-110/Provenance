import { expect, test } from "vitest";
// Live-captured IODA country-summary rows + one unknown-country edge row.
import fixture from "@/tests/fixtures/ioda-outages.json";
import { normalizeOutages, INTERNET_OUTAGES_SOURCE } from "@/lib/signals/internet-outages";
import { rowMetric } from "@/lib/console/signals/signalCard";

test("normalizes IODA outages to one marker per located country", () => {
  const out = normalizeOutages(fixture as never);
  // BZ, GI, LR resolve to centroids; the "ZZ" edge row has no centroid and is skipped.
  expect(out).toHaveLength(3);
  expect(new Set(out.map((f) => f.signalId))).toEqual(new Set(["internet-outages"]));
  expect(out.every((f) => f.id.startsWith("ioda:"))).toBe(true);
});

test("severity bands and magnitude scale with the outage score", () => {
  const out = normalizeOutages(fixture as never);
  // The fixture is a June capture whose worst outage was 3.8e5. On the scale IODA
  // emits today that is a MINOR event — the live feed on 2026-08-10 topped out at
  // 5.8e10, with the second-worst country at 2.9e4. The bands are log-based for
  // exactly that reason; this assertion changed because the world did, not to make
  // the test pass.
  const belize = out.find((f) => f.id === "ioda:BZ")!; // score ~377k
  expect(belize.props?.severity).toBe("localised");
  expect(belize.title).toContain("Belize");

  const liberia = out.find((f) => f.id === "ioda:LR")!; // score 1500 → localised
  expect(liberia.props?.severity).toBe("localised");

  // Bigger outage → bigger marker.
  expect(Number(belize.props?.magnitude)).toBeGreaterThan(Number(liberia.props?.magnitude));
  expect(Number(belize.props?.magnitude)).toBeLessThanOrEqual(10);
});

test("declares a readable metric and rowMetric resolves it", () => {
  const out = normalizeOutages(fixture as never);
  const belize = out.find((f) => f.id === "ioda:BZ")!;

  // The metric points at a real finite numeric prop. It USED to point at the raw
  // upstream score, which is unitless and unbounded — see the block at the bottom.
  // The raw score is still carried in props for the dossier.
  expect(INTERNET_OUTAGES_SOURCE.metric).toEqual({ field: "magnitude", domain: [0, 10] });
  expect(typeof belize.props?.outageScore).toBe("number");
  expect(Number.isFinite(belize.props?.outageScore as number)).toBe(true);

  const resolved = rowMetric(belize, INTERNET_OUTAGES_SOURCE.metric);
  expect(resolved).toBeDefined();
  expect(resolved!.value).toBe(Number(belize.props?.magnitude));
  expect(resolved!.value).toBeGreaterThanOrEqual(0);
  expect(resolved!.value).toBeLessThanOrEqual(10);
  expect(resolved!.domain).toEqual([0, 10]);
});

// ---------------------------------------------------------------------------
// The metric drives the monitor bar AND the number the anomaly widget prints, so
// it has to be readable. It was `outageScore` — unitless, unbounded, with live
// values around 5.7e10 against a declared ceiling of 100,000. The first row of
// the flagship "What's abnormal" widget read
// "Internet outages (IODA) · 56780505874", and three separate auditors flagged it
// independently.
// ---------------------------------------------------------------------------
import { describe as describeM, it as itM, expect as expectM } from "vitest";
import { outageBand, outageMagnitude } from "@/lib/signals/internet-outages";

describeM("what the widget prints", () => {
  itM("declares a metric a person can read, not the raw upstream score", () => {
    expectM(INTERNET_OUTAGES_SOURCE.metric?.field).toBe("magnitude");
    expectM(INTERNET_OUTAGES_SOURCE.metric?.domain).toEqual([0, 10]);
  });

  itM("keeps the magnitude inside its declared domain at real-world scores", () => {
    // Measured live on 2026-08-10: Côte d'Ivoire 57,727,616,804.
    for (const score of [0, 1, 5_000, 100_000, 57_727_616_804, Number.MAX_SAFE_INTEGER]) {
      const m = outageMagnitude(score);
      expectM(m, `score ${score}`).toBeGreaterThanOrEqual(0);
      expectM(m, `score ${score}`).toBeLessThanOrEqual(10);
    }
  });

  itM("keeps the ordering the raw score had", () => {
    expectM(outageMagnitude(1e10)).toBeGreaterThan(outageMagnitude(1e7));
    expectM(outageMagnitude(1e7)).toBeGreaterThan(outageMagnitude(1e3));
  });

  itM("bands against the scale the upstream actually emits", () => {
    expectM(outageBand(57_727_616_804)).toBe("severe");
    expectM(outageBand(5e7)).toBe("elevated");
    expectM(outageBand(1_000)).toBe("localised");
  });
});
