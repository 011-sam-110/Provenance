"use client";
// EACH VIEW'S OWN SOURCES, AND THE ONE-TIME "USE SAME SOURCES FROM <VIEW>" OFFER.
//
// A view is a board (Globe, Streets, News, or a saved one). World is ONE set of
// toggles in lib/shell/inspector.ts, and a board switch used to overwrite all of it
// with the incoming board's template, so Globe's Planes and Earthquakes were gone the
// moment you opened Streets. Now every view keeps its own whole-map set, filed in
// `tn.variant.v1` under `views[<board id>]` (lib/variants/store.ts), and a switch puts
// the incoming view's set back instead of writing a template over it.
//
// This file holds the two pieces that need no knowledge of how the sets are stored:
//
//   1. PURE HELPERS on a `ViewSet`: build one from World, compare two, say whether it
//      has anything on, and name its sources in one line. Unit-tested.
//   2. THE OFFER STORE (`sameSources`): the button at the top of Sources that copies
//      the view you just left onto this one, once, and the Undo that follows. Memory
//      only; nothing here is persisted.
//
// THIS FILE MUST NOT IMPORT lib/variants/store.ts OR lib/console/presets.ts. The
// variant store imports the helpers below, and presets.ts imports the offer store, so
// either import would close a cycle. The few lines that write World (`applyViewSet`)
// therefore live HERE and the variant store re-exposes them.

import { useSyncExternalStore } from "react";
import { DEFAULT_STATE } from "@/lib/layers";
import { MAP_SIGNALS } from "@/lib/signals/registry";
import { inspectorStore, type SourceSet } from "@/lib/shell/inspector";

/** One view's (board's) whole-map sources: every LayerKey, and the MAP_SIGNALS ids on. */
export interface ViewSet {
  layers: Record<string, boolean>;
  signals: string[];
}

const LAYER_KEYS = Object.keys(DEFAULT_STATE) as (keyof typeof DEFAULT_STATE)[];

// ── pure helpers ─────────────────────────────────────────────────────────────

/**
 * Pure: the whole-map sources in a World set.
 *
 * FULL, not a delta from the variant. A delta is only meaningful against the variant
 * it was taken from, so a later variant switch would reinterpret it; a full set means
 * the same thing wherever it is read. Layers floor to DEFAULT_STATE (a key World has
 * never written reads as its default, like lib/layers.ts `project`), signals are
 * "on" or absent, in registry order so two equal sets serialise the same.
 */
export function viewSetFromWorld(world: SourceSet): ViewSet {
  const layers: Record<string, boolean> = {};
  for (const k of LAYER_KEYS) layers[k] = typeof world[k] === "boolean" ? world[k] : DEFAULT_STATE[k];
  const signals = MAP_SIGNALS.filter((s) => world[s.id] === true).map((s) => s.id);
  return { layers, signals };
}

/** Pure: do two sets switch on exactly the same sources? A missing set equals only a missing set. */
export function sameViewSet(a?: ViewSet | null, b?: ViewSet | null): boolean {
  if (!a || !b) return !a && !b;
  for (const k of LAYER_KEYS) {
    if ((a.layers[k] ?? DEFAULT_STATE[k]) !== (b.layers[k] ?? DEFAULT_STATE[k])) return false;
  }
  if (a.signals.length !== b.signals.length) return false;
  const inB = new Set(b.signals);
  return a.signals.every((id) => inB.has(id));
}

/**
 * Pure: has this view got anything on besides Borders & names?
 *
 * `countries` is the base reference layer, on in every view by default, so a view
 * that only has it on has nothing worth copying: offering it would be offering to
 * switch things OFF.
 */
export function hasData(v: ViewSet): boolean {
  return v.signals.length > 0 || LAYER_KEYS.some((k) => k !== "countries" && v.layers[k] === true);
}

/** Pure: the ids that are on, except Borders & names. Layers first (their order), then signals. */
export function onIds(v: ViewSet): string[] {
  const out: string[] = [];
  for (const k of LAYER_KEYS) if (k !== "countries" && v.layers[k] === true) out.push(k);
  for (const id of v.signals) out.push(id);
  return out;
}

/** Pure: "Planes", "Planes, Earthquakes, Wildfires", or "Planes, Earthquakes, Wildfires and 4 more". */
export function sourceLine(labels: string[]): string {
  if (labels.length <= 3) return labels.join(", ");
  return `${labels.slice(0, 3).join(", ")} and ${labels.length - 3} more`;
}

