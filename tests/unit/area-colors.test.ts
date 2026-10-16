import { describe, expect, it } from "vitest";
import {
  AREA_COLORS,
  AREA_EDITING_FILL,
  AREA_EDITING_LINE,
  AREA_FILL_MAX,
  DEFAULT_AREA_COLOR,
  DEFAULT_AREA_OPACITY,
  areaColorName,
  areaPaint,
  coerceAreaOpacity,
  coerceAreaColor,
  isAreaColor,
  nextAreaColor,
} from "@/lib/shell/areaColors";

// The palette, and the two rules that keep it out of trouble: what may be painted, and
// which colour a new area gets. Pure functions in a pure module, so this is where they
// are held — vitest here is node-environment and collects no .tsx.

describe("the palette itself", () => {
  it("is eight colours, all of them #rrggbb", () => {
    expect(AREA_COLORS).toHaveLength(8);
    for (const c of AREA_COLORS) expect(c.hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("has no duplicate hex and no duplicate name", () => {
    // Two names for one colour makes the picker's labels ambiguous; two entries for one
    // hex makes a swatch a duplicate of another with no way to tell them apart.
    expect(new Set(AREA_COLORS.map((c) => c.hex)).size).toBe(AREA_COLORS.length);
    expect(new Set(AREA_COLORS.map((c) => c.name)).size).toBe(AREA_COLORS.length);
  });

  it("DEFAULTS TO THE COLOUR AREAS WERE ALREADY DRAWN IN", () => {
    // Not an aesthetic choice: #0ea5e9 is what lib/map/aoi.ts hardcoded for every area
    // before this feature existed, so an area saved by an older build keeps the colour
    // it had instead of changing under the user on upgrade.
    expect(DEFAULT_AREA_COLOR).toBe("#0ea5e9");
    expect(AREA_COLORS[0].hex).toBe(DEFAULT_AREA_COLOR);
  });
});

describe("isAreaColor / coerceAreaColor", () => {
  it("accepts six-digit hex in either case", () => {
    expect(isAreaColor("#0ea5e9")).toBe(true);
    expect(isAreaColor("#0EA5E9")).toBe(true);
  });

  it("REJECTS what MapLibre would silently drop the layer over", () => {
    // The stakes, stated: a malformed colour goes into a paint expression, and MapLibre
    // removes a layer whose expression it cannot parse — so this is the difference
    // between "that colour is not used" and "the areas are gone".
    for (const bad of ["#abc", "0ea5e9", "red", "rgb(1,2,3)", "#0ea5e", "#0ea5e99", "", null, undefined, 42, {}]) {
      expect(isAreaColor(bad), String(bad)).toBe(false);
    }
  });

  it("answers the DEFAULT for everything a stored envelope can hold", () => {
    // The real case: every area saved before this feature has no colour field at all.
    expect(coerceAreaColor(undefined)).toBe(DEFAULT_AREA_COLOR);
    expect(coerceAreaColor(null)).toBe(DEFAULT_AREA_COLOR);
    expect(coerceAreaColor("nonsense")).toBe(DEFAULT_AREA_COLOR);
    expect(coerceAreaColor("#22c55e")).toBe("#22c55e");
    expect(coerceAreaColor("#22C55E")).toBe("#22c55e");
    expect(coerceAreaColor("  #22c55e  ")).toBe("#22c55e");
  });
});

describe("nextAreaColor — what a NEW area is drawn in", () => {
  it("gives the first area the default", () => {
    expect(nextAreaColor([])).toBe(DEFAULT_AREA_COLOR);
  });

  it("does not repeat a colour that is already on the map", () => {
    // The complaint this exists for: two rings drawn in a row used to be two identical
    // rings, indistinguishable on the map and in the list.
    const first = nextAreaColor([]);
    const second = nextAreaColor([first]);
    expect(second).not.toBe(first);
  });

  it("walks the whole palette before it repeats", () => {
    const used: string[] = [];
    for (let i = 0; i < AREA_COLORS.length; i++) {
      const next = nextAreaColor(used);
      expect(used).not.toContain(next);
      used.push(next);
    }
    expect(new Set(used).size).toBe(AREA_COLORS.length);
    // The ninth has to repeat — the palette is the offer — and it repeats from the
    // start rather than failing.
    expect(nextAreaColor(used)).toBe(DEFAULT_AREA_COLOR);
  });

  it("hands a deleted area's colour to the next one drawn", () => {
    // Rotation, not bookkeeping: with eight colours and nine areas something repeats,
    // and reusing the free one is the least surprising way to do it.
    const used = [AREA_COLORS[0].hex, AREA_COLORS[1].hex, AREA_COLORS[2].hex];
    expect(nextAreaColor(used)).toBe(AREA_COLORS[3].hex);
    expect(nextAreaColor([AREA_COLORS[0].hex, AREA_COLORS[2].hex])).toBe(AREA_COLORS[1].hex);
  });

  it("treats a junk stored colour as the default rather than as free", () => {
    // A corrupted envelope must not make nextAreaColor hand out a colour that is
    // already in use — coerceAreaColor is what puts it back in the palette's terms.
    expect(nextAreaColor(["nonsense"])).not.toBe(DEFAULT_AREA_COLOR);
  });
});

describe("areaColorName", () => {
  it("names the palette colours and falls back to the hex", () => {
    expect(areaColorName("#0ea5e9")).toBe("Sky");
    expect(areaColorName("#ef4444")).toBe("Red");
    // A custom colour from the platform picker has no name, and inventing one would be
    // worse than saying the value.
    expect(areaColorName("#123456")).toBe("#123456");
  });
});

// Opacity: how strongly an area shows. Sam could not see an area once he had marked
// it, so the strength became a per-area setting. The rule that matters most is the
// first one: an area saved before this existed must look exactly as it did.
describe("area opacity", () => {
  it("defaults to 0, which paints the look areas already had", () => {
    expect(DEFAULT_AREA_OPACITY).toBe(0);
    expect(coerceAreaOpacity(undefined)).toBe(0);
    // Not edited: no fill, the 50% dashed outline. Exactly the paint before 2026-10-16.
    expect(areaPaint(undefined, false)).toEqual({ fill: 0, line: 0.5 });
    // Edited: the 6% fill and 95% outline the edited ring always had.
    expect(areaPaint(undefined, true)).toEqual({ fill: AREA_EDITING_FILL, line: AREA_EDITING_LINE });
  });

  it("refuses anything that is not a finite number, so no NaN reaches a paint property", () => {
    for (const junk of [null, "0.5", NaN, Infinity, -Infinity, {}, [0.5]]) {
      expect(coerceAreaOpacity(junk)).toBe(DEFAULT_AREA_OPACITY);
    }
  });

  it("clamps to 0..1 and snaps to the slider's step without float noise", () => {
    expect(coerceAreaOpacity(-1)).toBe(0);
    expect(coerceAreaOpacity(7)).toBe(1);
    expect(coerceAreaOpacity(0.35)).toBe(0.35);
    expect(coerceAreaOpacity(0.33)).toBe(0.35);
    expect(coerceAreaOpacity(0.32)).toBe(0.3);
    expect(coerceAreaOpacity(0.7 * 0.5)).toBe(0.35);
  });

  it("at full strength the outline is solid and the fill stops short of hiding the map", () => {
    expect(areaPaint(1, false)).toEqual({ fill: AREA_FILL_MAX, line: 1 });
    expect(AREA_FILL_MAX).toBeLessThan(1);
  });

  it("raises fill and outline together as one knob", () => {
    const low = areaPaint(0.2, false);
    const high = areaPaint(0.8, false);
    expect(high.fill).toBeGreaterThan(low.fill);
    expect(high.line).toBeGreaterThan(low.line);
  });

  it("never paints the edited area fainter than it was before, whatever its own setting", () => {
    expect(areaPaint(0, true).fill).toBe(AREA_EDITING_FILL);
    expect(areaPaint(0.05, true).fill).toBe(AREA_EDITING_FILL);
    expect(areaPaint(0.5, true).fill).toBe(0.3);
    expect(areaPaint(1, true).line).toBe(1);
  });
});
