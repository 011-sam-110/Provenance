"use client";
// Apply the filters of a typed question, and say which ones are on the map now.
//
// THE CHIPS ARE READ FROM THE STORES, NOT REMEMBERED. `appliedChips` builds the chip
// list from the live state: the time window, the precision filter, the scope and the
// layers. So a chip cannot outlive its filter and a filter cannot outlive its chip.
// Clear the place from the Sources rail and the Place chip goes. Turn the layer off
// in the rail and the Layer chip goes. Nothing here keeps a second copy of "what is
// filtered" that could disagree with the map.
//
// The one thing kept here is which LAYERS the reader turned on. A layer that is on
// is not a hidden filter (the rail shows it), so it needs no chip of its own; the
// chip is there because the question put the layer on the map and one click must be
// able to take it off again.
//
// The four kinds, and the store each one writes:
//   layer      signalsStore        the same call the Sources rail makes
//   place      scopeStore          the one console-wide crop, as a place scope
//   time       timeWindowStore     the window WorldMap and the event lists read
//   precision  precisionFilterStore
//
// Nothing here is persisted. See the notes in precisionFilter.ts, in scope.ts
// (`coerceSavedScope`) and in timeWindow.ts (`hydrate`): a reload gives the full map.

import { useMemo, useSyncExternalStore } from "react";
import { mapViewStore } from "@/lib/mapView";
import { MAP_SIGNALS } from "@/lib/signals/registry";
import { signalsStore, useSignals, type SignalState } from "@/lib/signals/store";
import { precisionLabel, timeLabel, type AskFilter, type AskTimeWindow } from "@/lib/shell/ask";
import type { ResolvedPlace } from "@/lib/shell/askPlace";
import { precisionFilterStore, usePrecisionFilter, type PrecisionFilter } from "@/lib/shell/precisionFilter";
import { placeScope, scopeStore, useScope, WORLD_SCOPE, type Scope } from "@/lib/shell/scope";
import { timeWindowStore, useTimeWindow, type TimeWindowKey } from "@/lib/shell/timeWindow";

// --- the layers the reader turned on -----------------------------------------------

let askLayerIds: readonly string[] = [];
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

