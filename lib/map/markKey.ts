"use client";
// WHETHER THE MAP'S MARKS KEY IS FOLDED, remembered in this browser, and where the key
// sits so it clears the HUD and the map's bottom-right controls.
//
// The key (components/console/MarkLegend.tsx) used to be a fixed box in the map's top
// right. It now folds to a one-line "Marks" chip behind its own title button. SAME SHAPE
// AS lib/terminal/skin.ts (module state + a listener set + useSyncExternalStore),
// persisted through lib/shell/persist.ts, and nothing here touches window or document at
// module scope, so importing this file on the server or in the node vitest environment is
// inert.
//
// OPEN IS THE DEFAULT AND NOTHING IS WRITTEN UNTIL THE VISITOR PRESSES THE BUTTON.
// `hydrate()` reads and never writes: seeding the default would turn "never chose" into
// "chose open". Only `set` and `toggle` persist. The key is device-only on purpose
// (tests/unit/account-sync-keys.test.ts): a fold is a screen preference, not an account's.

import { useSyncExternalStore } from "react";
import { loadPersisted, savePersisted } from "@/lib/shell/persist";

export const MARK_KEY_PERSIST_KEY = "tn.map.legend.v1";
export const MARK_KEY_PERSIST_VERSION = 1;

/** Folded only for exactly `true`: a corrupt or foreign value must never hide the key. */
export function coerceFolded(v: unknown): boolean {
  return v === true;
}

let folded = false;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

export const markKeyStore = {
  get(): boolean {
    return folded;
  },
  /** No-op when unchanged, so a re-render cannot loop through a setter. */
  set(next: boolean) {
    if (folded === next) return;
    folded = next;
    savePersisted(MARK_KEY_PERSIST_KEY, MARK_KEY_PERSIST_VERSION, folded);
    notify();
  },
  toggle() {
    markKeyStore.set(!folded);
  },
  /** Read the saved fold. Call from an effect, never during render: the server snapshot
   *  is always open. It NEVER writes. */
  hydrate() {
    const next = coerceFolded(loadPersisted<boolean>(MARK_KEY_PERSIST_KEY, MARK_KEY_PERSIST_VERSION));
    if (next === folded) return;
    folded = next;
    notify();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useMarkKeyFolded(): boolean {
  return useSyncExternalStore(markKeyStore.subscribe, markKeyStore.get, () => false);
}

// ── Placement ───────────────────────────────────────────────────────────────────

/** A box inside the map, in px from the map's top-left corner. */
export interface MarkKeyBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface MarkKeyPlacementInput {
  mapW: number;
  mapH: number;
  /** The HUD readout's box, or null while it is off. */
  hud: MarkKeyBox | null;
  /** The top of the map's bottom-right control group (the compass and the i). */
  groupTop: number;
  /** The key's open width: its computed max-width, so folding never moves the chip. */
  openW: number;
  inset?: number;
  gap?: number;
}

export interface MarkKeyPlacement {
  top: number;
  maxHeight: number;
  belowHud: boolean;
}

/**
 * Where the key goes. It sits in the map's top right, `inset` from the edge, unless the
 * HUD (top left) would reach it: on a phone the two share the width, and the key then
 * drops to just below the HUD and opens downward. Its height is capped so it stops
 * `gap` above the bottom-right controls and scrolls inside instead of running over
 * them. Pure: every number is relative to the map's top-left, none is read from a DOM.
 */
export function markKeyPlacement({
  mapW,
  mapH,
  hud,
  groupTop,
  openW,
  inset = 10,
  gap = 8,
}: MarkKeyPlacementInput): MarkKeyPlacement {
  const belowHud = hud !== null && hud.right + gap > mapW - inset - openW;
  const top = belowHud && hud ? hud.bottom + gap : inset;
  const floor = Number.isFinite(groupTop) ? groupTop : mapH - inset;
  return { top, maxHeight: Math.max(0, floor - gap - top), belowHud };
}
