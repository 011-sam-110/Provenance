"use client";
// Placement picker's one-request store.
//
// WHY A STORE AND NOT PROPS. The ＋ button lives on every Sources rail row, deep
// inside the Sources tree; the picker itself renders once, high in the console
// shell. Threading "which widget wants to be placed" through props would mean
// plumbing state through every intermediate layer that has nothing to do with
// placement. A one-request store lets any ＋ ask a question and one picker
// instance answer it, exactly like lib/terminal/solo.ts does for stage solo —
// same shape (module state + listener Set + useSyncExternalStore), deliberately.
//
// WHY NOT PERSISTED. A pending "where should this go?" question is mid-gesture
// state, not a preference. Persisting it would let a reload resurrect a
// half-finished add — a picker for a widget the user may not even remember
// starting — which is worse than just losing it. `ask` / `cancel` are the whole
// lifecycle here; nothing in this file ever touches localStorage.

import { useSyncExternalStore } from "react";

export interface PlacementRequest {
  type: string; // widget type id
  label: string; // "Wildfires" — for the heading
  config?: Record<string, unknown>;
  height?: number;
}

let pending: PlacementRequest | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export const placementStore = {
  get(): PlacementRequest | null {
    return pending;
  },
  /** Replaces any pending request — there is only ever one question on screen at once. */
  ask(req: PlacementRequest): void {
    pending = req;
    emit();
  },
  cancel(): void {
    if (pending === null) return;
    pending = null;
    emit();
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

export function usePlacementRequest(): PlacementRequest | null {
  // Server snapshot is always null: a pending question is raised by a click, and
  // SSR has had no click happen yet — claiming one here would render a modal the
  // server never had a reason to draw, and mismatch on hydration.
  return useSyncExternalStore(placementStore.subscribe, placementStore.get, () => null);
}
