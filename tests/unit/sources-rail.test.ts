import { describe, expect, it } from "vitest";
import { coerceEverOpened, shouldHintRail } from "@/lib/console/sourcesRail";

// The Sources rail collapses to a thin tab on an edge that is otherwise a widget
// column, and reviewers did not find it. The tab bounces once per browser until the
// rail has been opened. Both halves of that rule are pure and live here; the store
// and the CSS animation are the parts a node-environment suite cannot see.

describe("has the rail ever been opened", () => {
  it("NOTHING STORED means never opened — this is the whole hint", () => {
    // The regression this test exists for. The predicate was `?.opened !== false`,
    // which is true for `null`, so the one person the hint is for — a visitor with
    // clean storage — was treated as a returning user and never saw it. Every
    // assertion still passed, because they all handed it a value that existed.
    expect(coerceEverOpened(null)).toBe(false);
    expect(coerceEverOpened(undefined)).toBe(false);
  });

  it("an explicit true is the only thing that silences it", () => {
    expect(coerceEverOpened({ opened: true })).toBe(true);
    expect(coerceEverOpened({ opened: false })).toBe(false);
  });

  it("junk replays the hint rather than swallowing it", () => {
    // localStorage is user-writable. A stray bounce costs a second; a hint that can
    // never fire costs the feature, so this fails toward showing it.
    for (const junk of [{}, { opened: "yes" }, { opened: 1 }, 42, "opened", []]) {
      expect(coerceEverOpened(junk), `${JSON.stringify(junk)}`).toBe(false);
    }
  });
});

describe("when the tab bounces", () => {
  it("only when the rail is closed AND has never been opened", () => {
    expect(shouldHintRail({ open: false, everOpened: false })).toBe(true);
  });

  it("never while the rail is open — it would point at what you are looking at", () => {
    expect(shouldHintRail({ open: true, everOpened: false })).toBe(false);
  });

  it("never once it has done its job, in either state", () => {
    expect(shouldHintRail({ open: false, everOpened: true })).toBe(false);
    expect(shouldHintRail({ open: true, everOpened: true })).toBe(false);
  });
});
