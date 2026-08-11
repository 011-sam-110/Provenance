import { expect, test } from "vitest";
import {
  computeInstability,
  normalizeFactor,
  instabilityColor,
  mergeFactors,
  factorLabel,
  iso3FromGdeltPlace,
  FACTOR_WEIGHTS,
  type CountryInput,
} from "@/lib/signals/instability";

test("scores a multi-factor country and shows its work", () => {
  const inputs: CountryInput[] = [
    { iso3: "SYR", factors: { conflict: 1000, food: 0.45, displacement: 6_000_000, outages: 50_000 } },
  ];
  const out = computeInstability(inputs);
  expect(out).toHaveLength(1);
  const f = out[0];
  expect(f.id).toBe("cii:SYR");
  expect(f.signalId).toBe("instability");
  expect(f.props?.score).toBe(95); // weighted composite over the full weight set
  expect(f.color).toBe(instabilityColor(95)); // extreme → dark red
  // Full coverage: a real measurement, not a floor.
  expect(f.props?.coverage).toBe("4/4 factors");
  expect(f.props?.scoreBasis).toBe("measured");
  expect(f.props?.coverageFactors).toBe(4);
  expect(f.title).toBe("Syrian Arab Republic — instability 95/100");
  // Drivers ordered by weighted contribution — conflict (w=0.40) leads.
  expect(String(f.props?.drivers).startsWith("armed conflict")).toBe(true);
  // The breakdown exposes each factor's normalised sub-score.
  expect(f.props?.["food insecurity"]).toBe("90%");
});

test("missing factors pull the score down (conservative), not renormalised away — and the result is labelled a FLOOR", () => {
  // Food only, 30% prevalence → norm 0.6 → 0.6*0.25 = 0.15 → score 15 (NOT 60).
  const out = computeInstability([{ iso3: "SDN", factors: { food: 0.3 } }]);
  expect(out).toHaveLength(1);
  const f = out[0];
  expect(f.props?.score).toBe(15);
  // Partial coverage: the exact same arithmetic is now presented as a floor,
  // not a measurement — every surface says so.
  expect(f.props?.coverage).toBe("1/4 factors — floor, not a full measurement (missing factors count as 0)");
  expect(f.props?.scoreBasis).toBe("floor");
  expect(f.props?.coverageFactors).toBe(1);
  expect(f.title).toContain("≥15/100");
  expect(f.title).toContain("floor, 1/4 factors");
});

test("zero coverage produces no feature at all — never a fabricated score", () => {
  const out = computeInstability([{ iso3: "SYR", factors: {} }]);
  expect(out).toHaveLength(0);
});

test("drops below-threshold countries and unknown ISO codes", () => {
  const out = computeInstability([
    { iso3: "DEU", factors: { food: 0.1 } }, // norm 0.2 → score 5 → below CII_MIN_SCORE
    { iso3: "XXX", factors: { conflict: 999 } }, // no centroid → skipped
  ]);
  expect(out).toHaveLength(0);
});

test("output is sorted by score, densest pressure first", () => {
  const out = computeInstability([
    { iso3: "SDN", factors: { food: 0.3 } }, // score 15
    { iso3: "SYR", factors: { conflict: 1000, food: 0.45, displacement: 6_000_000, outages: 50_000 } }, // 95
  ]);
  expect(out.map((f) => f.id)).toEqual(["cii:SYR", "cii:SDN"]);
});

