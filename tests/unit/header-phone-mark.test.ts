import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// NO HEADER BUTTON IS AN EMPTY BOX ON A PHONE. The ≤900px header pass hides every
// `.tnx-hdr-btn-label`, so a button may only use that class on a word it can lose: it must
// keep a glyph, or a word in a plain span. SHORTCUTS was the button that once had neither,
// and it had a stand-in mark (`.tnx-hdr-btn-mark`) until it left the bar on 2026-10-31.
// These pins keep the wiring; tests/e2e/header-phone.spec.ts checks what is painted.

const TSX = readFileSync(join(process.cwd(), "components", "terminal", "TerminalHeader.tsx"), "utf8");
const ACCOUNT = readFileSync(join(process.cwd(), "components", "account", "AccountButton.tsx"), "utf8");
const CSS = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

/** Every element in the source that wears `.tnx-hdr-btn`, up to its closing tag. */
function headerButtons(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/className=(?:"|\{`)tnx-hdr-btn(?=[ "`])/g)) {
    const open = Math.max(src.lastIndexOf("<a", m.index), src.lastIndexOf("<button", m.index));
    const tag = src.startsWith("<a", open) ? "</a>" : "</button>";
    out.push(src.slice(open, src.indexOf(tag, m.index)));
  }
  return out;
}

describe("the header's buttons on a phone", () => {
  const buttons = [...headerButtons(TSX), ...headerButtons(ACCOUNT)];

  it("finds the buttons it is about", () => {
    expect(headerButtons(TSX).length).toBe(3); // Support, Source, Settings
    expect(headerButtons(ACCOUNT).length).toBeGreaterThan(0);
  });

  it.each(buttons.map((b, i) => [i, b] as const))("button %i keeps something once its word is hidden", (_i, btn) => {
    const rest = btn.replace(/<span className="tnx-hdr-btn-label">[\s\S]*?<\/span>/g, "");
    expect(rest).toMatch(/<span\b|<svg\b|<PersonMark\b/);
  });

  it("the 900px pass still hides the words", () => {
    const hide = CSS.indexOf(".tn-terminal .tnx-hdr-utc-label { display: none; }");
    expect(hide).toBeGreaterThan(-1);
    expect(CSS.slice(CSS.lastIndexOf("@media (max-width: 900px) {", hide), hide)).toContain(".tnx-hdr-btn-label");
  });

  it("the old 'no mobile palette' hide rule is gone", () => {
    // Written for the unmounted StatusBar; on the live header `.tn-terminal .tnx-hdr-btn`
    // always outranked it. Removed with that proof (see the PR).
    expect(CSS).not.toMatch(/^\s*\.tn-palette-trigger\s*\{\s*display:\s*none/m);
  });
});
