"use client";
// Which global-signal layers are currently ON. A framework-light external store
// (useSyncExternalStore), MIRRORING lib/layers.ts — but kept SEPARATE on purpose:
// the core cameras/planes/satellites/webcams toggles must stay untouched, and
// signals are heavy, global, opt-in extras that DEFAULT ALL OFF.
//
// Keyed by the registry source id (an arbitrary string), so adding a layer needs
// no edit here. Like the core layers, a signal that is OFF is never fetched —
// WorldMap mounts each signal's <SignalFeed> only while its id is on. State is
// persisted to localStorage so a composed view survives a reload.

import { useSyncExternalStore } from "react";

/** Map of signal id → on/off. A missing id reads as off (default). */
export type SignalState = Record<string, boolean>;

import { DEFAULT_STATE } from "@/lib/layers";
import { effectiveSetMemo, inspectorStore, type SourceSet } from "@/lib/shell/inspector";

// Signals are the sparse half of a context's SourceSet: an id that is not present
// reads as off, exactly as before. No projection is needed — a SourceSet IS a
// SignalState — so this returns the context's map directly.
//
// It must go through the MEMOISED reader. An earlier cut of this file called
// effectiveSet() and claimed its identity was "already stable across renders": true
// for World, which is returned by identity, and false for an area, where the
// always-on ids are forced into a fresh object on every call. useSignals() would have
// looped as soon as an area loaded. Pinned by an identity assertion in
// tests/unit/inspector-routing.test.ts.
function current(): SignalState {
  return effectiveSetMemo(inspectorStore.get());
}

export const signalsStore = {
  isOn(id: string): boolean {
    return current()[id] === true;
  },
  toggle(id: string) {
    inspectorStore.setSource(id, !(current()[id] === true));
  },
  set(id: string, on: boolean) {
    if ((current()[id] === true) === on) return;
    inspectorStore.setSource(id, on);
  },
  applyExact(next: SignalState) {
    // MERGE, never replace — the exact mirror of the note in lib/layers.ts. Layers and
    // signals used to own separate module state, so neither could reach the other; they
    // now project onto ONE SourceSet per context. A variant writes both (layers first,
    // then signals, in lib/variants/store.ts), so a whole-set replace here resets every
    // map layer to its floor a moment after the variant set it. Only the layer half is
    // carried over; every signal id comes from `next`, so a signal absent from it still
    // reads off, exactly as before.
    const set: SourceSet = { ...next };
    const cur = effectiveSetMemo(inspectorStore.get());
    for (const k of Object.keys(DEFAULT_STATE)) {
      if (typeof cur[k] === "boolean") set[k] = cur[k];
    }
    inspectorStore.replaceSources(set);
  },
  get: current,
  /** Kept for API compatibility. inspectorStore.hydrate() owns rehydration now. */
  hydrate() {
    /* no-op */
  },
  subscribe(listener: () => void): () => void {
    return inspectorStore.subscribe(listener);
  },
};

export function useSignals(): SignalState {
  return useSyncExternalStore(signalsStore.subscribe, signalsStore.get, signalsStore.get);
}

// --- Live per-signal counts -------------------------------------------------
// Mirrors lib/metrics.ts: the gating <SignalFeed> children push their loaded
// feature counts here so the rail can show a live count beside each toggle
// without WorldMap threading props back out. set(id, null) clears (layer off).

export type SignalCounts = Record<string, number>;

let counts: SignalCounts = {};
const countListeners = new Set<() => void>();

export const signalCountsStore = {
  set(id: string, count: number | null) {
    if (count == null) {
      if (!(id in counts)) return;
      const next = { ...counts };
      delete next[id];
      counts = next;
    } else {
      if (counts[id] === count) return;
      counts = { ...counts, [id]: count };
    }
    for (const l of countListeners) l();
  },
  get(): SignalCounts {
    return counts;
  },
  subscribe(listener: () => void): () => void {
    countListeners.add(listener);
    return () => {
      countListeners.delete(listener);
    };
  },
};

export function useSignalCounts(): SignalCounts {
  return useSyncExternalStore(signalCountsStore.subscribe, signalCountsStore.get, signalCountsStore.get);
}
