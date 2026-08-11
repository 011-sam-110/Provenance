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
import { loadPersisted, savePersisted } from "@/lib/shell/persist";

// Active layers have a live CORE map layer today. The two "planned" keys never got
// one — but their data DID ship, as signal layers (lib/signals/ais.ts and
// lib/signals/weather.ts, both in SIGNALS), so the rail renders them as dimmed,
// toggle-less signposts pointing at Global signals, NOT as "coming soon".
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

let state: LayerState = { ...DEFAULT_STATE };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
  savePersisted(PERSIST_KEY, PERSIST_VERSION, state);
}

export const layersStore = {
  toggle(key: LayerKey) {
    state = { ...state, [key]: !state[key] };
    emit();
  },
  set(key: LayerKey, on: boolean) {
    if (state[key] === on) return;
    state = { ...state, [key]: on };
    emit();
  },
  applyPreset(id: PresetId) {
    state = presetState(id);
    emit();
  },
  applyExact(next: LayerState) {
    state = { ...DEFAULT_STATE, ...next };
    emit();
  },
  get(): LayerState {
    return state;
  },
  /** Pull persisted toggles back in. Call once, client-side, after mount. */
  hydrate() {
    const saved = loadPersisted<Partial<LayerState>>(PERSIST_KEY, PERSIST_VERSION);
    if (saved) state = { ...DEFAULT_STATE, ...saved };
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useLayers(): LayerState {
  return useSyncExternalStore(layersStore.subscribe, layersStore.get, layersStore.get);
}
