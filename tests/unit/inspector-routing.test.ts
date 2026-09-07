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

// --- the two the first cut got wrong ----------------------------------------

test("an empty area reads every layer OFF except the always-on pair", () => {
  const id = inspectorStore.add(RING, "Kharkiv")!;
  inspectorStore.load(id);
  // A new area starts with an empty set. DEFAULT_STATE is World's floor, not an
  // area's — flooring an area with it would silently hand the user a context they
  // never configured, and would drift again the day a default flips.
  expect(layersStore.get()).toEqual({
    cameras: true, // always-on
    webcams: true, // always-on
    satellites: false,
    planes: false,
    ships: false,
    weather: false,
    countries: false,
  });
});

test("get() is identity-stable while an area is loaded — a fresh object per call loops React", () => {
  const id = inspectorStore.add(RING, "Kharkiv")!;
  inspectorStore.load(id);
  // effectiveSet() FORCES the always-on ids in, so it builds a new object every
  // call. useSyncExternalStore compares snapshots by identity: returning a new one
  // per render is the documented infinite-loop bug, and there are no component
  // tests in this repo to catch it. World never showed it — it returns state.world
  // by identity — so this only bites once an area loads.
  expect(layersStore.get()).toBe(layersStore.get());
  expect(signalsStore.get()).toBe(signalsStore.get());
});

test("the two stores share one map and must not wipe each other's half", () => {
  // Layers and signals used to own separate module state, so neither applyExact
  // could reach the other. They now project onto ONE SourceSet per context, which
  // makes a whole-set replace from either side destructive. A variant writes both
  // (lib/variants/store.ts applies layers, then signals) so whichever runs second
  // would silently reset the first — caught by tests/unit/variants-store.test.ts.
  layersStore.applyExact({ ...DEFAULT_STATE, satellites: false });
  signalsStore.applyExact({ "conflict-coverage": true });
  expect(layersStore.get().satellites).toBe(false);
  expect(signalsStore.isOn("conflict-coverage")).toBe(true);

  // ...and the mirror: a layer preset must not switch every signal layer off.
  layersStore.applyExact({ ...DEFAULT_STATE, planes: false });
  expect(signalsStore.isOn("conflict-coverage")).toBe(true);
  expect(layersStore.get().planes).toBe(false);
});
