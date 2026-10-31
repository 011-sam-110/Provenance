import { beforeEach, describe, expect, it } from "vitest";
import {
  PANEL_TITLE,
  closePanel,
  leaveInspector,
  mapAbsenceNote,
  nextPanel,
  openPanel,
  panelAfterToolEscape,
  panelOf,
  readPanel,
  showInspector,
  togglePanel,
  type ConsolePanel,
} from "@/lib/console/consolePanel";
import { inspectorRailStore } from "@/lib/console/inspectorRail";
import { railTabStore } from "@/lib/console/railTab";
import { shouldHintRail, sourcesRailStore } from "@/lib/console/sourcesRail";
import { mapControlGroups } from "@/lib/console/mapControls";
import { DEFAULT_KEYMAP, FIXED_KEYS } from "@/lib/shell/keymap";

// Which panel is open beside the console's sidebar. It is a view over three stores, so what
// needs holding is that the three can only ever describe one panel, and that every door
// goes through the same rules. What needs a DOM is in tests/e2e/console-sidebar.spec.ts.

beforeEach(() => {
  inspectorRailStore.close();
  railTabStore.set("sources");
  closePanel();
  // Clears the remembered "came from" between tests.
  openPanel("inspector");
  leaveInspector();
  closePanel();
});

describe("panelOf: every state of the three stores is one panel", () => {
  it("is nothing while the panel is closed, whatever the other two hold", () => {
    expect(panelOf({ open: false, tab: "sources", tool: null })).toBeNull();
    expect(panelOf({ open: false, tab: "inspector", tool: "settings" })).toBeNull();
  });

  it("is Sources on that tab, and a tool left in the store does not show through", () => {
    expect(panelOf({ open: true, tab: "sources", tool: null })).toBe("sources");
    expect(panelOf({ open: true, tab: "sources", tool: "draw" })).toBe("sources");
  });

  it("is the tool when one is open, and the Inspector when none is", () => {
    expect(panelOf({ open: true, tab: "inspector", tool: null })).toBe("inspector");
    expect(panelOf({ open: true, tab: "inspector", tool: "alerts" })).toBe("alerts");
  });
});

describe("nextPanel: what a click on a row leaves open", () => {
  it("opens from nothing, closes on a second click, replaces otherwise", () => {
    expect(nextPanel(null, "sources")).toBe("sources");
    expect(nextPanel("sources", "sources")).toBeNull();
    expect(nextPanel("sources", "draw")).toBe("draw");
  });
});

describe("openPanel and togglePanel", () => {
  it("each row lands on its own panel, one at a time", () => {
    const panels: ConsolePanel[] = ["sources", "inspector", "settings", "draw", "alerts"];
    for (const p of panels) {
      openPanel(p);
      expect(readPanel()).toBe(p);
    }
  });

  it("a second toggle closes, on every row", () => {
    for (const p of ["sources", "inspector", "settings", "draw", "alerts"] as ConsolePanel[]) {
      togglePanel(p);
      expect(readPanel()).toBe(p);
      togglePanel(p);
      expect(readPanel()).toBeNull();
    }
  });

  it("moving off a tool to Sources leaves no tool behind in the store", () => {
    openPanel("settings");
    openPanel("sources");
    expect(inspectorRailStore.get()).toBeNull();
  });

  it("the Sources chord from another panel goes to Sources, not to closed", () => {
    openPanel("alerts");
    togglePanel("sources");
    expect(readPanel()).toBe("sources");
  });

  it("opening by any route ends the fresh-launch hint, and closing does not bring it back", () => {
    // The store keeps this for the whole file, so the assertion is on the rule and the state
    // after a real open. The rule itself is pinned by tests/unit/sources-rail.test.ts.
    openPanel("draw");
    expect(shouldHintRail(sourcesRailStore.get())).toBe(false);
    closePanel();
    expect(shouldHintRail(sourcesRailStore.get())).toBe(false);
  });
});