export const askLayersStore = {
  get(): readonly string[] {
    return askLayerIds;
  },
  add(id: string) {
    if (askLayerIds.includes(id)) return;
    askLayerIds = [...askLayerIds, id];
    emit();
  },
  remove(id: string) {
    if (!askLayerIds.includes(id)) return;
    askLayerIds = askLayerIds.filter((x) => x !== id);
    emit();
  },
  clear() {
    if (askLayerIds.length === 0) return;
    askLayerIds = [];
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

// --- chips -------------------------------------------------------------------------

export type AppliedChip = {
  /** Stable for a React key and a test. */
  key: string;
  /** What the chip says after the name of its kind. */
  label: string;
  /** One plain sentence: what this filter does to the map. The chip's tooltip. */
  note: string;
} & (
  | { kind: "layer"; layerId: string }
  | { kind: "place" }
  | { kind: "time"; window: AskTimeWindow }
  | { kind: "precision"; filter: PrecisionFilter }
);

export interface AppliedInput {
  askLayerIds: readonly string[];
  signalsOn: SignalState;
  /** The registry label of a map layer, or undefined for an id that is not one. */
  layerLabel: (id: string) => string | undefined;
  scope: Scope;
  timeWindow: TimeWindowKey;
  precision: PrecisionFilter | null;
  /** What the place crop is, from the lookup that made it. */
  placeNote?: string;
}

const TIME_NOTE: Readonly<Record<AskTimeWindow, string>> = {
  "1h": "Signal items older than 1 hour are hidden. Items with no time stay on the map.",
  "6h": "Signal items older than 6 hours are hidden. Items with no time stay on the map.",
  "24h": "Signal items older than 24 hours are hidden. Items with no time stay on the map.",
  "7d": "Signal items older than 7 days are hidden. Items with no time stay on the map.",
};

/**
 * Pure: the chips for the filters that have an effect now, in a fixed order
 * (layers, place, time, precision). A filter with no effect gives no chip.
 */
export function appliedChips(s: AppliedInput): AppliedChip[] {
  const chips: AppliedChip[] = [];
  for (const id of s.askLayerIds) {
    const label = s.layerLabel(id);
    if (!label || s.signalsOn[id] !== true) continue;
    chips.push({ kind: "layer", key: `layer:${id}`, layerId: id, label, note: `The layer ${label} is on the map.` });
  }
  if (s.scope.mode === "aoi" && s.scope.origin === "place") {
    chips.push({
      kind: "place",
      key: "place",
      label: s.scope.label,
      note: s.placeNote ?? `The map shows only what is inside ${s.scope.label}. The outline is on the map.`,
    });
  }
  if (s.timeWindow !== "all") {
    chips.push({ kind: "time", key: "time", window: s.timeWindow, label: timeLabel(s.timeWindow), note: TIME_NOTE[s.timeWindow] });
  }
  if (s.precision) {
    const label = precisionLabel(s.precision.mode, s.precision.level);
    chips.push({
      kind: "precision",
      key: "precision",
      filter: s.precision,
      label,
      note: `${label}. This rule hides signal items of the other kind. It does not change cameras, aircraft or ships.`,
    });
  }
  return chips;
}

const LAYER_LABELS = new Map(MAP_SIGNALS.map((s) => [s.id, s.label]));
const layerLabel = (id: string) => LAYER_LABELS.get(id);

/** The area that was drawn before a place took the scope. A removed place gives it back. */
let scopeBeforePlace: Scope | null = null;
let placeNote: string | undefined;

/** The chips now, read from the stores. For code that is not a component. */
export function readApplied(): AppliedChip[] {
  return appliedChips({
    askLayerIds,
    signalsOn: signalsStore.get(),
    layerLabel,
    scope: scopeStore.get(),
    timeWindow: timeWindowStore.get(),
    precision: precisionFilterStore.get(),
    placeNote,
  });
}

/** The chips now, for a component. It renders again when one of the stores changes. */
export function useAppliedChips(): AppliedChip[] {
  const ids = useSyncExternalStore(askLayersStore.subscribe, askLayersStore.get, askLayersStore.get);
  const signalsOn = useSignals();
  const scope = useScope();
  const timeWindow = useTimeWindow();
  const precision = usePrecisionFilter();
  return useMemo(
    () => appliedChips({ askLayerIds: ids, signalsOn, layerLabel, scope, timeWindow, precision, placeNote }),
    [ids, signalsOn, scope, timeWindow, precision],
  );
}

// --- apply and remove ----------------------------------------------------------------

/**
 * Apply the filters of one question.
 *
 * `place` is the resolved place of the question's place filter, or null when the
 * question has none or the lookup found none. A place that was not found is NOT
 * applied: the caller shows it as not understood. Each kind the question does not
 * name is left as it is, and its chip stays on the screen.
 */
export function applyAsk(filters: readonly AskFilter[], place: ResolvedPlace | null): void {
  for (const f of filters) {
    if (f.kind === "layer") {
      signalsStore.set(f.layerId, true);
      askLayersStore.add(f.layerId);
    } else if (f.kind === "time") {
      timeWindowStore.set(f.window);
    } else if (f.kind === "precision") {
      precisionFilterStore.set({ mode: f.mode, level: f.level });
    } else if (place) {
      const next = placeScope(place.label, place.parts);
      if (next.mode !== "aoi") continue;
      const current = scopeStore.get();
      if (current.origin !== "place") scopeBeforePlace = current.mode === "aoi" ? current : null;
      placeNote = place.note;
      scopeStore.set(next);
      mapViewStore.flyToPoint({ lat: place.center.lat, lon: place.center.lon, zoom: place.zoom });
    }
  }
}

/** Remove one filter. The chip goes because the filter is gone, not the other way round. */
export function removeApplied(chip: AppliedChip): void {
  switch (chip.kind) {
    case "layer":
      signalsStore.set(chip.layerId, false);
      askLayersStore.remove(chip.layerId);
      return;
    case "place": {
      const back = scopeBeforePlace ?? WORLD_SCOPE;
      scopeBeforePlace = null;
      placeNote = undefined;
      scopeStore.set(back);
      return;
    }
    case "time":
      timeWindowStore.set("all");
      return;
    case "precision":
      precisionFilterStore.set(null);
      return;
  }
}
