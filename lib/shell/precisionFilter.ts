"use client";
// The precision filter of the map: show only one precision level, or hide one.
//
// Every signal feature carries how precise its place is (lib/signals/precision.ts):
// an exact point, a named facility, an area or a country figure. This filter keeps
// one level ("exact points only") or removes one ("no country figures"). WorldMap
// applies it where it applies the time window, so it changes what the map draws.
//
// ONE WRITER, AND IT SHOWS A CHIP. The question reader of the command palette sets
// this (lib/shell/askApplied.ts), and the chip bar on the map removes it. It is not
// persisted: a reload gives the full map, so a filter can never be active with no
// chip on the screen to say so and to remove it.
//
// It filters SIGNAL features only. Cameras, aircraft, ships and satellites have no
// precision level; each is a measured position, and the filter leaves them alone.

import { useSyncExternalStore } from "react";
import { isSignalPrecision } from "@/lib/signals/precision";
import type { SignalPrecision } from "@/lib/signals/types";

export interface PrecisionFilter {
  /** "only" keeps this level and hides the other three. "without" hides this level. */
  mode: "only" | "without";
  level: SignalPrecision;
}

/**
 * Pure: does a feature of this precision level pass the filter?
 *
 * A feature with no valid level fails an "only" rule and passes a "without" rule.
 * Both follow from one idea: the filter never treats a feature as a level that the
 * feature did not state. In practice every feature states one, because the route
 * writes the resolved level on each (lib/signals/precision.ts).
 */
export function passesPrecision(level: unknown, filter: PrecisionFilter | null): boolean {
  if (!filter) return true;
  const known = isSignalPrecision(level);
  if (filter.mode === "only") return known && level === filter.level;
  return !known || level !== filter.level;
}

let state: PrecisionFilter | null = null;
const listeners = new Set<() => void>();

export const precisionFilterStore = {
  set(next: PrecisionFilter | null) {
    if (state === next) return;
    if (state && next && state.mode === next.mode && state.level === next.level) return;
    state = next;
    for (const l of listeners) l();
  },
  get(): PrecisionFilter | null {
    return state;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function usePrecisionFilter(): PrecisionFilter | null {
  return useSyncExternalStore(precisionFilterStore.subscribe, precisionFilterStore.get, precisionFilterStore.get);
}
