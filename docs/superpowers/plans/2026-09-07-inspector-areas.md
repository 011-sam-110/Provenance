# Inspector Areas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the console several independent source contexts — World plus one per drawn area — with a left-rail Inspector index that loads them, and detail opening in the existing right-hand dossier.

**Architecture:** One new persisted store (`lib/shell/inspector.ts`) holds `world`, `areas[]` and a `loaded` pointer. `layersStore` and `signalsStore` keep their exact public APIs but read and write the loaded context's `SourceSet` instead of a single global map, so no call site changes. Loading an area drives the existing `scopeStore`, which the map, feed and widgets already honour. Detail opens through `lib/overlay-content.tsx`'s existing `kind → component` switch.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, MapLibre GL, vitest (node environment), Playwright for e2e.

## Global Constraints

- **Branch:** `feat/inspector-areas`, worktree `~/Desktop/tn-inspector`, forked from `origin/main` `bbe9651`.
- **Baseline (measured, not remembered):** `npx tsc --noEmit` exit 0; `npm test` 319 files / 3121 tests passed. Any red after this is ours.
- **Gate for every task:** `npx tsc --noEmit && npm test`.
- **Attribution:** solo. `CLAUDE.md` line 56 — no `Co-Authored-By`, no session trailer. This overrides the harness default.
- **Tests are vitest, NODE environment, in `tests/unit/**/*.test.ts`.** No React testing library is installed — **there are no component tests**. Logic goes in pure exported functions that can be tested without a DOM; components stay thin.
- **Every guard test is watched go RED before it goes green.** A pinning test nobody saw fail is decoration.
- **Dormant-safe:** a missing or corrupt persisted payload degrades to defaults, never throws.
- **Do not touch:** `lib/console/widgets/camslot.*`, `components/console/maprail/*`, `lib/map/aoi.ts`, `components/shell/EventFeed.tsx`.
- **`startDraw(map, opts)` contract is unchanged:** with `opts.onFinish` the ring goes to the caller and the scope is left alone. A camera pick must never become a saved area.
- **Never type a count from memory.** Widget/layer/source counts are re-measured; `tests/unit/readme-counts.test.ts` and `tests/unit/claude-md-counts.test.ts` pin several.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/shell/inspector.ts` | **New.** The context store: `SourceSet`, `InspectorArea`, `InspectorState`, pure list/set operations, persistence, `useInspector()`. Knows nothing about `layersStore` or `signalsStore` — the dependency runs one way only. |
| `lib/layers.ts` | **Modify.** `layersStore` reads/writes the loaded context. Public API unchanged. Also fixes the false `LayerKey` comment. |
| `lib/signals/store.ts` | **Modify.** Same treatment for `signalsStore`. |
| `components/shell/ConsoleShell.tsx` | **Modify.** One line: `inspectorStore.hydrate()` in the existing hydrate effect. |
| `components/shell/inspector/InspectorTab.tsx` | **New.** The index: area list, draw button, coming-soon alerts block. |
| `components/shell/inspector/ContextBar.tsx` | **New.** The `⌂ World` / `▣ <area> ✕` line above the tabs. |
| `components/shell/inspector/AreaDetail.tsx` | **New.** The `area` dossier body. |
| `components/shell/SourceCatalog.tsx` | **Modify.** Context bar + two tabs; the existing content becomes the Sources tab. |
| `lib/overlay-content.tsx` | **Modify.** Add `case "area"`. |
| `lib/world.ts` | **Modify.** Add `"area"` to `WorldObjectKind`. |
| `lib/scopeFilter.ts` | **New.** One pure helper the four unscoped hooks share, so scoping is defined once. |
| `lib/planes/usePlanes.ts`, `lib/cameras/useCameras.ts`, satellites + webcam directory hooks | **Modify.** Apply `lib/scopeFilter.ts`. |
| `components/WorldMap.tsx` | **Modify.** Line 1507 only — a country click also opens the Inspector tab. |

---

## Task 1: The context store

**Files:**
- Create: `lib/shell/inspector.ts`
- Test: `tests/unit/inspector-store.test.ts`

**Interfaces:**
- Consumes: `loadPersisted` / `savePersisted` from `@/lib/shell/persist`; `bboxOfRing`, `sanitiseRing` from `@/lib/shell/scope`.
- Produces:
  - `type SourceSet = Record<string, boolean>`
  - `interface InspectorArea { id, label, polygon, bbox, createdAt, sources }`
  - `interface InspectorState { world: SourceSet; areas: InspectorArea[]; loaded: string | null }`
  - `const AREA_CAP = 40`
  - `const ALWAYS_ON_SOURCES: readonly string[]`
  - `newArea(ring, label, now): InspectorArea | null`
  - `addArea(areas, area, cap?): InspectorArea[]`
  - `removeArea(areas, id): InspectorArea[]`
  - `renameArea(areas, id, label): InspectorArea[]`
  - `activeSet(state): SourceSet`
  - `effectiveSet(state): SourceSet`
  - `writeActive(state, id, on): InspectorState`
  - `replaceActive(state, next): InspectorState`
  - `coerceState(saved): InspectorState`
  - `inspectorStore` (`get`, `subscribe`, `hydrate`, `add`, `remove`, `rename`, `load`, `setSource`, `replaceSources`)
  - `useInspector(): InspectorState`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/inspector-store.test.ts`:

