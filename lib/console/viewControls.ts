"use client";
// The pure tables behind the Inspector rail's MAP SETTINGS tool — projection and
// basemap. Moved out of lib/console/mapRail.ts when the stage rail was retired;
// what did NOT come across is that file's rail store (RailGroup, RAIL_GROUPS,
// toggleGroup, railStep, railEdge, mapRailStore, useMapRail), which is now
// lib/console/inspectorRail.ts, and `railHoldsOpen`, which guarded a flyout that no
// longer exists — the tool takes the panel body now, so there is no panel to hold
// open over the map while a gesture is running (see components/shell/
// DrawBanner.tsx for what narrates a draw instead).
//
// WHY THESE LIVE IN A PURE MODULE AT ALL. vitest is `environment: "node"` with
// `include: ["tests/unit/**/*.test.ts"]`; no .tsx is collected and there is no
// React testing library, so a table left inside SettingsTool.tsx cannot be tested.
//
// RAIL_BASEMAP_LABEL IS GONE, and its absence is the change rather than an
// oversight. It existed for one reason, stated in its own comment: the strip had to
// stay LATERAL — "Streets / Sat / Topo" fitted three chips across a 40px-wide
// flyout row. The rail is vertical now and the tool is a panel, so each basemap is
// a full-width row and the abbreviation is no longer a saving. Rows read
// `BASEMAPS[k].label` directly, which also removes the one place a basemap's name
// could have been spelled differently from the registry's own.

import { BASEMAPS, type BasemapKey } from "@/lib/basemaps";
import type { StageId } from "@/lib/console/types";

/** 3D is the globe (map3d); 2D is the flat mercator stage (map2d). */
export function stageForMode(mode: "2d" | "3d"): StageId {
  return mode === "3d" ? "map3d" : "map2d";
}

/**
 * The inverse, for reading the current state back. `null` for the legacy "clock"
 * stage, which renders neither button checked.
 */
export function modeForStage(stage: StageId): "2d" | "3d" | null {
  if (stage === "map3d") return "3d";
  if (stage === "map2d") return "2d";
  return null;
}

/**
 * Iteration order for the basemap rows. BASEMAPS' own key order is load-bearing —
 * see lib/basemaps.ts — so the panel iterates this and never hand-lists. A sixth
 * basemap appears in the tool with no edit, and tests/unit/view-controls.test.ts
 * fails if the registry and this helper disagree.
 */
export function basemapKeys(): BasemapKey[] {
  return Object.keys(BASEMAPS) as BasemapKey[];
}
