import { describe, expect, it } from "vitest";
import {
  SOURCES_RAIL_DEFAULT,
  SOURCES_RAIL_MAX,
  SOURCES_RAIL_MIN,
  clampSourcesRailWidth,
  widthFromPointer,
} from "@/lib/shell/sourcesRailWidth";

/**
 * The Sources rail's width, pinned where it can be pinned.
 *
 * The repo has no jsdom, so the drag itself cannot be covered — which is exactly
 * why the arithmetic was split out of the component. What is tested here is every
 * decision a reader of the CSS would otherwise have to take on trust.
 */
describe("clampSourcesRailWidth", () => {
  it("holds the bounds", () => {
    expect(clampSourcesRailWidth(SOURCES_RAIL_MIN - 200)).toBe(SOURCES_RAIL_MIN);
    expect(clampSourcesRailWidth(SOURCES_RAIL_MAX + 200)).toBe(SOURCES_RAIL_MAX);
    expect(clampSourcesRailWidth(500)).toBe(500);
  });

  it("rounds to whole pixels", () => {
    // The value becomes a CSS length; a sub-pixel rail puts the handle on a
    // fractional boundary and the hairline renders at half opacity on some DPRs.
    expect(clampSourcesRailWidth(452.6)).toBe(453);
  });

  it("answers junk with the DEFAULT, not the minimum", () => {
    // Deliberately unlike clampRailSize, which floors unknowns. The only route to
    // junk here is a corrupted persist envelope, and punishing that with a 300px
    // rail would look like the app deciding to shrink your pane on its own.
    expect(clampSourcesRailWidth(NaN)).toBe(SOURCES_RAIL_DEFAULT);
    expect(clampSourcesRailWidth("wide" as unknown as number)).toBe(SOURCES_RAIL_DEFAULT);
  });

  it("reads the infinities as directions, not as junk", () => {
    expect(clampSourcesRailWidth(Infinity)).toBe(SOURCES_RAIL_MAX);
    expect(clampSourcesRailWidth(-Infinity)).toBe(SOURCES_RAIL_MIN);
  });
});

describe("widthFromPointer", () => {
  it("measures from the workspace's left edge, not the viewport's", () => {
    // The rail is absolutely positioned inside `.tn-cw-shell`. If the shell starts
    // at x=100 and the pointer is at x=500, the rail is 400 wide — not 500.
    expect(widthFromPointer(500, 100)).toBe(400);
    expect(widthFromPointer(500, 0)).toBe(500);
  });

  it("clamps a drag past either end", () => {
    expect(widthFromPointer(20, 0)).toBe(SOURCES_RAIL_MIN);
    expect(widthFromPointer(4000, 0)).toBe(SOURCES_RAIL_MAX);
  });
});

describe("the chosen bounds", () => {
  it("defaults to about 75% of the old fixed 602px width", () => {
    // The ask was "around 75% of its current space usage". 602 * 0.75 = 451.5.
    expect(SOURCES_RAIL_DEFAULT).toBe(452);
    expect(SOURCES_RAIL_DEFAULT / 602).toBeCloseTo(0.75, 2);
  });

  it("keeps the TWO-COLUMN layout reachable by dragging", () => {
    // `.tn-src-rows` folds to one column at `@container (max-width: 561px)`, and the
    // rail spends 40px on padding and scrollbar. So two columns need a rail wider
    // than 601px, and a ceiling at the old 602px default would have left the
    // two-column layout barely — or, after any chrome change, not at all —
    // reachable. This is the assertion that fails if someone lowers the max.
    const RAIL_CHROME_PX = 40;
    const TWO_COLUMN_MIN_CONTENT_PX = 562;
    expect(SOURCES_RAIL_MAX - RAIL_CHROME_PX).toBeGreaterThanOrEqual(TWO_COLUMN_MIN_CONTENT_PX);
  });

  it("defaults BELOW the two-column fold, which is the point of the change", () => {
    // Not an accident to be tidied up later: at the default the rail is one column
    // sized to one column. The old default sat just above/around the fold and drew
    // one column in a two-column pane, which is the waste this change removes.
    const RAIL_CHROME_PX = 40;
    expect(SOURCES_RAIL_DEFAULT - RAIL_CHROME_PX).toBeLessThan(562);
  });

  it("never lets a width outside the bounds through, whatever the source", () => {
    for (const px of [-1, 0, 299, 300, 451, 452, 640, 641, 10_000]) {
      const w = clampSourcesRailWidth(px);
      expect(w).toBeGreaterThanOrEqual(SOURCES_RAIL_MIN);
      expect(w).toBeLessThanOrEqual(SOURCES_RAIL_MAX);
    }
  });
});
