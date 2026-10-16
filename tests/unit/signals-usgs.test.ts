import { expect, test } from "vitest";
import fixture from "@/tests/fixtures/usgs-quakes.json";
import { normalizeUsgs, magnitudeColor, isUsgsEarthquake, USGS_COVERAGE_RULE } from "@/lib/signals/usgs";
import { readCoverage } from "@/lib/signals/coverage";

test("normalizes USGS quakes, skipping null-geometry, bad-coords and id-less ones", () => {
  const out = normalizeUsgs(fixture as never);
  expect(out).toHaveLength(2); // nullgeom + badcoords + empty-id skipped
  expect(out.map((f) => f.signalId)).toEqual(["earthquakes", "earthquakes"]);
});

test("maps magnitude, depth (coords[2]), place, time and a magnitude colour", () => {
  const [a, b] = normalizeUsgs(fixture as never);
  expect(a.id).toBe("usgs:nc75385091");
  expect(a.lat).toBeCloseTo(39.3005, 3);
  expect(a.lon).toBeCloseTo(-123.231, 3);
  expect(a.props?.magnitude).toBe(2.5); // rounded to 1dp
  expect(a.props?.depth).toBe("0.1 km"); // from coordinates[2]
  expect(a.props?.place).toBe("5 km NNW of Redwood Valley, CA");
  expect(a.color).toBe(magnitudeColor(2.46));
  expect(a.ts).toBe(new Date(1782535654940).toISOString());

  // A great quake sizes/colours up: depth from coords[2], red on the ramp.
  expect(b.props?.depth).toBe("120.4 km");
  expect(b.color).toBe("#dc2626");
  expect(magnitudeColor(6.3)).toBe("#dc2626");
  expect(magnitudeColor(1.0)).toBe("#a3e635");
});

// On 2026-10-16, 4 of 175 rows were explosions or quarry blasts drawn as quakes.
test("drops explosions and quarry blasts, keeps earthquakes and untyped events", () => {
  const row = (id: string, type?: string) => ({
    id,
    properties: { mag: 2, place: "x", time: 1, ...(type ? { type } : {}) },
    geometry: { coordinates: [-100, 40, 3] },
  });
  const rows = { features: [row("a", "earthquake"), row("b", "explosion"), row("c", "quarry blast"), row("d")] };
  expect(normalizeUsgs(rows).map((f) => f.id)).toEqual(["usgs:a", "usgs:d"]);
  const all = normalizeUsgs(rows, { keepNonQuakes: true });
  expect(all.map((f) => f.props?.type)).toEqual(["earthquake", "explosion", "quarry blast", "earthquake"]);
  expect(isUsgsEarthquake("Earthquake")).toBe(true);
  expect(isUsgsEarthquake("mining explosion")).toBe(false);
});

test("the coverage rule says what the catalogue holds, not 'all earthquakes'", () => {
  const c = readCoverage(normalizeUsgs(fixture as never))!;
  expect(c.rule).toBe(USGS_COVERAGE_RULE);
  expect(c.rule).not.toMatch(/all earthquakes/i);
  expect(c.rule).toMatch(/M2\.5 in the US/);
});
