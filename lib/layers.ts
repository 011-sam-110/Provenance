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
import { RETIRED_LAYER_KEYS } from "@/lib/layerAliases";

// Active layers have a live CORE map layer today. The two "planned" keys never got
// one. ships still ships as the AIS signal layer; weather no longer has one — its
// adapter was unregistered in #177. Neither is drawn in the rail; see OMITTED_LAYERS
// in lib/console/sources/railSources.ts.
//
// THE CAMERA KEYS ARE CUT BY WHAT A PIN SHOWS YOU, NOT BY WHICH FEED IT CAME FROM.
// They used to be `cameras` (the road-camera registry) and `webcams` (Windy), which
// named the SUPPLIER and told a reader nothing about what they would get. It also
// made the obvious relabel a lie: only ~1,467 of the registry's ~20,400 cameras
// carry a stream /api/hls can play, so a toggle called "Live cams" over the whole
// registry would have overstated the product by a factor of thirteen.
//
//   livecams   — moving video we can actually play. Registry cameras whose
//                `live` flag is true, and nothing else.
//   staticcams — a still image on a refresh interval. The other ~18,900 registry
//                cameras PLUS every Windy webcam.
//
// `live` is derived per camera in lib/cameras/body.ts and rides on the row the map
// already loads, so the split costs no extra request.
//
// WHY EVERY WINDY WEBCAM IS ON THE STILL SIDE, AND WHAT WOULD CHANGE IT. Not because
// Windy has no live cameras — because this app never asks for them. `WebcamSchema`
// (lib/types.ts) carries `imageUrl`/`thumbnailUrl` and NO stream field, and
// lib/sources/windy.ts requests `include=images,location,urls,categories`, which
// omits Windy's `player` include (day/month/live embeds). So "0 live webcams" is a
// fact about our adapter, not about the catalogue, and it has never been measured
// the other way. Add `player` and a row could arrive live — at which point this
// split has to read the same per-row flag for webcams that it reads for registry
// cameras, instead of assuming the tier from the source.
export type LayerKey = "livecams" | "staticcams" | "satellites" | "planes" | "ships" | "weather" | "countries";
export type LayerState = Record<LayerKey, boolean>;

export const ACTIVE_LAYERS: readonly LayerKey[] = ["livecams", "staticcams", "planes", "satellites"];
export const PLANNED_LAYERS: readonly LayerKey[] = ["ships", "weather"];

/**
 * Retired layer keys, and which live keys they become.
 *
 * READ BOUNDARIES ONLY — a saved variant override (tn.variant.v1), a saved area, and
 * every `?layers=` link anyone has already sent. Those links were minted against the
 * old names and there is no way to reissue them, so the decoder keeps answering.
 *
 * `cameras` maps to BOTH tiers because that is what it drew: the whole registry, live
 * and still together. `webcams` was the Windy layer, which is entirely stills, so it
 * lands in staticcams alone. Nothing maps back the other way — these names are gone
 * from everything this code WRITES.
 */
export const LEGACY_LAYER_ALIASES = RETIRED_LAYER_KEYS as Readonly<Record<string, readonly LayerKey[]>>;

/**
 * A saved or authored layer map with retired keys expanded into the live ones.
 *
 * Used on the two paths that can still be carrying the old vocabulary: a persisted
 * variant override, and a user-authored variant — both live in `tn.variant.v1`, both
 * were written before the rename, and neither is reachable for a rewrite. The share
 * link takes the same expansion in lib/share/url.ts, and a saved source context in
 * lib/shell/inspector.ts; the reasoning for `true` winning a collision is written out
 * once, there.
 *
 * Unknown keys are dropped rather than carried: an override is spread over
 * DEFAULT_STATE, so a stray key would ride along in the state object forever.
 */
