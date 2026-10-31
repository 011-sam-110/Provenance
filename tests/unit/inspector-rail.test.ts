import { describe, expect, it } from "vitest";
import {
  inspectorRailStore,
  railEdge,
  railStep,
  toggleTool,
} from "@/lib/console/inspectorRail";

// vitest here is node-environment and collects .ts only — there is no React testing
// library, so a component test is impossible. Everything the tools have to get right
// therefore lives in lib/console/inspectorRail.ts and lib/console/consolePanel.ts as pure
// functions. This file holds the first; tests/unit/console-panel.test.ts holds the second.
//
// THIS FILE REPLACES tests/unit/map-rail.test.ts. The stage rail it covered is gone
// (Search and View settings moved onto the Sources rail's tool column on 2026-09-16,
// and Draw an area moved with them off the Sources tab), and the assertions moved with
// the behaviour rather than being deleted: "one thing open at a time", the
// roving-focus arithmetic and the store's emit contract are the same invariants, held
// against the same shapes. What has NO replacement is `railHoldsOpen` — it guarded a
// flyout that could be left open over an armed map, and a tool that takes the panel
// body has no such state.

describe("toggleTool — one panel at a time", () => {
  it("opens from the view", () => {
    expect(toggleTool(null, "alerts")).toBe("alerts");
  });

  it("closes when the open tool is clicked again, landing on the VIEW", () => {
    // null is not "nothing" — it is the object's own view. That is what makes the
    // eye's pressed state and a closed tool the same state rather than two.
    expect(toggleTool("alerts", "alerts")).toBe(null);
  });

  it("replaces rather than stacking", () => {
    expect(toggleTool("alerts", "settings")).toBe("settings");
    expect(toggleTool("settings", "draw")).toBe("draw");
    expect(toggleTool("draw", "alerts")).toBe("alerts");
  });

  it("treats draw like any other tool, which is the change", () => {
    // It used to arm the map on click and hold no panel state at all, so there was
    // nothing to toggle. Sam: "when you click the draw area button on the inspector,
    // it shouldnt just automatically start drawing an area."
    expect(toggleTool(null, "draw")).toBe("draw");
    expect(toggleTool("draw", "draw")).toBe(null);
  });
});

describe("railStep / railEdge — walking the sidebar's rows", () => {
  const rows = ["menu", "sources", "inspector", "settings", "draw", "alerts", "controls"] as const;

  it("walks the rendered order and wraps at both ends", () => {
    expect(railStep(rows, "menu", 1)).toBe("sources");
    expect(railStep(rows, "inspector", 1)).toBe("settings");
    expect(railStep(rows, "controls", 1)).toBe("menu");
    expect(railStep(rows, "menu", -1)).toBe("controls");
  });

  it("returns to where it started after a full lap in each direction", () => {
    for (const row of rows) {
      let f: (typeof rows)[number] = row;
      let b: (typeof rows)[number] = row;
      for (let i = 0; i < rows.length; i++) {
        f = railStep(rows, f, 1);
        b = railStep(rows, b, -1);
      }
      expect(f).toBe(row);
      expect(b).toBe(row);
    }
  });

  it("falls back to the first row when the focused one is not on the list", () => {
    // Returning undefined there would move focus nowhere, and the arrow key would read as
    // broken rather than as clamped.
    expect(railStep(["a", "b"], "gone", 1)).toBe("a");
    expect(railStep(["a", "b"], "gone", -1)).toBe("a");
  });

  it("Home and End hit the real ends", () => {
    expect(railEdge(rows, "first")).toBe("menu");
    expect(railEdge(rows, "last")).toBe("controls");
  });
});

describe("inspectorRailStore", () => {
  it("notifies on a real change", () => {
    inspectorRailStore.close();
    let hits = 0;
    const off = inspectorRailStore.subscribe(() => hits++);
    inspectorRailStore.open("settings");
    expect(hits).toBe(1);
    expect(inspectorRailStore.get()).toBe("settings");
    off();
    inspectorRailStore.close();
  });

  it("does not emit on a redundant close", () => {
    inspectorRailStore.close();
    let hits = 0;
    const off = inspectorRailStore.subscribe(() => hits++);
    inspectorRailStore.close();
    expect(hits).toBe(0);
    off();
  });

  it("toggle closes the tool that is already open", () => {
    inspectorRailStore.open("alerts");
    inspectorRailStore.toggle("alerts");
    expect(inspectorRailStore.get()).toBe(null);
  });

  it("NEVER HOLDS \"view\" — opening it is closing whatever was open", () => {
    // The store's null IS the view (lib/console/inspectorRail.ts says why), so a
    // caller can say `open("view")` without knowing that, and nothing downstream has
    // to handle a state meaning "no panel, but differently".
    inspectorRailStore.open("settings");
    inspectorRailStore.open("view");
    expect(inspectorRailStore.get()).toBe(null);

    inspectorRailStore.open("alerts");
    inspectorRailStore.toggle("view");
    expect(inspectorRailStore.get()).toBe(null);
  });

  it("opening a tool a second time by name is a no-op, not a close", () => {
    // `open` asserts; `toggle` is the click. Knowing which one a caller wants is the
    // difference between a map click landing on the object and landing on the tool
    // the user left open — every overlay.open() closes the tool for that reason, through
    // lib/console/consolePanel.ts.
    inspectorRailStore.open("alerts");
    inspectorRailStore.open("alerts");
    expect(inspectorRailStore.get()).toBe("alerts");
  });
});
