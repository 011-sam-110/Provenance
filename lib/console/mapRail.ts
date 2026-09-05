"use client";
// The stage rail: four icon groups on the right edge of the map, one flyout open
// at a time. This module is the rail's brain — the pure reducers plus a
// module-level store — and it holds everything worth testing.
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

export type RailGroup = "search" | "draw" | "cameras" | "view";
export type RailOpen = RailGroup | null;

/** Rail order, top to bottom. Also the arrow-key order. */
export const RAIL_GROUPS = ["search", "draw", "cameras", "view"] as const;

/**
 * Click a rail button. Clicking the open group closes it; clicking any other
 * group replaces it. This is the whole "one group open at a time" rule, and it is
 * a function rather than a setState branch so a test can hold it.
 */
export function toggleGroup(open: RailOpen, group: RailGroup): RailOpen {
  return open === group ? null : group;
}

/** Move along the rail by one, wrapping at both ends. Roving-tabindex arithmetic. */
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
 * Does an outside click leave the flyout open?
 *
 * YES while the map is armed, and this is the rule that makes Draw and Cameras
 * usable at all. Both groups exist to make the user click ON THE MAP — placing
 * vertices, or picking pins. A plain close-on-outside-click would shut the panel
 * on the very first map click and take the live vertex counter and the Cancel
 * button with it, which is the one moment the user most needs them.
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
