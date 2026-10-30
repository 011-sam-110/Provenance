"use client";
// WHAT EACH VIEW REMEMBERS OF THE INSPECTOR AND THE MAP, FOR THIS VISIT.
//
// Globe and Streets each have their own Sources (lib/console/viewSources.ts,
// lib/variants/store.ts); this is the other half of "entirely separate views": the
// Inspector pane and where the map is looking. Per view it keeps
//
//   - the selected item (what the Inspector tab shows),
//   - the open tool (Search / Map settings / Draw / Alerts),
//   - the rail's tab (Sources | Inspector),
//   - the map's centre, zoom, bearing and pitch.
//
// MEMORY ONLY, like the three stores it reads: a reload starts fresh, as it always
// did. Map settings (basemap, buildings, terrain, HUD) and drawn areas are NOT here;
// they stay shared by every view.
//
// A SWITCH BRINGS THE VIEW'S STATE BACK AND NEVER WIPES IT. `parkView` runs for the
// view being left, `restoreView` for the view being opened (lib/console/presets.ts
// `applyPreset`, a person's switch only).

import type { WorldObject } from "@/lib/world";
import { overlay } from "@/lib/overlay";
import { inspectorRailStore, type OpenTool } from "@/lib/console/inspectorRail";
import { railTabStore, type RailTab } from "@/lib/console/railTab";
import { getMapInstance } from "@/lib/map/instance";

export interface ViewCamera {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

export interface ViewMemory {
  object: WorldObject | null;
  tool: OpenTool | null;
  tab: RailTab;
  /** null when no map was mounted as the view was left. */
  camera: ViewCamera | null;
}

const memory = new Map<string, ViewMemory>();

/**
 * Pure: the Inspector state to put back for a view. A view never visited has nothing
 * selected, no tool open and the Sources tab, which is how a fresh launch starts.
 */
export function restoredInspector(m: ViewMemory | undefined): Pick<ViewMemory, "object" | "tool" | "tab"> {
  return m ? { object: m.object, tool: m.tool, tab: m.tab } : { object: null, tool: null, tab: "sources" };
}

/** Remember the view being left. */
export function parkView(id: string): void {
  const map = getMapInstance();
  let camera: ViewCamera | null = null;
  if (map) {
    const c = map.getCenter();
    camera = { center: [c.lng, c.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
  }
  memory.set(id, {
    object: overlay.get().object,
    tool: inspectorRailStore.get(),
    tab: railTabStore.get().tab,
    camera,
  });
}

/**
 * Put the view being opened back as it was left. A view with no memory gets the
 * fresh Inspector, and its map is LEFT ALONE: a first visit to Streets must still be
 * framed on its circle by the map itself (WorldMap's fitToRing), which a jump here
 * would pre-empt.
 */
export function restoreView(id: string): void {
  const m = memory.get(id);
  const i = restoredInspector(m);
  overlay.restore(i.object);
  if (i.tool) inspectorRailStore.open(i.tool);
  else inspectorRailStore.close();
  railTabStore.set(i.tab);
  const map = getMapInstance();
  if (m?.camera && map) {
    map.jumpTo({ center: m.camera.center, zoom: m.camera.zoom, bearing: m.camera.bearing, pitch: m.camera.pitch });
  }
}

/** For tests. */
export function resetViewMemory(): void {
  memory.clear();
}
