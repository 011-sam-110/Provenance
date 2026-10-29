import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The status pill introduced a FOURTH surface.
 *
 * The --tn-*-ink tokens were each measured to clear 4.5:1 on --tn-surface,
 * --tn-surface-2 and --tn-chip-bg (see the block comment at the top of
 * globals.css). The pill puts a 10%-alpha tint of an ink's OWN hue underneath
 * that ink, which is a ground none of those measurements covered — and because
 * the tint is a dark colour, it makes the ground DARKER and the contrast LOWER,
 * not higher. That is fine as long as it is checked, and useless unless it stays
 * checked: nudging one hex in globals.css is a one-character edit that can drop
 * a state below AA with nothing on screen looking obviously wrong.
 *
 * What this test does NOT cover, stated so nobody reads more into a green run
 * than it earns: --tn-surface is `rgba(255,255,255,0.92)` and composites over
 * live map imagery, so the true ground under a pill is the map plus two
 * translucent layers. This measures against the SOLID surface, which is what
 * the rest of the file's contrast comments use as their reference, and which is
 * the most favourable case. Dark map imagery under a widget makes every one of
 * these numbers worse, for the pill and for the bare text beside it alike.
 */

const CSS = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

/** Pull `--name: value;` out of the :root block. */
function token(name: string): string {
  const m = CSS.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`token --${name} is not declared in globals.css`);
  return m[1].trim();
}

type RGB = [number, number, number];

