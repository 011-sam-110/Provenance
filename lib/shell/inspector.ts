"use client";
// The console's SOURCE CONTEXTS — World, plus one per drawn area.
//
// WHY CONTEXTS AND NOT AN OVERRIDE. An area does not inherit from World, layer on
// top of it, or copy it. It is a separate map of source id → on with a boundary
// attached. That is the whole reason this is safe: nothing is borrowed, so
// unloading an area cannot leave the globe wearing the area's toggles, and
// removing an area cannot strand a source that only it turned on. The alternative
// — one global set plus per-area diffs — has to answer "what happens to World's
// toggles while an area is loaded" on every single write, and every answer to that
// question is a bug waiting for a reload.
//
// WHAT DEPENDS ON WHAT. This file knows nothing about lib/layers.ts or
// lib/signals/store.ts. THEY import THIS. Keep it that way: those two stores are
// views onto whichever SourceSet is loaded, and a back-reference here would make
// the pair circular and the ownership unreadable.
//
// ONE MAP FOR TWO REGISTRIES. A SourceSet holds layersStore's LayerKeys and
// signalsStore's arbitrary signal ids together, because a context does not care
// which registry a source came from. The two stores keep their own typed surfaces
// on top; the split lives there, not here.
//
// PERSISTENCE, AND A BUG IT FIXES. Adding this store to ConsoleShell's hydrate
// list is what makes a saved area survive a reload. It also, incidentally, makes
// LAYER and SIGNAL toggles survive one — which both of those files' comments have
// claimed for a long time and which was not true: layersStore.hydrate() and
// signalsStore.hydrate() existed and had no caller anywhere in the tree, so every
// reload reset them to their defaults. Measured on bbe9651 before this change.

import { useSyncExternalStore } from "react";
import { loadPersisted, savePersisted } from "@/lib/shell/persist";
import { bboxOfRing, sanitiseRing } from "@/lib/shell/scope";

/** id → on, for ONE context. Covers LayerKeys and signal ids in a single map. */
export type SourceSet = Record<string, boolean>;

export interface InspectorArea {
  /** "area:<epoch ms>" — stable, and sorts by age without a second field. */
  id: string;
  label: string;
  /** OPEN ring of [lon, lat] — exactly what lib/shell/scope.ts speaks. */
  polygon: [number, number][];
  bbox: [number, number, number, number];
  createdAt: number;
  /** ITS OWN. Never merged with World's. */
  sources: SourceSet;
}

export interface InspectorState {
  world: SourceSet;
  areas: InspectorArea[];
  /** null = World. The one value that decides what the console shows. */
  loaded: string | null;
}

export const AREA_CAP = 40;

/**
 * Sources an AREA always draws, whatever its own set says.
 *
 * Sam's rule, and it is what lets a new area start empty without ever loading to a
 * blank map. ONE CONSTANT ON PURPOSE: `webcams` is a keyed, rate-limited global
 * sample that lib/layers.ts deliberately defaults off and keeps out of the presets,
 * and its adapter's fetch() takes no arguments — so the pull is global whatever the
 * ring is, and scoping crops what is drawn rather than what is pulled. That cost was
 * put to Sam and he kept the rule. Reversing it is deleting one string here, not a
 * hunt through the UI.
 *
 * WORLD IS NOT SUBJECT TO THIS. The globe keeps its own toggles, so today's
 * "webcams is opt-in on the globe" behaviour is unchanged. See effectiveSet.
 */
export const ALWAYS_ON_SOURCES: readonly string[] = ["cameras", "webcams"];

const PERSIST_KEY = "tn.inspector.v1";
const PERSIST_VERSION = 1;

const EMPTY: InspectorState = Object.freeze({ world: {}, areas: [], loaded: null });

// --- pure -------------------------------------------------------------------