test("factor normalisers ramp as documented; weights sum to 1", () => {
  expect(Object.values(FACTOR_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  expect(normalizeFactor("food", 0.5)).toBeCloseTo(1);
  expect(normalizeFactor("food", 1)).toBe(1); // clamped
  expect(normalizeFactor("food", 0)).toBe(0);
  expect(normalizeFactor("outages", 1_000_000)).toBeCloseTo(1);
  expect(normalizeFactor("conflict", 1000)).toBeCloseTo(1); // defaults to the ACLED ramp
  expect(instabilityColor(90)).toBe("#7f1d1d");
  expect(instabilityColor(35)).toBe("#f59e0b");
  expect(instabilityColor(5)).toBe("#84cc16");
});

test("mergeFactors keys per-factor maps by ISO-3", () => {
  const inputs = mergeFactors([
    { key: "food", values: new Map([["SYR", 0.45], ["USA", 0.05]]) },
    { key: "conflict", values: new Map([["SYR", 1000]]) },
  ]);
  const syr = inputs.find((i) => i.iso3 === "SYR")!;
  expect(syr.factors.food).toBe(0.45);
  expect(syr.factors.conflict).toBe(1000);
  const usa = inputs.find((i) => i.iso3 === "USA")!;
  expect(usa.factors).toEqual({ food: 0.05 });
});

// --- GDELT conflict fallback -------------------------------------------------

test("GDELT conflict ramp is looser and hard-capped below the ACLED ceiling", () => {
  // Same raw magnitude scores lower under the GDELT proxy than under ACLED.
  expect(normalizeFactor("conflict", 1000, "gdelt")).toBeLessThan(normalizeFactor("conflict", 1000, "acled"));
  // No volume of articles can push the GDELT proxy to the ACLED ceiling (1.0).
  expect(normalizeFactor("conflict", 1_000_000, "gdelt")).toBeCloseTo(0.55);
  expect(normalizeFactor("conflict", 1_000_000, "gdelt")).toBeLessThan(1);
});

test("mergeFactors tags the conflict factor with its source; default is acled", () => {
  const viaGdelt = mergeFactors([{ key: "conflict", values: new Map([["UKR", 178]]) }], "gdelt");
  expect(viaGdelt.find((i) => i.iso3 === "UKR")?.conflictSource).toBe("gdelt");

  const viaAcled = mergeFactors([{ key: "conflict", values: new Map([["UKR", 178]]) }], "acled");
  expect(viaAcled.find((i) => i.iso3 === "UKR")?.conflictSource).toBe("acled");

  const untagged = mergeFactors([{ key: "conflict", values: new Map([["UKR", 178]]) }]);
  expect(untagged.find((i) => i.iso3 === "UKR")?.conflictSource).toBe("acled"); // default
});

test("computeInstability labels the GDELT-sourced conflict factor honestly in the breakdown", () => {
  const inputs: CountryInput[] = [{ iso3: "UKR", factors: { conflict: 178 }, conflictSource: "gdelt" }];
  const out = computeInstability(inputs);
  expect(out).toHaveLength(1);
  const props = out[0].props ?? {};
  expect(String(props.drivers)).toContain("armed conflict (GDELT article-volume proxy)");
  expect(props["armed conflict (GDELT article-volume proxy)"]).toBeDefined();
  // Never silently relabelled as the stronger ACLED signal.
  expect(props["armed conflict"]).toBeUndefined();
});

test("computeInstability keeps the plain ACLED label when conflictSource is acled or omitted", () => {
  const out = computeInstability([{ iso3: "SYR", factors: { conflict: 1000 }, conflictSource: "acled" }]);
  expect(String(out[0].props?.drivers)).toBe("armed conflict");
  expect(out[0].props?.["armed conflict"]).toBeDefined();
});

test("factorLabel names the GDELT proxy explicitly and leaves every other factor untouched", () => {
  expect(factorLabel("conflict", "gdelt")).toBe("armed conflict (GDELT article-volume proxy)");
  expect(factorLabel("conflict", "acled")).toBe("armed conflict");
  expect(factorLabel("conflict")).toBe("armed conflict"); // default
  expect(factorLabel("food")).toBe("food insecurity");
});

// --- GDELT place → ISO-3 matching --------------------------------------------

test("iso3FromGdeltPlace reads the trailing country segment of a City, ADM1, Country place", () => {
  expect(iso3FromGdeltPlace("Kyiv, Kyyiv, Misto, Ukraine")).toBe("UKR");
  expect(iso3FromGdeltPlace("Damascus, Dimashq, Syria")).toBe("SYR");
  expect(iso3FromGdeltPlace("Iran")).toBe("IRN"); // bare country, no comma
});

test("iso3FromGdeltPlace resolves GDELT gazetteer spellings that don't match the centroid dataset", () => {
  expect(iso3FromGdeltPlace("Tripoli, Tarabulus, Libya")).toBe("LBY");
  expect(iso3FromGdeltPlace("Tianmu, T'ai-pei, Taiwan")).toBe("TWN");
  expect(iso3FromGdeltPlace("Nablus, West Bank (general), West Bank")).toBe("PSE");
  expect(iso3FromGdeltPlace("Black Sea, Oceans (general), Oceans")).toBeUndefined(); // not a country
  expect(iso3FromGdeltPlace("")).toBeUndefined();
});

test("iso3FromGdeltPlace handles official long-forms with an embedded comma via the multi-token suffix", () => {
  // GDELT's historical GNS entry for former South Vietnam.
  expect(iso3FromGdeltPlace("Ho Chi Minh City, H? Ch?inh, Vietnam, Republic Of")).toBe("VNM");
  // The centroid dataset's own name for South Korea already has a comma in it.
  expect(iso3FromGdeltPlace("Seoul, Seoul, Korea, Republic of")).toBe("KOR");
});
