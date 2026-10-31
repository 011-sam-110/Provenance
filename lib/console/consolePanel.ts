"use client";
// WHICH PANEL IS OPEN BESIDE THE CONSOLE'S SIDEBAR, and the rules for changing it.
//
// One panel at a time, chosen from the sidebar (components/shell/ConsoleSidebar.tsx) and
// drawn by components/shell/SourceCatalog.tsx: Sources, Inspector, Map settings, Areas
// or Notifications. Sam's plan: "One store opens one panel at a time". A second one open
// would halve a column that is already the narrowest surface in the console.
//
// IT IS A VIEW OVER THE THREE STORES THAT ALREADY HOLD THE ANSWER, NOT A FOURTH STORE.
// `sourcesRailStore` says the panel is on screen and owns the fresh-launch hint,
// `railTabStore` says whether it shows Sources or the Inspector, and `inspectorRailStore`
// says which tool has taken the Inspector's place. Every state those three can hold maps to
// one panel (`panelOf`), and every change goes through the functions below, so no caller
// has to know the mapping. They stayed three because lib/overlay.ts writes them and the
// open pull request for Globe and Streets parks and restores two of them per view;
// a fourth store would be a second answer those writes do not reach.
//
// NOTHING HERE IS PERSISTED, and that is the old rail's rule unchanged: a panel that
// reopened on every visit would hide the map the visitor came for. The one thing kept is
// the panel's width (lib/shell/sourcesRailWidth.ts). The sidebar's own open state is
// lib/rail/railOpen.ts.
//
// Nothing here touches window or document, so importing this on the server or under the
// node vitest environment is inert.

import { useSyncExternalStore } from "react";
import { inspectorRailStore, type OpenTool } from "@/lib/console/inspectorRail";
import { railTabStore, type RailTab } from "@/lib/console/railTab";
import { sourcesRailStore } from "@/lib/console/sourcesRail";

export type ConsolePanel = "sources" | "inspector" | OpenTool;

/** The panel's title and accessible name. One table, so the sidebar and the head cannot differ. */
export const PANEL_TITLE: Record<ConsolePanel, string> = {
  sources: "Sources",
  inspector: "Inspector",
  settings: "Map settings",
  draw: "Areas",
  alerts: "Notifications",
};

/** The id on the open panel, for the sidebar's aria-controls. */
export const CONSOLE_PANEL_ID = "tn-console-panel";

/** Pure: the panel the three stores describe, or null when none is on screen. */
export function panelOf(s: { open: boolean; tab: RailTab; tool: OpenTool | null }): ConsolePanel | null {
  if (!s.open) return null;
  if (s.tab === "sources") return "sources";
  return s.tool ?? "inspector";
}

/**
 * Pure: what a click on a sidebar item leaves open. A second click on the open item closes
 * it; any other item replaces it. Null is a real answer, because the map gets its room back.
 */
export function nextPanel(current: ConsolePanel | null, clicked: ConsolePanel): ConsolePanel | null {
  return current === clicked ? null : clicked;
}

/**
 * Pure: where Escape on an open tool lands. With an object selected it is that object's
 * view, so one press closes the tool and the next closes the object. With nothing selected
 * there is nothing to go back to, and the map gets its room back.
 */
export function panelAfterToolEscape(hasObject: boolean): ConsolePanel | null {
  return hasObject ? "inspector" : null;
}

/**
 * Pure: why the map is not on screen, in words, or null when it is. Sidebar rows stay on every
 * board, so a row whose job needs the map says so rather than doing nothing. A focused widget
 * unmounts the map (StageHost.tsx), and a wall board can close the dock that holds it.
 */
export function mapAbsenceNote(l: {
  focusedWidgetId: string | null;
  mode?: "rails" | "wall";
  segments: { right: { collapsed: boolean } };
}): string | null {
  if (l.focusedWidgetId != null) return "A widget fills the stage, so the map is not on screen. Close that widget to get the map back.";
  if (l.mode === "wall" && l.segments.right.collapsed) return "The map is closed on this board. Press Map above the wall to open it.";
  return null;
}

export function readPanel(): ConsolePanel | null {
  return panelOf({
    open: sourcesRailStore.get().open,
    tab: railTabStore.get().tab,
    tool: inspectorRailStore.get(),
  });
}

/** What the Inspector replaced when it opened. See `showInspector`. */
let cameFrom: ConsolePanel | null = null;

export function openPanel(panel: ConsolePanel): void {
  if (panel === "sources") {
    railTabStore.set("sources");
    inspectorRailStore.close();
  } else {
    railTabStore.set("inspector");
    if (panel === "inspector") inspectorRailStore.close();
    else inspectorRailStore.open(panel);
  }
  // Last, and through the one setter, because opening is what ends the fresh-launch hint.
  if (!sourcesRailStore.get().open) sourcesRailStore.setOpen(true);
}

export function closePanel(): void {
  if (sourcesRailStore.get().open) sourcesRailStore.setOpen(false);
}

/** Bring up the Inspector and remember what it replaced, so closing an inspection goes back. */
export function showInspector(): void {
  const now = readPanel();
  if (now !== "inspector") cameFrom = now;
  openPanel("inspector");
}

/**
 * An inspection has closed. Go back to what the Inspector replaced: the Areas list for an
 * area opened from it, Sources for a click made while reading Sources, and the map itself
 * for a click made with no panel open. A panel the visitor has since moved to is theirs,
 * so it is left alone.
 */
export function leaveInspector(): void {
  if (readPanel() !== "inspector") return;
  const back = cameFrom;
  cameFrom = null;
  if (back) openPanel(back);
  else closePanel();
}

/** A click on a sidebar item, and the Sources chord. */
export function togglePanel(panel: ConsolePanel): void {
  const next = nextPanel(readPanel(), panel);
  if (next === null) closePanel();
  else if (next === "inspector") showInspector();
  else openPanel(next);
}

function subscribe(listener: () => void): () => void {
  const off = [
    sourcesRailStore.subscribe(listener),
    railTabStore.subscribe(listener),
    inspectorRailStore.subscribe(listener),
  ];
  return () => off.forEach((fn) => fn());
}

// The snapshot is a string or null, so useSyncExternalStore has no identity to trip over.
export function useConsolePanel(): ConsolePanel | null {
  return useSyncExternalStore(subscribe, readPanel, () => null);
}
