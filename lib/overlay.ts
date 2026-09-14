"use client";
// The overlay store. The globe stays mounted as the live background; clicking
// any WorldObject opens a panel ON TOP of it (close to return). One object at a
// time (multi-window is explicitly out of scope for now — see the design spec).
//
// Framework-light on purpose: a tiny external store + useSyncExternalStore, no
// new dependency. GlobeView calls `overlay.open(obj)` on click; <FeedOverlay>
// subscribes via `useOverlay()` and renders the kind-specific detail body.

import { useSyncExternalStore } from "react";
import type { WorldObject } from "./world";
import { track } from "@/lib/analytics/track";

export interface OverlayState {
  /** The clicked object, or null when the overlay is closed. */
  object: WorldObject | null;
}

let state: OverlayState = { object: null };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export const overlay = {
  open(object: WorldObject) {
    state = { object };
    emit();
    // One site covers every opener: map clicks, search, widgets and a restored share link
    // (opening the link was the user's action). Only the kind is sent, never the object.
    track({ name: "object_opened", kind: object.kind });
  },
  close() {
    if (state.object === null) return;
    state = { object: null };
    emit();
  },
  get(): OverlayState {
    return state;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** React hook: re-renders the caller whenever the overlay opens/closes. */
export function useOverlay(): OverlayState {
  return useSyncExternalStore(overlay.subscribe, overlay.get, overlay.get);
}