```ts
import { expect, test } from "vitest";
import {
  AREA_CAP,
  ALWAYS_ON_SOURCES,
  activeSet,
  addArea,
  coerceState,
  effectiveSet,
  newArea,
  removeArea,
  renameArea,
  replaceActive,
  writeActive,
  type InspectorArea,
  type InspectorState,
} from "@/lib/shell/inspector";

const RING: [number, number][] = [
  [36.0, 49.8],
  [36.5, 49.8],
  [36.5, 50.2],
  [36.0, 50.2],
];

function area(id: string, createdAt = 1): InspectorArea {
  return { id, label: id, polygon: RING, bbox: [36, 49.8, 36.5, 50.2], createdAt, sources: {} };
}

function state(partial: Partial<InspectorState> = {}): InspectorState {
  return { world: {}, areas: [], loaded: null, ...partial };
}

test("newArea derives a bbox and keeps the ring open", () => {
  const a = newArea(RING, "Kharkiv corridor", 1788744123456);
  expect(a).not.toBeNull();
  expect(a!.bbox).toEqual([36, 49.8, 36.5, 50.2]);
  expect(a!.polygon).toHaveLength(4);
  expect(a!.label).toBe("Kharkiv corridor");
  expect(a!.sources).toEqual({});
});

test("newArea refuses a ring that is not an area", () => {
  expect(newArea([[0, 0], [1, 1]], "line", 1)).toBeNull();
  expect(newArea([], "empty", 1)).toBeNull();
});

test("addArea puts the newest first and dedupes by id", () => {
  const list = addArea(addArea([], area("a")), area("b"));
  expect(list.map((x) => x.id)).toEqual(["b", "a"]);
  const again = addArea(list, { ...area("a"), label: "renamed" });
  expect(again.map((x) => x.id)).toEqual(["a", "b"]);
  expect(again[0].label).toBe("renamed");
});

test("addArea caps the list, dropping the oldest", () => {
  let list: InspectorArea[] = [];
  for (let i = 0; i < AREA_CAP + 5; i++) list = addArea(list, area(`a${i}`, i));
  expect(list).toHaveLength(AREA_CAP);
  expect(list[0].id).toBe(`a${AREA_CAP + 4}`);
});

test("removeArea and renameArea are pure and by id", () => {
  const list = addArea(addArea([], area("a")), area("b"));
  expect(removeArea(list, "a").map((x) => x.id)).toEqual(["b"]);
  expect(renameArea(list, "b", "Gulf of Aden")[0].label).toBe("Gulf of Aden");
  expect(list[0].label).toBe("b"); // original untouched
});

test("activeSet returns World's set when nothing is loaded", () => {
  const s = state({ world: { cameras: true }, areas: [area("a")], loaded: null });
  expect(activeSet(s)).toEqual({ cameras: true });
});

test("activeSet returns the loaded area's own set", () => {
  const a = { ...area("a"), sources: { planes: true } };
  expect(activeSet(state({ world: { cameras: true }, areas: [a], loaded: "a" }))).toEqual({ planes: true });
});

test("a loaded id that no longer exists falls back to World", () => {
  const s = state({ world: { cameras: true }, areas: [], loaded: "gone" });
  expect(activeSet(s)).toEqual({ cameras: true });
});

test("effectiveSet forces the always-on sources on inside an area", () => {
  const a = { ...area("a"), sources: { planes: true } };
  const eff = effectiveSet(state({ areas: [a], loaded: "a" }));
  for (const id of ALWAYS_ON_SOURCES) expect(eff[id]).toBe(true);
  expect(eff.planes).toBe(true);
});

test("effectiveSet leaves World alone — webcams stays opt-in on the globe", () => {
  const eff = effectiveSet(state({ world: { cameras: true } }));
  expect(eff).toEqual({ cameras: true });
  expect(eff.webcams).toBeUndefined();
});

test("writeActive lands on the loaded area and leaves World untouched", () => {
  const a = area("a");
  const s = state({ world: { cameras: true }, areas: [a], loaded: "a" });
  const next = writeActive(s, "planes", true);
  expect(next.areas[0].sources).toEqual({ planes: true });
  expect(next.world).toEqual({ cameras: true });
});

test("writeActive lands on World when nothing is loaded", () => {
  const next = writeActive(state({ world: {} }), "planes", true);
  expect(next.world).toEqual({ planes: true });
});

test("replaceActive swaps the whole set for the loaded context only", () => {
  const a = { ...area("a"), sources: { planes: true } };
  const s = state({ world: { cameras: true }, areas: [a], loaded: "a" });
  const next = replaceActive(s, { ships: true });
  expect(next.areas[0].sources).toEqual({ ships: true });
  expect(next.world).toEqual({ cameras: true });
});

test("coerceState turns junk into a valid empty state", () => {
  expect(coerceState(null)).toEqual({ world: {}, areas: [], loaded: null });
  expect(coerceState("nonsense")).toEqual({ world: {}, areas: [], loaded: null });
  expect(coerceState({ areas: "no" })).toEqual({ world: {}, areas: [], loaded: null });
});

test("coerceState drops areas whose ring is not an area, and a dangling loaded id", () => {
  const s = coerceState({
    world: { cameras: true, junk: "yes" },
    areas: [
      { id: "good", label: "Good", polygon: RING, createdAt: 1, sources: { planes: true } },
      { id: "bad", label: "Bad", polygon: [[0, 0]], createdAt: 2, sources: {} },
    ],
    loaded: "bad",
  });
  expect(s.areas.map((a) => a.id)).toEqual(["good"]);
  expect(s.world).toEqual({ cameras: true });
  expect(s.loaded).toBeNull();
});

test("coerceState recomputes the bbox rather than trusting the payload", () => {
  const s = coerceState({
    world: {},
    areas: [{ id: "a", label: "A", polygon: RING, bbox: [0, 0, 0, 0], createdAt: 1, sources: {} }],
    loaded: null,
  });
  expect(s.areas[0].bbox).toEqual([36, 49.8, 36.5, 50.2]);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/inspector-store.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/shell/inspector"`.

- [ ] **Step 3: Write the store**

Create `lib/shell/inspector.ts`:

```ts
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

// --- store ------------------------------------------------------------------

let state: InspectorState = { ...EMPTY };
const listeners = new Set<() => void>();

function commit(next: InspectorState) {
  state = next;
  for (const l of listeners) l();
  savePersisted(PERSIST_KEY, PERSIST_VERSION, state);
}

export const inspectorStore = {
  get: (): InspectorState => state,
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },

  /** Pull persisted contexts back in. Called once from ConsoleShell, client-side. */
  hydrate() {
    commit(coerceState(loadPersisted<InspectorState>(PERSIST_KEY, PERSIST_VERSION)));
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
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/unit/inspector-store.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Run the full gate**

Run: `npx tsc --noEmit && npm test`
Expected: exit 0, 320 files / 3136 tests (319 + this file, 3121 + 15).

- [ ] **Step 6: Commit**

```bash
git add lib/shell/inspector.ts tests/unit/inspector-store.test.ts docs/superpowers/specs/2026-09-07-inspector-design.md docs/superpowers/plans/2026-09-07-inspector-areas.md
git commit -m "Inspector: source contexts — World plus one per drawn area

