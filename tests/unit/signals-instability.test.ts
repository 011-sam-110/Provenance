import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { aggregateGdeltByCountry, parseGdeltExport, GDELT_LAYERS } from "@/lib/signals/gdelt";
import {
  computeInstability,
  normalizeFactor,
  instabilityColor,
  mergeFactors,
  factorLabel,
  iso3FromGdeltPlace,
  conflictArticlesByIso3,
  foodFromFewsNet,
  displacementShare,
  FACTOR_WEIGHTS,
  DISPLACEMENT_FLOOR,
  type CountryInput,
  type FactorKey,
} from "@/lib/signals/instability";

// A country every factor measured, at roughly Syria's levels on 2026-10-16's inputs.
const FULL: CountryInput = {
  iso3: "SYR",
  factors: {
    conflict: 130, // UCDP deaths, ~60 days
    severity: 8.4, // INFORM Severity
    food: 0.225, // FEWS NET: 20-25 % in IPC 3+
    structural: 0.8, // INFORM Risk + WGI
    displacement: 0.35, // displaced-from share of population
    attention: 120, // GDELT articles
    outages: 1, // critical IODA alerts
  },
};

test("scores a fully measured country and shows its work", () => {
  const [f] = computeInstability([FULL]);
  expect(f.id).toBe("cii:SYR");
  expect(f.signalId).toBe("instability");
  // conflict 0.30*0.37 + severity 0.25*0.84 + food 0.15*0.45 + structural 0.15*0.8
  // + displacement 0.10*1 + attention 0.03*0.46 + outages 0.02*0.25 = 0.63
  expect(f.props?.score).toBe(63);
  expect(f.color).toBe(instabilityColor(63));
  expect(f.props?.coverage).toBe("7/7 factors");
  expect(f.props?.scoreBasis).toBe("measured");
  expect(f.props?.coverageFactors).toBe(7);
  expect(f.title).toBe("Syrian Arab Republic — instability 63/100");
  // Drivers are ordered by weighted contribution.
  expect(String(f.props?.drivers).split(" › ")[0]).toBe("crisis severity (INFORM)");
  expect(f.props?.["food insecurity"]).toBe("45%");
});

test("a factor with no data pulls the score down and makes it a FLOOR; a measured zero does not", () => {
  // Measured by every global upstream, with nothing on most of them.
  const zeros: CountryInput = { iso3: "SDN", factors: { conflict: 0, severity: 0, attention: 0, outages: 0, food: 0.475 } };
  const [f] = computeInstability([zeros]);
  // food 0.95 * 0.15 = 0.1425 → 14. Five factors measured, two (structural,
  // displacement) missing → floor.
  expect(f.props?.score).toBe(14);
  expect(f.props?.coverageFactors).toBe(5);
  expect(f.props?.scoreBasis).toBe("floor");
  expect(f.props?.coverage).toBe("5/7 factors — floor, not a full measurement (missing factors count as 0)");
  expect(f.title).toContain("≥14/100");
  expect(f.title).toContain("floor, 5/7 factors");
  // The zeros are measurements: they count toward coverage but add no driver.
  expect(String(f.props?.drivers)).toBe("food insecurity");
});

test("zero coverage, or only zeros, produces no feature — never a fabricated score", () => {
  expect(computeInstability([{ iso3: "SYR", factors: {} }])).toHaveLength(0);
  expect(computeInstability([{ iso3: "SYR", factors: { conflict: 0, severity: 0 } }])).toHaveLength(0);
});

test("drops below-threshold countries and unknown ISO codes", () => {
  const out = computeInstability([
    { iso3: "DEU", factors: { structural: 0.1 } }, // 0.015 → 2 → below CII_MIN_SCORE
    { iso3: "XXX", factors: { conflict: 99999 } }, // no centroid → skipped
  ]);
  expect(out).toHaveLength(0);
});

test("output is sorted by score, densest pressure first", () => {
  const out = computeInstability([{ iso3: "SDN", factors: { food: 0.475 } }, FULL]);
  expect(out.map((f) => f.id)).toEqual(["cii:SYR", "cii:SDN"]);
});