function parseHex(v: string): RGB {
  const m = v.match(/^#([0-9a-f]{6})$/i);
  if (!m) throw new Error(`not a 6-digit hex colour: ${v}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function parseRgba(v: string): { rgb: RGB; a: number } {
  const m = v.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)$/i);
  if (!m) throw new Error(`not an rgb()/rgba() colour: ${v}`);
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], a: m[4] == null ? 1 : Number(m[4]) };
}

/** Source-over composite of a translucent colour onto an opaque backdrop. */
function over(fg: RGB, alpha: number, bg: RGB): RGB {
  return [0, 1, 2].map((i) => alpha * fg[i] + (1 - alpha) * bg[i]) as RGB;
}

/** WCAG 2.x relative luminance. */
function luminance([r, g, b]: RGB): number {
  const lin = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The solid surface a pill sits on. */
const SURFACE = parseHex(token("tn-surface-solid"));

/**
 * THE DARK SKIN'S PASS. The dark block (globals.css, `html[data-tnx-skin="dark"]
 * .tn-terminal`) redefines the four inks, the four 14% grounds and the chip ground, and
 * the console remaps `--tn-surface-solid` onto `--tnx-panel-head`, so a pill in the dark
 * skin sits on #1b1e14, not on white. `token()` above finds the FIRST declaration in the
 * file, which is the light one, so this reads the dark block on its own, and resolves
 * the inks the block writes as `var(--tnx-…)` through the same block.
 */
const DARK_SELECTOR = '\n:root[data-tnx-skin="dark"] .tn-terminal {';

function darkBlock(): string {
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const at = bare.indexOf(DARK_SELECTOR);
  if (at < 0) throw new Error("the dark skin block is not in globals.css");
  const open = bare.indexOf("{", at);
  return bare.slice(open, bare.indexOf("\n}", open));
}

/** A token's value in the dark block, following `var(--x)` references inside it. */
function darkToken(name: string, block = darkBlock()): string {
  const m = block.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`token --${name} is not declared in the dark skin block`);
  const v = m[1].trim();
  const ref = v.match(/^var\(--([\w-]+)\)$/);
  return ref ? darkToken(ref[1], block) : v;
}

/** A pill's ground in the dark skin is the panel-head the console remaps the surface to. */
const DARK_SURFACE = parseHex(darkToken("tnx-panel-head"));

/** Every pill state that paints a tinted ground, ink ↔ ground. */
const TINTED: { state: string; ink: string; bg: string }[] = [
  { state: "live", ink: "tn-live-ink", bg: "tn-live-bg" },
  { state: "lagging", ink: "tn-lagging-ink", bg: "tn-lagging-bg" },
  { state: "stale", ink: "tn-stale-ink", bg: "tn-stale-bg" },
  { state: "down", ink: "tn-down-ink", bg: "tn-down-bg" },
  // `refused` deliberately reuses the down pair — the two states are told apart
  // by their TEXT, not their colour. Listed so a future split is caught here.
  { state: "refused", ink: "tn-down-ink", bg: "tn-down-bg" },
];

/** The states that stay on the NEUTRAL chip ground rather than a tint. */
const NEUTRAL = ["empty", "off", "unknown"];

describe("status pill contrast", () => {
  it.each(TINTED)("$state ink clears AA on its own tinted ground", ({ ink, bg }) => {
    const { rgb, a } = parseRgba(token(bg));
    const ground = over(rgb, a, SURFACE);
    expect(contrast(parseHex(token(ink)), ground)).toBeGreaterThanOrEqual(4.5);
  });

  // Measured on #1b1e14 when the dark skin was written: live 5.83, lagging 6.94, stale
  // 5.68, down 5.38. Down needed its own lifted ink (#ff7468): the vivid #ff5449 is 4.47
  // on its own 14% ground.
  it.each(TINTED)("dark skin: $state ink clears AA on its own tinted ground", ({ ink, bg }) => {
    const { rgb, a } = parseRgba(darkToken(bg));
    const ground = over(rgb, a, DARK_SURFACE);
    expect(contrast(parseHex(darkToken(ink)), ground)).toBeGreaterThanOrEqual(4.5);
  });

  it("dark skin: the neutral states also clear AA", () => {
    const faint = parseHex(darkToken("tnx-ink-faint"));
    expect(contrast(faint, parseHex(darkToken("tn-chip-bg")))).toBeGreaterThanOrEqual(4.5);
  });

  it("puts the neutral states on a ground that also clears AA", () => {
    // One assertion for all three: they share --tn-chip-bg and --tn-text-faint.
    const ratio = contrast(parseHex(token("tn-text-faint")), parseHex(token("tn-chip-bg")));
    expect(NEUTRAL.length).toBe(3);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  /**
   * The alert pill takes the same slot when a widget reports alerts, and paints
   * WHITE on a solid severity fill instead of dark ink on a tint. Those four
   * fills were already chosen so white clears AA (see the comment above
   * .tn-cw-badge in globals.css) — this pins that, because the pill now carries
   * a word ("3 alerts") where it used to carry a single digit, and a longer
   * string is read for longer.
   */
  it.each([
    ["neutral", "#5f6b7a"],
    ["critical", "#b5322e"],
    ["warn", "#a35c0c"],
    ["info", "#2f5aa8"],
  ])("alert pill: white clears AA on the %s fill", (_name, fill) => {
    expect(contrast([255, 255, 255], parseHex(fill))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps those four fills as the ones globals.css actually paints", () => {
    // The literals above are only worth asserting if they are the shipped ones.
    for (const fill of ["#5f6b7a", "#b5322e", "#a35c0c", "#2f5aa8"]) {
      expect(CSS, `${fill} is no longer in globals.css`).toContain(fill);
    }
  });

  it("records that tinting LOWERS contrast, so the margin is never assumed", () => {
    // Not decoration: this is the claim the CSS comment makes, and it is the
    // reason the test above exists at all. If a future tint is ever built to
    // lighten rather than darken, this flips and the comment must be rewritten
    // rather than the assertion loosened.
    const { rgb, a } = parseRgba(token("tn-live-bg"));
    const inkRgb = parseHex(token("tn-live-ink"));
    const onPlain = contrast(inkRgb, SURFACE);
    const onTint = contrast(inkRgb, over(rgb, a, SURFACE));
    expect(onTint).toBeLessThan(onPlain);
    expect(onTint).toBeGreaterThanOrEqual(4.5);
  });
});