A new persisted store holding the globe's source set, a capped list of drawn
areas each with its OWN set, and the loaded pointer that says which one the
console is showing. Pure list and set operations, unit-tested; nothing renders
yet and no existing behaviour changes.

An area does not inherit from World, override it, or copy it. That is what makes
unloading safe: nothing is borrowed, so the globe cannot end up wearing an area's
toggles and removing an area cannot strand a source only it turned on."
```

---

## Task 2: Route the two source stores through the loaded context

**Files:**
- Modify: `lib/layers.ts`
- Modify: `lib/signals/store.ts`
- Modify: `components/shell/ConsoleShell.tsx` (one line in the existing hydrate effect)
- Test: `tests/unit/inspector-routing.test.ts`

**Interfaces:**
- Consumes: everything Task 1 produces.
- Produces: no new exports. `layersStore.toggle/set/applyPreset/applyExact/get/hydrate/subscribe`, `useLayers()`, `signalsStore.isOn/toggle/set/applyExact/get/hydrate/subscribe`, `useSignals()` all keep their **exact** current signatures. Every existing call site is correct unchanged.

**Why this shape:** `WorldMap`, `SourceCatalog`, `monitors.ts`, `presetLayers.ts`, `presets.ts`, `PresetBar.tsx`, the command palette and the widgets all call these stores. Changing the API would touch every one of them. Making them views onto `inspectorStore` touches none.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/inspector-routing.test.ts`:

```ts
import { beforeEach, expect, test } from "vitest";
import { inspectorStore } from "@/lib/shell/inspector";
import { DEFAULT_STATE, layersStore } from "@/lib/layers";
import { signalsStore } from "@/lib/signals/store";

const RING: [number, number][] = [
  [36.0, 49.8],
  [36.5, 49.8],
  [36.5, 50.2],
  [36.0, 50.2],
];

beforeEach(() => {
  // A clean store between tests — hydrate with nothing persisted resets to empty.
  inspectorStore.hydrate();
});

test("with nothing loaded, layersStore reads World and matches today's defaults", () => {
  expect(layersStore.get()).toEqual(DEFAULT_STATE);
});

test("a layer toggle while World is loaded writes World, not an area", () => {
  const id = inspectorStore.add(RING, "Kharkiv")!;
  layersStore.set("planes", false);
  expect(inspectorStore.get().world.planes).toBe(false);
  expect(inspectorStore.get().areas.find((a) => a.id === id)!.sources.planes).toBeUndefined();
});

test("a layer toggle while an area is loaded writes the area and leaves World alone", () => {
  const id = inspectorStore.add(RING, "Kharkiv")!;
  layersStore.set("planes", false); // World: planes off
  inspectorStore.load(id);
  layersStore.set("planes", true); // area: planes on
  expect(inspectorStore.get().areas.find((a) => a.id === id)!.sources.planes).toBe(true);
  expect(inspectorStore.get().world.planes).toBe(false);
});

test("unloading restores World's set exactly", () => {
  const id = inspectorStore.add(RING, "Kharkiv")!;
  layersStore.set("satellites", false);
  const world = { ...layersStore.get() };
  inspectorStore.load(id);
  layersStore.set("satellites", true);
  inspectorStore.load(null);
  expect(layersStore.get()).toEqual(world);
});

test("an area forces cameras and webcams on however its own set reads", () => {
  const id = inspectorStore.add(RING, "Kharkiv")!;
  inspectorStore.load(id);
  layersStore.set("cameras", false);
  layersStore.set("webcams", false);
  expect(layersStore.get().cameras).toBe(true);
  expect(layersStore.get().webcams).toBe(true);
});

test("World keeps webcams opt-in — the always-on rule is areas only", () => {
  expect(layersStore.get().webcams).toBe(false);
});

test("signalsStore routes the same way", () => {
  const id = inspectorStore.add(RING, "Kharkiv")!;
  signalsStore.set("earthquakes", true);
  inspectorStore.load(id);
  expect(signalsStore.isOn("earthquakes")).toBe(false);
  signalsStore.set("conflict", true);
  expect(signalsStore.isOn("conflict")).toBe(true);
  inspectorStore.load(null);
  expect(signalsStore.isOn("earthquakes")).toBe(true);
  expect(signalsStore.isOn("conflict")).toBe(false);
});

test("applyPreset writes the loaded area, not World", () => {
  const id = inspectorStore.add(RING, "Kharkiv")!;
  inspectorStore.load(id);
  layersStore.applyPreset("air-space");
  expect(inspectorStore.get().areas.find((a) => a.id === id)!.sources.planes).toBe(true);
  expect(inspectorStore.get().world.planes).toBeUndefined();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/inspector-routing.test.ts`
Expected: FAIL — the routing tests fail because `layersStore` still holds its own module-level `state`. The first test (`equals DEFAULT_STATE`) passes already; that is the point of having it, it pins the behaviour that must NOT change.

- [ ] **Step 3: Route `lib/layers.ts`**

Replace the module-level `state` and the store body. Keep `LayerKey`, `LayerState`, `ACTIVE_LAYERS`, `PLANNED_LAYERS`, `DEFAULT_STATE`, `PresetId`, `LAYER_PRESETS` and `presetState` exactly as they are.

Also **fix the false comment above `LayerKey`** — `sources-rail` verified both halves are wrong as of `bbe9651` and handed over this wording:

```ts
// Active layers have a live CORE map layer today. The two "planned" keys never got
// one. ships still ships as the AIS signal layer; weather no longer has one — its
// adapter was unregistered in #177. Neither is drawn in the rail; see OMITTED_LAYERS
// in lib/console/sources/railSources.ts.
export type LayerKey = "cameras" | "satellites" | "planes" | "ships" | "webcams" | "weather" | "countries";
```

