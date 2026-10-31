import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards for the Streets area controls (Leon, 2026-10-29): the filled New area button, the
 * area card in the map's bottom-left with an amber edge, and the glow that fades up once.
 * They read the stylesheets as text, like dark-skin-css.test.ts, because no test here
 * renders CSS.
 */

const root = process.cwd();
const GLOBALS = readFileSync(join(root, "app", "globals.css"), "utf8");
const MOTION = readFileSync(join(root, "app", "console-motion.css"), "utf8");
const CIRCLE = readFileSync(join(root, "lib", "console", "widgets", "camslot.circle.ts"), "utf8");

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of the first rule whose selector list is exactly `selector`. */
function ruleBody(css: string, selector: string): string {
  const bare = strip(css);
  const at = bare.indexOf(selector + " {") >= 0 ? bare.indexOf(selector + " {") : bare.indexOf(selector + "{");
  expect(at, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
  const open = bare.indexOf("{", at);
  const close = bare.indexOf("}", open);
  return bare.slice(open + 1, close);
}

describe("the amber edge", () => {
  it("is the colour of the area ring on the map, written in both places", () => {
    expect(GLOBALS).toContain("--tn-streets-amber: 255 176 32");
    expect(CIRCLE.toLowerCase()).toContain("#ffb020");
  });
});

describe("the area card", () => {
  const card = ruleBody(GLOBALS, ".tn-streets-prompt");

  it("is no longer centred on the map", () => {
    expect(card).not.toContain("translate(-50%");
    expect(card).not.toMatch(/\btop\s*:\s*50%/);
    expect(card).not.toMatch(/\bleft\s*:\s*50%/);
  });

  it("sits at the bottom-left of the map, clear of the clock bar through the shared property", () => {
    const corner = ruleBody(GLOBALS, ".tn-streets-corner");
    expect(corner).toMatch(/\bleft\s*:\s*12px/);
    expect(corner).toContain("var(--tnx-stage-foot-clear");
    expect(corner).toContain("var(--tn-streets-note-clear");
  });

  it("does not define the clock bar's property: the clock's own task owns it", () => {
    expect(strip(GLOBALS)).not.toMatch(/--tnx-stage-foot-clear\s*:/);
  });

  it("has an amber edge and glow, from the one amber token", () => {
    expect(card).toContain("rgb(var(--tn-streets-amber)");
  });
});

describe("the glow", () => {
  const block = MOTION.slice(MOTION.indexOf("tn-streets-glow-in") - 400);

  it("is one named keyframe, used once, with no loop", () => {
    expect(block).toContain("@keyframes tn-streets-glow-in");
    expect(strip(block)).not.toMatch(/infinite/);
    expect(strip(block)).not.toMatch(/animation-iteration-count\s*:\s*(?!1\b)/);
  });

  it("runs on the card with the focal duration", () => {
    expect(strip(MOTION)).toMatch(/\.tn-terminal \.tn-streets-prompt\s*{\s*animation:\s*tn-streets-glow-in var\(--tn-mo-focal\)/);
  });

  it("is switched off under reduced motion, so the glow is steady from the first frame", () => {
    expect(strip(MOTION)).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*{[^{}]*\.tn-terminal \.tn-streets-prompt\s*{\s*animation:\s*none/,
    );
  });
});

describe("the New area button", () => {
  const body = ruleBody(GLOBALS, ".tn-terminal .tn-wall-btn.is-new-area");

  it("is filled with the accent and reads the on-accent ink, with no hex colour", () => {
    expect(body).toContain("var(--tnx-accent)");
    expect(body).toContain("var(--tnx-on-accent)");
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
