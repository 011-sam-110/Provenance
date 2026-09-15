"use client";
// The Sources rail's active tab — "sources" (the catalog) or "inspector" (the detail
// body for the currently open object).
//
// WHY A STORE AND NOT `useState` IN SourceCatalog. The tab has to be settable from
// lib/overlay.ts — every `overlay.open()` points the rail at Inspector, and
// `overlay.close()` returns it to Sources — and overlay.ts is nowhere near
// SourceCatalog's tree. Same shape as every other shell store here (module state, a
// listener set, useSyncExternalStore), so it reads like lib/console/sourcesRail.ts.
//
// SESSION-ONLY, like the rail's open state. Nothing here persists: a fresh launch
// should land on the Sources catalog, not on the last thing someone inspected.
//
// Nothing here touches window/document at all, at module scope or otherwise, so
// importing this on the server or under the node vitest environment is inert.

import { useSyncExternalStore } from "react";

export type RailTab = "sources" | "inspector";

/**
 * The state a launch starts in, and the server snapshot. ONE frozen value, not two
 * literals — see the identical note in lib/console/sourcesRail.ts for why the
 * snapshot getter and the initial state must be the same object by identity.
 */
const FRESH: { tab: RailTab } = Object.freeze({ tab: "sources" });

let state: { tab: RailTab } = { ...FRESH };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const railTabStore = {
  get: (): { tab: RailTab } => state,
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  set(tab: RailTab): void {
    if (state.tab === tab) return;
    state = { tab };
    emit();
  },
};

export function useRailTab(): { tab: RailTab } {
  return useSyncExternalStore(railTabStore.subscribe, railTabStore.get, () => FRESH);
}
