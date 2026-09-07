"use client";
// Which world layers are currently visible. Framework-light external store
// (useSyncExternalStore), the same pattern as lib/overlay.ts.
//
// WorldMap reads this to decide which MapLibre layers are visible AND — via the
// gating <CamerasFeed>/<PlanesFeed>/<SatellitesFeed> wrappers — whether a layer's
// data hook is even mounted (a hidden layer does not fetch or tick). The left
// LayerRail and the ⌘K palette drive the toggles.
//
// TOGGLE STATE IS NOT PERSISTED HERE, and this comment used to say it was. It
// survives a reload through the VARIANT SPINE: variantStore.bootstrap is the only
// load-time hydration path, and its captureOverride subscribes to this store and
// persists the diff-from-variant under tn.variant.v1. The header was wrong about
// the mechanism while being right about the outcome, which is the worse kind of
// wrong — the behaviour appears to confirm it. tn.layers.v1 is a dead key.

import { useSyncExternalStore } from "react";

// Active layers have a live CORE map layer today. The two "planned" keys never got
// one. ships still ships as the AIS signal layer; weather no longer has one — its
// adapter was unregistered in #177. Neither is drawn in the rail; see OMITTED_LAYERS
// in lib/console/sources/railSources.ts.
export type LayerKey = "cameras" | "satellites" | "planes" | "ships" | "webcams" | "weather" | "countries";
export type LayerState = Record<LayerKey, boolean>;

export const ACTIVE_LAYERS: readonly LayerKey[] = ["cameras", "planes", "satellites", "webcams"];
export const PLANNED_LAYERS: readonly LayerKey[] = ["ships", "weather"];

export const DEFAULT_STATE: LayerState = {
  cameras: true,
  satellites: true,
  planes: true,
  ships: false,
  webcams: false,
  weather: false,
  // A base reference layer (borders + names + click), not a data feed — on by
  // default and intentionally left out of ACTIVE/PLANNED + the quick presets so a
  // preset switch never strips the map's geography. Names only show on the raster
  // basemaps (Satellite/Topo); the Light basemap already labels itself.
  countries: true,
};


export type PresetId = "all" | "none" | "cameras" | "air-space";
// Labels have to match presetState() below, which they did not: the "all" preset
// switches cameras/planes/satellites and forces webcams OFF, and "none" deliberately
// leaves the countries reference layer ON. A button labelled "All" that turns a
// visible layer off is a false claim, so the label says what it does and `hint`
// (rendered as the button's title) states the exception outright.
export const LAYER_PRESETS: { id: PresetId; label: string; hint: string }[] = [
  { id: "all", label: "Core", hint: "Cameras, planes and satellites on — webcams stay opt-in" },
  { id: "none", label: "None", hint: "Every data layer off — borders and names stay on" },
  { id: "cameras", label: "Cameras", hint: "Road cameras only" },
  { id: "air-space", label: "Air + space", hint: "Planes and satellites only" },
];

// Presets switch the core cameras/planes/satellites layers. Webcams is active
// (a live toggle) but stays OUT of the presets on purpose: it is a keyed,
// rate-limited global sample, so it stays opt-in rather than being pulled in by
// a one-tap preset. ships/weather have no core layer to switch (their data lives in
// lib/signals), so a preset can never turn them on and they stay false throughout.
export function presetState(id: PresetId): LayerState {
  const off: LayerState = { ...DEFAULT_STATE, cameras: false, satellites: false, planes: false };
  switch (id) {
    case "all":
      return { ...off, cameras: true, planes: true, satellites: true };
    case "none":
      return off;
    case "cameras":
      return { ...off, cameras: true };
    case "air-space":
      return { ...off, planes: true, satellites: true };
  }
}

// STATE LIVES IN lib/shell/inspector.ts, NOT HERE. This store is a VIEW onto the
// source contexts — World, plus one per drawn area.
//
// IT IS NOW TWO VIEWS, AND THEY ANSWER DIFFERENT QUESTIONS. Areas are additive, so
// "is cameras on?" has stopped having one answer:
//
//   get()      the UNION — on in World or in ANY area. What WorldMap gates its
//              feeds and its layer visibility on, because a source wanted inside
//              one ring still has to be fetched and still has to have a layer.
//   editing()  the ONE context the rail is pointed at. What a tick in the Sources
//              rail shows, and what toggle() flips.
//
// Reading the wrong one is a real bug in both directions and neither shows up as a
// type error, so they are named rather than distinguished by an argument. Using the
// union to drive a toggle is the worse half: with Aircraft on in World, toggling it
// while editing an area would read `true`, write `false` to the area, and change
// nothing on screen — a dead control.
//
// The projection is one-way. This file imports inspector.ts; inspector.ts must never
// import this one, or the pair is circular and neither owns the state.
import { editingArea, editingSet, inspectorStore, unionSetMemo, type SourceSet } from "@/lib/shell/inspector";

