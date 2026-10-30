"use client";
// Which built-in/custom preset board is currently applied — the single source of
// truth the central navbar pill (and the Settings "load board" list) read to show
// the active board. Set by applyPreset() so the pill, the ⌘K palette, and the
// Settings drawer all stay in sync. Persisted so the pill survives a reload.
//
// This does NOT track "edited" state: a user who tweaks widgets after applying a
// board keeps showing that board's name (the layout is still "based on" it). That
// is intentional — a calm label, not a dirty flag.

import { useSyncExternalStore } from "react";
import { loadPersisted, savePersisted } from "@/lib/shell/persist";

const KEY = "tn.console.activePreset.v1";
const VERSION = 1;

let state: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
  savePersisted(KEY, VERSION, state);
}

export const activePresetStore = {
  get(): string | null {
    return state;
  },
  set(id: string | null) {
    if (state === id) return;
    state = id;
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /**
   * The saved board id, READ WITHOUT HYDRATING THE STORE.
   *
   * variantStore.bootstrap needs to know which board the browser was last on, because
   * each board now has its own sources. hydrate() cannot simply move up to answer that:
   * shellLayoutStore files every layout change under the active board, and its own
   * hydrate (which runs before this store's) deliberately finds the id still null, so
   * the layout it loads is not filed as the board's saved edits. Hydrating early would
   * file it, and every board would read as customised on the next boot.
   */
  saved(): string | null {
    return loadPersisted<string>(KEY, VERSION) ?? null;
  },
  /** Pull the persisted active-preset id back in. Call once, client-side, after mount. */
  hydrate() {
    const saved = loadPersisted<string>(KEY, VERSION);
    if (saved) state = saved;
    emit();
  },
};

export function useActivePreset(): string | null {
  return useSyncExternalStore(activePresetStore.subscribe, activePresetStore.get, activePresetStore.get);
}
