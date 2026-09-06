import { describe, it, expect } from "vitest";
import { SETTINGS_TABS, nextTabId, type SettingsTabId } from "@/lib/shell/settingsTabs";
import { FIXED_KEYS, DEFAULT_KEYMAP, KEY_ACTIONS } from "@/lib/shell/keymap";

// The pure half of the Settings drawer's tab strip. There is no React testing library in
// this repo, so the markup is e2e's problem (tests/e2e/shortcuts.spec.ts) — what a node
// test can own is the arrow arithmetic and the claim the Fixed table makes.

describe("SETTINGS_TABS", () => {
  it("has unique ids, and a label and a blurb for every one", () => {
    const ids = SETTINGS_TABS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of SETTINGS_TABS) expect(t.label.trim().length).toBeGreaterThan(0);
    // The panel header renders the blurb unconditionally, so a tab added without one
    // would ship an empty bar rather than fail anywhere a person would notice.
    for (const t of SETTINGS_TABS) expect(t.blurb.trim().length).toBeGreaterThan(0);
  });

  it("opens on Main", () => {
    // The landing tab is a product decision, not an accident of array order: the drawer
    // resets to SETTINGS_TABS[0] every time it opens, and both the e2e suite and
    // scripts/shoot-surfaces.mjs assert what they see first.
    expect(SETTINGS_TABS[0].id).toBe("main");
  });
});

describe("nextTabId", () => {
  const ids = SETTINGS_TABS.map((t) => t.id);
  const first = ids[0];
  const last = ids[ids.length - 1];

  it("steps on BOTH axes", () => {
    // The list is a vertical rail on the left of the drawer and a horizontal strip below
    // 540px, so ↑/↓ and ←/→ are both live and both mean the same step. Losing either axis
    // leaves the arrows dead at one of the two widths.
    expect(nextTabId(SETTINGS_TABS, ids[0], "ArrowDown")).toBe(ids[1]);
    expect(nextTabId(SETTINGS_TABS, ids[1], "ArrowUp")).toBe(ids[0]);
    expect(nextTabId(SETTINGS_TABS, ids[0], "ArrowRight")).toBe(ids[1]);
    expect(nextTabId(SETTINGS_TABS, ids[1], "ArrowLeft")).toBe(ids[0]);
  });

  it("wraps at BOTH ends", () => {
    // Stopping dead on the last tab reads as a key that failed, not a boundary reached.
    expect(nextTabId(SETTINGS_TABS, last, "ArrowDown")).toBe(first);
    expect(nextTabId(SETTINGS_TABS, first, "ArrowUp")).toBe(last);
    expect(nextTabId(SETTINGS_TABS, last, "ArrowRight")).toBe(first);
    expect(nextTabId(SETTINGS_TABS, first, "ArrowLeft")).toBe(last);
  });

  it("jumps to the ends with Home and End", () => {
    expect(nextTabId(SETTINGS_TABS, last, "Home")).toBe(first);
    expect(nextTabId(SETTINGS_TABS, first, "End")).toBe(last);
  });

  it("returns null for a key that is not the rail's", () => {
    // The null is what the handler reads to decide whether to preventDefault. A tablist
    // that answered every key would swallow Tab and Escape along with the arrows.
    for (const k of ["Tab", "Escape", "Enter", "a", " ", "PageDown", "ArrowLeftFoo"]) {
      expect(nextTabId(SETTINGS_TABS, first, k)).toBeNull();
    }
  });

  it("returns null rather than guessing when the current tab is not in the list", () => {
    expect(nextTabId(SETTINGS_TABS, "nope" as SettingsTabId, "ArrowRight")).toBeNull();
    expect(nextTabId([], first, "ArrowRight")).toBeNull();
  });
});

describe("FIXED_KEYS", () => {
  it("prints something for every row", () => {
    expect(FIXED_KEYS.length).toBeGreaterThan(0);
    for (const k of FIXED_KEYS) {
      expect(k.keys.trim().length).toBeGreaterThan(0);
      expect(k.short.trim().length).toBeGreaterThan(0);
      expect(k.label.trim().length).toBeGreaterThan(0);
      expect(k.chords.length).toBeGreaterThan(0);
    }
  });

  it("gives the palette footer something to render", () => {
    // CommandPalette's footer is now a filter over this table rather than four hardcoded
    // chips. An empty filter would render an empty bar with no other symptom.
    expect(FIXED_KEYS.filter((k) => k.where === "palette").length).toBeGreaterThan(0);
  });

  it("never advertises a key the keymap also binds", () => {
    // THE POINT OF `chords`. The Fixed block sits inches below the rebindable list, and
    // the moment a default lands on one of these the drawer is telling the user that a
    // key they can plainly see and change cannot be changed.
    const bound = new Set(KEY_ACTIONS.flatMap((a) => DEFAULT_KEYMAP[a.id]));
    for (const k of FIXED_KEYS) {
      for (const c of k.chords) expect(bound.has(c)).toBe(false);
    }
  });
});