/** Every LayerKey off. An AREA's floor — see project(). */
const ALL_OFF: LayerState = (Object.keys(DEFAULT_STATE) as LayerKey[]).reduce((acc, k) => {
  acc[k] = false;
  return acc;
}, {} as LayerState);

/**
 * The 7 LayerKeys pulled out of a context's set, over the floor that context uses.
 *
 * THE FLOOR IS DIFFERENT FOR WORLD AND FOR AN AREA, and that is the whole contexts
 * rule expressed in one argument. World floors to DEFAULT_STATE, so the globe behaves
 * exactly as it did before this store was routed. An area floors to ALL_OFF, because a
 * new area starts with an empty set and must read as empty — flooring it with
 * DEFAULT_STATE would hand the user a context they never configured, and would move
 * every area's unset key the day a default flips. ALWAYS_ON_SOURCES is what keeps an
 * empty area from loading to a blank map; the floor is not.
 */
function project(set: SourceSet, floor: LayerState): LayerState {
  const out = { ...floor };
  for (const k of Object.keys(DEFAULT_STATE) as LayerKey[]) {
    if (typeof set[k] === "boolean") out[k] = set[k];
  }
  return out;
}

// Both projections are memoised on the object they derive from, so
// useSyncExternalStore's identity check holds: project() builds a fresh object every
// call, and returning a new one from get() on every render loops React forever.
// unionSetMemo is memoised for the same reason one layer down — see the note on it in
// lib/shell/inspector.ts.
//
// TWO CACHES, NOT ONE. They key off different objects (the union set, and the state)
// and are read on different renders; sharing one slot would thrash it on every write.
let lastSet: SourceSet | null = null;
let lastProjection: LayerState = { ...DEFAULT_STATE };

/**
 * The UNION — what is drawn and fetched.
 *
 * FLOORED TO DEFAULT_STATE, always. World is always part of the union and World's
 * floor is DEFAULT_STATE, so there is no second case here the way there is in
 * `editingProjection` below. An area contributes only its `true` values (see
 * unionSet), so an area can add a layer to this and can never take one away.
 */
function current(): LayerState {
  const set = unionSetMemo(inspectorStore.get());
  if (set !== lastSet) {
    lastSet = set;
    lastProjection = project(set, DEFAULT_STATE);
  }
  return lastProjection;
}

let lastEditState: unknown = null;
let lastEditProjection: LayerState = { ...DEFAULT_STATE };

/**
 * The context being EDITED — what the rail ticks and what toggle() flips.
 *
 * THE FLOOR IS DIFFERENT FOR WORLD AND FOR AN AREA, and that is the contexts rule in
 * one argument. World floors to DEFAULT_STATE, so the globe reads exactly as it did
 * before any of this. An area floors to ALL_OFF, because a new area's set is empty
 * and must read as empty — flooring it with DEFAULT_STATE would tick four layers the
 * user never turned on, and would move every area's unset key the day a default flips.
 */
function editingProjection(): LayerState {
  const state = inspectorStore.get();
  if (state !== lastEditState) {
    lastEditState = state;
    lastEditProjection = project(editingSet(state), editingArea(state) ? ALL_OFF : DEFAULT_STATE);
  }
  return lastEditProjection;
}

export const layersStore = {
  // EVERY WRITE READS `editingProjection`, NEVER `current`. A write lands on the
  // context being edited, so it has to compare against that context — comparing
  // against the union means "on in World" makes the area's own toggle inert.
  toggle(key: LayerKey) {
    inspectorStore.setSource(key, !editingProjection()[key]);
  },
  set(key: LayerKey, on: boolean) {
    if (editingProjection()[key] === on) return;
    inspectorStore.setSource(key, on);
  },
  applyPreset(id: PresetId) {
    layersStore.applyExact(presetState(id));
  },
  applyExact(next: LayerState) {
    // Merge rather than replace: the context's set also holds SIGNAL ids, and a
    // layer preset must not silently switch every signal layer off.
    const active = { ...DEFAULT_STATE, ...next };
    const set: SourceSet = { ...editingSet(inspectorStore.get()) };
    for (const k of Object.keys(DEFAULT_STATE) as LayerKey[]) set[k] = active[k];
    inspectorStore.replaceSources(set);
  },
  get: current,
  /** The context being edited. For the rail's ticks and for anything that writes. */
  editing: editingProjection,
  /** Kept for API compatibility. inspectorStore.hydrate() owns rehydration now. */
  hydrate() {
    /* no-op — see the note at the top of this block */
  },
  subscribe(listener: () => void): () => void {
    return inspectorStore.subscribe(listener);
  },
};

/** The UNION. What is on the map. */
export function useLayers(): LayerState {
  return useSyncExternalStore(layersStore.subscribe, layersStore.get, layersStore.get);
}

/** The context being EDITED. What the Sources rail ticks. */
export function useEditingLayers(): LayerState {
  return useSyncExternalStore(layersStore.subscribe, layersStore.editing, layersStore.editing);
}
