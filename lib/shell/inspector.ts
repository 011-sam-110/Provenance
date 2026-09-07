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
// EVERY CONTEXT IS LIVE AT ONCE. THIS IS THE PART THAT CHANGED, and the comment it
// replaces was wrong about the product rather than about the code. Contexts used to
// be EXCLUSIVE: one area was "loaded", and while it was, it was the only thing the
// console drew. Sam's report was that configuring one area silently took every
// global signal off the globe and every other area dark with it — "all the global
// signals that were on for different areas and different parts of the globe aren't
// on". That is exactly what exclusivity does, and it is not what anyone wants from
// a tool whose job is watching several places.
//
// So the composition rule is now:
//
//   World's sources draw EVERYWHERE, always.
//   Each area's sources draw INSIDE THAT AREA'S RING, always, all areas at once.
//
// and the field formerly called `loaded` is now `editing`: it selects which context
// a toggle in the Sources rail WRITES to, and nothing else. It no longer decides
// what is on the map, so switching context can no longer make anything disappear.
//
// The contexts stay separate maps, which is what keeps that safe — see above. What
// changed is only how they are READ, and there are now two readings, which callers
// must not confuse:
//
//   editingSet(state)  the ONE context being edited. What the rail ticks and writes.
//   unionSet(state)    on in World or in ANY area. What is fetched and mounted.
//
// A source that is on only inside one ring is still FETCHED globally — almost every
// upstream here is a whole-world pull with no bbox parameter — and then CROPPED to
// the rings that asked for it. `sourceRegions` is what says where; see
// lib/shell/sourceScope.ts for the filter that consumes it.
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
  /**
   * Which context the Sources rail WRITES to. null = World.
   *
   * IT DOES NOT DECIDE WHAT IS DRAWN. It was called `loaded` and it did, which is
   * the bug described at the top of this file. Every area is live whatever this
   * says, so changing it is a safe, invisible-on-the-map act: you are choosing a
   * pen, not a view.
   */
  editing: string | null;
}

export const AREA_CAP = 40;

// ALWAYS_ON_SOURCES IS GONE, and its own rationale is what retired it.
//
// It forced `cameras` and `webcams` on inside every area whatever that area's set
// said, and the stated reason was that it "lets a new area start empty without ever
// loading to a blank map". Loading an area cannot blank the map any more — World
// keeps drawing throughout — so the premise is spent.
//
// Keeping it would have been actively wrong under the new rule rather than merely
// redundant. With every area live at once, a forced-on source is not a floor for the
// one area you are looking at; it is camera pins inside every ring you have ever
// drawn, permanently, with a toggle in the rail that says off and no way to make it
// true. A control that cannot turn its own source off is the thing this codebase
// keeps writing comments about. The AREA_CAP of 40 is what that would have scaled to.

const PERSIST_KEY = "tn.inspector.v1";
const PERSIST_VERSION = 1;

const EMPTY: InspectorState = Object.freeze({ world: {}, areas: [], editing: null });

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

/** Pure: the area being edited, or null for World (including a dangling id). */
export function editingArea(state: InspectorState): InspectorArea | null {
  if (state.editing === null) return null;
  return state.areas.find((a) => a.id === state.editing) ?? null;
}

/** Pure: the RAW set for the context being edited. What the Sources rail ticks. */
export function editingSet(state: InspectorState): SourceSet {
  return editingArea(state)?.sources ?? state.world;
}

/**
 * Pure: on in World, or on in ANY area. What is FETCHED and MOUNTED.
 *
 * OR, never AND, and never a later context winning. An area saying nothing about a
 * source (the common case — an area's set starts empty) must not pull World's copy
 * down, and an area saying `false` is that area declining it rather than vetoing it
 * for everyone. So only `true` propagates upwards; every other value is silence.
 *
 * This is deliberately a coarser question than "what should the map DRAW". It
 * answers "is this source wanted anywhere at all", which is the only question the
 * fetch layer can act on: almost every upstream here is a whole-world pull with no
 * bounding-box parameter, so a source wanted in one 40km ring costs exactly the same
 * request as one wanted globally. WHERE it is then allowed to appear is
 * `sourceRegions`, applied after the fetch.
 */
export function unionSet(state: InspectorState): SourceSet {
  const out: SourceSet = { ...state.world };
  for (const area of state.areas) {
    for (const [id, on] of Object.entries(area.sources)) {
      if (on === true) out[id] = true;
    }
  }
  return out;
}

/**
 * Pure: WHERE a source is allowed to appear.
 *
 * `null` means everywhere and is the answer whenever World has the source on — an
 * area cannot narrow the globe, only add to it. Otherwise it is the areas that asked
 * for it, and the source is cropped to their rings. An empty array means the source
 * is on nowhere, which callers should never see for a source they are drawing, but
 * is the honest answer and is cheaper to return than to forbid.
 */
export function sourceRegions(state: InspectorState, id: string): InspectorArea[] | null {
  if (state.world[id] === true) return null;
  return state.areas.filter((a) => a.sources[id] === true);
}

/**
 * The union, memoised on the state object.
 *
 * IT MUST GO THROUGH HERE, always. unionSet() builds a fresh object on every call,
 * and useSyncExternalStore compares snapshots by identity — a store calling it per
 * render hands React a new snapshot every time, which is an infinite render loop and
 * not a slow one. The predecessor of this function had exactly that shape and was
 * saved only by returning `state.world` by identity in the no-area case, so the loop
 * was latent until the first area was drawn. There are no component tests here to
 * catch it, so the guard is an identity assertion in
 * tests/unit/inspector-routing.test.ts.
 *
 * The state object is replaced on every write and never mutated, so its identity is
 * the correct cache key.
 */