test("factor ramps are as documented; weights sum to 1", () => {
  expect(Object.values(FACTOR_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  expect(normalizeFactor("conflict", 9)).toBe(0); // under 10 deaths: noise, not war
  expect(normalizeFactor("conflict", 99)).toBeCloseTo(1 / 3);
  expect(normalizeFactor("conflict", 9999)).toBeCloseTo(1);
  expect(normalizeFactor("severity", 9.2)).toBeCloseTo(0.92);
  expect(normalizeFactor("food", 0.5)).toBeCloseTo(1);
  expect(normalizeFactor("food", 1)).toBe(1); // clamped
  expect(normalizeFactor("structural", 0.4)).toBeCloseTo(0.4);
  expect(normalizeFactor("displacement", 0.05)).toBeCloseTo(0.5);
  expect(normalizeFactor("displacement", 0.5)).toBe(1);
  expect(normalizeFactor("outages", 2)).toBeCloseTo(0.5);
  expect(normalizeFactor("outages", 40)).toBe(1);
  for (const k of Object.keys(FACTOR_WEIGHTS) as FactorKey[]) expect(normalizeFactor(k, 0)).toBe(0);
  expect(instabilityColor(90)).toBe("#7f1d1d");
  expect(instabilityColor(35)).toBe("#f59e0b");
  expect(instabilityColor(5)).toBe("#84cc16");
});

test("press coverage is capped, so article volume alone can never claim 'extreme'", () => {
  expect(normalizeFactor("attention", 1_000_000)).toBeCloseTo(0.55);
  expect(normalizeFactor("attention", 178)).toBeGreaterThan(0);
  expect(normalizeFactor("attention", 178)).toBeLessThan(normalizeFactor("attention", 17_800));
  // Every factor at its maximum: 1 - 0.03 * 0.45 = 0.9865 → 99. Pinned so that a change
  // to the cap or the weights moves the top of the scale on purpose, not by accident.
  const out = computeInstability([
    {
      iso3: "SYR",
      factors: { conflict: 1e9, severity: 10, food: 1, structural: 1, displacement: 1, attention: 1e9, outages: 99 },
    },
  ]);
  expect(out[0].props?.score).toBe(99);
  expect(out[0].props?.scoreBasis).toBe("measured");
});

test("the 2026-10-16 inversion cannot recur: an outage blip and a small diaspora do not outrank a war", () => {
  // Barbados ranked 21 above Russia 19 and Israel 18 on the old index: IODA's summary
  // score and a log ramp on head counts. Same shape on the new ramps.
  const out = computeInstability(
    mergeFactors([
      { key: "conflict", values: new Map([["RUS", 54], ["ISR", 102]]), global: true },
      { key: "outages", values: new Map([["BRB", 1]]), global: true },
      { key: "displacement", values: displacementShare(new Map([["BRB", 300]]), new Map([["BRB", 280_000], ["RUS", 1.4e8], ["ISR", 1e7]])) },
      { key: "structural", values: new Map([["RUS", 0.6], ["ISR", 0.55], ["BRB", 0.05]]) },
    ]),
  );
  const rank = out.map((f) => f.countryIso3);
  expect(rank.indexOf("BRB")).toBe(-1); // below the noise floor now
  expect(rank).toContain("RUS");
  expect(rank).toContain("ISR");
});

test("mergeFactors keys per-factor maps by ISO-3 and gives global upstreams a measured zero", () => {
  const inputs = mergeFactors([
    { key: "food", values: new Map([["SYR", 0.45], ["USA", 0.05]]) },
    { key: "conflict", values: new Map([["SYR", 1000]]), global: true },
  ]);
  const syr = inputs.find((i) => i.iso3 === "SYR")!;
  expect(syr.factors).toEqual({ food: 0.45, conflict: 1000 });
  // UCDP measures every country: no row for the US is "0 deaths", not "unknown".
  expect(inputs.find((i) => i.iso3 === "USA")!.factors).toEqual({ food: 0.05, conflict: 0 });
});

test("displacement is a share of population, from 10,000 people up", () => {
  const share = displacementShare(
    new Map([["UKR", 9_000_000], ["DEU", 4_000], ["SYR", 13_000_000]]),
    new Map([["UKR", 37_000_000], ["DEU", 84_000_000], ["SYR", 23_000_000], ["FRA", 68_000_000]]),
  );
  expect(share.get("UKR")).toBeCloseTo(9 / 37);
  expect(share.get("DEU")).toBe(0); // under DISPLACEMENT_FLOOR: a measured zero
  expect(DISPLACEMENT_FLOOR).toBe(10_000);
  expect(share.get("FRA")).toBe(0); // no UNHCR row: none displaced from France
  expect(share.has("PSE")).toBe(false); // no population figure, no value
});

test("factorLabel names each source, and the GDELT term as article volume", () => {
  expect(factorLabel("conflict")).toBe("armed conflict (UCDP fatalities)");
  expect(factorLabel("attention")).toBe("conflict coverage (GDELT article volume)");
  expect(factorLabel("food")).toBe("food insecurity");
  expect(factorLabel("displacement")).toBe("displacement");
  // No label claims a bare "armed conflict": a reader must see where the number comes from.
  for (const k of Object.keys(FACTOR_WEIGHTS) as FactorKey[]) expect(factorLabel(k)).not.toBe("armed conflict");
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

// --- attention factor reads the REAL conflict-layer shape ---------------------

test("the GDELT attention factor reads countryIso3 from the conflict layer's real per-country output", () => {
  // Regression: since the conflict layer went per-country (PR #96) its features carry
  // `countryIso3` + `props.country` and no `props.place`. The factor read `place` only, so
  // it resolved nothing and fed 0 of 172 rows on prod (2026-10-16). Feed it the output of
  // the real aggregator, not a synthetic `place` string, so the shape cannot drift again.
  const tsv = readFileSync(join(process.cwd(), "tests/fixtures/gdelt-events.export.tsv"), "utf8");
  const feats = aggregateGdeltByCountry(parseGdeltExport(tsv), GDELT_LAYERS.conflict);
  expect(feats.length).toBeGreaterThan(0);
  expect(feats.every((f) => f.props?.place === undefined)).toBe(true);
  const byIso = conflictArticlesByIso3(feats);
  const withIso = feats.filter((f) => typeof f.countryIso3 === "string");
  expect(withIso.length).toBeGreaterThan(0);
  expect(byIso.size).toBeGreaterThanOrEqual(withIso.length);
  for (const f of withIso) expect(byIso.get(f.countryIso3!)).toBeGreaterThan(0);
});

test("conflictArticlesByIso3 skips the dormant notice and falls back to the country name, then place", () => {
  const base = { lat: 0, lon: 0, title: "t", signalId: "conflict" };
  const byIso = conflictArticlesByIso3([
    { ...base, id: "a", countryIso3: "UKR", props: { articles: 10 } },
    { ...base, id: "b", props: { country: "Syria", articles: 5 } },
    { ...base, id: "c", props: { place: "Tripoli, Tarabulus, Libya", articles: 3 } },
    { ...base, id: "d", props: { status: "unavailable", articles: 99 } },
  ]);
  expect(Object.fromEntries(byIso)).toEqual({ UKR: 10, SYR: 5, LBY: 3 });
});

// --- food factor: FEWS NET IPC population (replaced WFP HungerMap, which 401s) ----

test("foodFromFewsNet reads the newest Current Situation share of IPC 3+ per country", () => {
  const rows = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/fewsnet-ipc-population.json"), "utf8"));
  const food = foodFromFewsNet(rows);
  // Captured 2026-10-16: Sudan 45-50 % (Sept CS), South Sudan 60-65 %, Yemen 50-55 %.
  expect(food.get("SDN")).toBeCloseTo(0.475);
  expect(food.get("SSD")).toBeCloseTo(0.625);
  expect(food.get("YEM")).toBeCloseTo(0.525);
  expect(food.size).toBeGreaterThanOrEqual(30);
  for (const v of food.values()) {
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThanOrEqual(1);
  }
});

test("foodFromFewsNet skips projections, missing bands and unknown codes, and keeps the newest month", () => {
  const food = foodFromFewsNet([
    { country_code: "SD", phase: "3+", scenario: "CS", reporting_date: "2026-08-01", pct_population_min: 10, pct_population_max: 20 },
    { country_code: "SD", phase: "3+", scenario: "CS", reporting_date: "2026-09-01", pct_population_min: 40, pct_population_max: 50 },
    { country_code: "SD", phase: "3+", scenario: "CS", reporting_date: "2026-07-01", pct_population_min: 90, pct_population_max: 99 },
    { country_code: "YE", phase: "3+", scenario: "ML", reporting_date: "2026-09-01", pct_population_min: 50, pct_population_max: 55 },
    { country_code: "SO", phase: "3+", scenario: "CS", reporting_date: "2026-09-01", pct_population_min: null, pct_population_max: null },
    { country_code: "ZZ", phase: "3+", scenario: "CS", reporting_date: "2026-09-01", pct_population_min: 5, pct_population_max: 10 },
  ]);
  expect(Object.fromEntries(food)).toEqual({ SDN: 0.45 });
  expect(foodFromFewsNet(null as unknown as [])).toEqual(new Map());
});