/** Pure: should the view you are on be offered the set of the view you left? */
export function shouldOffer(from: ViewSet, here: ViewSet): boolean {
  return hasData(from) && !sameViewSet(from, here);
}

/** Pure: a ViewSet as the World SourceSet it stands for (every layer key explicit). */
export function worldFromViewSet(v: ViewSet): SourceSet {
  const set: SourceSet = {};
  for (const k of LAYER_KEYS) set[k] = v.layers[k] ?? DEFAULT_STATE[k];
  for (const id of v.signals) set[id] = true;
  return set;
}

/**
 * Put a view's set on World, exactly. One whole-set write aimed at WORLD however the
 * Sources rail is pointed (an area being edited must not absorb it), so subscribers
 * see one change rather than a layers write followed by a signals write.
 */
export function applyViewSet(v: ViewSet): void {
  inspectorStore.replaceWorldSources(worldFromViewSet(v));
}

// ── the offer store ──────────────────────────────────────────────────────────

interface Offer {
  /** The view the offer is shown on. The button renders only while this is the open board. */
  here: string;
  /** The view you left. */
  from: string;
  /** The set to copy, taken when you left. */
  fromSet: ViewSet;
  /** The World object when the offer was made: any other World means a source changed. */
  world: SourceSet;
}

interface Undo {
  here: string;
  from: string;
  fromSet: ViewSet;
  /** This view's own set before the copy. */
  previous: ViewSet;
  world: SourceSet;
}

interface SameSourcesState {
  offer: Offer | null;
  undo: Undo | null;
}

const NONE: SameSourcesState = Object.freeze({ offer: null, undo: null });

let state: SameSourcesState = NONE;
const listeners = new Set<() => void>();
let watching = false;

function set(next: SameSourcesState) {
  state = next;
  for (const l of listeners) l();
}

/**
 * "Goes on ANY source change in that view": a rail toggle, ⌘K, an Ask chip, a widget's
 * "Show on map". Every one of them replaces World's set object, so comparing the
 * object by identity is the whole test. Area edits keep World's object, so they do not
 * clear it. Installed on first use, once.
 */
function watch() {
  if (watching) return;
  watching = true;
  inspectorStore.subscribe(() => {
    const world = inspectorStore.get().world;
    if ((state.offer && state.offer.world !== world) || (state.undo && state.undo.world !== world)) {
      set(NONE);
    }
  });
}

export const sameSources = {
  get: (): SameSourcesState => state,
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },

  /**
   * A person switched from `from` to `here`. Offer `from`'s set when it is worth copying
   * and differs from what `here` has now; otherwise clear anything left from before.
   * `fromSet` is the caller's to compute (the outgoing view's filed set, else its
   * template) because that lookup needs presets.ts, which imports this file.
   */
  offer(from: string, here: string, fromSet: ViewSet) {
    watch();
    const world = inspectorStore.get().world;
    if (shouldOffer(fromSet, viewSetFromWorld(world))) {
      set({ offer: { here, from, fromSet, world }, undo: null });
    } else {
      sameSources.clear();
    }
  },

  /** The × on the button. */
  dismiss() {
    if (state.offer) set({ offer: null, undo: state.undo });
  },

  /** The button: this view's set becomes an exact copy of the other's, once. */
  copy() {
    const o = state.offer;
    if (!o) return;
    const previous = viewSetFromWorld(inspectorStore.get().world);
    set(NONE); // before the write, so the watcher has nothing to clear
    applyViewSet(o.fromSet);
    set({
      offer: null,
      undo: { here: o.here, from: o.from, fromSet: o.fromSet, previous, world: inspectorStore.get().world },
    });
  },

  /** Undo: this view's own set comes back, and so does the button. */
  undo() {
    const u = state.undo;
    if (!u) return;
    set(NONE);
    applyViewSet(u.previous);
    set({
      offer: { here: u.here, from: u.from, fromSet: u.fromSet, world: inspectorStore.get().world },
      undo: null,
    });
  },

  /** The note has gone (time, Esc or ×). */
  closeUndo() {
    if (state.undo) set({ offer: state.offer, undo: null });
  },

  clear() {
    if (state === NONE || (!state.offer && !state.undo)) return;
    set(NONE);
  },
};

export function useSameSources(): SameSourcesState {
  return useSyncExternalStore(sameSources.subscribe, sameSources.get, () => NONE);
}