export function expandLegacyLayers(saved: unknown): Partial<LayerState> {
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
  const known = new Set<string>(Object.keys(DEFAULT_STATE));
  const out: Partial<LayerState> = {};
  const expanded: Partial<LayerState> = {};
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    if (typeof v !== "boolean") continue;
    if (known.has(k)) out[k as LayerKey] = v;
    else for (const key of RETIRED_LAYER_KEYS[k] ?? []) {
      expanded[key as LayerKey] = (expanded[key as LayerKey] ?? false) || v;
    }
  }
  return { ...expanded, ...out };
}

export const DEFAULT_STATE: LayerState = {
  livecams: true,
  // ON, where `webcams` was off. The still tier is most of the road-camera registry
  // and that registry has always been on by default — keeping it off would have hidden
  // ~18,900 cameras the product has drawn since it shipped. The Windy webcams inside
  // this tier are the part that is new to the default, and they are zoom-gated rather
  // than dumped on the globe — see WEBCAM_MIN_ZOOM in components/WorldMap.tsx.
  staticcams: true,
  satellites: true,
  planes: true,
  ships: false,
  weather: false,
  // A base reference layer (borders + names + click), not a data feed — on by
  // default and intentionally left out of ACTIVE/PLANNED + the quick presets so a
  // preset switch never strips the map's geography. Names only show on the raster
  // basemaps (Satellite/Topo); the Light basemap already labels itself.
  countries: true,
};


export type PresetId = "all" | "none" | "cameras" | "air-space";
// Labels have to match presetState() below, and `hint` (rendered as the button's
// title) states anything the one-word label cannot. "None" deliberately leaves the
// countries reference layer ON, so it says so rather than claiming more than it does.
//
// The old "Core" exception is gone with the key rename: it existed because the preset
// forced `webcams` off while calling itself All, and there is no longer a camera layer
// held out of it. "Cameras" now means both tiers.
//
// NOTHING MOUNTED RENDERS THIS TODAY. Its two renderers — components/shell/PresetBar
// and components/shell/sources/LayerPresetRow — are both unmounted, each kept with its
// reasoning on disk. The set is maintained rather than extended for that reason: a
// fifth chip here would be a control no one can press.
export const LAYER_PRESETS: { id: PresetId; label: string; hint: string }[] = [
  { id: "all", label: "All", hint: "Live cams, static cams, planes and satellites on" },
  { id: "none", label: "None", hint: "Every data layer off — borders and names stay on" },
  { id: "cameras", label: "Cameras", hint: "Both camera tiers, nothing else" },
  { id: "air-space", label: "Air + space", hint: "Planes and satellites only" },
];

// Presets switch the four ACTIVE_LAYERS. ships/weather have no core layer to switch
// (their data lives in lib/signals), so a preset can never turn them on and they stay
// false throughout.
export function presetState(id: PresetId): LayerState {
  const off: LayerState = { ...DEFAULT_STATE, livecams: false, staticcams: false, satellites: false, planes: false };
  switch (id) {
    case "all":
      return { ...off, livecams: true, staticcams: true, planes: true, satellites: true };
    case "none":
      return off;
    case "cameras":
      return { ...off, livecams: true, staticcams: true };
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
  /**
   * The same whole-set write, aimed at WORLD however the rail is pointed.
   *
   * WHY BOTH EXIST. applyExact is reached from the rail's own layer-preset chips,
   * where "give this area the Transit set" is a real thing to ask for. This is
   * reached from the variant spine and from applyPreset, which say in their own
   * comments that they are driving THE GLOBE. Sending those down the contextual path
   * quietly poured a board's layers into whatever area was being edited — see the
   * note on replaceWorld in lib/shell/inspector.ts for how that surfaced.
   *
   * The merge base is World's own set rather than the edited one, for the same
   * reason: reading the area's set here would copy the area's signals onto World.
   */
  applyWorld(next: LayerState) {
    const active = { ...DEFAULT_STATE, ...next };
    const set: SourceSet = { ...inspectorStore.get().world };
    for (const k of Object.keys(DEFAULT_STATE) as LayerKey[]) set[k] = active[k];
    inspectorStore.replaceWorldSources(set);
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
