"use client";
// The overlay store. The globe stays mounted as the live background; clicking
// any WorldObject opens its detail in the console's Inspector panel (close to
// return). One object at a time (multi-window is explicitly out of scope for now
// — see the design spec).
//
// Framework-light on purpose: a tiny external store + useSyncExternalStore, no
// new dependency. Every opener calls `overlay.open(obj)`; opening also brings up the
// Inspector beside the sidebar (lib/console/consolePanel.ts), which is where
// components/shell/InspectorPanel.tsx renders the kind-specific detail body via
// useOverlay(). The old right-edge <FeedOverlay> dossier is retired.

import { useSyncExternalStore } from "react";
import type { WorldObject } from "./world";
import { track } from "@/lib/analytics/track";
import { leaveInspector, showInspector } from "@/lib/console/consolePanel";

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
    // The detail now lives in the panel beside the sidebar, not a right-edge card.
    //
    // THIS ALSO CLOSES ANY TOOL, which is the one thing here that is not obvious. The
    // panel shows one thing at a time (see components/shell/InspectorPanel.tsx): with
    // Map settings open, a click on the map would land on a panel full of basemap rows
    // while the thing the user clicked sat behind it. A click that selects an object
    // is a request to SEE that object, and that is true from every door.
    showInspector();
  },
  close() {
    if (state.object === null) return;
    state = { object: null };
    emit();
    // Closing the detail goes back to what the Inspector replaced, so someone who read
    // a dossier from the Sources list is back on that list, and someone who clicked the
    // map with no panel open gets the map back.
    leaveInspector();
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