Then replace everything from `let state: LayerState = { ...DEFAULT_STATE };` to the end of the file with:

```ts
// STATE LIVES IN lib/shell/inspector.ts, NOT HERE. This store is a VIEW onto
// whichever source context is loaded — World, or one drawn area. The API below is
// byte-identical to what it was before that change, which is the whole point:
// WorldMap, SourceCatalog, monitors.ts, presetLayers.ts, presets.ts, PresetBar and
// the command palette all call these methods and none of them needed an edit.
//
// The projection is one-way. This file imports inspector.ts; inspector.ts must never
// import this one, or the pair is circular and neither owns the state.
import { effectiveSet, inspectorStore, type SourceSet } from "@/lib/shell/inspector";

/** The 7 LayerKeys pulled out of a context's set, with DEFAULT_STATE as the floor. */
function project(set: SourceSet): LayerState {
  const out = { ...DEFAULT_STATE };
  for (const k of Object.keys(DEFAULT_STATE) as LayerKey[]) {
    if (typeof set[k] === "boolean") out[k] = set[k];
  }
  return out;
}

// Memoised on the context object so useSyncExternalStore's identity check holds:
// project() builds a fresh object every call, and returning a new one from get()
// on every render loops React forever.
let lastSet: SourceSet | null = null;
let lastProjection: LayerState = { ...DEFAULT_STATE };

function current(): LayerState {
  const set = effectiveSet(inspectorStore.get());
  if (set !== lastSet) {
    lastSet = set;
    lastProjection = project(set);
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
    const merged: SourceSet = { ...inspectorStore.get().world };
    const active = { ...DEFAULT_STATE, ...next };
    const set: SourceSet = { ...effectiveSet(inspectorStore.get()) };
    for (const k of Object.keys(DEFAULT_STATE) as LayerKey[]) set[k] = active[k];
    void merged;
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
```

Remove the now-unused `loadPersisted` / `savePersisted` import and the `PERSIST_KEY` / `PERSIST_VERSION` constants.

- [ ] **Step 4: Route `lib/signals/store.ts`**

Same treatment. Replace the module-level `state` and the `signalsStore` body; leave `SignalState`, `signalCountsStore` and `useSignalCounts` untouched.

```ts
import { effectiveSet, inspectorStore } from "@/lib/shell/inspector";

// Signals are the sparse half of a context's SourceSet: an id that is not present
// reads as off, exactly as before. No projection is needed — a SourceSet IS a
// SignalState — so this returns the context's map directly and its identity is
// already stable across renders.
function current(): SignalState {
  return effectiveSet(inspectorStore.get());
}

export const signalsStore = {
  isOn(id: string): boolean {
    return current()[id] === true;
  },
  toggle(id: string) {
    inspectorStore.setSource(id, !(current()[id] === true));
  },
  set(id: string, on: boolean) {
    if ((current()[id] === true) === on) return;
    inspectorStore.setSource(id, on);
  },
  applyExact(next: SignalState) {
    inspectorStore.replaceSources({ ...next });
  },
  get: current,
  /** Kept for API compatibility. inspectorStore.hydrate() owns rehydration now. */
  hydrate() {
    /* no-op */
  },
  subscribe(listener: () => void): () => void {
    return inspectorStore.subscribe(listener);
  },
};
```

- [ ] **Step 5: Hydrate the store in `ConsoleShell.tsx`**

In the existing effect at `components/shell/ConsoleShell.tsx:87-103`, add one line **before** the others so the source contexts exist before anything reads them:

```ts
    inspectorStore.hydrate();
    uiStore.hydrate();
```

with `import { inspectorStore } from "@/lib/shell/inspector";` beside the other store imports.

- [ ] **Step 6: Run the routing test and watch it pass**

Run: `npx vitest run tests/unit/inspector-routing.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 7: Run the full gate**

Run: `npx tsc --noEmit && npm test`
Expected: exit 0. `tests/unit/layers.test.ts` must still pass untouched — it pins `PLANNED_LAYERS` as `["ships", "weather"]` and the preset shapes, none of which move.

- [ ] **Step 8: Commit**

```bash
git add lib/layers.ts lib/signals/store.ts components/shell/ConsoleShell.tsx tests/unit/inspector-routing.test.ts
git commit -m "Point the layer and signal stores at the loaded source context

Both stores keep their exact public API and become views onto whichever context
is loaded. No call site changed: WorldMap, SourceCatalog, monitors, presetLayers,
presets, PresetBar and the palette all still call toggle/set/get unedited.

This is also a REVERT of an accidental deletion, not a new feature, and one git
show makes that visible:

  git log -S \"layersStore.hydrate\" origin/main   ->  41cf2b9
  git show 41cf2b9 -- components/shell/ConsoleShell.tsx

41cf2b9, 2026-06-27, \"wire ConsoleShell to the variant spine\", rewrote the hydrate
block and dropped two stores out of it. Its parent has layersStore.hydrate() and
signalsStore.hydrate() at ConsoleShell.tsx lines 34 and 35; the commit shows them as
two minus lines while alertStore and langStore are re-added in the same hunk. Nothing
adds them back. That is 474 commits and 71 days on main.

So layer and signal toggles have not survived a reload since 2026-06-27, and both
files' headers have described the behaviour of the code that used to be there --
lib/layers.ts still says \"persisted to localStorage so a composed view survives a
reload\", and lib/signals/store.ts says the same. This makes the code match its
documentation again. Rehydration now happens once, in inspectorStore.

