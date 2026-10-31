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

  it("keeps a width saved under the old 372 floor's bounds as it was", () => {
    // Every visitor has a saved value: hydrate() writes the default back on load. Lowering
    // the floor must not move a width somebody chose.
    expect(clampSourcesRailWidth(372)).toBe(372);
    expect(clampSourcesRailWidth(452)).toBe(452);
  });

  it("reads the infinities as directions, not as junk", () => {
    expect(clampSourcesRailWidth(Infinity)).toBe(SOURCES_RAIL_MAX);
    expect(clampSourcesRailWidth(-Infinity)).toBe(SOURCES_RAIL_MIN);
  });
});

describe("widthFromPointer", () => {
  it("measures from the panel's left edge, not the viewport's", () => {
    // The panel stands right of the sidebar. If its left edge is at x=64 and the pointer is
    // at x=500, it is 436 wide — not 500.
    expect(widthFromPointer(500, 64)).toBe(436);
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
    //
    // THE TOOL COLUMN LEFT ON 2026-10-31, when its buttons became rows on the sidebar. So
    // nothing but the panel's own inset comes off the top now, and 680 has room to spare.
    const CONTENT_INSET_PX = 40; // 12px padding either side, plus a scrollbar
    const TWO_COLUMN_MIN_CONTENT_PX = 562;
    expect(SOURCES_RAIL_MAX - CONTENT_INSET_PX).toBeGreaterThanOrEqual(TWO_COLUMN_MIN_CONTENT_PX);
  });

  it("defaults BELOW the two-column fold, which is the point of the change", () => {
    // Not an accident to be tidied up later: at the default the rail is one column
    // sized to one column. The old default sat just above/around the fold and drew
    // one column in a two-column pane, which is the waste this change removes.
    const CONTENT_INSET_PX = 40;
    expect(SOURCES_RAIL_DEFAULT - CONTENT_INSET_PX).toBeLessThan(562);
  });

  it("keeps the catalogue's measured content floor at the narrow end", () => {
    // The min is 324 because the ROWS need 300 — the label column has ~150px there,
    // which is what clears "Borders & names" without ellipsis. The padding sits on top of
    // that, so a min that ignored it would squeeze the catalogue below the width it was
    // measured at. It is exactly that, with nothing to spare: the floor is not a guess.
    const CONTENT_INSET_PX = 24; // padding only: at the narrow end both columns fit
    expect(SOURCES_RAIL_MIN - CONTENT_INSET_PX).toBe(300);
  });

  it("never lets a width outside the bounds through, whatever the source", () => {
    for (const px of [-1, 0, 323, 324, 339, 340, 372, 451, 452, 680, 681, 10_000]) {
      const w = clampSourcesRailWidth(px);
      expect(w).toBeGreaterThanOrEqual(SOURCES_RAIL_MIN);
      expect(w).toBeLessThanOrEqual(SOURCES_RAIL_MAX);
    }
  });
});
