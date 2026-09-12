import { expect, test } from "vitest";
import {
  landReadsAboveSea,
  GLOBE_SEA,
  COVERAGE_NO_DATA,
  COVERAGE_RAMP_LOW,
  COVERAGE_RAMP_HIGH,
} from "@/components/marketing/HeroGlobe";

/**
 * The hero globe has no land layer: land is the basemap's background showing through, and
 * the only thing that gives a continent a shape is the coverage choropleth over it. So the
 * whole map reads correctly on one relationship — the sea must be darker than the darkest
 * land — and it shipped inverted, with OpenFreeMap's water (rgb 27,27,29) brighter than an
 * unmeasured country (rgb 16,22,27 composited). The pins were never wrong; there was just
 * no coastline to read them against.
 */
test("the sea is darker than the darkest land", () => {
  expect(landReadsAboveSea()).toBe(true);
});

test("upstream's own water colour is what broke it, and would break it again", () => {
  // OpenFreeMap dark's `water`. Left in as the regression case: if the override is ever
  // dropped, this is the value that comes back, and this test says what it costs.
  expect(landReadsAboveSea("#1b1b1d")).toBe(false);
});

test("the no-data tone is distinct from the ramp, so 'nothing found' is not 'found one'", () => {
  // The page's legend names those two states separately, so the colours may not collide.
  expect(COVERAGE_NO_DATA).not.toBe(COVERAGE_RAMP_LOW);
  expect(COVERAGE_RAMP_LOW).not.toBe(COVERAGE_RAMP_HIGH);
  // …and every one of them is a 6-digit hex, because the compositing maths assumes it.
  for (const c of [GLOBE_SEA, COVERAGE_NO_DATA, COVERAGE_RAMP_LOW, COVERAGE_RAMP_HIGH]) {
    expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  }
});
