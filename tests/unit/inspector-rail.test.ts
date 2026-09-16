import { describe, expect, it } from "vitest";
import {
  TOOLS,
  inspectorRailStore,
  railEdge,
  railStep,
  railTools,
  toggleTool,
  type InspectorTool,
} from "@/lib/console/inspectorRail";

// vitest here is node-environment and collects .ts only — there is no React testing
// library, so a component test is impossible. Everything the rail has to get right
// therefore lives in lib/console/inspectorRail.ts as a pure function, and this file
// is where those invariants are held.
//
// THIS FILE REPLACES tests/unit/map-rail.test.ts. The stage rail it covered is gone
// (Search and View settings moved onto the Sources rail's tool column on 2026-09-16,
// and Draw an area moved with them off the Sources tab), and the assertions moved with
// the behaviour rather than being deleted: "one thing open at a time", the
// roving-focus arithmetic and the store's emit contract are the same invariants, held
// against the same shapes. What has NO replacement is `railHoldsOpen` — it guarded a
// flyout that could be left open over an armed map, and a tool that takes the panel
// body has no such state.

describe("railTools — which buttons are on the rail", () => {
  it("has no eye until a map click has selected something", () => {
    // Sam's rule: the View button APPEARS once there is something to view. An eye
    // that opens an empty pane is the dead control this codebase keeps writing about.
    expect(railTools(false)).toEqual(["search", "settings", "draw", "alerts"]);
    expect(railTools(true)).toEqual(["search", "view", "settings", "draw", "alerts"]);
  });

  it("keeps the declared order — search, view, settings, draw, alerts", () => {
    // Order is a UI decision, not an implementation detail: it is the render order
    // AND the arrow-key order, and the two must not drift. Draw and Alerts are last
    // because they sit below the rule on screen — neither is a map control.
    expect([...TOOLS]).toEqual(["search", "view", "settings", "draw", "alerts"]);
    expect(railTools(true)).toEqual([...TOOLS]);
  });

  it("INCLUDES EVERY BUTTON, because the rail is one tab stop", () => {
    // Draw was an action rather than a tool until Sam's second pass, and this list
    // was a second one (`railSlots`) that appended it. The failure that guarded
    // against is silent and total: the toolbar uses a roving tabindex, so a button
    // left out of the render order is not merely last — it is unreachable from a
    // keyboard, since nothing else on the rail takes Tab.
    //
    // ALERTS IS THE CASE THAT PROVES IT. It arrived as a section inside the Draw
    // panel, went unfound ("i cant see the alerts and bell"), and became a tool.
    for (const hasObject of [true, false]) {
      expect(railTools(hasObject)).toContain("draw");
      expect(railTools(hasObject)).toContain("alerts");
      expect(railTools(hasObject).at(-1)).toBe("alerts");
    }
  });

  it("never invents a tool that is not in TOOLS", () => {
    for (const hasObject of [true, false]) {
      for (const id of railTools(hasObject)) expect(TOOLS).toContain(id);
    }
  });
});

describe("toggleTool — one panel at a time", () => {
  it("opens from the view", () => {
    expect(toggleTool(null, "search")).toBe("search");
  });

  it("closes when the open tool is clicked again, landing on the VIEW", () => {
    // null is not "nothing" — it is the object's own view. That is what makes the
    // eye's pressed state and a closed tool the same state rather than two.
    expect(toggleTool("search", "search")).toBe(null);
  });

  it("replaces rather than stacking", () => {
    expect(toggleTool("search", "settings")).toBe("settings");
    expect(toggleTool("settings", "draw")).toBe("draw");
    expect(toggleTool("draw", "search")).toBe("search");
  });

  it("treats draw like any other tool, which is the change", () => {
    // It used to arm the map on click and hold no panel state at all, so there was
    // nothing to toggle. Sam: "when you click the draw area button on the inspector,
    // it shouldnt just automatically start drawing an area."
    expect(toggleTool(null, "draw")).toBe("draw");
    expect(toggleTool("draw", "draw")).toBe(null);
  });
});

describe("railStep / railEdge — roving tabindex arithmetic", () => {
  const slots = railTools(true);

  it("walks the rendered order and wraps at both ends", () => {
    expect(railStep(slots, "search", 1)).toBe("view");
    expect(railStep(slots, "view", 1)).toBe("settings");
    expect(railStep(slots, "settings", 1)).toBe("draw");
    expect(railStep(slots, "draw", 1)).toBe("alerts");
    expect(railStep(slots, "alerts", 1)).toBe("search");
    expect(railStep(slots, "search", -1)).toBe("alerts");
  });

  it("returns to where it started after a full lap in each direction", () => {
    for (const slot of slots) {
      let f: InspectorTool = slot;
      let b: InspectorTool = slot;
      for (let i = 0; i < slots.length; i++) {
        f = railStep(slots, f, 1);
        b = railStep(slots, b, -1);
      }
      expect(f).toBe(slot);
      expect(b).toBe(slot);
    }
  });

  it("falls back to the first slot when the focused one has gone", () => {
    // The eye disappears when the map selection clears — which can happen while
    // "view" holds focus. Returning undefined there would move focus nowhere, and
    // the arrow key would read as broken rather than as clamped.
    expect(railStep(railTools(false), "view", 1)).toBe("search");
    expect(railStep(railTools(false), "view", -1)).toBe("search");
  });

  it("Home and End hit the real ends", () => {
    expect(railEdge(slots, "first")).toBe("search");
    expect(railEdge(slots, "last")).toBe("alerts");
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
    inspectorRailStore.open("search");
    inspectorRailStore.toggle("search");
    expect(inspectorRailStore.get()).toBe(null);
  });

  it("NEVER HOLDS \"view\" — opening it is closing whatever was open", () => {
    // The store's null IS the view (lib/console/inspectorRail.ts says why), so a
    // caller can say `open("view")` without knowing that, and nothing downstream has
    // to handle a state meaning "no panel, but differently".
    inspectorRailStore.open("settings");
    inspectorRailStore.open("view");
    expect(inspectorRailStore.get()).toBe(null);

    inspectorRailStore.open("search");
    inspectorRailStore.toggle("view");
    expect(inspectorRailStore.get()).toBe(null);
  });

  it("opening a tool a second time by name is a no-op, not a close", () => {
    // `open` asserts; `toggle` is the click. Knowing which one a caller wants is the
    // difference between a map click landing on the object and landing on the tool
    // the user left open — lib/overlay.ts calls close() on every open for that
    // reason, InspectorRail calls toggle().
    inspectorRailStore.open("search");
    inspectorRailStore.open("search");
    expect(inspectorRailStore.get()).toBe("search");
  });
});
