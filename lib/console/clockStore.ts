"use client";
// WHICH CLOCKS THE MAP SHOWS: a short list of airport codes, remembered in this browser.
//
// Same shape as lib/terminal/skin.ts (module state, a listener set, useSyncExternalStore)
// and persisted through lib/shell/persist.ts under `tn.clocks.v1`. The key is
// DEVICE-ONLY on purpose: it is not in lib/account/syncKeys.ts, so a saved board does not
// carry it to another machine, and tests/unit/account-sync-keys.test.ts pins that.
//
// WHAT IS STORED IS THE CODES IN THE ORDER THEY WERE ADDED. The order on screen is never
// stored: it is always west to east by the CURRENT UTC offset, so it moves with daylight
// saving (orderWestToEast in lib/console/clockZones.ts, called at render).
//
// HYDRATE READS, IT NEVER WRITES. The server snapshot, and the first client render, are
// the defaults; `hydrate()` runs from a mount effect and swaps in what was saved. Writing
// there would turn "never chose" into "chose the defaults" and pin a person to today's
// list. Only add, remove and reset touch storage, and reset REMOVES the key rather than
// saving the defaults, so a person who resets goes back to being someone who never chose.
//
// Nothing here touches window at module scope, so importing it on the server or in the node
// vitest environment is inert.

import { useSyncExternalStore } from "react";
import { loadPersisted, removePersisted, savePersisted } from "@/lib/shell/persist";
import {
  DEFAULT_CLOCK_CODES,
  MAX_CLOCKS,
  clockAirport,
  coerceClockCodes,
} from "@/lib/console/clockZones";

export const CLOCKS_PERSIST_KEY = "tn.clocks.v1";
export const CLOCKS_PERSIST_VERSION = 1;

let state: readonly string[] = DEFAULT_CLOCK_CODES;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function commit(next: readonly string[]) {
  state = next;
  savePersisted(CLOCKS_PERSIST_KEY, CLOCKS_PERSIST_VERSION, next);
  notify();
}

export const clockStore = {
  /** The chosen codes, in the order they were added. The same array until something changes. */
  get(): readonly string[] {
    return state;
  },
  /** Add a clock. Ignores an unknown code, one already there, and anything past the cap. */
  add(code: string) {
    if (!clockAirport(code) || state.includes(code) || state.length >= MAX_CLOCKS) return;
    commit([...state, code]);
  },
  /** Remove a clock. There is always at least one, so the last one stays. */
  remove(code: string) {
    if (!state.includes(code) || state.length <= 1) return;
    commit(state.filter((c) => c !== code));
  },
  /** Back to the defaults, and forget the choice (the key is removed, not overwritten). */
  reset() {
    removePersisted(CLOCKS_PERSIST_KEY);
    state = DEFAULT_CLOCK_CODES;
    notify();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Read the saved list. Call from an effect, never during render. Never writes. */
  hydrate() {
    const saved = loadPersisted<unknown>(CLOCKS_PERSIST_KEY, CLOCKS_PERSIST_VERSION);
    // Nothing saved keeps the defaults object itself, so a person who never chose stays
    // on the exact snapshot the server rendered.
    state = saved === null ? DEFAULT_CLOCK_CODES : coerceClockCodes(saved);
    notify();
  },
};

/** The chosen codes. Defaults on the server and on the first client render. */
export function useClockCodes(): readonly string[] {
  return useSyncExternalStore(clockStore.subscribe, clockStore.get, () => DEFAULT_CLOCK_CODES);
}