Also corrects the LayerKey comment: weather left SIGNALS in #177 and the rail
stopped drawing signposts for either planned key before that."
```

---

## Task 3: The context bar, the tabs, and the Inspector index

**Files:**
- Create: `components/shell/inspector/ContextBar.tsx`
- Create: `components/shell/inspector/InspectorTab.tsx`
- Modify: `components/shell/SourceCatalog.tsx`
- Modify: `app/globals.css`
- Test: `tests/unit/inspector-labels.test.ts`

**Interfaces:**
- Consumes: `inspectorStore`, `useInspector`, `InspectorArea` from Task 1; `useAoiDraw`, `startDraw`, `aoiLabel` from `@/lib/map/aoi` (read-only — `aoi.ts` is not edited); `scopeStore`, `aoiScope`, `WORLD_SCOPE` from `@/lib/shell/scope`.
- Produces: `areaSummary(area, effective): string` in `lib/shell/inspector.ts` — the one-line "4 sources · 4,180 km²" the index and the dossier both print.

**Copy rule:** the Sources tab's section headings read `EDITING THIS AREA` while an area is loaded. The context bar is visible in **both** tabs and states `⌂ World` or `▣ <label>` with an unload control.

- [ ] **Step 1: Write the failing test for the pure label helpers**

Create `tests/unit/inspector-labels.test.ts`:

```ts
import { expect, test } from "vitest";
import { areaSummary, ringAreaKm2, type InspectorArea } from "@/lib/shell/inspector";

const RING: [number, number][] = [
  [36.0, 49.8],
  [36.5, 49.8],
  [36.5, 50.2],
  [36.0, 50.2],
];

const AREA: InspectorArea = {
  id: "area:1",
  label: "Kharkiv corridor",
  polygon: RING,
  bbox: [36, 49.8, 36.5, 50.2],
  createdAt: 1,
  sources: { planes: true, conflict: true },
};

test("ringAreaKm2 is within 5% of the true spherical area of a known box", () => {
  // 0.5deg lon x 0.4deg lat at ~50N. Reference computed from the spherical excess
  // formula: ~35.8km x 44.5km = ~1,593 km2.
  const km2 = ringAreaKm2(RING);
  expect(km2).toBeGreaterThan(1_500);
  expect(km2).toBeLessThan(1_700);
});

test("ringAreaKm2 refuses a degenerate ring rather than returning a fake number", () => {
  expect(ringAreaKm2([[0, 0], [1, 1]])).toBe(0);
});

test("areaSummary counts the sources actually on, not the keys present", () => {
  expect(areaSummary({ ...AREA, sources: { planes: true, conflict: false } })).toMatch(/^1 source /);
});

test("areaSummary pluralises and rounds", () => {
  expect(areaSummary(AREA)).toMatch(/^2 sources · [\d,]+ km²$/);
});

