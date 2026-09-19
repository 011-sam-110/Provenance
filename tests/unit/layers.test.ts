import { afterEach, expect, test } from "vitest";
import { layersStore, presetState, ACTIVE_LAYERS, PLANNED_LAYERS } from "@/lib/layers";

// The store is a module singleton; reset to a known baseline after each test so
// ordering can't leak. ("all" turns the active layers on, planned stay off.)
afterEach(() => layersStore.applyPreset("all"));

test("active and planned layer sets are disjoint and complete", () => {
  expect(ACTIVE_LAYERS).toEqual(["livecams", "staticcams", "planes", "satellites"]);
  expect(PLANNED_LAYERS).toEqual(["ships", "weather"]);
});

test("presets only ever switch active layers; planned stay off; countries (a base reference) stays on", () => {
  expect(presetState("all")).toEqual({ livecams: true, staticcams: true, planes: true, satellites: true, ships: false, weather: false, countries: true });
  expect(presetState("none")).toEqual({ livecams: false, staticcams: false, planes: false, satellites: false, ships: false, weather: false, countries: true });
  expect(presetState("cameras")).toEqual({ livecams: true, staticcams: true, planes: false, satellites: false, ships: false, weather: false, countries: true });
  expect(presetState("air-space")).toEqual({ livecams: false, staticcams: false, planes: true, satellites: true, ships: false, weather: false, countries: true });
});

test("applyPreset drives the live store", () => {
  layersStore.applyPreset("cameras");
  expect(layersStore.get()).toEqual(presetState("cameras"));
});

test("toggle flips a single layer without touching the others", () => {
  layersStore.applyPreset("all");
  layersStore.toggle("planes");
  expect(layersStore.get().planes).toBe(false);
  expect(layersStore.get().livecams).toBe(true);
  expect(layersStore.get().staticcams).toBe(true);
  expect(layersStore.get().satellites).toBe(true);
});

test("subscribers fire on change", () => {
  let n = 0;
  const unsub = layersStore.subscribe(() => n++);
  layersStore.applyPreset("none");
  layersStore.toggle("livecams");
  unsub();
  layersStore.applyPreset("all"); // not counted
  expect(n).toBe(2);
});
