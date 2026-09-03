"use client";
// Console (flat 2D map) vs Explore (the 3D globe + cinematic dive). One persisted
// store the shell reads to choose chrome, and WorldMap reads to choose its MapLibre
// projection.
//
// READ THIS BEFORE EDITING DEFAULT_VIEW_MODE. It is not the switch it looks like.
// components/console/StageHost.tsx sets viewModeStore from the active board's stage
// in a mount effect, so this value is overwritten before the map is ever built. What
// actually decides how /app opens is the stage literal on the default board in
// lib/console/presets.ts. This constant is the fallback for a missing or corrupt
// persisted value, and it is kept in agreement with that board on purpose -- the two
// contradicting each other is how it read for a while, and it made this file lie.
//
// The redesign had flipped the default to console-as-hero (spec §4, §11). Sam asked
// for the globe back on 2026-09-03, which supersedes that.

import { useSyncExternalStore } from "react";
import { loadPersisted, savePersisted } from "@/lib/shell/persist";

export type ViewMode = "console" | "explore";
export const DEFAULT_VIEW_MODE: ViewMode = "explore";

export function coerceViewMode(saved: unknown): ViewMode {
  return saved === "explore" || saved === "console" ? saved : DEFAULT_VIEW_MODE;
}

const PERSIST_KEY = "tn.viewmode.v1";
const PERSIST_VERSION = 1;

let state: ViewMode = DEFAULT_VIEW_MODE;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
  savePersisted(PERSIST_KEY, PERSIST_VERSION, state);
}

export const viewModeStore = {
  set(m: ViewMode) {
    if (state === m) return;
    state = m;
    emit();
  },
  toggle() {
    state = state === "console" ? "explore" : "console";
    emit();
  },
  get(): ViewMode {
    return state;
  },
  hydrate() {
    state = coerceViewMode(loadPersisted<ViewMode>(PERSIST_KEY, PERSIST_VERSION));
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useViewMode(): ViewMode {
  return useSyncExternalStore(viewModeStore.subscribe, viewModeStore.get, viewModeStore.get);
}
