import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// THE SEARCH SHORTCUT IS A CONTRACT ACROSS TWO FILES, AND NOTHING ELSE CAN SEE IT.
//
// ConsoleShell.tsx owns the keydown ladder and calls focusMapSearch();
// components/console/MapSearch.tsx owns that function. The load-bearing part is the BOOLEAN:
// the shell preventDefaults only when there was something to focus, so when no search box is
// on screen the key still types its own character and the browser's own binding still fires.
// Swallow it unconditionally and you get a dead key.
//
// THAT MATTERS MORE NOW, NOT LESS. The binding used to be "/", one key, checked after
// the text-field guard. It is now whatever the user's keymap says, and the default set
// includes ";" — a plain printable character. An unconditional preventDefault on a
// printable binding does not just shadow Firefox's quick-find, it stops the character
// being typed at all.
//
// THE FUNCTION HAS MOVED TWICE AND THIS FILE MOVED WITH IT. It was focusStageSearch() in
// components/terminal/StageBar.tsx while the search box was stage chrome, unmounted whenever a
// widget was expanded onto the stage, which is what gave the boolean its original meaning. It
// was focusMapSearch() while the box lived on the Inspector panel's tool rail, and it
// is focusMapSearch() since 2026-10-31, with the box back on the map as a pill. That is the
// first meaning again: a focused widget or a closed dock leaves no box to focus. This is the
// third time this file has been repointed rather than deleted — it was
// slash-shortcut-contract.test.ts before the keymap replaced the `case "/":` arm.
//
// WHY A SOURCE TEST, WHICH IS NORMALLY THE WEAK KIND. Three signals all stay green
// while this breaks:
//
//   - git never conflicts. The two halves live in different files, so a change to
//     the shell's keydown effect and a change to the rail merge cleanly.
//   - vitest cannot reach it. This project runs `environment: "node"` and collects
//     `tests/unit/**/*.test.ts` only; no .tsx is collected and no React testing
//     library is installed, so neither component can be rendered here at all.
//   - the e2e that does assert it needs a running server, so it is the first thing
//     skipped when the machine cannot spare a build.
//
// If you are here because this test failed: the fix is not to delete the assertion.
// It is to keep the boolean, or to move the contract somewhere a real test can hold
// it and delete this file deliberately.

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

const SHELL = "components/shell/ConsoleShell.tsx";
const PILL = "components/console/MapSearch.tsx";

describe("the search shortcut contract between ConsoleShell and the search pill", () => {
  it("the shell still imports focusMapSearch from the pill", () => {
    // Not just "calls something named that" — the import is what makes it the same
    // function, and an inlined re-implementation is the failure this catches.
    const src = read(SHELL);
    expect(src).toMatch(
      /import\s*\{[^}]*\bfocusMapSearch\b[^}]*\}\s*from\s*"@\/components\/console\/MapSearch"/,
    );
  });

  it("the shell preventDefaults ONLY on a truthy return", () => {
    const src = read(SHELL);
    // The whole contract in one line. Allows reformatting and an intermediate
    // variable; rejects a bare call followed by an unconditional preventDefault.
    const guarded =
      /if\s*\(\s*focusMapSearch\(\)\s*\)\s*e\.preventDefault\(\)/.test(src) ||
      /const\s+(\w+)\s*=\s*focusMapSearch\(\)[\s\S]{0,120}?if\s*\(\s*\1\s*\)\s*e\.preventDefault\(\)/.test(src);
    expect(guarded).toBe(true);
  });

  it("nothing swallows the key without asking", () => {
    const src = read(SHELL);
    // An unconditional preventDefault on the search arm is the regression. Read the
    // slice from the arm's `if` to the `return` that closes it, so an unrelated
    // preventDefault elsewhere in the handler does not fail this.
    const arm = src.split('if (action === "search")')[1]?.split("return;")[0] ?? "";
    expect(arm).toContain("focusMapSearch()");
    // `[\s\S]*?` rather than `[^)]*`, because the condition itself contains a
    // closing paren — `if (focusMapSearch())`. The lazy form still terminates:
    // it expands only until the required `) e.preventDefault()` suffix matches.
    expect(arm.replace(/if\s*\([\s\S]*?\)\s*e\.preventDefault\(\)/g, "")).not.toContain(
      "e.preventDefault()",
    );
  });

  it("THE TEXT-FIELD GUARD RUNS BEFORE THE KEYMAP IS CONSULTED", () => {
    // A keymap that can hold a single printable character must never be consulted
    // while someone is typing, or a semicolon in the search box re-opens the search
    // box. The old "/" binding could be checked after the modifier test; ";" cannot.
    const src = read(SHELL);
    const typing = src.indexOf("target?.isContentEditable");
    const dispatch = src.indexOf("actionFor(chordOf(e)");
    expect(typing).toBeGreaterThan(-1);
    expect(dispatch).toBeGreaterThan(-1);
    expect(typing).toBeLessThan(dispatch);
    // And the dispatch is actually inside the guard, not merely after it.
    expect(src.slice(typing, dispatch)).toMatch(/if\s*\(\s*!typing\s*\)/);
  });

  it("focusMapSearch returns a boolean, and false is a real answer", () => {
    const src = read(PILL);
    expect(src).toMatch(/export function focusMapSearch\(\)\s*:\s*boolean/);
    // Both ways there can be no box: not mounted, and mounted but hidden. A closed dock on
    // a wall board keeps the box in the DOM with `visibility: hidden`, and a focus() on that
    // does nothing while the shell eats the key.
    expect(src).toContain("return false");
    expect(src).toMatch(/instanceof HTMLInputElement\)\)\s*return false/);
    expect(src).toMatch(/getClientRects\(\)\.length === 0/);
    expect(src).toMatch(/visibility === "hidden"/);
  });

  it("it opens no panel: the box is on the map, so the shortcut touches nothing else", () => {
    // The old shortcut had to open a rail, point it at a tab and open a tool. Keeping any of
    // that would cover the map the visitor is about to search.
    const src = read(PILL);
    const fn = src.split("export function focusMapSearch")[1]?.split("\n}\n")[0] ?? "";
    expect(fn).not.toMatch(/openPanel|sourcesRailStore|railTabStore|inspectorRailStore/);
  });
});
