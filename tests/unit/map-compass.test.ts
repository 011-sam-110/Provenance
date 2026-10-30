import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { COMPASS_DURATION_MS, COMPASS_LABEL, NEEDLE_SVG, needleTurn } from "@/lib/map/compass";

/**
 * The map's compass and the rules that sit around it in app/globals.css: a needle that
 * turns the opposite way to the map, a button styled with tokens only, a bottom-right
 * corner that reads the clock block's clearance property, a still i, and an i that can be
 * read in the dark skin. The stylesheet pins read the file, the way terminal-tokens.test.ts
 * does, because a rule that quietly loses a specificity fight is invisible to every other
 * kind of test. tests/e2e/map-overlays.spec.ts measures the same things in a browser.
 */

const CSS = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
const BARE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of the first rule whose selector list contains `selector`. */
function rule(selector: string): string {
  const at = BARE.indexOf(selector);
  expect(at, `selector not found: ${selector}`).toBeGreaterThan(-1);
  const open = BARE.indexOf("{", at);
  const close = BARE.indexOf("}", open);
  return BARE.slice(open + 1, close);
}

describe("needleTurn", () => {
  it("turns the needle the opposite way to the map, folded into (-180, 180]", () => {
    expect(needleTurn(0)).toBe(0);
    expect(needleTurn(90)).toBe(-90);
    expect(needleTurn(250)).toBe(110);
    expect(needleTurn(-30)).toBe(30);
    expect(needleTurn(360)).toBe(0);
    expect(needleTurn(540)).toBe(180);
    expect(needleTurn(180)).toBe(180);
    expect(needleTurn(-180)).toBe(180);
    expect(needleTurn(720.5)).toBeCloseTo(-0.5, 9);
  });

  it("rounds float noise away: the bearing MapLibre hands back for 250 still reads 110", () => {
    expect(needleTurn(249.99999999999997)).toBe(110);
    expect(needleTurn(-0.001)).toBe(0);
    // Rounding happens before the fold, so the half-turn stays +180 and never becomes -180.
    expect(needleTurn(179.999)).toBe(180);
  });

  it("is never -0, so the style never reads '-0deg'", () => {
    for (const b of [0, -0, 360, -360, 720]) {
      expect(Object.is(needleTurn(b), -0), `bearing ${b}`).toBe(false);
    }
  });

  it("reads a non-finite bearing as north", () => {
    expect(needleTurn(Number.NaN)).toBe(0);
    expect(needleTurn(Number.POSITIVE_INFINITY)).toBe(0);
    expect(needleTurn(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe("the compass button", () => {
  it("is named 'Face north' and takes half a second", () => {
    expect(COMPASS_LABEL).toBe("Face north");
    expect(COMPASS_DURATION_MS).toBe(500);
  });

  it("draws a solid north half and a faint south half in currentColor, with no colour of its own", () => {
    expect(NEEDLE_SVG).toContain('fill="currentColor"');
    expect(NEEDLE_SVG).toContain('opacity=".28"');
    expect(NEEDLE_SVG).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(NEEDLE_SVG).toContain('aria-hidden="true"');
  });

  it("is styled with tokens only: no literal colour in any compass rule", () => {
    const decls = [
      rule(".tn-terminal .maplibregl-ctrl button.tn-compass {"),
      rule(".tn-terminal .maplibregl-ctrl button.tn-compass:not(:disabled):hover"),
      rule(".tn-terminal .maplibregl-ctrl button.tn-compass:focus-visible"),
      rule(".tn-terminal .tn-compass svg"),
    ].join("\n");
    expect(decls).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(decls).not.toMatch(/\brgba?\(|\bhsla?\(/i);
    expect(decls).toContain("var(--tnx-accent)");
    expect(decls).toContain("var(--tnx-panel)");
  });

  it("turns the needle through --tn-compass-turn", () => {
    expect(rule(".tn-terminal .tn-compass svg")).toContain("rotate(var(--tn-compass-turn, 0deg))");
  });

  it("is a 30px circle, like the i", () => {
    const d = rule(".tn-terminal .maplibregl-ctrl button.tn-compass {");
    expect(d).toMatch(/width:\s*30px/);
    expect(d).toMatch(/height:\s*30px/);
    expect(d).toMatch(/border-radius:\s*999px/);
  });

  it("keeps its 44px tap area on a phone, for the i as well", () => {
    // 44px each: an inset runs from the padding box, and only the compass has a 1px border.
    expect(BARE).toMatch(/\.tn-terminal \.maplibregl-ctrl button\.tn-compass::before\s*\{[^}]*inset:\s*-8px/);
    expect(BARE).toMatch(/\.tn-terminal \.maplibregl-ctrl-attrib \.maplibregl-ctrl-attrib-button::before\s*\{[^}]*inset:\s*-7px/);
    expect(BARE).toMatch(/\.tn-terminal \.maplibregl-ctrl\.tn-compass-ctrl\s*\{\s*margin-bottom:\s*14px/);
  });
});

describe("the bottom-right corner", () => {
  it("reads the clock block's clearance property, with a fallback, and no longer says bottom: 28px", () => {
    const d = rule(".tn-terminal .maplibregl-ctrl-bottom-right {");
    expect(d).toContain("var(--tnx-stage-foot-clear");
    expect(d).toMatch(/var\(--tnx-stage-foot-clear,\s*46px\)/);
    expect(d).not.toContain("bottom: 28px");
  });

  it("never DEFINES the clearance property: it belongs to the clock block", () => {
    expect(BARE).not.toMatch(/--tnx-stage-foot-clear\s*:/);
  });
});

describe("the i", () => {
  it("does not move when it opens: no margin, a 30px floor, pinned to the corner", () => {
    const open = rule(".tn-terminal .maplibregl-ctrl-attrib.maplibregl-compact-show {");
    expect(open).toMatch(/margin:\s*0\s*!important/);
    expect(open).toMatch(/min-height:\s*30px\s*!important/);
    const button = rule(".tn-terminal .maplibregl-ctrl-attrib .maplibregl-ctrl-attrib-button,");
    expect(button).toMatch(/top:\s*auto\s*!important/);
    expect(button).toMatch(/bottom:\s*-1px\s*!important/);
    expect(button).toMatch(/right:\s*-1px\s*!important/);
  });

  it("keeps the left-corner mirror AFTER the right-corner rule, or it would lose on order", () => {
    const right = BARE.indexOf("bottom: -1px !important");
    const left = BARE.indexOf("left: -1px !important");
    expect(right).toBeGreaterThan(-1);
    expect(left).toBeGreaterThan(right);
  });

  it("drops maplibre's blue focus glow and rings keyboard focus in the accent", () => {
    expect(rule(".tn-terminal .maplibregl-ctrl-attrib .maplibregl-ctrl-attrib-button:focus {")).toMatch(/box-shadow:\s*none\s*!important/);
    expect(rule(".tn-terminal .maplibregl-ctrl-attrib .maplibregl-ctrl-attrib-button:focus-visible")).toContain("var(--tnx-accent)");
  });

  it("is readable in the dark skin: the mark is the dark accent, and the credit text is the faint ink", () => {
    const dark = rule(':root[data-tnx-skin="dark"] .tn-terminal .maplibregl-ctrl-attrib .maplibregl-ctrl-attrib-button');
    expect(dark).toContain("c9d1a6");
    expect(rule(".tn-terminal .maplibregl-ctrl-attrib.maplibregl-compact {")).toContain("var(--tnx-ink-faint)");
    expect(rule(".tn-terminal .maplibregl-ctrl-attrib {")).toContain("color: var(--tnx-ink-faint)");
  });
});
