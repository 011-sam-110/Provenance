import { expect, test } from "vitest";
import {
  landReadsAboveSea,
  GLOBE_SEA,
  COVERAGE_NO_DATA,
  COVERAGE_RAMP_LOW,
  COVERAGE_RAMP_HIGH,
  COVERAGE_BORDER,
  borderReadsOnLand,
  borderWidthAt,
  zoomToFill,
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

/**
 * Shape and tone are two different failures. Sinking the sea gives a continent an edge
 * against the water; it gives two neighbouring countries nothing, because the only thing
 * separating them was a difference in coverage brightness, and most of Europe measures
 * the same. So a reader could see a landmass and still not tell which country a pin was
 * standing in — which is what "the globe is not accurate" actually looked like.
 */
test("a country outline reads as a line on the brightest land", () => {
  expect(borderReadsOnLand()).toBe(true);
});

test("the outline the choropleth shipped with is invisible, and that is the bug", () => {
  // `fill-outline-color` on the `pv-coverage` fill: near enough to GLOBE_SEA that a
  // coastline was the colour of the water beside it. It is still set — it darkens the
  // seam under the line — but it was never a border anyone could see.
  expect(borderReadsOnLand("rgba(5,7,12,0.7)")).toBe(false);
});

test("the border is a translucent tint, not a solid stroke", () => {
  // A solid line at this width turns the globe into an atlas and pulls the eye off the
  // signals. Parsed by `borderReadsOnLand`, so the format is load-bearing.
  expect(COVERAGE_BORDER).toMatch(/^rgba\(\d+,\d+,\d+,0\.\d+\)$/);
});

/**
 * Colour was only half of it. The first cut of this border was 0.26 alpha on a 0.7 px
 * line and rendered as nothing: a sub-pixel line is drawn faint, not thin, so the
 * rasteriser scaled that 26% down to roughly 18% and it vanished into the globe.
 * `borderReadsOnLand` passed the whole time, which is the honest reason this test exists
 * — the invariant it holds is about tone, and the defect was width.
 */
test("the border is at least 0.9px at the zoom the globe actually rests at", () => {
  // zoomToFill() is the resting zoom, and it is a function of the container: 2.84 on a
  // 911px desktop stage, 1.62 on a 390px phone. The phone is the one a ramp starting at
  // 0.4 would have let down, so both are checked.
  for (const px of [390, 911, 1440, 1920]) {
    expect(borderWidthAt(zoomToFill(px))).toBeGreaterThanOrEqual(0.9);
  }
});

test("no stop in the width ramp goes under the floor, at any zoom", () => {
  for (let z = 0; z <= 8; z += 0.25) expect(borderWidthAt(z)).toBeGreaterThanOrEqual(0.9);
  // …and it still climbs, so a country filling the frame gets a heavier edge.
  expect(borderWidthAt(6)).toBeGreaterThan(borderWidthAt(0));
});
