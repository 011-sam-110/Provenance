"use client";
// The stage rail: two icon groups on the right edge of the map, one flyout open
// at a time. This module is the rail's brain — the pure reducers plus a
// module-level store — and it holds everything worth testing.
//
// IT WAS FOUR. "Restrict results to an area" (draw) and "Pick cameras for a wall"
// (cameras) were removed on request; Search and View stay.
//
// MOSTLY THE FEATURES DID NOT GO WITH THEIR BUTTONS, and the exception is worth
// stating rather than discovering. Still reachable: startDraw() from the inspector's
// "Draw an area" (components/shell/inspector/AreasPanel.tsx) and from the Ctrl+Q
// keymap action (ConsoleShell.tsx), and camera picking from the empty camera wall's
// "Pick cameras on the map" (camslot.tsx). NOT reachable any more: startAreaPick()
// in lib/console/widgets/camslot.area.ts - picking cameras BY DRAWING A SHAPE was
// the Cameras flyout's second button and had no other door. It is left in place
// rather than deleted, because that is a product call and not this change's to
// make; if it is wanted back it needs a control, not a repair.
//
// So anything reasoning about whether the map can still be ARMED must answer YES -
// see railHoldsOpen below, which is exactly where that assumption would have been
// quietly wrong.
//
// WHY A MODULE STORE AND NOT useState. `focusStageSearch()` in
// components/terminal/StageBar.tsx is called synchronously from ConsoleShell's
// keydown handler when the user presses "/", and it has to be able to open the
// search flyout from outside React. That is the same reason pickStore
// (camslot.pick.ts) and areaPickStore (camslot.area.ts) are module stores rather
// than context, and this file deliberately copies their shape.
//
// WHY THE LOGIC LIVES HERE AND NOT IN THE COMPONENT. vitest is configured
// `environment: "node"` with `include: ["tests/unit/**/*.test.ts"]` — .tsx is not
// collected and no React testing library is installed, so anything left inside a
// component cannot be tested at all. Every invariant that matters (one group open
// at a time, the roving-focus arithmetic, the basemap label table) is a pure
// function exported from here so tests/unit/map-rail.test.ts can hold it.
//
// NOT PERSISTED, same contract as mapViewStore: chrome that reopens a panel on
// every visit outstays its welcome, and there is no `?param` for it to race.

import { useSyncExternalStore } from "react";
import { BASEMAPS, type BasemapKey } from "@/lib/basemaps";
import type { StageId } from "@/lib/console/types";

export type RailGroup = "search" | "view";
export type RailOpen = RailGroup | null;

/** Rail order, top to bottom. Also the arrow-key order. */
export const RAIL_GROUPS = ["search", "view"] as const;

/**
 * Click a rail button. Clicking the open group closes it; clicking any other
 * group replaces it. This is the whole "one group open at a time" rule, and it is
 * a function rather than a setState branch so a test can hold it.
 */
export function toggleGroup(open: RailOpen, group: RailGroup): RailOpen {
  return open === group ? null : group;
}

/**
 * Move along the rail by one, wrapping at both ends. Roving-tabindex arithmetic.
 *
 * AT n=2 THE TWO DIRECTIONS COINCIDE, and the modulo is what makes that fall out
 * rather than needing a case: from either group, +1 and -1 both land on the other
 * one, because (i+1) and (i-1) are congruent mod 2. That is the correct behaviour
 * for a two-item toolbar and not a degenerate one — ArrowDown from the last item
 * has always wrapped to the first, and with two items the first IS the other item.
 * tests/unit/map-rail.test.ts asserts it explicitly so the arithmetic is pinned
 * rather than merely happening to work.
 */
export function railStep(from: RailGroup, dir: 1 | -1): RailGroup {
  const i = RAIL_GROUPS.indexOf(from);
  const n = RAIL_GROUPS.length;
  return RAIL_GROUPS[(i + dir + n) % n];
}

/** Home / End. */
export function railEdge(to: "first" | "last"): RailGroup {
  return to === "first" ? RAIL_GROUPS[0] : RAIL_GROUPS[RAIL_GROUPS.length - 1];
}

