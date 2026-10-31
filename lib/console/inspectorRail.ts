"use client";
// WHICH TOOL HAS TAKEN THE INSPECTOR'S PLACE: Map settings, Areas or Notifications.
//
// lib/console/consolePanel.ts is the door everything goes through; this is the store under
// it, and it keeps the name of the column that first held these buttons.
//
// WHY THE TOOLS EXIST AS THEY DO. Sam asked for the map's own controls to come off the
// map: the stage rail (components/console/maprail/MapRail.tsx) carried them on the right
// edge of the globe, and "Draw an area" was a button in the Sources tab. They moved to
// a tool column on the Sources panel, CHOSEN FROM RENDERED OPTIONS, not from a description
// (option C for its edge, option D for what a tool does when it opens: it takes the panel
// body; both are in ~/Desktop/rail-options/). Since the HUD v2 work (2026-10-31) the buttons
// are rows on the console's sidebar, components/shell/ConsoleSidebar.tsx, and option D still
// holds: a tool takes the whole panel, it is never a card over the object.
//
// ONE TOOL OPEN AT A TIME, and the same reasoning the stage rail wrote down still holds:
// these are panels over a workstation, not independent windows.
//
// "VIEW" IS NOT A TOOL, IT IS THE HOME STATE. `open === null` IS the Inspector's own view,
// the dossier for whatever the map has selected. That is why opening "view" closes whatever
// tool is open rather than opening a fourth thing. Until 2026-10-31 the eye button was
// absent until a click had selected something, because "a control that opens an empty pane
// is the dead control this codebase keeps writing about". Sam then asked for Inspector to
// be a place you can see: the row is always on the sidebar, and with nothing selected the
// pane says what to do instead of being empty (components/shell/InspectorPanel.tsx). The
// objection was to a control that does nothing, and that one now tells you how to use it.
//
// DRAW IS A TOOL, AND IT WAS AN ACTION. It used to arm the map the moment you clicked its
// button, which Sam judged wrong: the button is the way IN to drawing, not the gesture
// itself, and a click that starts a map interaction from a panel the user has not read yet
// is a click with no undo. So it opens a panel like the rest, and the gesture starts from a
// button INSIDE it, which is also where the areas list lives, because "what areas do I
// have" and "draw another one" are the same question. The sidebar calls this tool Areas;
// its store id stays "draw".
//
// ALERTS JOINED IT LATER, AND FOR A BLUNTER REASON: as a section inside the Draw panel it
// went unfound. Sam's report was "i cant see the alerts and bell", and a control nobody can
// find is not a control. It has its own row and its own panel.
//
// DRAW AND ALERTS ARE SEPARATE GROUPS on the sidebar, each opening with a rule: Map settings
// changes what the MAP looks like, Areas defines the places you have, and Notifications says
// what should be said about them. They were one group for one build and that was wrong in a
// way only Sam could see: "the alerts isnt its own separate section, its part of the
// drawing".
//
// SEARCH LEFT ON 2026-10-31. It is a pill on the map now (components/console/MapSearch.tsx),
// so it is not a tool and the store cannot hold it.
//
// WHY THE REDUCERS ARE HERE AND NOT IN THE COMPONENT. vitest is configured
// `environment: "node"` with `include: ["tests/unit/**/*.test.ts"]`, .tsx is not collected
// and no React testing library is installed, so anything left inside the component cannot
// be tested at all. Every invariant that matters is a pure export with a test on it.
//
// NOT PERSISTED, and this is where the retired stage rail's reasoning had to be re-checked
// rather than copied. Chrome that reopens a panel on every visit outstays its welcome, and
// a rail that remembered "Map settings" would hide the object the user just clicked, which
// is the whole reason they clicked. `open` therefore starts null on every launch, and
// overlay.open() closes it (see lib/overlay.ts), so a map click always lands on that
// object's view.

import { useSyncExternalStore } from "react";

/** The tools the STORE can be holding. */
export type OpenTool = "settings" | "draw" | "alerts";

/** Everything `open` and `toggle` accept. "view" is the store's null. */
export type InspectorTool = OpenTool | "view";

/**
 * Click a tool's button. Clicking the open tool closes it; clicking any other opens it.
 * `null`, the view, is what a close lands on, so "close" and "show me the object" are the
 * same state rather than two that can drift apart.
 */
export function toggleTool(open: OpenTool | null, tool: OpenTool): OpenTool | null {
  return open === tool ? null : tool;
}

/**
 * Move along a column of buttons by one, wrapping at both ends. The arrow keys on the
 * sidebar use it.
 *
 * TAKES THE RENDERED LIST rather than reading a constant, and is generic over what that list
 * holds, so arithmetic over a fixed count cannot step onto a button that is not in the DOM:
 * focus would move nowhere and the arrow key would read as broken.
 */
export function railStep<T>(ids: readonly T[], from: T, dir: 1 | -1): T {
  const i = ids.indexOf(from);
  const n = ids.length;
  // `from` can be absent when focus is not on a row at all. Falling back to the first entry
  // keeps the key doing something sane instead of returning undefined.
  if (i === -1) return ids[0];
  return ids[(i + dir + n) % n];
}

/** Home / End. */
export function railEdge<T>(ids: readonly T[], to: "first" | "last"): T {
  return to === "first" ? ids[0] : ids[ids.length - 1];
}

// ── the store ────────────────────────────────────────────────────────────────

let open: OpenTool | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

function set(next: OpenTool | null) {
  // Early-return on no-change, the contract every other store in this repo keeps:
  // a redundant close() must not wake every subscriber.
  if (open === next) return;
  open = next;
  emit();
}

export const inspectorRailStore = {
  get(): OpenTool | null {
    return open;
  },
  open(tool: InspectorTool) {
    // "view" is the closed state. Opening it is closing whatever else is open, and
    // routing it through the same setter means a caller can say `open("view")`
    // without knowing that.
    set(tool === "view" ? null : tool);
  },
  close() {
    set(null);
  },
  toggle(tool: InspectorTool) {
    set(tool === "view" ? null : toggleTool(open, tool));
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

export function useInspectorRail(): OpenTool | null {
  return useSyncExternalStore(inspectorRailStore.subscribe, inspectorRailStore.get, () => null);
}
