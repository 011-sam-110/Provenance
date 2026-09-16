"use client";
// The INSPECTOR RAIL — the tool column on the right edge of the Sources rail, shown
// on BOTH tabs, and the one store behind it.
//
// WHY IT EXISTS. Sam asked for the map's own controls to come off the map: the stage
// rail (components/console/maprail/MapRail.tsx) carried Search and View settings on
// the right edge of the globe, and "Draw an area" was a button in the Sources tab.
// All of them are one rail on this panel now. CHOSEN FROM RENDERED OPTIONS, not from
// a description: option C for the rail's edge (map side) and option D for what a tool
// does when it opens (it takes the panel body). Both are in ~/Desktop/rail-options/
// with the rejected layouts.
//
// IT IS ON BOTH TABS, AND IT IS NOT PART OF EITHER ONE. Sam's second pass: the
// buttons should be there whichever tab you are reading, and clicking one should
// bring you to the Inspector and open that tool. So the rail is a sibling of the tab
// panels rather than a child of the Inspector's — see components/shell/
// SourceCatalog.tsx for the layout and InspectorRail.tsx for the click that switches.
//
// ONE TOOL OPEN AT A TIME, and the same reasoning the stage rail wrote down still
// holds: these are panels over a workstation, not independent windows, and a second
// one open would halve a column that is already the narrowest surface in the console.
//
// "VIEW" IS NOT A PANEL, IT IS THE HOME STATE. `open === null` IS the view — the
// dossier for whatever the map has selected. That is why clicking the eye closes
// whatever tool is open rather than opening a fourth thing, why the eye reads as
// pressed whenever nothing else is, and why it is absent entirely until a click has
// selected something (there is nothing to view before then, and a control that opens
// an empty pane is the dead control this codebase keeps writing about).
//
// DRAW IS A TOOL NOW, AND IT WAS AN ACTION. It used to arm the map the moment you
// clicked its button, which Sam judged wrong: the button is the way IN to drawing,
// not the gesture itself, and a click that starts a map interaction from a panel the
// user has not read yet is a click with no undo. So it opens a panel like the rest,
// and the gesture starts from a button INSIDE it — which is also where the areas list
// lives, moved off the Sources tab, because "what areas do I have" and "draw another
// one" are the same question.
//
// ALERTS JOINED IT LATER, AND FOR A BLUNTER REASON: as a section inside the Draw panel
// it went unfound. Sam's report was "i cant see the alerts and bell", and a control
// nobody can find is not a control. It has its own button and its own panel now.
//
// DRAW AND ALERTS ARE SEPARATE GROUPS ON THE RAIL, each opening with its own rule:
// the three above them change what the MAP looks like, Draw defines the areas you
// have, and Alerts says what should be said about them. They were one group for one
// build and that was wrong in a way only Sam could see — "the alerts isnt its own
// separate section, its part of the drawing" — because a rule is the only thing on
// that column saying where one idea stops and the next starts.
//
// Both are in TOOLS like everything else, so the roving-focus arithmetic never needs a
// special case for either.
//
// WHY THE REDUCERS ARE HERE AND NOT IN THE COMPONENT. vitest is configured
// `environment: "node"` with `include: ["tests/unit/**/*.test.ts"]`, .tsx is not
// collected and no React testing library is installed, so anything left inside the
// component cannot be tested at all. Same constraint, same answer as the file this
// one replaces: every invariant that matters is a pure export with a test on it.
//
// NOT PERSISTED, and this is where the retired stage rail's reasoning had to be
// re-checked rather than copied. Chrome that reopens a panel on every visit outstays
// its welcome, and a rail that remembered "Map settings" would hide the object the
// user just clicked — which is the whole reason they clicked. `open` therefore starts
// null on every launch, and overlay.open() closes it (see lib/overlay.ts), so a map
// click always lands on that object's view.

import { useSyncExternalStore } from "react";

/** Everything the rail can put on screen, in render order, top to bottom. */
export type InspectorTool = "search" | "view" | "settings" | "draw" | "alerts";

/**
 * The tools the STORE can be holding. "view" is not one of them: the store's null IS
 * the view, so `open()` translates "view" to null on the way in and nothing
 * downstream ever has to handle a state that means "no panel, but differently".
 */
export type OpenTool = Exclude<InspectorTool, "view">;

/** Render order. Also the arrow-key order and the roving-focus order. */
export const TOOLS: readonly InspectorTool[] = [
  "search",
  "view",
  "settings",
  "draw",
  "alerts",
] as const;

/**
 * The tools that are actually on screen, in order.
 *
 * "View" is filtered out while nothing is selected: the eye appears the moment a map
 * click gives it something to show. This is the ONE place that membership is decided,
 * so the roving tabindex, the arrow keys and the rendered buttons cannot disagree
 * about how many there are.
 *
 * THIS IS ALSO THE FOCUS ORDER, and it used to be a second list. When Draw was an
 * action rather than a tool there was a `railSlots` that appended it, because the
 * rail is ONE tab stop and a button outside the roving set is unreachable from a
 * keyboard rather than merely last. Draw is a tool, so the two lists are the same
 * list and the second one is gone — if a future rail grows a button that is not a
 * tool, that function comes back rather than a special case in the component.
 */
export function railTools(hasObject: boolean): InspectorTool[] {
  return TOOLS.filter((t) => t !== "view" || hasObject);
}

/**
 * Click a rail button. Clicking the open tool closes it; clicking any other opens
 * it. `null` — the view — is what a close lands on, so "close" and "show me the
 * object" are the same state rather than two that can drift apart.
 */
export function toggleTool(open: OpenTool | null, tool: OpenTool): OpenTool | null {
  return open === tool ? null : tool;
}

/**
 * Move along the rail by one, wrapping at both ends. Roving-tabindex arithmetic.
 *
 * TAKES THE RENDERED LIST rather than reading a constant, and is generic over what
 * that list holds: the eye comes and goes with the map selection, so arithmetic over
 * a fixed four would step onto a button that is not in the DOM — focus would move
 * nowhere and the arrow key would read as broken.
 */
export function railStep<T>(ids: readonly T[], from: T, dir: 1 | -1): T {
  const i = ids.indexOf(from);
  const n = ids.length;
  // `from` can be absent when the eye disappears under the focused button — a map
  // click clearing the selection while "view" holds focus. Falling back to the first
  // entry keeps the key doing something sane instead of returning undefined.
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
