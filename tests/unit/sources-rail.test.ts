import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { shouldHintRail, sourcesRailStore } from "@/lib/console/sourcesRail";

// The Sources rail collapses to a thin tab on an edge that is otherwise a widget
// column, and reviewers did not find it. The tab jumps on every fresh launch until
// the rail is opened. The rule is pure and lives here; the animation itself is the
// part a node-environment suite cannot see, and tests/e2e/sources-rail.spec.ts holds
// that half.
//
// THE SCOPE OF THE HINT CHANGED, and these tests changed with it. It used to be a
// once-per-browser hint: a `tn.sources.opened.v1` flag in localStorage, set the first
// time the rail was opened by any route, after which the tab never moved again. That
// read well and did not survive contact — anyone who opens Sources once, including on
// the visit where they were only looking, never sees the hint again on any later
// launch, and "the tab does not move on a fresh launch" was the report. The flag is
// gone; the hint is now scoped to one visit and nothing about it is written down.
//
// The three assertions about `coerceEverOpened` that used to be here went with it.
// They pinned a real regression (`?.opened !== false` classified a first-time visitor
// as a returning one), but they pinned the reading of a persisted value that no longer
// exists, so they are deleted deliberately rather than repointed at nothing. What
// replaces them is the persistence guard at the bottom of this file: the bug they
// protected against is only reachable if someone reintroduces storage here.

describe("when the tab jumps", () => {
  it("only when the rail is closed AND has not been opened this visit", () => {
    expect(shouldHintRail({ open: false, openedThisVisit: false })).toBe(true);
  });

  it("never while the rail is open — it would point at what you are looking at", () => {
    expect(shouldHintRail({ open: true, openedThisVisit: false })).toBe(false);
  });

  it("never once it has done its job, in either state", () => {
    expect(shouldHintRail({ open: false, openedThisVisit: true })).toBe(false);
    expect(shouldHintRail({ open: true, openedThisVisit: true })).toBe(false);
  });
});

// These run in order against the one module-level store, because the thing under test
// IS a sequence: launch, open, close. Vitest runs `it` blocks in source order within a
// describe, and nothing above this point touches the store.
describe("the store, across a single visit", () => {
  it("HINTS ON A FRESH LAUNCH, before anything has happened", () => {
    // The whole change. The initial state used to be `everOpened: true` so that a
    // returning user could not see one frame of a hint they had already earned out
    // of, before `hydrate()` had read storage. With no storage to read there is no
    // such frame, and starting closed-and-unopened is both the honest initial state
    // and identical to the server snapshot, so hydration has nothing to reconcile.
    expect(sourcesRailStore.get()).toEqual({ open: false, openedThisVisit: false });
    expect(shouldHintRail(sourcesRailStore.get())).toBe(true);
  });

  it("stops the moment the rail is opened by ANY route", () => {
    // `toggle` is the keymap's route, called from ConsoleShell's keydown handler;
    // `setOpen` is the tab's. Both land on the same setter, which is why the hint is
    // earned out there rather than in each caller.
    sourcesRailStore.toggle();
    expect(sourcesRailStore.get().open).toBe(true);
    expect(shouldHintRail(sourcesRailStore.get())).toBe(false);
  });

  it("does not come back when the rail is closed again", () => {
    // Closing does not un-earn it. Someone who opened Sources and shut it has found
    // the control, and a hint that replays after it has worked is just motion.
    sourcesRailStore.setOpen(false);
    expect(sourcesRailStore.get()).toEqual({ open: false, openedThisVisit: true });
    expect(shouldHintRail(sourcesRailStore.get())).toBe(false);
  });
});

describe("the hint is not written down", () => {
  it("THE STORE PERSISTS NOTHING — this is what makes it once per launch", () => {
    // A source test, which is normally the weak kind, and it is here because the
    // failure it guards is silent by construction. Re-adding a `savePersisted` call
    // would leave every assertion above green — they all run inside one visit, which
    // is exactly the window a persisted flag does not change — while restoring the
    // behaviour this file exists to remove. There is no in-process observation that
    // separates "hint scoped to a visit" from "hint scoped to a browser"; only a
    // second launch does, and this suite has no second launch.
    //
    // If you are here because this failed: the fix is not to delete the assertion. It
    // is to decide, deliberately, that the hint should outlive a launch again, and to
    // rewrite the header above to say so.
    //
    // COMMENTS ARE STRIPPED FIRST, and that is not a convenience. The rule being
    // pinned is "this module runs no persistence", not "this module never says the
    // word" — and the module's header has to say the word, because explaining why the
    // localStorage flag was removed is the most useful thing written in it. Scanning
    // raw text made the doc comment fail the test it was documenting.
    const src = readFileSync(join(process.cwd(), "lib/console/sourcesRail.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(src).not.toContain("@/lib/shell/persist");
    expect(src).not.toContain("savePersisted");
    expect(src).not.toContain("loadPersisted");
    expect(src).not.toContain("localStorage");
  });
});
