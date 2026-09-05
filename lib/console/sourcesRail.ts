"use client";
// The Sources rail's open state, and the one-time hint that says it is there.
//
// WHY A STORE AND NOT `useState` IN SourceCatalog. It was local state, and that was
// correct while the only thing that could open the rail was the tab you clicked to
// open it. The keymap's Sources chord now opens it from ConsoleShell's global keydown
// handler, which is not in SourceCatalog's tree and cannot reach a hook inside it.
// Same shape as every other shell store here — module state, a listener set, and
// useSyncExternalStore — so it reads like lib/shell/scope.ts rather than introducing
// a third way to hold shell state.
//
// THE HINT IS FINITE AND IT IS EARNED-OUT, NOT TIMED. The rail collapses to a thin
// tab on the left edge, and in review nobody found it — which is the same complaint
// that produced the light skin, and the same class of bug this codebase has already
// argued about twice ("dead controls that sit exactly where a thumb starts a swipe").
// So the tab bounces on a first visit. It stops the first time the rail is opened by
// ANY route — the tab, the keymap's Sources chord, or the command palette — because
// at that point the user
// has demonstrably found it, and a hint that keeps playing after it has worked is
// just motion. The flag persists, so it is a first-visit hint and not a per-load one.
//
// Nothing here touches window/document at module scope. `hydrate()` is called from an
// effect, so importing this on the server or under the node vitest environment is
// inert — the same contract lib/shell/keymap.ts states.

import { useSyncExternalStore } from "react";
import { loadPersisted, savePersisted } from "@/lib/shell/persist";

const PERSIST_KEY = "tn.sources.opened.v1";
const PERSIST_VERSION = 1;

interface RailState {
  /** Is the rail expanded? */
  open: boolean;
  /**
   * Has the rail EVER been opened, on any visit? Drives the hint, and nothing else.
   * Starts true so that the hint cannot flash during the render before `hydrate()`
   * has read localStorage — a returning user seeing one bounce of a hint they
   * already earned out of is worse than a first-time user seeing it a beat late.
   */
  everOpened: boolean;
}

let state: RailState = { open: false, everOpened: true };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/**
 * Pure: what a persisted value means.
 *
 * ONLY AN EXPLICIT `true` COUNTS AS OPENED. The first version of this asked whether
 * the value was `!== false`, which is the same sentence read the wrong way round:
 * `loadPersisted` returns `null` when there is nothing stored, `null?.opened` is
 * `undefined`, and `undefined !== false` is `true` — so a first-time visitor, the
 * only person the hint exists for, was classified as having already opened the rail
 * and never saw it. Caught by opening the app with clean storage and reading the
 * attribute back off the tab, which is the only way it could have been caught: every
 * assertion about it passed, because they all fed it a value that was actually there.
 *
 * Junk that is not `{ opened: true }` therefore replays the hint once. That is the
 * right direction to fail — a stray bounce costs a second, a hint that can never
 * appear costs the feature.
 */
export function coerceEverOpened(saved: unknown): boolean {
  return (saved as { opened?: unknown } | null)?.opened === true;
}

export const sourcesRailStore = {
  get: (): RailState => state,
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  /** Read the persisted flag. Call from an effect, once. */
  hydrate(): void {
    const everOpened = coerceEverOpened(loadPersisted(PERSIST_KEY, PERSIST_VERSION));
    if (everOpened === state.everOpened) return;
    state = { ...state, everOpened };
    emit();
  },

  setOpen(open: boolean): void {
    // Opening is what earns the hint out, so the write happens here rather than in
    // each of the four callers. Closing does not un-earn it.
    const everOpened = state.everOpened || open;
    if (open && !state.everOpened) savePersisted(PERSIST_KEY, PERSIST_VERSION, { opened: true });
    state = { open, everOpened };
    emit();
  },

  toggle(): void {
    sourcesRailStore.setOpen(!state.open);
  },
};

export function useSourcesRail(): RailState {
  return useSyncExternalStore(sourcesRailStore.subscribe, sourcesRailStore.get, () => ({
    open: false,
    everOpened: true,
  }));
}

/**
 * Pure: should the tab be bouncing?
 *
 * Split out and exported so the rule is testable without a DOM. It is deliberately
 * narrow — the hint plays only when the rail is CLOSED and has never been opened.
 * A hint on an open rail would be pointing at something the user is already looking
 * at.
 */
export function shouldHintRail(s: RailState): boolean {
  return !s.open && !s.everOpened;
}