describe("an inspection goes back to what it replaced", () => {
  it("a click made with no panel open gives the map back", () => {
    showInspector();
    expect(readPanel()).toBe("inspector");
    leaveInspector();
    expect(readPanel()).toBeNull();
  });

  it("a click made while reading Sources goes back to Sources", () => {
    openPanel("sources");
    showInspector();
    leaveInspector();
    expect(readPanel()).toBe("sources");
  });

  it("an area opened from the Areas list goes back to that list", () => {
    openPanel("draw");
    showInspector();
    expect(inspectorRailStore.get()).toBeNull();
    leaveInspector();
    expect(readPanel()).toBe("draw");
  });

  it("a second inspection on top of the first keeps the first place to go back to", () => {
    openPanel("sources");
    showInspector();
    showInspector();
    leaveInspector();
    expect(readPanel()).toBe("sources");
  });

  it("a panel the visitor has moved to since is theirs, and is left alone", () => {
    openPanel("sources");
    showInspector();
    openPanel("settings");
    leaveInspector();
    expect(readPanel()).toBe("settings");
  });
});

describe("panelAfterToolEscape", () => {
  it("lands on the object when there is one, and closes when there is none", () => {
    expect(panelAfterToolEscape(true)).toBe("inspector");
    expect(panelAfterToolEscape(false)).toBeNull();
  });
});

describe("mapAbsenceNote: the rows that need the map say when it is not there", () => {
  const open = { segments: { right: { collapsed: false } } };

  it("says nothing while the map is on screen", () => {
    expect(mapAbsenceNote({ ...open, focusedWidgetId: null, mode: "rails" })).toBeNull();
    expect(mapAbsenceNote({ ...open, focusedWidgetId: null, mode: "wall" })).toBeNull();
  });

  it("names the focused widget's case, and how to get the map back", () => {
    expect(mapAbsenceNote({ ...open, focusedWidgetId: "w1", mode: "rails" })).toMatch(/Close that widget/);
  });

  it("names the closed dock's case on a wall board, and only there", () => {
    const closed = { segments: { right: { collapsed: true } }, focusedWidgetId: null };
    expect(mapAbsenceNote({ ...closed, mode: "wall" })).toMatch(/Press Map/);
    // A rails board's right segment is a widget rail: collapsing it does not hide the map.
    expect(mapAbsenceNote({ ...closed, mode: "rails" })).toBeNull();
  });
});

describe("the sidebar's words", () => {
  it("names the five panels as Sam listed them", () => {
    expect(PANEL_TITLE).toEqual({
      sources: "Sources",
      inspector: "Inspector",
      settings: "Map settings",
      draw: "Areas",
      alerts: "Notifications",
    });
  });
});

describe("mapControlGroups: the Controls popover", () => {
  const groups = mapControlGroups(DEFAULT_KEYMAP, false);
  const keys = groups.find((g) => g.id === "keys")!;

  it("has the three groups, each with rows", () => {
    expect(groups.map((g) => g.id)).toEqual(["mouse", "touch", "keys"]);
    for (const g of groups) expect(g.rows.length).toBeGreaterThan(0);
  });

  it("prints the visitor's own keys, not typed ones", () => {
    const rebound = mapControlGroups({ ...DEFAULT_KEYMAP, sources: ["ctrl+b"] }, false);
    const sources = rebound.find((g) => g.id === "keys")!.rows.find((r) => r.does === "Sources panel");
    expect(sources?.how).toBe("Ctrl+B");
    expect(keys.rows.find((r) => r.does === "Sources panel")?.how).toBe("Ctrl+K");
  });

  it("joins an action's several keys, and says so when an action has none", () => {
    expect(keys.rows.find((r) => r.does === "Search the map")?.how).toContain(" or ");
    const none = mapControlGroups({ ...DEFAULT_KEYMAP, draw: [] }, false);
    expect(none.find((g) => g.id === "keys")!.rows.find((r) => r.does === "Draw an area")?.how).toBe("No key set");
  });

  it("prints a Mac's own marks on a Mac", () => {
    const mac = mapControlGroups(DEFAULT_KEYMAP, true).find((g) => g.id === "keys")!;
    expect(mac.rows.find((r) => r.does === "Sources panel")?.how).toContain("⌘");
  });

  it("takes Escape from the keymap's own table", () => {
    const esc = FIXED_KEYS.find((k) => k.chords.includes("escape") && k.where === "console");
    expect(keys.rows.at(-1)).toEqual({ does: "Close or step back", how: esc?.keys });
  });

  it("does not use a word for a state the map cannot prove", () => {
    // The console's rule on the word, applied to every string in the popover.
    const text = groups.flatMap((g) => g.rows.flatMap((r) => [r.does, r.how])).join(" ");
    expect(text).not.toMatch(/\blive\b/i);
  });
});
