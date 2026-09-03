// tests/unit/widgets-dock.test.ts
//
// lib/widgets/dock.ts is the bridge between a Source Catalog row and the
// console workspace. Under the free grid its ＋ added a widget outright,
// because the grid picked the spot itself. There are rails now and no
// spot-picker left, so the ＋ ASKS which rail and adds nothing until the
// question is answered — see lib/console/placement.ts.
//
// These tests exist because the difference between the two is invisible to
// the type checker once a segment is supplied: a default of "left" compiles
// and reverses the product decision (every ＋ asks, every time, with no
// remembered default) in silence. So the assertion is specifically that the
// layout is UNCHANGED and a request is pending, not merely that something
// happened.
//
// Node environment, no DOM, module-level singletons — same idiom as
// tests/unit/console-placement.test.ts: stub `window`, import dynamically.

import { afterEach, beforeEach, expect, test } from "vitest";

/** Toasts are `window.dispatchEvent(new CustomEvent("tn-toast", ...))`. */
let toasts: string[] = [];

function installWindow(): void {
  toasts = [];
  (globalThis as { window?: unknown }).window = {
    localStorage: undefined,
    dispatchEvent: (e: { type?: string; detail?: unknown }) => {
      if (e.type === "tn-toast") toasts.push(String(e.detail));
      return true;
    },
  };
  // dock.ts constructs a CustomEvent; node 18+ has one, but keep the test
  // honest if it is ever run somewhere that does not.
  if (typeof (globalThis as { CustomEvent?: unknown }).CustomEvent === "undefined") {
    (globalThis as { CustomEvent?: unknown }).CustomEvent = class {
      type: string;
      detail: unknown;
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    };
  }
}

beforeEach(async () => {
  installWindow();
  const { placementStore } = await import("@/lib/console/placement");
  const { shellLayoutStore } = await import("@/lib/console/store");
  const { createDefaultLayout } = await import("@/lib/console/types");
  placementStore.cancel();
  shellLayoutStore.set(createDefaultLayout());
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

test("toggling a CLOSED signal source asks which rail, and adds nothing yet", async () => {
  const { toggleSourceWidget } = await import("@/lib/widgets/dock");
  const { placementStore } = await import("@/lib/console/placement");
  const { shellLayoutStore } = await import("@/lib/console/store");

  const before = shellLayoutStore.get().widgets.length;
  toggleSourceWidget("wildfires", "Wildfires");

  // The question is pending, carrying the label the picker's heading shows. The
  // type is the mapped WIDGET type, not the catalog id — lib/console/sourceWidgets
  // sends a signal to its per-signal card.
  expect(placementStore.get()).toEqual({ type: "signal:wildfires", label: "Wildfires" });
  // And nothing has been placed — the user has not answered yet.
  expect(shellLayoutStore.get().widgets.length).toBe(before);
});

test("a CORE source with no bespoke widget asks for its generic leaf card", async () => {
  const { toggleSourceWidget } = await import("@/lib/widgets/dock");
  const { placementStore } = await import("@/lib/console/placement");

  // The other half of the mapping: a core layer the console has no bespoke card
  // for opens the `source:` leaf. Both branches are exercised so a change to
  // sourceWidgets.ts cannot quietly send one kind of row to the wrong widget.
  toggleSourceWidget("webcams", "Webcams");

  expect(placementStore.get()).toEqual({ type: "source:webcams", label: "Webcams" });
});

test("no widget-added toast fires on the ask", async () => {
  const { toggleSourceWidget } = await import("@/lib/widgets/dock");

  toggleSourceWidget("wildfires", "Wildfires");

  // The old code announced "Wildfires added to your workspace" the instant the
  // ＋ was clicked. Saying that while a modal is still asking where to put it
  // is a claim about something that has not happened.
  expect(toasts).toEqual([]);
});

test("toggling an OPEN source removes it, and asks nothing", async () => {
  const { toggleSourceWidget } = await import("@/lib/widgets/dock");
  const { placementStore } = await import("@/lib/console/placement");
  const { shellLayoutStore } = await import("@/lib/console/store");

  const added = shellLayoutStore.add("signal:wildfires", { segment: "left" });
  expect(added.ok).toBe(true);

  toggleSourceWidget("wildfires", "Wildfires");

  expect(shellLayoutStore.get().widgets.filter((w) => w.type === "signal:wildfires")).toEqual([]);
  // Removing is not a placement, so no question is raised.
  expect(placementStore.get()).toBeNull();
});

test("a category roll-up asks under its own label", async () => {
  const { toggleGroupWidget } = await import("@/lib/widgets/dock");
  const { placementStore } = await import("@/lib/console/placement");

  toggleGroupWidget("Hazards");

  expect(placementStore.get()).toEqual({ type: "rollup:Hazards", label: "Hazards roll-up" });
});

test("a second ＋ before the first is answered replaces the question", async () => {
  const { toggleSourceWidget } = await import("@/lib/widgets/dock");
  const { placementStore } = await import("@/lib/console/placement");
  const { shellLayoutStore } = await import("@/lib/console/store");

  toggleSourceWidget("wildfires", "Wildfires");
  toggleSourceWidget("earthquakes", "Earthquakes");

  // One picker, one question. The first is dropped rather than queued, which
  // is placementStore's documented behaviour — pinned here from the caller's
  // side so a queue cannot be added later without this test noticing.
  expect(placementStore.get()).toEqual({ type: "signal:earthquakes", label: "Earthquakes" });
  expect(shellLayoutStore.get().widgets.length).toBe(0);
});
