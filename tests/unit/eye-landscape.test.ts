import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * God's eye view on a phone held sideways (eye-landscape, 30 Oct 2026). At 300-430 px tall
 * the wide layout ran into itself: the title under the bar, the ledger into the credits and
 * the place chips, the hint over the ledger, and five pins pushed Previews and Turn off the
 * screen. Under 500 px of height the frame now takes the phone's compact words and splits
 * into a left half (the place and the counts) and a right half (the clock, the bar and what
 * it opens): one block at the end of eye.module.css, its twin at the end of
 * EyeSources.module.css. tests/e2e/eye-landscape.spec.ts measures the boxes in a browser.
 */

const ROOT = resolve(__dirname, "../..");
const EYE = readFileSync(resolve(ROOT, "components/eye/eye.module.css"), "utf8");
const SOURCES = readFileSync(resolve(ROOT, "components/eye/EyeSources.module.css"), "utf8");
const QUERY = "@media (min-aspect-ratio: 4/5) and (max-height: 500px)";

/** The one block that opens with QUERY, up to its closing brace. */
function landscape(css: string): string {
  const at = css.indexOf(QUERY);
  expect(at, "the landscape block").toBeGreaterThan(-1);
  expect(css.indexOf(QUERY, at + 1), "only one landscape block").toBe(-1);
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
  const sources = landscape(SOURCES);

  it("comes after the rules it overrides, which have the same specificity", () => {
    const at = EYE.indexOf(QUERY);
    expect(at).toBeGreaterThan(EYE.indexOf("(min-aspect-ratio: 4/5) and (max-width: 820px)"));
    expect(at).toBeGreaterThan(EYE.indexOf("\n.detail {"));
    expect(at).toBeGreaterThan(EYE.indexOf("\n.previewsBtn {"));
    expect(SOURCES.indexOf(QUERY)).toBeGreaterThan(SOURCES.indexOf("\n.tray.tray {"));
  });

  it("stacks the header and the counts in flow, in the left half", () => {
    expect(rule(eye, ".hud")).toMatch(/flex-direction:\s*column/);
    expect(rule(eye, ".top")).toMatch(/position:\s*relative/);
    const ledger = rule(eye, ".ledger");
    expect(ledger).toMatch(/position:\s*relative/);
    expect(ledger).not.toMatch(/\bbottom:/);
    expect(ledger).toContain("max-width: calc(50% - 16px)");
    expect(rule(eye, ".placeBlock")).toContain("max-width: calc(50% - 16px)");
  });

  it("uses the phone's words: Places, short labels, no zero rows", () => {
    expect(rule(eye, ".long")).toMatch(/display:\s*none\s*!important/);
    expect(rule(eye, ".short")).toMatch(/display:\s*block/);
    expect(eye).toMatch(/\.ledger p\[data-zero\],\s*\.ledger p\[data-note\]\s*\{\s*display:\s*none/);
    expect(rule(eye, ".place")).toContain("font-size: 22px");
  });

  it("keeps the bar and what it opens in the right half, under the bar", () => {
    expect(rule(eye, ".controls")).toContain("max-width: calc(50% - 22px)");
    expect(rule(eye, ".controls")).toContain("top: 54px");
    for (const sel of [".hint", ".placeSheet", ".detail"]) expect(rule(eye, sel), sel).toContain("top: 96px");
    expect(rule(eye, ".detail")).toContain("max-height: calc(100% - 106px)");
    expect(rule(sources, ".tray.tray")).toContain("top: 96px");
    expect(rule(sources, ".tray.tray")).toContain("max-height: calc(100dvh - 106px)");
    // On a short screen the whole tray scrolls under its sticky header, as the console's rail does.
    expect(rule(sources, ".tray.tray")).toMatch(/overflow-y:\s*auto/);
    expect(rule(sources, ".tray .body.body")).toMatch(/overflow:\s*visible/);
    // The console makes its rail's header static inside .tn-terminal; the tray pins it again.
    expect(rule(sources, ".tray.tray :global(.tn-rail-header)")).toMatch(/position:\s*sticky/);
    expect(rule(sources, ".bar")).toMatch(/overflow-x:\s*auto/);
  });

  it("leaves the wide and portrait rules as they were", () => {
    expect(EYE).toMatch(/\n\.controls\s*\{[^}]*top:\s*60px;[^}]*right:\s*26px;/);
    expect(EYE).toMatch(/\n\.ledger\s*\{[^}]*bottom:\s*76px;/);
    expect(EYE).toMatch(/\n\.hint\s*\{[^}]*top:\s*120px;/);
    expect(SOURCES).toMatch(/\n\.tray\.tray\s*\{[^}]*top:\s*116px;/);
    // No new scrim: eye-frame-look.test.ts counts the three .hud::before rules.
    expect(eye).not.toMatch(/::before\s*\{/);
  });
});
