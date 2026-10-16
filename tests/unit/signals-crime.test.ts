import { expect, test } from "vitest";
import fixture from "@/tests/fixtures/uk-crime.json";
import { normalizeCrime, crimeCategory, crimeOutcome, capCrime, CRIME_CITIES } from "@/lib/signals/crime";
import { readCoverage } from "@/lib/signals/coverage";

test("normalizes data.police.uk rows, skipping the null-location record", () => {
  const out = normalizeCrime(fixture as never);
  expect(out).toHaveLength(9); // 10 rows, the last has location:null
  expect(new Set(out.map((f) => f.signalId))).toEqual(new Set(["crime"]));
  expect(out[0].id).toBe("ukpolice:134642993");
  // String "lat"/"lng" are coerced to numbers and placed on the map.
  expect(out[0].lat).toBeCloseTo(51.506236, 5);
  expect(out[0].lon).toBeCloseTo(-0.141322, 5);
  // Monthly aggregate → no real-time timestamp (the time-window filter won't hide it).
  expect(out[0].ts).toBeUndefined();
  expect(out[0].props?.month).toBe("2026-04");
});

test("maps categories to labels/colours and dedupes by crime id", () => {
  const robbery = normalizeCrime(fixture as never).find((f) => f.id === "ukpolice:134678224");
  expect(robbery?.props?.category).toBe("Robbery");
  expect(robbery?.color).toBe("#dc2626");

  // A duplicate id collapses to one feature.
  const dup = [...(fixture as never[]), (fixture as never[])[0]];
  expect(normalizeCrime(dup as never)).toHaveLength(9);
});

test("crimeCategory falls back gracefully for an unknown slug", () => {
  expect(crimeCategory("anti-social-behaviour").label).toBe("Anti-social behaviour");
  expect(crimeCategory("made-up-slug")).toEqual({ label: "made up slug", color: "#64748b" });
});

test("a null outcome is not 'under investigation', and anti-social behaviour says why it has none", () => {
  expect(crimeOutcome("anti-social-behaviour", null)).toBe(
    "No outcome recorded (anti-social behaviour has no outcomes in this dataset)",
  );
  expect(crimeOutcome("burglary", null)).toBe("No outcome recorded");
  expect(crimeOutcome("burglary", { category: "Under investigation" })).toBe("Under investigation");
});

test("the cap is shared by city, so one big city cannot fill the layer", () => {
  const rows = (prefix: number, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: prefix + i,
      category: "burglary",
      month: "2026-08",
      location: { latitude: "51.5", longitude: "-0.12", street: { name: `S${i}` } },
    }));
  const london = normalizeCrime(rows(1000, 40) as never, "London");
  const leeds = normalizeCrime(rows(2000, 5) as never, "Leeds");
  const bristol = normalizeCrime(rows(3000, 20) as never, "Bristol");
  const out = capCrime([...london, ...leeds, ...bristol], 20);
  const per = (c: string) => out.filter((f) => f.props?.city === c).length;
  // Leeds has only 5, so London and Bristol share the rest evenly.
  expect([per("London"), per("Leeds"), per("Bristol")]).toEqual([8, 5, 7]);
  expect(readCoverage(out)).toMatchObject({ returned: 20, available: 65, capped: true });
  expect(readCoverage(out)!.rule).toContain("not a ranking");
});

test("Manchester is not sampled: its city-centre query returns almost nothing", () => {
  expect(CRIME_CITIES.map((c) => c.name)).not.toContain("Manchester");
  expect(CRIME_CITIES.length).toBeGreaterThanOrEqual(10);
});