/** Pure: a source map with only boolean values kept. */
function cleanSet(value: unknown): SourceSet {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: SourceSet = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

/** Pure: build an area from a drawn ring. Null when the ring is not an area. */
export function newArea(
  ring: readonly [number, number][],
  label: string,
  now: number,
): InspectorArea | null {
  const clean = sanitiseRing(ring as unknown);
  if (!clean) return null;
  return {
    id: `area:${now}`,
    label,
    polygon: clean,
    bbox: bboxOfRing(clean),
    createdAt: now,
    sources: {},
  };
}

/** Pure: newest first, deduped by id, capped. */
export function addArea(
  areas: readonly InspectorArea[],
  area: InspectorArea,
  cap = AREA_CAP,
): InspectorArea[] {
  return [area, ...areas.filter((a) => a.id !== area.id)].slice(0, cap);
}

/** Pure: drop by id. */
export function removeArea(areas: readonly InspectorArea[], id: string): InspectorArea[] {
  return areas.filter((a) => a.id !== id);
}

/** Pure: relabel by id. */
export function renameArea(
  areas: readonly InspectorArea[],
  id: string,
  label: string,
): InspectorArea[] {
  return areas.map((a) => (a.id === id ? { ...a, label } : a));
}

/** Pure: the loaded area, or null for World (including a dangling id). */
export function loadedArea(state: InspectorState): InspectorArea | null {
  if (state.loaded === null) return null;
  return state.areas.find((a) => a.id === state.loaded) ?? null;
}

/** Pure: the RAW set for the loaded context. What the Sources rail edits. */
export function activeSet(state: InspectorState): SourceSet {
  return loadedArea(state)?.sources ?? state.world;
}

/** Pure: the set the console actually DRAWS. Areas force ALWAYS_ON_SOURCES on. */
export function effectiveSet(state: InspectorState): SourceSet {
  const area = loadedArea(state);
  if (!area) return state.world;
  const out: SourceSet = { ...area.sources };
  for (const id of ALWAYS_ON_SOURCES) out[id] = true;
  return out;
}

/**
 * The set the console DRAWS, memoised on the state object.
 *
 * effectiveSet() builds a fresh object whenever an area is loaded, because it has to
 * force ALWAYS_ON_SOURCES in. useSyncExternalStore compares snapshots by identity, so
 * a store calling effectiveSet() per render hands React a new snapshot every time —
 * the documented infinite-loop bug. World hid it: with nothing loaded effectiveSet
 * returns state.world by identity, so the globe was stable and only loading an area
 * would have hung the console. There are no component tests in this repo to catch
 * that, so the guard is an identity assertion in tests/unit/inspector-routing.test.ts.
 *
 * The state object is replaced on every write and never mutated, so its identity is
 * the correct cache key.
 */
let memoState: InspectorState | null = null;
let memoSet: SourceSet = {};

export function effectiveSetMemo(state: InspectorState): SourceSet {
  if (state !== memoState) {
    memoState = state;
    memoSet = effectiveSet(state);
  }
  return memoSet;
}

/** Pure: set one source on the loaded context. */
export function writeActive(state: InspectorState, id: string, on: boolean): InspectorState {
  const area = loadedArea(state);
  if (!area) return { ...state, world: { ...state.world, [id]: on } };
  return {
    ...state,
    areas: state.areas.map((a) => (a.id === area.id ? { ...a, sources: { ...a.sources, [id]: on } } : a)),
  };
}

/** Pure: replace the whole set for the loaded context (presets, variants). */
export function replaceActive(state: InspectorState, next: SourceSet): InspectorState {
  const area = loadedArea(state);
  if (!area) return { ...state, world: { ...next } };
  return {
    ...state,
    areas: state.areas.map((a) => (a.id === area.id ? { ...a, sources: { ...next } } : a)),
  };
}

/**
 * Pure: coerce a persisted payload into a valid state.
 *
 * The bbox is RECOMPUTED rather than trusted: it is derived data, and a payload
 * whose bbox disagrees with its ring would silently mis-filter every source in
 * that area through withinScope's cheap reject.
 */
export function coerceState(saved: unknown): InspectorState {
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return { ...EMPTY };
  const s = saved as Partial<InspectorState>;
  const areas: InspectorArea[] = [];
  if (Array.isArray(s.areas)) {
    for (const raw of s.areas) {
      if (!raw || typeof raw !== "object") continue;
      const a = raw as Partial<InspectorArea>;
      const ring = sanitiseRing(a.polygon as unknown);
      if (!ring || typeof a.id !== "string" || typeof a.label !== "string") continue;
      areas.push({
        id: a.id,
        label: a.label,
        polygon: ring,
        bbox: bboxOfRing(ring),
        createdAt: typeof a.createdAt === "number" && Number.isFinite(a.createdAt) ? a.createdAt : 0,
        sources: cleanSet(a.sources),
      });
    }
  }
  const loaded =
    typeof s.loaded === "string" && areas.some((a) => a.id === s.loaded) ? s.loaded : null;
  return { world: cleanSet(s.world), areas: areas.slice(0, AREA_CAP), loaded };
}

const EARTH_RADIUS_KM = 6371.0088;

/**
 * Pure: the spherical area of a closed ring, in km².
 *
 * A PLANAR shoelace on lon/lat is wrong by the cosine of the latitude — at 50°N it
 * overstates by about 55%, and an area label that overstates is worse than no label
 * on a product whose whole claim is that it does not overstate. This is the spherical
 * excess form, which is correct at any latitude and costs nothing at these ring sizes.
 * Returns 0 for anything that is not an area, rather than a plausible fake.
 */
export function ringAreaKm2(ring: readonly [number, number][]): number {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  const rad = Math.PI / 180;
  let total = 0;
  for (let i = 0; i < ring.length; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[(i + 1) % ring.length];
    total += (lon2 - lon1) * rad * (2 + Math.sin(lat1 * rad) + Math.sin(lat2 * rad));
  }
  return Math.abs((total * EARTH_RADIUS_KM * EARTH_RADIUS_KM) / 2);
}

/** Pure: the one-line summary the index row and the dossier header both print. */
export function areaSummary(area: InspectorArea): string {
  const on = Object.values(area.sources).filter(Boolean).length;
  const km2 = Math.round(ringAreaKm2(area.polygon));
  const count = on === 0 ? "No sources" : on === 1 ? "1 source" : `${on} sources`;
  return `${count} · ${km2.toLocaleString("en-GB")} km²`;
}

// --- store ------------------------------------------------------------------

let state: InspectorState = { ...EMPTY };
const listeners = new Set<() => void>();

/** Nothing persists before hydrate() has read what is already saved. See commit(). */
let hydrated = false;

function commit(next: InspectorState) {
  state = next;
  for (const l of listeners) l();
  // THE GATE IS LOAD-BEARING. variantStore.bootstrap() runs BEFORE hydrate() by
  // design, and it writes World through this store (layersStore.applyExact and
  // signalsStore.applyExact are views onto the loaded context). Persisting that
  // write would save the pre-hydrate state — areas: [] — over the user's saved
  // areas, and the hydrate that follows then reads back the file it just
  // destroyed. Measured on a preview: one reload emptied the Inspector.
  if (hydrated) savePersisted(PERSIST_KEY, PERSIST_VERSION, state);
}

export const inspectorStore = {
  get: (): InspectorState => state,
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },

  /**
   * Pull persisted AREAS back in. Called once from ConsoleShell, client-side,
   * AFTER variantStore.bootstrap().
   *
   * WORLD IS DELIBERATELY NOT RESTORED, and the ordering is not incidental. The
   * variant spine is, in its own words, "the ONLY load-time hydration path": every
   * boot runs applyVariant, which calls layersStore.applyExact and
   * signalsStore.applyExact and so re-derives World's whole set. Persisting a
   * second copy of it here would be two owners for one piece of state — the exact
   * bug the Sources/Inspector split exists to avoid — and it was destructive, not
   * merely redundant: with an area loaded, bootstrap's writes land on the AREA, so
   * one reload replaced a user's area configuration with the variant's layers.
   * Measured on a preview before this ordering was fixed.
   *
   * So World's toggles persist where they already did for 71 days, as a delta in
   * tn.variant.v1; this store persists the areas, which nothing else knows about.
   */
  hydrate() {
    const saved = coerceState(loadPersisted<InspectorState>(PERSIST_KEY, PERSIST_VERSION));
    // Read BEFORE the gate opens, write after: from here on every change persists.
    hydrated = true;
    commit({ ...saved, world: state.world });
  },

  /** Save a drawn ring as an area. Returns its id, or null for a ring that is not one. */
  add(ring: readonly [number, number][], label: string): string | null {
    const area = newArea(ring, label, Date.now());
    if (!area) return null;
    commit({ ...state, areas: addArea(state.areas, area) });
    return area.id;
  },

  remove(id: string) {
    commit({
      ...state,
      areas: removeArea(state.areas, id),
      loaded: state.loaded === id ? null : state.loaded,
    });
  },

  rename(id: string, label: string) {
    commit({ ...state, areas: renameArea(state.areas, id, label) });
  },

  /** null unloads (back to World). An unknown id is ignored rather than stranding. */
  load(id: string | null) {
    if (id !== null && !state.areas.some((a) => a.id === id)) return;
    if (state.loaded === id) return;
    commit({ ...state, loaded: id });
  },

  setSource(id: string, on: boolean) {
    commit(writeActive(state, id, on));
  },

  replaceSources(next: SourceSet) {
    commit(replaceActive(state, next));
  },
};

export function useInspector(): InspectorState {
  return useSyncExternalStore(inspectorStore.subscribe, inspectorStore.get, () => EMPTY);
}
