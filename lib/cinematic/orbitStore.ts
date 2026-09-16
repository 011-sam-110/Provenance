"use client";
// ISS-orbit-follow preferences — the SAME external-store + persisted-envelope
// pattern as lib/hud/store.ts (which itself mirrors the shell stores). The
// template is lib/shell/viewMode.ts: module state, emit() persists through
// lib/shell/persist's versioned envelope, hydrate() re-reads on mount.
// New key (`tn.issOrbit.v1`), new version — no other store is touched.
//
// Named orbitStore (not store) on purpose: lib/cinematic/store.ts is the
// repo's own cinematic-DIVE store, and one folder must not grow two `store`s.
//
// The pure half (defaults, speed table, sanitise) lives in ./prefs.ts so
// tests/unit/iss-orbit-prefs.test.ts can pin it in the node vitest
// environment without importing React or the persist helpers.

import { useSyncExternalStore } from "react";
import { loadPersisted, savePersisted } from "@/lib/shell/persist";
import {
  DEFAULT_ISS_ORBIT_PREFS,
  sanitizeIssOrbitPrefs,
  type IssOrbitPrefs,
  type IssOrbitSpeed,
} from "@/lib/cinematic/prefs";

const PERSIST_KEY = "tn.issOrbit.v1";
const PERSIST_VERSION = 1;

let state: IssOrbitPrefs = { ...DEFAULT_ISS_ORBIT_PREFS };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
  savePersisted(PERSIST_KEY, PERSIST_VERSION, state);
}

export const issOrbitStore = {
  setEnabled(on: boolean) {
    if (state.enabled === on) return;
    state = { ...state, enabled: on };
    emit();
  },
  setSpeed(s: IssOrbitSpeed) {
    if (state.speed === s) return;
    state = { ...state, speed: s };
    emit();
  },
  get(): IssOrbitPrefs {
    return state;
  },
  /** Re-read the persisted envelope (client mount only — loadPersisted no-ops
   *  on the server). Called from the orbit controller and from the Map
   *  settings tool, both of which render the prefs. */
  hydrate() {
    state = sanitizeIssOrbitPrefs(loadPersisted<IssOrbitPrefs>(PERSIST_KEY, PERSIST_VERSION));
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useIssOrbitPrefs(): IssOrbitPrefs {
  return useSyncExternalStore(issOrbitStore.subscribe, issOrbitStore.get, issOrbitStore.get);
}
