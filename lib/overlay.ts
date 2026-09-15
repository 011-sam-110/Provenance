"use client";
// The overlay store. The globe stays mounted as the live background; clicking
// any WorldObject opens its detail in the Sources rail's INSPECTOR tab (close to
// return). One object at a time (multi-window is explicitly out of scope for now
// — see the design spec).
//
// Framework-light on purpose: a tiny external store + useSyncExternalStore, no
// new dependency. Every opener calls `overlay.open(obj)`; opening also points the
// Sources rail at its Inspector tab (railTabStore) and expands the rail
// (sourcesRailStore), which is where components/shell/InspectorPanel.tsx renders
// the kind-specific detail body via useOverlay(). The old right-edge <FeedOverlay>
// dossier is retired.

import { useSyncExternalStore } from "react";
import type { WorldObject } from "./world";
import { track } from "@/lib/analytics/track";
import { sourcesRailStore } from "@/lib/console/sourcesRail";
import { railTabStore } from "@/lib/console/railTab";

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
    // The detail now lives in the left rail, not a right-edge card. Point the rail at
    // its Inspector tab and expand it — if it is already open on Sources, setOpen(true)
    // is a no-op and only the tab flips.
    railTabStore.set("inspector");
    sourcesRailStore.setOpen(true);
  },
  close() {
    if (state.object === null) return;
    state = { object: null };
    emit();
    // Closing the detail returns the rail to its Sources tab. The rail itself stays
    // open — someone who read a dossier may still want the sources list it came from.
    railTabStore.set("sources");
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