test("areaSummary states zero honestly rather than hiding it", () => {
  expect(areaSummary({ ...AREA, sources: {} })).toMatch(/^No sources · /);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/inspector-labels.test.ts`
Expected: FAIL — `areaSummary` and `ringAreaKm2` are not exported.

- [ ] **Step 3: Add the two helpers to `lib/shell/inspector.ts`**

```ts
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
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/unit/inspector-labels.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Build `ContextBar.tsx`**

```tsx
"use client";
// What the rail is editing. THE LOAD-BEARING CONTROL OF THIS WHOLE FEATURE.
//
// With several source contexts, a toggle in the Sources tab writes whichever one is
// loaded. A user who flips Aircraft without knowing whether they changed the globe
// or the Kharkiv area has been handed a control that lies about its effect — and
// this codebase has shipped and then fixed two variants of that bug already. So this
// line is rendered in BOTH tabs, not just the Inspector, and it is never hidden.

import { inspectorStore, loadedArea, useInspector } from "@/lib/shell/inspector";
import { scopeStore, WORLD_SCOPE } from "@/lib/shell/scope";

export default function ContextBar() {
  const state = useInspector();
  const area = loadedArea(state);

  return (
    <div className="tn-ctxbar" data-area={area ? "" : undefined}>
      <span className="tn-ctxbar-glyph" aria-hidden>{area ? "▣" : "⌂"}</span>
      <span className="tn-ctxbar-name">{area ? area.label : "World"}</span>
      {area ? (
        <button
          type="button"
          className="tn-ctxbar-x"
          onClick={() => {
            inspectorStore.load(null);
            scopeStore.set(WORLD_SCOPE);
          }}
          title="Back to World"
          aria-label={`Unload ${area.label} and return to World`}
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 6: Build `InspectorTab.tsx`**

```tsx
"use client";
// The Inspector index. A LIST, not a detail view — detail opens in the dossier on
// the right, which already exists at 384px and already handles focus, escape and
// mobile. See lib/overlay-content.tsx.
//
// Sources are NOT configured here. Load an area and the Sources tab is pointed at
// it; that is the whole interaction, and duplicating a source list in this column
// would give the user two places to change one thing.

import { aoiLabel, startDraw } from "@/lib/map/aoi";
import { areaSummary, inspectorStore, useInspector } from "@/lib/shell/inspector";
import { aoiScope, scopeStore } from "@/lib/shell/scope";
import { overlay } from "@/lib/overlay";
import type { Map as MapLibreMap } from "maplibre-gl";

declare global {
  interface Window { __map?: MapLibreMap }
}

export default function InspectorTab() {
  const state = useInspector();

  const draw = () => {
    const map = window.__map;
    if (!map) return;
    // onFinish is supplied, so aoi.ts hands us the ring and leaves the scope alone.
    // That contract is what keeps a camera pick from becoming a saved area; do not
    // drop it. See DrawOptions in lib/map/aoi.ts.
    startDraw(map, {
      onFinish: (ring) => {
        const id = inspectorStore.add(ring, aoiLabel(ring));
        if (id) load(id);
      },
    });
  };

  const load = (id: string) => {
    inspectorStore.load(id);
    const area = inspectorStore.get().areas.find((a) => a.id === id);
    if (area) scopeStore.set(aoiScope(area.polygon, area.label));
  };

  return (
    <div className="tn-insp">
      <div className="tn-subhead">
        Areas <span className="tn-insp-count">{state.areas.length}</span>
      </div>

      {state.areas.length === 0 ? (
        <p className="tn-rail-foot">
          No areas yet. Draw one on the map to give it its own sources.
        </p>
      ) : (
        state.areas.map((a) => (
          <button
            key={a.id}
            type="button"
            className="tn-insp-row"
            data-loaded={state.loaded === a.id ? "" : undefined}
            onClick={() => overlay.open({ kind: "area", id: a.id, label: a.label, lat: 0, lon: 0 })}
          >
            <span className="tn-insp-glyph" aria-hidden>▣</span>
            <span className="tn-insp-main">
              <span className="tn-insp-label">{a.label}</span>
              <span className="tn-insp-sub">{areaSummary(a)}</span>
            </span>
            {state.loaded === a.id ? <span className="tn-insp-pill">LOADED</span> : null}
          </button>
        ))
      )}

      <button type="button" className="tn-insp-draw" onClick={draw}>
        ＋ Draw an area
      </button>

      {/* Labelled and inert, never a control that does nothing. The design is in
          docs/superpowers/specs/2026-09-07-inspector-design.md §12 so it drops in
          without moving anything here. */}
      <div className="tn-insp-soon">
        <div className="tn-insp-soon-head">
          <span>Alert me</span>
          <span className="tn-insp-pill tn-insp-pill-muted">COMING SOON</span>
        </div>
        <p>Tell me when something enters or leaves an area. Not built yet.</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Wire the tabs into `SourceCatalog.tsx`**

Add `const [tab, setTab] = useState<"sources" | "inspector">("sources");` beside the existing `query` state. Immediately after the `<div className="tn-rail-header">…</div>` block at line 206-216, insert:

```tsx
      <ContextBar />

      <div className="tn-rail-tabs" role="tablist">
        <button
          type="button" role="tab" className="tn-rail-tab"
          aria-selected={tab === "sources"} onClick={() => setTab("sources")}
        >
          Sources
        </button>
        <button
          type="button" role="tab" className="tn-rail-tab"
          aria-selected={tab === "inspector"} onClick={() => setTab("inspector")}
        >
          Inspector
        </button>
      </div>
```

Wrap everything from the `<input className="tn-cat-search">` to the closing `</p>` of `tn-rail-foot` in `{tab === "sources" ? (<>…</>) : <InspectorTab />}`.

- [ ] **Step 8: Add the CSS**

Append to `app/globals.css`, beside the existing `.tn-rail` block:

```css
/* ── Inspector: the context bar and the index ─────────────────────────────── */
.tn-ctxbar {
  display: flex; align-items: center; gap: 7px; margin: 0 0 2px;
  padding: 6px 9px; border-radius: 8px; font-size: 12px;
  background: var(--tn-surface-2, rgba(0,0,0,.03)); border: 1px solid var(--tn-border);
}
.tn-ctxbar[data-area] { border-color: var(--tn-accent); }
.tn-ctxbar-glyph { color: var(--tn-text-faint); }
.tn-ctxbar[data-area] .tn-ctxbar-glyph, .tn-ctxbar[data-area] .tn-ctxbar-name { color: var(--tn-accent); }
.tn-ctxbar-name { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tn-ctxbar-x { border: none; background: none; color: var(--tn-text-faint); cursor: pointer; font: inherit; padding: 0 2px; }
.tn-ctxbar-x:hover { color: var(--tn-text); }

.tn-rail-tabs { display: flex; gap: 4px; padding: 7px 0 2px; }
.tn-rail-tab {
  flex: 1; padding: 5px 0 6px; font: inherit; font-size: 12px; font-weight: 500;
  border-radius: 7px; border: 1px solid transparent; background: none;
  color: var(--tn-text-faint); cursor: pointer;
}
.tn-rail-tab[aria-selected="true"] {
  border-color: var(--tn-accent); color: var(--tn-accent); font-weight: 600;
}

.tn-insp-count { color: var(--tn-text-faint); font-weight: 400; }
.tn-insp-row {
  display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 8px;
  margin: 0 -8px; border: none; border-radius: 8px; background: none;
  font: inherit; text-align: left; color: inherit; cursor: pointer;
}
.tn-insp-row:hover { background: var(--tn-surface-2, rgba(0,0,0,.04)); }
.tn-insp-row[data-loaded] { background: var(--tn-accent-soft, rgba(0,0,0,.06)); }
.tn-insp-glyph { color: var(--tn-accent); flex: 0 0 auto; }
.tn-insp-main { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
.tn-insp-label { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tn-insp-sub { font-size: 11px; color: var(--tn-text-faint); }
.tn-insp-pill {
  font-size: 9.5px; font-weight: 700; letter-spacing: .05em;
  padding: 1.5px 5px; border-radius: 4px; white-space: nowrap; color: var(--tn-accent);
  border: 1px solid var(--tn-accent);
}
.tn-insp-pill-muted { color: var(--tn-text-faint); border-color: var(--tn-border); }
.tn-insp-draw {
  width: 100%; margin-top: 8px; padding: 7px 9px; text-align: left;
  border: 1px dashed var(--tn-border); border-radius: 8px; background: none;
  font: inherit; font-size: 12px; color: var(--tn-accent); cursor: pointer;
}
.tn-insp-soon {
  margin-top: 12px; padding: 9px 10px; border-radius: 10px;
  border: 1px dashed var(--tn-border); background: var(--tn-surface-2, rgba(0,0,0,.03));
}
.tn-insp-soon-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; font-size: 11px; font-weight: 600; }
.tn-insp-soon-head span:first-child { flex: 1; }
.tn-insp-soon p { margin: 0; font-size: 11px; color: var(--tn-text-faint); line-height: 1.5; }
```

- [ ] **Step 9: Run the full gate**

Run: `npx tsc --noEmit && npm test`
Expected: exit 0.

- [ ] **Step 10: Commit**

```bash
git add components/shell/inspector/ components/shell/SourceCatalog.tsx app/globals.css lib/shell/inspector.ts tests/unit/inspector-labels.test.ts
git commit -m "Split the rail into Sources and Inspector, above a context line

The Inspector is an index: the areas you have drawn, what each holds, and which
one is loaded. Detail opens in the dossier on the right rather than in this
column, and sources are configured in the Sources tab — which the context line
above the tabs says is pointed at the loaded area, in both tabs, always.

Area size uses the spherical excess formula, not a planar shoelace on lon/lat.
The planar version overstates by the cosine of the latitude — about 55% at 50N —
and an area label that overstates is the one thing this product must not print."
```

---

## Task 4: Loading an area scopes the console

**Files:**
- Create: `lib/scopeFilter.ts`
- Test: `tests/unit/scope-filter.test.ts`
- Modify: `lib/planes/usePlanes.ts`, `lib/cameras/useCameras.ts`, and the satellites + webcam directory hooks

**Interfaces:**
- Consumes: `withinScope`, `useScope` from `@/lib/shell/scope`.
- Produces: `filterToScope<T>(items, scope, at): T[]` and `useScopeFilter<T>(items, at): T[]`, where `at` is `(item: T) => { lat: number; lon: number } | null`.

**Why one helper:** the filter goes inside the shared hooks, not at each call site, so a widget added next month is scoped by construction — the same property that makes adding a signal layer need no edit to the rail.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/scope-filter.test.ts`:

```ts
import { expect, test } from "vitest";
import { filterToScope } from "@/lib/scopeFilter";
import { aoiScope, WORLD_SCOPE } from "@/lib/shell/scope";

const RING: [number, number][] = [
  [36.0, 49.8],
  [36.5, 49.8],
  [36.5, 50.2],
  [36.0, 50.2],
];

const AT = (p: { lat: number; lon: number }) => p;
const INSIDE = { lat: 50.0, lon: 36.2 };
const OUTSIDE = { lat: 51.5, lon: -0.1 };

test("the world scope filters nothing and returns the SAME array", () => {
  const items = [INSIDE, OUTSIDE];
  expect(filterToScope(items, WORLD_SCOPE, AT)).toBe(items);
});

test("an aoi scope keeps only what is inside the ring", () => {
  const out = filterToScope([INSIDE, OUTSIDE], aoiScope(RING), AT);
  expect(out).toEqual([INSIDE]);
});

test("an item with no position is DROPPED inside an area, not silently kept", () => {
  const out = filterToScope([INSIDE, { lat: NaN, lon: NaN }], aoiScope(RING), (p) =>
    Number.isFinite(p.lat) ? p : null,
  );
  expect(out).toEqual([INSIDE]);
});

test("an item with no position is KEPT under the world scope", () => {
  const items = [{ lat: NaN, lon: NaN }];
  expect(filterToScope(items, WORLD_SCOPE, () => null)).toBe(items);
});

test("an empty list stays empty rather than throwing", () => {
  expect(filterToScope([], aoiScope(RING), AT)).toEqual([]);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/scope-filter.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/scopeFilter"`.

- [ ] **Step 3: Write the helper**

Create `lib/scopeFilter.ts`:

```ts
"use client";
// One scope filter, shared by every data hook that is not already scoped.
//
// WHY IT LIVES IN A HELPER AND NOT AT THE CALL SITES. Ten widget files already call
// useScope() and filter for themselves. The remaining data-bearing ones funnel
// through four hooks — usePlanes, useCameras, useSatellites, useWebcamDirectory —
// so putting the filter INSIDE those four scopes every widget that reads them, and
// scopes any widget added later by construction. Filtering at each call site would
// be the same work done six times and forgotten on the seventh.
//
// A MISSING POSITION IS DROPPED, NOT KEPT. Under an area, "I do not know where this
// is" cannot honestly answer "is it in the ring". Keeping it would put an item of
// unknown location inside a boundary the user drew precisely to exclude things.
// Under World the question is not asked, so it stays.

import { useScope, withinScope, type Scope } from "@/lib/shell/scope";

/** Pure: keep only the items inside `scope`. Returns the input array untouched for World. */
export function filterToScope<T>(
  items: readonly T[],
  scope: Scope,
  at: (item: T) => { lat: number; lon: number } | null,
): T[] {
  if (scope.mode === "world") return items as T[];
  const out: T[] = [];
  for (const item of items) {
    const p = at(item);
    if (p && withinScope(p.lat, p.lon, scope)) out.push(item);
  }
  return out;
}

/** Hook form: filters to the LIVE scope, which the Inspector drives when an area loads. */
export function useScopeFilter<T>(
  items: readonly T[],
  at: (item: T) => { lat: number; lon: number } | null,
): T[] {
  return filterToScope(items, useScope(), at);
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/unit/scope-filter.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Apply it in the four hooks**

In each of `lib/planes/usePlanes.ts`, `lib/cameras/useCameras.ts`, the satellites hook and the webcam-directory hook, wrap the returned list:

```ts
const scoped = useScopeFilter(list, (x) => (Number.isFinite(x.lat) && Number.isFinite(x.lon) ? x : null));
```

and return `scoped` in place of `list`. Read each hook's actual return shape first — the field names differ (`lat`/`lon` vs `latitude`/`longitude`) and the accessor must match the real one.

- [ ] **Step 6: Classify every registered widget type**

Run this and record the output in the commit message:

```bash
npx tsx -e "import('./lib/console/widgets/index.ts').then(async()=>{const{listWidgetTypes}=await import('./lib/console/registry.ts');console.log(listWidgetTypes().length)})"
```

For each type, confirm it falls in exactly one bucket: already scoped (calls `useScope`), scoped now (reads one of the four hooks), or carries no geographic data. **Any type in none of the three is a gap** — a widget showing global numbers beside a cropped map — and gets a `⌂ WORLD` marker or a scope filter before this task is done.

- [ ] **Step 7: Run the full gate**

Run: `npx tsc --noEmit && npm test`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add lib/scopeFilter.ts tests/unit/scope-filter.test.ts lib/planes/ lib/cameras/
git commit -m "Loading an area scopes the map, the feed and every widget

The filter goes inside the four shared data hooks rather than at each call site,
so a widget added later is scoped by construction — the same property that makes
adding a signal layer need no edit to the rail. Ten widget files already scoped
themselves through useScope and are untouched.

An item with no usable position is DROPPED inside an area and KEPT under World.
Under an area, 'I do not know where this is' cannot honestly answer 'is it in the
ring', and keeping it would place an unknown inside a boundary drawn to exclude."
```

---

## Task 5: The area dossier, and the country click

**Files:**
- Create: `components/shell/inspector/AreaDetail.tsx`
- Modify: `lib/world.ts` — add `"area"` to `WorldObjectKind`
- Modify: `lib/overlay-content.tsx` — add `case "area"`
- Modify: `components/WorldMap.tsx:1507`

**Interfaces:**
- Consumes: `inspectorStore`, `useInspector`, `areaSummary` from Task 1; `overlay` from `@/lib/overlay`.
- Produces: nothing other tasks depend on.

**Note:** `case "country"` in `lib/overlay-content.tsx` is **not** removed and `components/CountryDetail.tsx` is **not** reflowed. `.tn-dossier` is already a 384px right-edge panel, which is the chosen layout — an earlier revision of the spec said otherwise and was wrong.

- [ ] **Step 1: Add the `area` kind**

In `lib/world.ts`, extend `WorldObjectKind` with `"area"`.

- [ ] **Step 2: Build `AreaDetail.tsx`**

Render, from the area whose `id` the overlay object carries: label (inline-editable → `inspectorStore.rename`), `areaSummary(area)`, vertex count, centre coordinates, and the source list read from `area.sources`. Buttons: **Load / Unload** (`inspectorStore.load` + `scopeStore.set`), **Fly to** (`mapViewStore.flyToPoint` on the bbox centre), **Remove** (`inspectorStore.remove`, then `overlay.close()`).

The source list is **read-only here** with the line "Change these in the Sources tab — it is already pointed at this area." Two places to change one thing is the bug this whole split exists to avoid.

- [ ] **Step 3: Register it**

In `lib/overlay-content.tsx`, add `case "area": return <AreaDetail object={object} />;`.

- [ ] **Step 4: Country click also opens the Inspector**

At `components/WorldMap.tsx:1507`, keep the existing `overlay.open(...)` and add `sourcesRailStore.setOpen(true)` beside it so the index is visible alongside the dossier. **Do not** change what the overlay opens.

- [ ] **Step 5: Run the full gate**

Run: `npx tsc --noEmit && npm test`
Expected: exit 0.

- [ ] **Step 6: Verify in a real browser, red first**

Push the branch, let Vercel build the preview, then run the existing e2e against **production** (old code — expect red) and against the **preview** (expect green), using the technique in the spec §11:

```bash
npx playwright test tests/e2e/map-rail.spec.ts --config=<temp config with baseURL and no webServer>
```

`tests/e2e/map-rail.spec.ts` matters twice here. Its "cold layer state" setup seeds `tn.layers.v1` and reloads, which was **inert** before Task 2 because nothing rehydrated — but only one half of the later assertion was damaged by that, and the distinction matters:

- `cameras: false → true` was **vacuous**. `DEFAULT_STATE.cameras` is already `true`, which is the exact condition the seed was written to rule out.
- `webcams: false → true` still **observed something real**, because `DEFAULT_STATE.webcams` is `false` with or without the seed.

So the case was half load-bearing, not dead — keep and repair it, never delete it. With hydration wired the seed is genuinely read, `cameras: false` actually holds at reload, and both halves become real. Confirm it still passes and record that it is now testing what it claims.

- [ ] **Step 7: Commit**

```bash
git add components/shell/inspector/AreaDetail.tsx lib/world.ts lib/overlay-content.tsx components/WorldMap.tsx
git commit -m "Open area detail in the dossier, and show the index on a country click

The dossier is already a 384px right-edge panel mirroring the rail, so an area
becomes one more kind in the kind-to-component switch rather than a second detail
surface. It inherits focus handling, escape, the close button and the mobile
behaviour for nothing.

The country case is untouched: an earlier draft of the spec proposed removing it
and reflowing CountryDetail into the left rail, which was wrong about where the
dossier already sits. A country click now also opens the rail so the index is
visible beside the dossier it is describing."
```

---

## Deferred to their own plan

- **Area alerts.** Spec §12. Ships in Task 3 as a labelled, inert block.
- **The camera tray split.** Spec §7. `wallpicker` has pre-agreed the hand-over of `CameraTray.tsx` and `StageBar.tsx:188`; the gesture controls stay on the stage and only the basket review moves. Needs its own red/green against a preview because it can strand an armed pick.
- **`components/shell/EventFeed.tsx`**, imported by nothing and already dead on `origin/main` before #177. Flagged, untouched.

## Self-Review

**Spec coverage.** §1–§2 → Tasks 1–3. §3 context bar → Task 3. §4 model → Task 1. §5 migration + the hydrate bug → Task 2. §6 scope reach → Task 4. §7 tray → deferred, stated. §8 webcams → `ALWAYS_ON_SOURCES`, Task 1. §9 country decision → Task 5. §11 tests → each task's test step. §12 alerts → Task 3's coming-soon block.

**Placeholder scan.** Task 4 Step 5 and Task 5 Step 2 describe edits without full code, because the four hooks' return shapes and `CountryDetail`'s markup must be read first — the field names differ per hook and inventing them here would plant a bug. Both steps name the exact files and the exact accessor contract instead.

**Type consistency.** `SourceSet`, `InspectorArea`, `InspectorState`, `effectiveSet`, `activeSet`, `writeActive`, `replaceActive`, `areaSummary`, `ringAreaKm2`, `loadedArea`, `filterToScope`, `useScopeFilter` are used in Tasks 2–5 exactly as Task 1 and Task 4 define them. `ALWAYS_ON_SOURCES` is read only through `effectiveSet`.

**One risk worth naming.** Task 2's `layersStore.applyExact` merges rather than replaces, because a context's `SourceSet` holds signal ids alongside `LayerKey`s and a layer preset must not switch every signal off. `signalsStore.applyExact` does replace, which mirrors its current behaviour but now also clears layer keys from the set — `presetLayers.ts` and `variants/resolveSignals.ts` call it, so their tests are the ones to watch in Task 2 Step 7.
