"use client";
// HUD preferences — the SAME external-store + persisted-envelope pattern the shell
// stores use. The template is lib/shell/viewMode.ts (module state, emit() persists
// through lib/shell/persist's versioned envelope, hydrate() re-reads on mount):
// mapViewStore itself is deliberately unpersisted, so persistence here mirrors the
// shell store that DOES persist, with a NEW key (`tn.hud.v1`) and a NEW version —
// no other store is touched.
//
// The pure half (defaults, variant table, sanitise) lives in lib/hud/model.ts so
// tests/unit/hud-model.test.ts can pin it in the node vitest environment without
// importing React or the persist helpers.

import { useSyncExternalStore } from "react";
import { loadPersisted, savePersisted } from "@/lib/shell/persist";
import { DEFAULT_HUD_PREFS, sanitizeHudPrefs, type HudPrefs, type HudVariant } from "@/lib/hud/model";

const PERSIST_KEY = "tn.hud.v1";
const PERSIST_VERSION = 1;

let state: HudPrefs = { ...DEFAULT_HUD_PREFS };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
  savePersisted(PERSIST_KEY, PERSIST_VERSION, state);
}

export const hudStore = {
  setEnabled(on: boolean) {
    if (state.enabled === on) return;
    state = { ...state, enabled: on };
    emit();
  },
  setVariant(v: HudVariant) {
    if (state.variant === v) return;
    state = { ...state, variant: v };
    emit();
  },
  setAnimate(on: boolean) {
    if (state.animate === on) return;
    state = { ...state, animate: on };
    emit();
  },
  setOpacity(pct: number) {
    const o = sanitizeHudPrefs({ opacity: pct }).opacity; // clamp via the model
    if (state.opacity === o) return;
    state = { ...state, opacity: o };
    emit();
  },
  get(): HudPrefs {
    return state;
  },
  /** Re-read the persisted envelope (client mount only — loadPersisted no-ops on
   *  the server). Called from the HUD and from the Map settings tool, both of
   *  which render the prefs. */
  hydrate() {
    state = sanitizeHudPrefs(loadPersisted<HudPrefs>(PERSIST_KEY, PERSIST_VERSION));
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useHudPrefs(): HudPrefs {
  return useSyncExternalStore(hudStore.subscribe, hudStore.get, hudStore.get);
}
