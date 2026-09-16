import { describe, expect, it } from "vitest";
import {
  TOOLS,
  inspectorRailStore,
  railEdge,
  railSlots,
  railStep,
  railTools,
  toggleTool,
  type RailSlot,
} from "@/lib/console/inspectorRail";

// vitest here is node-environment and collects .ts only — there is no React testing
// library, so a component test is impossible. Everything the rail has to get right
// therefore lives in lib/console/inspectorRail.ts as a pure function, and this file
// is where those invariants are held.
//
// THIS FILE REPLACES tests/unit/map-rail.test.ts. The stage rail it covered is gone
// (Search and View settings moved onto the Inspector panel's tool column on
// 2026-09-16, and Draw an area moved with them from the Sources tab), and the
// assertions moved with the behaviour rather than being deleted: "one thing open at
// a time", the roving-focus arithmetic and the store's emit contract are the same
// invariants, held against the same shapes. What has NO replacement is
// `railHoldsOpen` — it guarded a flyout that could be left open over an armed map,
// and a tool that takes the panel body has no such state.

describe("railTools — which buttons are on the rail", () => {
  it("has no eye until a map click has selected something", () => {
    // Sam's rule: the View button APPEARS once there is something to view. An eye
    // that opens an empty pane is the dead control this codebase keeps writing about.
    expect(railTools(false)).toEqual(["search", "settings"]);
    expect(railTools(true)).toEqual(["search", "view", "settings"]);
  });

  it("keeps the declared order — search, view, settings", () => {
    // Order is a UI decision, not an implementation detail: it is the render order
    // AND the arrow-key order, and the two must not drift.
    expect([...TOOLS]).toEqual(["search", "view", "settings"]);
    expect(railTools(true)).toEqual([...TOOLS]);
  });

  it("never invents a tool that is not in TOOLS", () => {
    for (const hasObject of [true, false]) {
      for (const id of railTools(hasObject)) expect(TOOLS).toContain(id);
    }
  });
});

describe("railSlots — the focus order", () => {
  it("puts draw last, after the tools", () => {
    expect(railSlots(true)).toEqual(["search", "view", "settings", "draw"]);
    expect(railSlots(false)).toEqual(["search", "settings", "draw"]);
  });

  it("INCLUDES DRAW, because the rail is one tab stop", () => {
    // The failure this pins is silent and total: the toolbar uses a roving tabindex,
    // so a slot left out of this list is not merely last — it is unreachable from a
    // keyboard, since nothing else on the rail takes Tab. Draw is an action rather
    // than a tool, which is why it is not in TOOLS, and it is still a button on the
    // same toolbar, which is why it is here.
    for (const hasObject of [true, false]) {
      expect(railSlots(hasObject)).toContain("draw");
      expect(railSlots(hasObject).at(-1)).toBe("draw");
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
    expect(toggleTool("settings", "search")).toBe("search");
  });
});

describe("railStep / railEdge — roving tabindex arithmetic", () => {
  const slots = railSlots(true);

  it("walks the rendered order and wraps at both ends", () => {
    expect(railStep(slots, "search", 1)).toBe("view");
    expect(railStep(slots, "view", 1)).toBe("settings");
    expect(railStep(slots, "settings", 1)).toBe("draw");
    expect(railStep(slots, "draw", 1)).toBe("search");
    expect(railStep(slots, "search", -1)).toBe("draw");
  });

  it("returns to where it started after a full lap in each direction", () => {
    for (const slot of slots) {
      let f: RailSlot = slot;
      let b: RailSlot = slot;
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
    expect(railEdge(slots, "last")).toBe("draw");
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
    // reason, and InspectorRail calls toggle().
    inspectorRailStore.open("search");
    inspectorRailStore.open("search");
    expect(inspectorRailStore.get()).toBe("search");
  });
});
