import { beforeEach, expect, test } from "vitest";
import { inspectorStore, sourceRegions } from "@/lib/shell/inspector";
import { DEFAULT_STATE, layersStore } from "@/lib/layers";
import { signalsStore } from "@/lib/signals/store";

const RING: [number, number][] = [
  [36.0, 49.8],
  [36.5, 49.8],
  [36.5, 50.2],
  [36.0, 50.2],
];

beforeEach(() => {
  // A clean store between tests. hydrate() alone is NOT a reset any more: it
  // deliberately preserves World, because the variant spine owns that half and
  // re-derives it on every boot. So World is cleared explicitly — with the rail
  // pointed at World, replaceSources writes World.
  inspectorStore.hydrate();
  inspectorStore.edit(null);
  inspectorStore.replaceSources({});
});

test("with the rail on World, layersStore reads World and matches today's defaults", () => {
  expect(layersStore.get()).toEqual(DEFAULT_STATE);
});

test("a layer toggle while editing World writes World, not an area", () => {
  const id = inspectorStore.add(RING, "Kharkiv")!;
  layersStore.set("planes", false);
  expect(inspectorStore.get().world.planes).toBe(false);
  expect(inspectorStore.get().areas.find((a) => a.id === id)!.sources.planes).toBeUndefined();
});

test("a layer toggle while editing an area writes the area and leaves World alone", () => {
  const id = inspectorStore.add(RING, "Kharkiv")!;
  layersStore.set("planes", false); // World: planes off
  inspectorStore.edit(id);
  layersStore.set("planes", true); // area: planes on
  expect(inspectorStore.get().areas.find((a) => a.id === id)!.sources.planes).toBe(true);
  expect(inspectorStore.get().world.planes).toBe(false);
});

test("switching back to World restores World's own set exactly", () => {
  const id = inspectorStore.add(RING, "Kharkiv")!;
  layersStore.set("satellites", false);
  const world = { ...layersStore.editing() };
  inspectorStore.edit(id);
  layersStore.set("satellites", true);
  inspectorStore.edit(null);
  expect(layersStore.editing()).toEqual(world);
});

test("signalsStore routes writes the same way", () => {
  const id = inspectorStore.add(RING, "Kharkiv")!;
  signalsStore.set("earthquakes", true);
  inspectorStore.edit(id);
  expect(signalsStore.editing().earthquakes).toBeUndefined();
  signalsStore.set("conflict", true);
  expect(signalsStore.editing().conflict).toBe(true);
  inspectorStore.edit(null);
  expect(signalsStore.editing().earthquakes).toBe(true);
  expect(signalsStore.editing().conflict).toBeUndefined();
});

test("applyPreset writes the edited area, not World", () => {
  const id = inspectorStore.add(RING, "Kharkiv")!;
  inspectorStore.edit(id);
  layersStore.applyPreset("air-space");
  expect(inspectorStore.get().areas.find((a) => a.id === id)!.sources.planes).toBe(true);
  expect(inspectorStore.get().world.planes).toBeUndefined();
});

// --- ADDITIVE AREAS: the reports this model was built from ---------------------

test("an area's sources do NOT take the globe's away", () => {
  // Sam's report, in one test. Turning a signal on for an area used to switch every
  // global signal off, because a loaded area REPLACED World rather than adding to it.
  signalsStore.set("earthquakes", true); // World
  const id = inspectorStore.add(RING, "Kharkiv")!;
  inspectorStore.edit(id);
  signalsStore.set("conflict", true); // the area only
  expect(signalsStore.isOn("earthquakes")).toBe(true); // still on the globe
  expect(signalsStore.isOn("conflict")).toBe(true); // and the area's is on too
});

test("every area is live at once, whichever one the rail is pointed at", () => {
  const a = inspectorStore.add(RING, "A")!;
  const b = inspectorStore.add(RING, "B")!;
  inspectorStore.edit(a);
  signalsStore.set("fires", true);
  inspectorStore.edit(b);
  signalsStore.set("quakes", true);
  // Pointed at B, and A's signal is still drawn.
  expect(signalsStore.isOn("fires")).toBe(true);
  expect(signalsStore.isOn("quakes")).toBe(true);
  inspectorStore.edit(null);
  expect(signalsStore.isOn("fires")).toBe(true);
  expect(signalsStore.isOn("quakes")).toBe(true);
});

test("a source on only inside an area is cropped to that area's ring", () => {
  const id = inspectorStore.add(RING, "Kharkiv")!;
  inspectorStore.edit(id);
  signalsStore.set("fires", true);
  const rings = sourceRegions(inspectorStore.get(), "fires");
  expect(rings?.map((r) => r.id)).toEqual([id]);
});

