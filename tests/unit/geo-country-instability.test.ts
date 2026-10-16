import { expect, test } from "vitest";
import { computeInstability, type CountryInput } from "@/lib/signals/instability";
import {
  featureIso3,
  findInstabilityFeature,
  deriveInstabilityView,
  resolveCountryInstability,
} from "@/lib/geo/countryInstability";
import type { SignalFeature } from "@/lib/signals/types";

// A real CII feature, produced by the actual source, so the test is pinned to the
// exact prop shape INSTABILITY_SOURCE emits (id `cii:<ISO3>`, props.score/drivers
// + spread per-factor breakdown + coverage).
const SYR_INPUT: CountryInput = {
  iso3: "SYR",
  factors: { conflict: 130, severity: 8.4, food: 0.225, structural: 0.8, displacement: 0.35, attention: 120, outages: 1 },
};
const [syr] = computeInstability([SYR_INPUT]);
// The CII source names countries from the centroid set ("Syrian Arab Republic"),
// which need NOT equal Natural Earth's clicked-polygon label ("Syria") — exactly
// why iso3-first matching matters and the name path is only a fallback.
const syrName = String(syr.props?.country);

test("featureIso3 extracts the ISO-3 from a cii:<ISO3> id", () => {
  expect(featureIso3(syr)).toBe("SYR");
  expect(featureIso3({ ...syr, id: "usgs:nc123" })).toBeNull();
  expect(featureIso3({ ...syr, id: "" })).toBeNull();
});

test("matches by iso3 (case-insensitive), regardless of label", () => {
  const found = findInstabilityFeature([syr], "syr", "Totally Different Name");
  expect(found?.id).toBe("cii:SYR");
});

test("falls back to props.country === label when iso3 is absent/unknown", () => {
  const byName = findInstabilityFeature([syr], undefined, syrName);
  expect(byName?.id).toBe("cii:SYR");
  const byNameCase = findInstabilityFeature([syr], "ZZZ", `  ${syrName.toLowerCase()}  `);
  expect(byNameCase?.id).toBe("cii:SYR");
});

test("returns null when the country is below threshold (no matching feature)", () => {
  // Germany is dropped by computeInstability (below CII_MIN_SCORE), so the feed
  // simply doesn't contain it.
  expect(findInstabilityFeature([syr], "DEU", "Germany")).toBeNull();
  expect(findInstabilityFeature([], "SYR", "Syria")).toBeNull();
});

test("deriveInstabilityView exposes score, ordered drivers and factor breakdown", () => {
  const view = deriveInstabilityView(syr);
  expect(view.score).toBe(Number(syr.props?.score));
  expect(view.color).toBe(syr.color);
  expect(view.coverage).toBe("7/7 factors");
  // Drivers ordered by weighted CONTRIBUTION, not by weight. Conflict holds the largest
  // weight (0.30) but 130 deaths ramp to 0.37 (0.112), so crisis severity (0.25 x 0.84 =
  // 0.21) leads.
  expect(view.drivers[0]).toBe("crisis severity (INFORM)");
  // Breakdown mirrors the drivers ordering and parses the "NN%" values.
  expect(view.factors[0].label).toBe("crisis severity (INFORM)");
  expect(view.factors.map((f) => f.label).sort()).toEqual([
    "armed conflict (UCDP fatalities)",
    "conflict coverage (GDELT article volume)",
    "crisis severity (INFORM)",
    "displacement",
    "food insecurity",
    "internet outages",
    "structural risk (INFORM Risk, WGI)",
  ]);
  const food = view.factors.find((f) => f.label === "food insecurity")!;
  expect(food.value).toBe("45%");
  expect(food.pct).toBe(45);
  // Reserved keys never leak into the breakdown.
  expect(view.factors.some((f) => ["country", "score", "coverage"].includes(f.label))).toBe(false);
});

test("resolveCountryInstability: scored when a feature matches", () => {
  const state = resolveCountryInstability([syr], "idle", "SYR", "Syria");
  expect(state.kind).toBe("scored");
  if (state.kind === "scored") expect(state.view.score).toBe(Number(syr.props?.score));
});

test("resolveCountryInstability: below-threshold when feed has data but no match", () => {
  expect(resolveCountryInstability([syr], "idle", "DEU", "Germany").kind).toBe("below");
});

test("resolveCountryInstability: honest empty vs loading vs error when nothing matches", () => {
  // Feed returned nothing and we're still fetching → loading.
  expect(resolveCountryInstability([], "loading", "SYR", "Syria").kind).toBe("loading");
  // Feed settled empty (dormant inputs) → empty, NOT a fake "Stable".
  expect(resolveCountryInstability([], "idle", "SYR", "Syria").kind).toBe("empty");
  // Fetch failed with no cached match → error.
  expect(resolveCountryInstability([], "error", "SYR", "Syria").kind).toBe("error");
});

test("resolveCountryInstability: a match wins even during a background refresh", () => {
  const nonMatch: SignalFeature = { ...syr, id: "cii:SDN", props: { ...syr.props, country: "Sudan" } };
  const state = resolveCountryInstability([syr, nonMatch], "loading", "SYR", "Syria");
  expect(state.kind).toBe("scored");
});
