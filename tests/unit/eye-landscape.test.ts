import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * God's eye view on a phone held sideways (eye-landscape, 30 Oct 2026). At 300-430 px tall the
 * wide layout ran into itself: the title under the old bar, the ledger into the credits, the hint
 * over the ledger. Under 500 px of height the frame takes the phone's compact sizes and splits in
 * two: the left half has the ☰, the search and the place, the right half the clock and what opens
 * (the hint, the tray, a details panel). A film keeps its ledger in the left half. One block at
 * the end of eye.module.css, with twins in EyeHud.module.css and EyeSources.module.css.
 * tests/e2e/eye-landscape.spec.ts measures the boxes in a browser.
 */

const ROOT = resolve(__dirname, "../..");
const EYE = readFileSync(resolve(ROOT, "components/eye/eye.module.css"), "utf8");
const HUD = readFileSync(resolve(ROOT, "components/eye/EyeHud.module.css"), "utf8");
const SOURCES = readFileSync(resolve(ROOT, "components/eye/EyeSources.module.css"), "utf8");
const QUERY = "@media (min-aspect-ratio: 4/5) and (max-height: 500px)";

/** The block that opens with QUERY alone, up to its closing brace. */
function landscape(css: string): string {
  const at = css.indexOf(`${QUERY} {`);
  expect(at, "the landscape block").toBeGreaterThan(-1);
  expect(css.indexOf(`${QUERY} {`, at + 1), "only one landscape block").toBe(-1);
  let depth = 0;
  for (let i = css.indexOf("{", at); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(at, i + 1);
  }
  throw new Error("the landscape block is not closed");
}

/** The declarations of `selector { ... }` inside a block (the selector alone on its line). */
function rule(block: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = block.match(new RegExp(`\\n\\s*${esc}\\s*\\{([^}]*)\\}`));
  expect(m, selector).not.toBeNull();
  return m![1];
}

describe("the God's eye view on a landscape phone", () => {
  const eye = landscape(EYE);
  const hud = landscape(HUD);
  const sources = landscape(SOURCES);

  it("comes after the rules it overrides, which have the same specificity", () => {
    const at = EYE.indexOf(`${QUERY} {`);
    expect(at).toBeGreaterThan(EYE.indexOf("\n.detail {"));
    expect(at).toBeGreaterThan(EYE.indexOf("\n.hint {"));
    expect(SOURCES.indexOf(`${QUERY} {`)).toBeGreaterThan(SOURCES.indexOf("\n.tray {"));
    expect(HUD.indexOf(`${QUERY} {`)).toBeGreaterThan(HUD.indexOf("\n.compass {"));
  });

  it("stacks a film's header and counts in flow, in the left half", () => {
    expect(rule(eye, ".film")).toMatch(/flex-direction:\s*column/);
    expect(rule(eye, ".top")).toMatch(/position:\s*relative/);
    const ledger = rule(eye, ".ledger");
    expect(ledger).toMatch(/position:\s*relative/);
    expect(ledger).not.toMatch(/\bbottom:/);
    expect(ledger).toContain("max-width: calc(50% - 16px)");
    expect(rule(eye, ".placeBlock")).toContain("max-width: calc(50% - 16px)");
  });

  it("a film uses the phone's words: short labels, no zero rows", () => {
    expect(rule(eye, ".long")).toMatch(/display:\s*none\s*!important/);
    expect(rule(eye, ".short")).toMatch(/display:\s*block/);
    expect(eye).toMatch(/\.ledger p\[data-zero\],\s*\.ledger p\[data-note\]\s*\{\s*display:\s*none/);
    expect(rule(eye, ".place")).toContain("font-size: 22px");
  });

  it("keeps the title in the left half and what opens in the right half, under the clock", () => {
    expect(rule(hud, ".place")).toContain("max-width: calc(50vw - 16px)");
    expect(rule(eye, ".hint")).toContain("top: 56px");
    expect(rule(eye, ".detail")).toContain("top: 68px");
    expect(rule(eye, ".detail")).toContain("max-height: calc(100% - 78px)");
    expect(rule(sources, ".tray")).toContain("top: 68px");
    expect(rule(sources, ".tray")).toContain("max-height: calc(100dvh - 78px)");
    // On a short screen the whole tray scrolls under its sticky header, as the console's rail does.
    expect(rule(sources, ".tray")).toMatch(/overflow-y:\s*auto/);
    expect(rule(sources, ".body")).toMatch(/overflow:\s*visible/);
    expect(rule(sources, ".head")).toMatch(/position:\s*sticky/);
  });

  it("keeps the compass short and low, between the left edge and the credits", () => {
    expect(rule(hud, ".compass")).toContain("bottom: 8px");
    expect(rule(hud, ".window")).toContain("height: 30px");
  });

  it("leaves the wide rules as they were", () => {
    expect(EYE).toMatch(/\n\.ledger\s*\{[^}]*bottom:\s*76px;/);
    expect(SOURCES).toMatch(/\n\.tray\s*\{[^}]*top:\s*var\(--tray-top, 120px\);/);
    // No new scrim: eye-frame-look.test.ts counts the three .hud::before rules.
    expect(eye).not.toMatch(/::before\s*\{/);
  });
});
