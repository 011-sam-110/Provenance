import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// SHORTCUTS IS NOT AN EMPTY BOX ON A PHONE. The ≤900px header pass hides every button's
// word; SHORTCUTS has no glyph of its own (its ⌘K cap left in #162), so it needs the
// stand-in mark `.tnx-hdr-btn-mark`, hidden above 900px so the desktop bar keeps its
// width. These pins keep the wiring; tests/e2e/header-phone.spec.ts checks what is painted.

const TSX = readFileSync(join(process.cwd(), "components", "terminal", "TerminalHeader.tsx"), "utf8");
const CSS = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

/** The SHORTCUTS <button>…</button>, found by its e2e hook. */
function paletteButton(): string {
  const hook = TSX.indexOf('className="tnx-hdr-btn tn-palette-trigger"');
  expect(hook).toBeGreaterThan(-1);
  return TSX.slice(TSX.lastIndexOf("<button", hook), TSX.indexOf("</button>", hook));
}

/** The `@media (max-width: 900px)` block that hides the header's words. */
function narrowHeaderPass(): { start: number; body: string } {
  const hide = CSS.indexOf(".tn-terminal .tnx-hdr-utc-label { display: none; }");
  expect(hide).toBeGreaterThan(-1);
  const start = CSS.lastIndexOf("@media (max-width: 900px) {", hide);
  expect(start).toBeGreaterThan(-1);
  return { start, body: CSS.slice(start, CSS.indexOf("\n}\n", hide)) };
}

describe("the SHORTCUTS button on a phone", () => {
  it("carries a decorative mark beside its word, and keeps its name", () => {
    const btn = paletteButton();
    expect(btn).toMatch(/<svg[^>]*className="tnx-hdr-btn-mark"[^>]*aria-hidden/s);
    expect(btn).toContain('<span className="tnx-hdr-btn-label">SHORTCUTS</span>');
    expect(btn).toContain('aria-label="Shortcuts and command palette"');
  });

  it("the mark is hidden by default and shown by the 900px pass, which comes later", () => {
    const base = CSS.search(/^\.tn-terminal \.tnx-hdr-btn-mark\s*\{[^}]*display:\s*none/m);
    const pass = narrowHeaderPass();
    expect(base).toBeGreaterThan(-1);
    // Same specificity (0,2,0) on both, so source order decides: the show rule must be later.
    expect(base).toBeLessThan(pass.start);
    expect(pass.body).toMatch(/\.tn-terminal \.tnx-hdr-btn-mark\s*\{\s*display:\s*block;/);
  });

  it("the old 'no mobile palette' hide rule is gone", () => {
    // Written for the unmounted StatusBar; on the live header `.tn-terminal .tnx-hdr-btn`
    // always outranked it. Removed with that proof (see the PR).
    expect(CSS).not.toMatch(/^\s*\.tn-palette-trigger\s*\{\s*display:\s*none/m);
  });
});
