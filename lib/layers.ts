"use client";
// Which world layers are currently visible. Framework-light external store
// (useSyncExternalStore), the same pattern as lib/overlay.ts.
//
// WorldMap reads this to decide which MapLibre layers are visible AND — via the
// gating <CamerasFeed>/<PlanesFeed>/<SatellitesFeed> wrappers — whether a layer's
// data hook is even mounted (a hidden layer does not fetch or tick). The left
// LayerRail and the ⌘K palette drive the toggles. Toggle state is persisted to
// localStorage so a composed view survives a reload.

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

const PERSIST_KEY = "tn.layers.v1";
const PERSIST_VERSION = 1;

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

// STATE LIVES IN lib/shell/inspector.ts, NOT HERE. This store is a VIEW onto
// whichever source context is loaded — World, or one drawn area. The API below is
// byte-identical to what it was before that change, which is the whole point:
// WorldMap, SourceCatalog, monitors.ts, presetLayers.ts, presets.ts, PresetBar and
// the command palette all call these methods and none of them needed an edit.
//
// The projection is one-way. This file imports inspector.ts; inspector.ts must never
// import this one, or the pair is circular and neither owns the state.
import { effectiveSetMemo, inspectorStore, loadedArea, type SourceSet } from "@/lib/shell/inspector";

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

// Memoised on the state object so useSyncExternalStore's identity check holds:
// project() builds a fresh object every call, and returning a new one from get() on
// every render loops React forever. effectiveSetMemo is memoised for the same reason
// one layer down — see the note on it in lib/shell/inspector.ts.
let lastSet: SourceSet | null = null;
let lastProjection: LayerState = { ...DEFAULT_STATE };

function current(): LayerState {
  const state = inspectorStore.get();
  const set = effectiveSetMemo(state);
  if (set !== lastSet) {
    lastSet = set;
    lastProjection = project(set, loadedArea(state) ? ALL_OFF : DEFAULT_STATE);
  }
  return lastProjection;
}

export const layersStore = {
  toggle(key: LayerKey) {
    inspectorStore.setSource(key, !current()[key]);
  },
  set(key: LayerKey, on: boolean) {
    if (current()[key] === on) return;
    inspectorStore.setSource(key, on);
  },
  applyPreset(id: PresetId) {
    layersStore.applyExact(presetState(id));
  },
  applyExact(next: LayerState) {
    // Merge rather than replace: the context's set also holds SIGNAL ids, and a
    // layer preset must not silently switch every signal layer off.
    const active = { ...DEFAULT_STATE, ...next };
    const set: SourceSet = { ...effectiveSetMemo(inspectorStore.get()) };
    for (const k of Object.keys(DEFAULT_STATE) as LayerKey[]) set[k] = active[k];
    inspectorStore.replaceSources(set);
  },
  get: current,
  /** Kept for API compatibility. inspectorStore.hydrate() owns rehydration now. */
  hydrate() {
    /* no-op — see the note at the top of this block */
  },
  subscribe(listener: () => void): () => void {
    return inspectorStore.subscribe(listener);
  },
};

export function useLayers(): LayerState {
  return useSyncExternalStore(layersStore.subscribe, layersStore.get, layersStore.get);
}
