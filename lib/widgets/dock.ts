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

import { shellLayoutStore } from "@/lib/console/store";
import { widgetTypeForGroup, widgetTypeForSource } from "@/lib/console/sourceWidgets";
import { WIDGET_LIMIT_MESSAGE } from "@/lib/console/types";

function toast(message: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("tn-toast", { detail: message }));
}

/** Every widget type currently on the console workspace. */
export function openWidgetTypes(): Set<string> {
  return new Set(shellLayoutStore.get().widgets.map((w) => w.type));
}

/** Add a widget of `type` unless one is already up. Reports the capacity cap. */
function addOnce(type: string, label: string): void {
  const open = shellLayoutStore.get().widgets.filter((w) => w.type === type);
  if (open.length > 0) return;
  const r = shellLayoutStore.add(type);
  if (!r.ok) toast(WIDGET_LIMIT_MESSAGE);
  else toast(`${label} added to your workspace`);
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
  else addOnce(type, label);
}

/** Toggle a category roll-up widget on/off the workspace. */
export function toggleGroupWidget(group: string): void {
  const type = widgetTypeForGroup(group);
  if (openWidgetTypes().has(type)) removeAll(type);
  else addOnce(type, `${group} roll-up`);
}
