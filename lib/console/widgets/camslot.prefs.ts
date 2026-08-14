"use client";
// The camera-slot pause preference — a USER setting, deliberately not widget config.
//
// WCAG 2.2.2 requires a way to stop content that updates automatically, and
// hover-pause is not one: it has no keyboard and no touch equivalent. So pause is
// always available and it is remembered.
//
// Remembering it in `WidgetInstance.config` is what we must NOT do. shellLayoutStore
// .configure() calls emit(), which writes both `tn.console.v1` and the per-board
// archive, and boards.ts's layoutSignature includes the config — so a pause stored
// there would light the board's "customised" dot on the first click, put a reset
// affordance on screen, and pin the user to that layout snapshot so future template
// improvements never reach them.

import { loadPersisted, savePersisted } from "@/lib/shell/persist";

const KEY = "tn.camslot.prefs.v1";
const VERSION = 1;

export interface CamslotPrefs {
  paused: boolean;
}

function initial(): CamslotPrefs {
  const saved = loadPersisted<CamslotPrefs>(KEY, VERSION);
  if (saved && typeof saved.paused === "boolean") return { paused: saved.paused };
  // Someone who has asked their OS to reduce motion should not be handed a wall that
  // swaps itself every five seconds before they have touched anything.
  const reduced =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return { paused: reduced };
}

let state: CamslotPrefs | null = null;
const listeners = new Set<() => void>();

export const camslotPrefs = {
  get(): CamslotPrefs {
    if (!state) state = initial();
    return state;
  },
  set(paused: boolean): void {
    state = { paused };
    savePersisted(KEY, VERSION, state);
    for (const fn of listeners) fn();
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
