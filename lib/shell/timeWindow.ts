"use client";
// Global time-window filter for the time-stamped global signals.
//
// Many signal features carry an ISO `ts` (earthquakes, GDELT news, EONET events,
// launches). This control filters the map to events no OLDER than a chosen window
// (1h / 6h / 24h / 7d / All). It is a framework-light persisted external store
// (the lib/shell/ui.ts idiom) plus a PURE `withinWindow` test that WorldMap applies
// where it builds the signal feature set.
//
// HONESTY RULES (baked into withinWindow):
//   • "All" never filters anything.
//   • Features with NO timestamp (or an unparseable one) are ALWAYS shown — we do
//     not hide data we cannot date.
//   • Future-dated events (e.g. upcoming launches) are always shown — the window
//     only trims events that are too OLD, never ones that are "too new".

import { useSyncExternalStore } from "react";
import { savePersisted } from "@/lib/shell/persist";

export type TimeWindowKey = "1h" | "6h" | "24h" | "7d" | "all";

const HOUR = 60 * 60 * 1000;

/** Ordered options for the segmented control. `ms: null` = "All" (no filtering). */
export const TIME_WINDOWS: { key: TimeWindowKey; label: string; ms: number | null }[] = [
  { key: "1h", label: "1h", ms: HOUR },
  { key: "6h", label: "6h", ms: 6 * HOUR },
  { key: "24h", label: "24h", ms: 24 * HOUR },
  { key: "7d", label: "7d", ms: 7 * 24 * HOUR },
  { key: "all", label: "All", ms: null },
];

export const DEFAULT_TIME_WINDOW: TimeWindowKey = "all";

/** Window length in ms for a key, or null for "All". */
export function windowMsFor(key: TimeWindowKey): number | null {
  return TIME_WINDOWS.find((w) => w.key === key)?.ms ?? null;
}

/**
 * Pure recency test: is a feature with timestamp `ts` within `windowMs` of `now`?
 * - windowMs null ("All") → always true.
 * - ts null/undefined/unparseable → always true (never hide untimed data).
 * - future ts (now - t < 0) → always true (the window only trims OLD events).
 * Otherwise true iff the event is no older than the window.
 */
export function withinWindow(
  ts: string | number | null | undefined,
  windowMs: number | null,
  now: number,
): boolean {
  if (windowMs == null) return true;
  if (ts == null) return true;
  const t = typeof ts === "number" ? ts : Date.parse(ts);
  if (!Number.isFinite(t)) return true;
  return now - t <= windowMs;
}

const PERSIST_KEY = "tn.timewindow.v1";
const PERSIST_VERSION = 1;

let state: TimeWindowKey = DEFAULT_TIME_WINDOW;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
  savePersisted(PERSIST_KEY, PERSIST_VERSION, state);
}

export const timeWindowStore = {
  set(key: TimeWindowKey) {
    if (state === key) return;
    state = key;
    emit();
  },
  get(): TimeWindowKey {
    return state;
  },
  /**
   * NO-OP SINCE 2026-09-05, deliberately, and this is the load-bearing half of taking
   * TimeWindowControl off the Sources rail.
   *
   * This used to restore the persisted window on mount. The control that set it is no
   * longer rendered anywhere, and it was the only caller of `set`. So restoring a saved
   * "1h" would leave that visitor filtered to the last hour forever -- events quietly
   * missing from the Events widget and the map, with no control anywhere to undo it and
   * nothing on screen saying a filter was active. Removing the control WITHOUT this
   * change is the bug; the two belong in the same commit.
   *
   * What it does instead: nothing, so `state` stays DEFAULT_TIME_WINDOW ("all"), which
   * `withinWindow` treats as "never filter". Everyone sees everything.
   *
   * The persisted value is deliberately NOT deleted, and the store, the key and the pure
   * `withinWindow` test are all still here and still exercised. Re-mount a control that
   * calls `set`, restore the two lines below, and the feature is back with the user's old
   * choice intact:
   *     const KEYS = new Set<string>(TIME_WINDOWS.map((w) => w.key));
   *     const saved = loadPersisted<TimeWindowKey>(PERSIST_KEY, PERSIST_VERSION);
   *     if (saved && KEYS.has(saved)) state = saved;
   * (re-importing loadPersisted from @/lib/shell/persist -- both it and KEYS were
   *  dropped here rather than left dangling for a linter to trip over.)
   */
  hydrate() {
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useTimeWindow(): TimeWindowKey {
  return useSyncExternalStore(timeWindowStore.subscribe, timeWindowStore.get, timeWindowStore.get);
}
