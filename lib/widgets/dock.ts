"use client";
// Bridge between a Source Catalog row and the console workspace.
//
// A source is "on screen" iff the console layout (lib/console/store) holds at
// least one widget of the type that shows it. That store is the one the app
// actually renders — components/console/ConsoleWorkspace reads it, and the ⌘K
// palette writes to it.
//
// This file used to write to variantStore's `layoutOverrides` slot instead, which
// only components/shell/DockableWorkspace ever read — and nothing has mounted that
// since the console rebuild. So every ＋ click in the rail committed a placement
// with no reader: the rail's "N ▦" counter went up, the persisted variant grew a
// panel, and the screen never changed. That is the bug this rewrite fixes; the
// dead dock components have been removed so it cannot come back.

import { placementStore } from "@/lib/console/placement";
import { shellLayoutStore } from "@/lib/console/store";
import { widgetTypeForGroup, widgetTypeForSource } from "@/lib/console/sourceWidgets";

/** Every widget type currently on the console workspace. */
export function openWidgetTypes(): Set<string> {
  return new Set(shellLayoutStore.get().widgets.map((w) => w.type));
}

/**
 * Ask where a widget of `type` should go, unless one is already up.
 *
 * This used to call `shellLayoutStore.add()` and toast "<label> added to your
 * workspace". It could, because the free grid chose the spot itself: a ＋ was a
 * complete instruction. Rails have no free space to scan, so the same click is
 * now only half an instruction and the rail is the missing half. Supplying a
 * default here would compile and would quietly reinstate the thing the rails
 * exist to remove — a widget landing somewhere the user did not choose.
 *
 * The toast goes with it rather than being kept: at this point nothing has been
 * added, so announcing that something was is a claim about an event that has not
 * happened yet. The capacity toast moves to the picker's commit, which is where
 * the add now lives — see components/console/PlacementPicker.tsx.
 */
function askOnce(type: string, label: string): void {
  const open = shellLayoutStore.get().widgets.filter((w) => w.type === type);
  if (open.length > 0) return;
  placementStore.ask({ type, label });
}

/** Remove EVERY widget of `type` (the rail's toggle is "is this on screen at all"). */
function removeAll(type: string): void {
  for (const w of shellLayoutStore.get().widgets.filter((x) => x.type === type)) {
    shellLayoutStore.remove(w.id);
  }
}

/** Is this catalog source currently shown by a widget on the workspace? */
export function isSourceWidgetOpen(sourceId: string, openTypes: Set<string>): boolean {
  return openTypes.has(widgetTypeForSource(sourceId));
}

/** Is this catalog group's roll-up currently on the workspace? */
export function isGroupWidgetOpen(group: string, openTypes: Set<string>): boolean {
  return openTypes.has(widgetTypeForGroup(group));
}

/** Toggle a source's widget on/off the workspace. */
export function toggleSourceWidget(sourceId: string, label: string): void {
  const type = widgetTypeForSource(sourceId);
  if (openWidgetTypes().has(type)) removeAll(type);
  else askOnce(type, label);
}

/** Toggle a category roll-up widget on/off the workspace. */
export function toggleGroupWidget(group: string): void {
  const type = widgetTypeForGroup(group);
  if (openWidgetTypes().has(type)) removeAll(type);
  else askOnce(type, `${group} roll-up`);
}