/**
 * Does an outside click leave the flyout open? YES while the map is armed.
 *
 * IT KEPT ITS JOB WHEN DRAW AND CAMERAS LEFT THE RAIL, and that was checked rather
 * than assumed. The rule was written for those two groups: both existed to make the
 * user click ON THE MAP, and a plain close-on-outside-click would have shut the
 * panel on the very first vertex and taken the live counter and Cancel with it.
 * Both groups are gone, so the obvious reading is that the guard has no work left.
 *
 * It has. "No caller" and "does not happen" are different claims, and only the
 * first one changed. The clearest live case is the Ctrl+Q keymap action: it arms a
 * draw without touching the rail at all, so a flyout that was open stays open and
 * the user's next click - a vertex - is an outside click. Camera picking reaches
 * the same state in two steps, since the empty camera wall's "Pick cameras on the
 * map" arms the mode and the rail can be reopened over it; every pin click after
 * that is an outside click too. Without this guard those clicks close the flyout
 * underneath.
 *
 * WHAT DID CHANGE IS THE STAKES, and the honest version is worth writing down: the
 * two surviving flyouts carry no vertex counter and no Cancel, so losing one costs a
 * reopen rather than the controls for the gesture in flight. That is why this is
 * kept as correct behaviour and not restored as a §1 regression guard. Both inputs
 * are still live truths; delete it only when nothing can arm the map at all.
 */
export function railHoldsOpen(drawActive: boolean, picking: boolean): boolean {
  return drawActive || picking;
}

/** 3D is the globe (map3d); 2D is the flat mercator stage (map2d). */
export function stageForMode(mode: "2d" | "3d"): StageId {
  return mode === "3d" ? "map3d" : "map2d";
}

/**
 * The inverse, for reading the current state back. `null` for the legacy "clock"
 * stage, which renders neither button checked. StageBar's own gate means the rail
 * is unmounted in that state anyway, so this is a guard rather than a case.
 */
export function modeForStage(stage: StageId): "2d" | "3d" | null {
  if (stage === "map3d") return "3d";
  if (stage === "map2d") return "2d";
  return null;
}

/**
 * Short labels for the View strip, which has to stay lateral. The full label from
 * BASEMAPS rides along in each button's `title`, so the abbreviation is never the
 * only name a user is given.
 *
 * tests/unit/map-rail.test.ts asserts this covers every key of BASEMAPS and adds
 * none of its own — a sixth basemap must fail there rather than render a blank chip.
 */
export const RAIL_BASEMAP_LABEL: Record<BasemapKey, string> = {
  streets: "Streets",
  satellite: "Sat",
  topo: "Topo",
};

/** Iteration order for the strip. BASEMAPS' own key order is load-bearing — see lib/basemaps.ts. */
export function railBasemapKeys(): BasemapKey[] {
  return Object.keys(BASEMAPS) as BasemapKey[];
}

// THE DARK/LIGHT PAIR BUTTON IS GONE, along with RAIL_PAIR, isPairBasemap(),
// railStandaloneBasemaps() and nextPairBasemap().
//
// It existed because Dark and Light were "the same map in two values", so one button
// could offer the other one and buy back a chip of width on a strip whose job is to
// stay lateral. Both of those basemaps have now left the registry with the console's
// dark skin, so the pair has no members: every remaining basemap — Streets, Sat,
// Topo — is a genuinely different map that a reader does weigh against the others,
// which is what the radiogroup was always for. `railStandaloneBasemaps()` is not kept
// as an alias for `railBasemapKeys()`, because "standalone" only means anything when
// something else is paired.

// ── the store ────────────────────────────────────────────────────────────────

let open: RailOpen = null;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

function set(next: RailOpen) {
  // Early-return on no-change, the contract every other store in this repo has:
  // a redundant close() must not wake every subscriber.
  if (open === next) return;
  open = next;
  emit();
}

export const mapRailStore = {
  get(): RailOpen {
    return open;
  },
  open(group: RailGroup) {
    set(group);
  },
  close() {
    set(null);
  },
  toggle(group: RailGroup) {
    set(toggleGroup(open, group));
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

export function useMapRail(): RailOpen {
  return useSyncExternalStore(mapRailStore.subscribe, mapRailStore.get, () => null);
}
