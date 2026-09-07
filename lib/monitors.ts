"use client";
// Monitor variants — curated, one-click "configure the whole map" presets.
//
// worldmonitor.app ships "monitor variants" (World / Tech / Finance / …). This is
// the calm-light analogue: a small set of CURATED combos that each flip BOTH the
// core world layers (lib/layers — cameras/planes/satellites/webcams) AND the
// opt-in global signal layers (lib/signals/store — earthquakes, cables, aurora …)
// to a sensible state in one tap, with a calm label.
//
// The combo definitions live here as plain data; the (lat-thin) pure functions
// derive the full on/off maps and find which monitor (if any) the live state
// matches. applyMonitor() is the only impure piece: it drives the EXISTING store
// APIs (layersStore.set / signalsStore.set) — it never re-implements toggle logic.

import { ACTIVE_LAYERS, PLANNED_LAYERS, layersStore, type LayerKey, type LayerState } from "@/lib/layers";
import { MAP_SIGNALS } from "@/lib/signals/registry";
import { signalsStore, type SignalState } from "@/lib/signals/store";

/** A curated map configuration: which core layers + which signal layers are on. */
export interface Monitor {
  /** Stable id (the ⌘K command + chip key). */
  id: string;
  /** Calm chip label. */
  label: string;
  /** One-line description for the ⌘K hint / chip title. */
  blurb: string;
  /** Core world layers to switch ON (every other core layer goes OFF). */
  layers: LayerKey[];
  /** Global-signal ids to switch ON (every other signal goes OFF). */
  signals: string[];
}

/** The full set of core layer keys (active + planned), for building the off-base. */
export const ALL_LAYER_KEYS: LayerKey[] = [...ACTIVE_LAYERS, ...PLANNED_LAYERS];

// Signal ids are the registry source ids (see lib/signals/registry.ts). They are
// validated against the live registry by the unit test, so a typo here fails CI.
export const MONITORS: Monitor[] = [
  {
    id: "world",
    label: "World",
    blurb: "Cameras, planes & satellites with a few key global signals",
    layers: ["cameras", "planes", "satellites"],
    signals: ["earthquakes", "wildfires", "conflict"],
  },
  {
    id: "skywatch",
    label: "Skywatch",
    blurb: "Everything in the sky — planes, satellites, launches & aurora",
    layers: ["planes", "satellites"],
    signals: ["launches", "aurora"],
  },
  {
    id: "ground",
    label: "Ground",
    blurb: "Just the live ground cameras — road cams + global webcams",
    layers: ["cameras", "webcams"],
    signals: [],
  },
  {
    id: "nature",
    label: "Nature",
    blurb: "Natural hazards — quakes, wildfires, volcanoes, storms, floods, aurora",
    layers: [],
    signals: ["earthquakes", "wildfires", "volcanoes", "severeStorms", "floods", "aurora"],
  },
  {
    id: "infrastructure",
    label: "Infrastructure",
    blurb: "Critical infrastructure — cables, nuclear, airports, ports, GPS jamming",
    layers: [],
    signals: ["cables", "nuclear", "airports", "ports", "gpsJamming"],
  },
  {
    id: "calm",
    label: "Calm",
    blurb: "Everything off but the cameras — the quiet default",
    layers: ["cameras"],
    signals: [],
  },
];

/** Look up a monitor by id. */
export function monitorById(id: string): Monitor | undefined {
  return MONITORS.find((m) => m.id === id);
}

/** Pure: the full LayerState a monitor implies (listed layers on, everything else off). */
export function monitorLayerState(m: Monitor): LayerState {
  const out = Object.fromEntries(ALL_LAYER_KEYS.map((k) => [k, false])) as LayerState;
  for (const k of m.layers) out[k] = true;
  return out;
}

/**
 * Pure: the SignalState a monitor implies over a given universe of signal ids
 * (listed signals on, every other id explicitly off). Passing the universe in
 * keeps this testable without importing the heavy registry.
 */
export function monitorSignalState(m: Monitor, signalIds: string[]): SignalState {
  const on = new Set(m.signals);
  const out: SignalState = {};
  for (const id of signalIds) out[id] = on.has(id);
  return out;
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}

/**
 * Pure: which monitor (if any) the live layer + signal state exactly matches —
 * used to highlight the active chip. Compares the ON-sets only (a signal/layer
 * absent from the state reads as off). Returns null when nothing matches.
 */
export function matchMonitor(
  layers: LayerState,
  signals: SignalState,
  signalIds: string[],
): string | null {
  const onLayers = ALL_LAYER_KEYS.filter((k) => layers[k]);
  const onSignals = signalIds.filter((id) => signals[id] === true);
  for (const m of MONITORS) {
    if (sameSet(onLayers, m.layers) && sameSet(onSignals, m.signals)) return m.id;
  }
  return null;
}

/**
 * Apply a monitor: drive the EXISTING layer + signal stores to the curated state.
 * Reuses layersStore.set / signalsStore.set (no duplicated toggle logic); each
 * store handles its own emit + persist. Returns false for an unknown id.
 */
export function applyMonitor(id: string): boolean {
  const m = monitorById(id);
  if (!m) return false;
  const ls = monitorLayerState(m);
  for (const k of ALL_LAYER_KEYS) layersStore.set(k, ls[k]);
  const on = new Set(m.signals);
  for (const s of MAP_SIGNALS) signalsStore.set(s.id, on.has(s.id));
  return true;
}