test("the same source on in World as well is cropped nowhere", () => {
  const id = inspectorStore.add(RING, "Kharkiv")!;
  inspectorStore.edit(id);
  signalsStore.set("fires", true);
  inspectorStore.edit(null);
  signalsStore.set("fires", true); // World too
  // An area can add to the globe and can never narrow it.
  expect(sourceRegions(inspectorStore.get(), "fires")).toBeNull();
});

test("a toggle inside an area compares against the AREA, never the union", () => {
  // The dead-control bug the two projections exist to prevent. With planes on in
  // World, `toggle` reading the union would see true, write false to the area, and
  // change nothing anyone can see.
  layersStore.set("planes", true); // World
  const id = inspectorStore.add(RING, "Kharkiv")!;
  inspectorStore.edit(id);
  layersStore.toggle("planes"); // the area's own floor is OFF, so this turns it ON
  expect(inspectorStore.get().areas.find((a) => a.id === id)!.sources.planes).toBe(true);
});

test("an empty area reads every layer OFF in the rail, and adds nothing to the map", () => {
  const id = inspectorStore.add(RING, "Kharkiv")!;
  inspectorStore.edit(id);
  // A new area starts with an empty set. DEFAULT_STATE is World's floor, not an
  // area's — flooring an area with it would silently hand the user a context they
  // never configured, and would drift again the day a default flips.
  //
  // NOTHING IS FORCED ON. ALWAYS_ON_SOURCES used to pin cameras and webcams true
  // here so an area could not load to a blank map; loading an area cannot blank the
  // map any more, and with every area live at once a forced source would be camera
  // pins inside every ring ever drawn, with a toggle that says off. See inspector.ts.
  expect(layersStore.editing()).toEqual({
    cameras: false,
    webcams: false,
    satellites: false,
    planes: false,
    ships: false,
    weather: false,
    countries: false,
  });
  expect(layersStore.get()).toEqual(DEFAULT_STATE); // the globe is untouched by it
});

test("get() and editing() are both identity-stable — a fresh object per call loops React", () => {
  const id = inspectorStore.add(RING, "Kharkiv")!;
  inspectorStore.edit(id);
  // unionSet() builds a new object every call, so get() must go through the memo.
  // useSyncExternalStore compares snapshots by identity: returning a new one per
  // render is the documented infinite-loop bug, and there are no component tests in
  // this repo to catch it.
  expect(layersStore.get()).toBe(layersStore.get());
  expect(signalsStore.get()).toBe(signalsStore.get());
  expect(layersStore.editing()).toBe(layersStore.editing());
  expect(signalsStore.editing()).toBe(signalsStore.editing());
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

// --- the two the BROWSER found, that no unit test could have --------------------

test("hydrate restores areas but leaves World to the variant spine", () => {
  // variantStore.bootstrap is, in its own words, the ONLY load-time hydration path:
  // it re-derives World's whole set on every boot. If this store restored World too
  // there would be two owners for one piece of state, and the loser was the user:
  // with an area being edited, bootstrap's writes landed on the AREA and one reload
  // replaced its sources with the variant's layers. Measured on a preview.
  const id = inspectorStore.add(RING, "Kharkiv")!;
  layersStore.set("planes", false);
  const worldBefore = { ...inspectorStore.get().world };
  inspectorStore.hydrate();
  expect(inspectorStore.get().world).toEqual(worldBefore);
  // The area is gone because nothing is persisted in this environment — the point
  // is only that World was NOT reset out from under the variant.
  expect(inspectorStore.get().areas.some((a) => a.id === id)).toBe(false);
});

test("a toggle inside an area is not captured as the variant's override", async () => {
  const { variantStore } = await import("@/lib/variants/store");
  // bootstrap is what SUBSCRIBES captureOverride. Without this call nothing is
  // listening and the assertion below passes whatever the guard does — which is
  // exactly what the first cut of this test did.
  variantStore.bootstrap(new URLSearchParams(""));
  const id = inspectorStore.add(RING, "Kharkiv")!;
  inspectorStore.edit(id);
  const before = JSON.stringify(variantStore.get().overrides);
  layersStore.set("planes", true);
  signalsStore.set("earthquakes", true);
  // captureOverride is subscribed to these stores. Without the `editing` guard, an
  // area's set is written into the variant's override and the next boot replays it
  // onto the globe — the exact leak the contexts model exists to prevent.
  expect(JSON.stringify(variantStore.get().overrides)).toBe(before);
});

test("a source on ONLY inside an area is never captured as a World override", () => {
  // The second half of that leak, and the one the guard alone does not close.
  // captureOverride reads the store while the rail is on World; if it read the UNION
  // it would see the area's signal, persist it as World's, and the next boot would
  // put a ring-scoped source across the whole globe.
  const id = inspectorStore.add(RING, "Kharkiv")!;
  inspectorStore.edit(id);
  signalsStore.set("fires", true);
  inspectorStore.edit(null);
  expect(signalsStore.isOn("fires")).toBe(true); // the union sees it...
  expect(signalsStore.editing().fires).toBeUndefined(); // ...and World does not
});