let memoState: InspectorState | null = null;
let memoSet: SourceSet = {};

export function unionSetMemo(state: InspectorState): SourceSet {
  if (state !== memoState) {
    memoState = state;
    memoSet = unionSet(state);
  }
  return memoSet;
}

/** Pure: set one source on the context being EDITED. */
export function writeActive(state: InspectorState, id: string, on: boolean): InspectorState {
  const area = editingArea(state);
  if (!area) return { ...state, world: { ...state.world, [id]: on } };
  return {
    ...state,
    areas: state.areas.map((a) => (a.id === area.id ? { ...a, sources: { ...a.sources, [id]: on } } : a)),
  };
}

/** Pure: replace the whole set for the context being EDITED (presets, variants). */
export function replaceActive(state: InspectorState, next: SourceSet): InspectorState {
  const area = editingArea(state);
  if (!area) return { ...state, world: { ...next } };
  return {
    ...state,
    areas: state.areas.map((a) => (a.id === area.id ? { ...a, sources: { ...next } } : a)),
  };
}

/**
 * Pure: replace WORLD's set, whatever context is being edited.
 *
 * The counterpart to replaceActive, and the split is a bug rather than a preference.
 * The variant spine and the board presets configure THE GLOBE — "drive the globe to
 * match the board", in lib/console/presets.ts's own words. Routing those through
 * replaceActive sent them to whichever context the rail happened to be pointed at,
 * so an area being edited absorbed them.
 *
 * Seen in the browser rather than reasoned about: draw an area, reload, and an area
 * created with `sources: {}` comes back holding a copy of World's whole set. The
 * path is ConsoleShell's first-run seed, `applyPreset(DEFAULT_PRESET_ID)`, which
 * fires on EVERY boot while the landing board carries no widgets, and which runs
 * AFTER inspectorStore.hydrate() has restored which area was being edited.
 *
 * Only whole-set writes move. A per-key write (writeActive, and so every toggle,
 * and applyMonitor, which drives layersStore.set key by key) still lands on the
 * edited context — pointing the rail at an area and giving it a monitor's layers is
 * a thing a user can reasonably want. Handing an area the globe's configuration
 * behind their back is not.
 */
export function replaceWorld(state: InspectorState, next: SourceSet): InspectorState {
  return { ...state, world: { ...next } };
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
  // `loaded` is the field's OLD name, still sitting in every browser that used the
  // console before this change. It is read as a fallback rather than migrated in
  // place: the value means less than it used to (a pen, not a view), so carrying it
  // forward costs one `??` and losing it would silently reset which context a
  // returning user was editing.
  const saw = (s as { editing?: unknown; loaded?: unknown });
  const want = typeof saw.editing === "string" ? saw.editing
    : typeof saw.loaded === "string" ? saw.loaded
    : null;
  const editing = want !== null && areas.some((a) => a.id === want) ? want : null;
  return { world: cleanSet(s.world), areas: areas.slice(0, AREA_CAP), editing };
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
   * WORLD IS DELIBERATELY NOT RESTORED. The variant spine is, in its own words,
   * "the ONLY load-time hydration path": every boot runs applyVariant, which calls
   * layersStore.applyWorld and signalsStore.applyWorld and so re-derives World's
   * whole set. Persisting a second copy of it here would be two owners for one
   * piece of state — the exact bug the Sources/Inspector split exists to avoid.
   *
   * Those two writes used to be applyExact, i.e. aimed at whatever context the rail
   * was pointed at, and this note used to say the fix was to run bootstrap BEFORE
   * hydrate so nothing was pointed at an area yet. That was true and insufficient:
   * ConsoleShell also seeds a board after hydrate. The write itself now names its
   * target, so neither ordering can send it into an area.
   *
   * So World's toggles persist where they already did for 71 days, as a delta in
   * tn.variant.v1; this store persists the areas and which one is being edited, which nothing else
   * knows about.
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
      editing: state.editing === id ? null : state.editing,
    });
  },

  rename(id: string, label: string) {
    commit({ ...state, areas: renameArea(state.areas, id, label) });
  },

  /**
   * Point the Sources rail at a context. null = World.
   *
   * WAS `load`, AND THE RENAME IS THE POINT. "Load" described putting an area on the
   * map and taking everything else off it, which is no longer a thing that happens.
   * This only chooses where the next toggle is written; the map does not change.
   * An unknown id is ignored rather than stranding the rail on a context that is not
   * there.
   */
  edit(id: string | null) {
    if (id !== null && !state.areas.some((a) => a.id === id)) return;
    if (state.editing === id) return;
    commit({ ...state, editing: id });
  },

  setSource(id: string, on: boolean) {
    commit(writeActive(state, id, on));
  },

  replaceSources(next: SourceSet) {
    commit(replaceActive(state, next));
  },

  /** Whole-set write from the variant spine / board presets. Always World. */
  replaceWorldSources(next: SourceSet) {
    commit(replaceWorld(state, next));
  },
};

export function useInspector(): InspectorState {
  return useSyncExternalStore(inspectorStore.subscribe, inspectorStore.get, () => EMPTY);
}
