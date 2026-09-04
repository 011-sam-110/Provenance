import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// THE "/" SHORTCUT IS A CONTRACT ACROSS TWO FILES, AND NOTHING ELSE CAN SEE IT.
//
// ConsoleShell.tsx owns the keydown ladder and calls focusStageSearch(); StageBar.tsx
// owns focusStageSearch() and, since the stage rail landed, opens the Search flyout
// from it. The load-bearing part is the BOOLEAN: the shell preventDefaults only when
// there was something to focus, so when the stage chrome is unmounted — a widget
// expanded onto the stage — "/" still types a literal slash and Firefox's quick-find
// still opens. Swallow it unconditionally and you get a dead key.
//
// WHY A SOURCE TEST, WHICH IS NORMALLY THE WEAK KIND. Three signals all stay green
// while this breaks:
//
//   - git never conflicts. The two halves live in different files, so a change to
//     the shell's keydown effect and a change to the rail merge cleanly.
//   - vitest cannot reach it. This project runs `environment: "node"` and collects
//     `tests/unit/**/*.test.ts` only; no .tsx is collected and no React testing
//     library is installed, so neither component can be rendered here at all.
//   - the e2e that does assert "/" needs a running server, so it is the first thing
//     skipped when the machine cannot spare a build.
//
// tests/unit/tour.test.ts already reads component source for exactly this reason —
// it greps for class names the guided tour points at. This is the same instrument
// pointed at a different invisible seam.
//
// If you are here because this test failed: the fix is not to delete the assertion.
// It is to keep the boolean, or to move the contract somewhere a real test can hold
// it and delete this file deliberately.

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

const SHELL = "components/shell/ConsoleShell.tsx";
const STAGEBAR = "components/terminal/StageBar.tsx";

describe('the "/" shortcut contract between ConsoleShell and StageBar', () => {
  it("the shell still imports focusStageSearch from StageBar", () => {
    // Not just "calls something named that" — the import is what makes it the same
    // function, and an inlined re-implementation is the failure this catches.
    const src = read(SHELL);
    expect(src).toMatch(/import\s*\{[^}]*\bfocusStageSearch\b[^}]*\}\s*from\s*"@\/components\/terminal\/StageBar"/);
  });

  it("the shell preventDefaults ONLY on a truthy return", () => {
    const src = read(SHELL);
    // The whole contract in one line. Allows reformatting and an intermediate
    // variable; rejects a bare call followed by an unconditional preventDefault.
    const guarded =
      /if\s*\(\s*focusStageSearch\(\)\s*\)\s*e\.preventDefault\(\)/.test(src) ||
      /const\s+(\w+)\s*=\s*focusStageSearch\(\)[\s\S]{0,120}?if\s*\(\s*\1\s*\)\s*e\.preventDefault\(\)/.test(src);
    expect(guarded).toBe(true);
  });

  it("nothing swallows the key without asking", () => {
    const src = read(SHELL);
    // An unconditional preventDefault on the "/" arm is the regression. Read the
    // slice between `case "/":` and the next `case`, so an unrelated
    // preventDefault elsewhere in the ladder does not fail this.
    const arm = src.split('case "/":')[1]?.split("case ")[0] ?? "";
    expect(arm).toContain("focusStageSearch()");
    // `[\s\S]*?` rather than `[^)]*`, because the condition itself contains a
    // closing paren — `if (focusStageSearch())`. The lazy form still terminates:
    // it expands only until the required `) e.preventDefault()` suffix matches.
    expect(arm.replace(/if\s*\([\s\S]*?\)\s*e\.preventDefault\(\)/g, "")).not.toContain(
      "e.preventDefault()",
    );
  });

  it("focusStageSearch returns a boolean and opens the rail's Search group", () => {
    const src = read(STAGEBAR);
    expect(src).toMatch(/export function focusStageSearch\(\)\s*:\s*boolean/);
    // Both halves of the answer: false when the rail is not on screen, and the
    // store call that opens the group when it is.
    expect(src).toContain("return false");
    expect(src).toMatch(/mapRailStore\.open\(\s*"search"\s*\)/);
  });
});
