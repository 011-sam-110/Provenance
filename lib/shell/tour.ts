"use client";
// Tour store — the small piece of state behind the guided walkthrough.
//
//   1. A PERSISTED "seen" flag (the tour version the visitor last completed) so the
//      first-run invitation never nags on return visits. Written the moment the tour
//      opens on a first visit, so a mid-tour reload will not re-trigger it.
//   2. An EPHEMERAL view: closed, the chapter MENU, or a RUN of one chapter or all
//      of them. The step index itself stays with the overlay, which is the only
//      thing that knows which steps resolved onto the page.
//
// Pure gating (shouldAutoRunTour), the chapters and the index maths live in
// lib/console/tour.ts.

import { useSyncExternalStore } from "react";
import { loadPersisted, savePersisted } from "@/lib/shell/persist";
import { TOUR_VERSION, shouldAutoRunTour } from "@/lib/console/tour";

const KEY = "tn.tour.v1";
const VERSION = 1;
interface Persisted { seenVersion: number }

/**
 * `menu` shows the chapter picker; `run` is walking steps. `chapter` scopes a run
 * to one chapter and is null for the full walkthrough.
 */
export interface TourView {
  open: boolean;
  mode: "menu" | "run";
  chapter: string | null;
}

const CLOSED: TourView = { open: false, mode: "menu", chapter: null };

let view: TourView = CLOSED;
let seenVersion: number | null = null;
const listeners = new Set<() => void>();
function emit() { for (const l of listeners) l(); }
function set(next: TourView) {
  // Reference equality is the subscription's change signal, so only publish a
  // genuinely different view — otherwise every re-render of a consumer re-runs the
  // overlay's step-resolution effect.
  if (next.open === view.open && next.mode === view.mode && next.chapter === view.chapter) return;
  view = next;
  emit();
}

function markSeen() {
  if (seenVersion === TOUR_VERSION) return;
  seenVersion = TOUR_VERSION;
  savePersisted<Persisted>(KEY, VERSION, { seenVersion: TOUR_VERSION });
}

export const tourStore = {
  get(): TourView { return view; },
  isActive(): boolean { return view.open; },
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },

  /** Load the persisted "seen" flag (no side effects on the open state). */
  hydrate() { seenVersion = loadPersisted<Persisted>(KEY, VERSION)?.seenVersion ?? null; },

  /**
   * First-run invitation — opens the MENU, not a forty-step run. A visitor who
   * has never seen the product gets a choice ("show me everything" / "just the
   * map" / "no thanks"), which is the difference between an offer and an ambush.
   * A no-op once they have seen this tour version.
   */
  maybeAutoStart() {
    if (!shouldAutoRunTour(seenVersion)) return;
    markSeen(); // never auto-invite again, even if they reload mid-tour
    set({ open: true, mode: "menu", chapter: null });
  },

  /** Replay on demand (⌘K / profile menu) — always opens the chapter menu. */
  start() { markSeen(); set({ open: true, mode: "menu", chapter: null }); },

  /** Walk every chapter, start to finish. */
  runAll() { markSeen(); set({ open: true, mode: "run", chapter: null }); },

  /** Walk one chapter, then return to the menu. */
  runChapter(id: string) { markSeen(); set({ open: true, mode: "run", chapter: id }); },

  /** Back to the chapter picker from inside a run. */
  openMenu() { set({ open: true, mode: "menu", chapter: null }); },

  /** Close the tour (finished or skipped) and remember it was seen. */
  stop() { markSeen(); set(CLOSED); },
};

export function useTourView(): TourView {
  return useSyncExternalStore(tourStore.subscribe, tourStore.get, () => CLOSED);
}

/** Kept for callers that only need "is it up" — the ⌘K palette and the profile menu. */
export function useTourActive(): boolean {
  return useSyncExternalStore(tourStore.subscribe, tourStore.isActive, () => false);
}
