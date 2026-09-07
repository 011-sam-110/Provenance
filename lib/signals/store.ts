"use client";
// Which global-signal layers are currently ON. A framework-light external store
// (useSyncExternalStore), MIRRORING lib/layers.ts — but kept SEPARATE on purpose:
// the core cameras/planes/satellites/webcams toggles must stay untouched, and
// signals are heavy, global, opt-in extras that DEFAULT ALL OFF.
//
// Keyed by the registry source id (an arbitrary string), so adding a layer needs
// no edit here. Like the core layers, a signal that is OFF is never fetched —
// WorldMap mounts each signal's <SignalFeed> only while its id is on.
//
// STATE IS NOT PERSISTED HERE — see the same correction in lib/layers.ts. It
// survives a reload as a variant override under tn.variant.v1; tn.signals.v1 is a
// dead key.

import { useSyncExternalStore } from "react";

/** Map of signal id → on/off. A missing id reads as off (default). */
export type SignalState = Record<string, boolean>;

import { DEFAULT_STATE } from "@/lib/layers";
import { editingSet, inspectorStore, unionSetMemo, type SourceSet } from "@/lib/shell/inspector";

// Signals are the sparse half of a context's SourceSet: an id that is not present
// reads as off, exactly as before. No projection is needed — a SourceSet IS a
// SignalState — so these return a context's map directly.
//
// TWO READERS, MIRRORING lib/layers.ts, and its note on the split applies here word
// for word: `current` is the UNION (on in World or in any area — what is fetched and
// mounted), `editing` is the one context the rail is pointed at (what it ticks, and
// what every write compares against). A write that compared against the union would
// be a dead toggle on any signal World already has on.
//
// `current` must go through the MEMOISED reader. An earlier cut of this file called
// the un-memoised builder and claimed its identity was "already stable across
// renders": true for World, which was returned by identity, and false the moment an
// area was involved, where a fresh object is built per call. useSignals() would have
// looped. Pinned by an identity assertion in tests/unit/inspector-routing.test.ts.
function current(): SignalState {
  return unionSetMemo(inspectorStore.get());
}

// `editingSet` returns a context's own map BY IDENTITY — state.world, or the area's
// own `sources` — so it is already stable across renders and needs no memo of its own.
function editing(): SignalState {
  return editingSet(inspectorStore.get());
}

export const signalsStore = {
  isOn(id: string): boolean {
    return current()[id] === true;
  },
  toggle(id: string) {
    inspectorStore.setSource(id, !(editing()[id] === true));
  },
  set(id: string, on: boolean) {
    if ((editing()[id] === true) === on) return;
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
    const cur = editing();
    for (const k of Object.keys(DEFAULT_STATE)) {
      if (typeof cur[k] === "boolean") set[k] = cur[k];
    }
    inspectorStore.replaceSources(set);
  },
  get: current,
  /** The context being edited. For the rail's ticks and for anything that writes. */
  editing,
  /** Kept for API compatibility. inspectorStore.hydrate() owns rehydration now. */
  hydrate() {
    /* no-op */
  },
  subscribe(listener: () => void): () => void {
    return inspectorStore.subscribe(listener);
  },
};

/** The UNION. What is on the map. */
export function useSignals(): SignalState {
  return useSyncExternalStore(signalsStore.subscribe, signalsStore.get, signalsStore.get);
}

/** The context being EDITED. What the Sources rail ticks. */
export function useEditingSignals(): SignalState {
  return useSyncExternalStore(signalsStore.subscribe, signalsStore.editing, signalsStore.editing);
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
