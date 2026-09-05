"use client";
// The Sources rail's open state, and the hint that says it is there.
//
// WHY A STORE AND NOT `useState` IN SourceCatalog. It was local state, and that was
// correct while the only thing that could open the rail was the tab you clicked to
// open it. The keymap's Sources chord now opens it from ConsoleShell's global keydown
// handler, which is not in SourceCatalog's tree and cannot reach a hook inside it.
// Same shape as every other shell store here — module state, a listener set, and
// useSyncExternalStore — so it reads like lib/shell/scope.ts rather than introducing
// a third way to hold shell state.
//
// THE HINT PLAYS ONCE PER LAUNCH, AND NOTHING ABOUT IT IS WRITTEN DOWN. The rail
// collapses to a thin tab on the left edge, and in review nobody found it — the same
// complaint that produced the light skin, and the same class of bug this codebase has
// argued about twice ("dead controls that sit exactly where a thumb starts a swipe").
// So the tab jumps, and it stops the instant the rail is opened by ANY route — the
// tab, the keymap's Sources chord, or the command palette — because at that point the
// user has demonstrably found it.
//
// IT USED TO BE ONCE PER BROWSER, and that is the part that changed. A
// `tn.sources.opened.v1` flag was written to localStorage the first time the rail was
// opened, and after that the tab never moved again on any later visit. The reasoning
// was sound in the abstract — a hint that keeps playing after it has worked is just
// motion — and it did not survive contact. Opening Sources once, including on the
// visit where you were only looking around, silently retired the hint for good; the
// console then looked to its owner exactly like a console where the hint had never
// been built. "On a fresh launch the tab does not move" was the report, and the flag
// was the whole reason.
//
// So the scope is now one visit. The cost is real and worth stating: someone who
// launches the console every day and never uses Sources gets the same nudge every
// day. That is the trade — the alternative failed in the direction where the feature
// silently does not exist, and this one fails in the direction where it is slightly
// insistent about the console's main data-source control. A bounded animation the
// user can end at any moment by opening the thing it points at is the cheaper failure.
//
// Nothing here touches window/document at all, at module scope or otherwise, so
// importing this on the server or under the node vitest environment is inert. That is
// also why there is no `hydrate()` any more: with nothing persisted there is nothing
// to read back, the initial state and the server snapshot are the same value, and
// hydration has nothing to reconcile.

import { useSyncExternalStore } from "react";

interface RailState {
  /** Is the rail expanded? */
  open: boolean;
  /**
   * Has the rail been opened at any point in THIS visit? Drives the hint, and
   * nothing else. Starts false, which is the honest answer on a fresh launch.
   */
  openedThisVisit: boolean;
}

/**
 * The state a launch starts in, and the server snapshot.
 *
 * ONE FROZEN VALUE, NOT TWO LITERALS. `useSyncExternalStore` compares snapshots by
 * identity, so the server snapshot getter has to return the same object every call or
 * React re-renders forever. Sharing it with the initial state also makes the SSR and
 * first-client renders agree by construction rather than by two literals that happen
 * to match today.
 */
const FRESH: RailState = Object.freeze({ open: false, openedThisVisit: false });

let state: RailState = FRESH;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const sourcesRailStore = {
  get: (): RailState => state,
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  setOpen(open: boolean): void {
    // Opening is what ends the hint, so it happens here rather than in each of the
    // callers. Closing does not bring it back: someone who opened the rail and shut
    // it again has found the control.
    state = { open, openedThisVisit: state.openedThisVisit || open };
    emit();
  },

  toggle(): void {
    sourcesRailStore.setOpen(!state.open);
  },
};

export function useSourcesRail(): RailState {
  return useSyncExternalStore(sourcesRailStore.subscribe, sourcesRailStore.get, () => FRESH);
}

/**
 * Pure: should the tab be jumping?
 *
 * Split out and exported so the rule is testable without a DOM. It is deliberately
 * narrow — the hint plays only when the rail is CLOSED and has not been opened this
 * visit. A hint on an open rail would be pointing at something the user is already
 * looking at.
 */
export function shouldHintRail(s: RailState): boolean {
  return !s.open && !s.openedThisVisit;
}
