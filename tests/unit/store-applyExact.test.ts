import { describe, it, expect } from "vitest";
import { layersStore } from "@/lib/layers";
import { signalsStore } from "@/lib/signals/store";

describe("applyExact", () => {
  it("layersStore.applyExact replaces the on-set over defaults", () => {
    layersStore.applyExact({ livecams: false, staticcams: false, planes: true, satellites: true, ships: false, weather: false, countries: true });
    expect(layersStore.get().planes).toBe(true);
    expect(layersStore.get().livecams).toBe(false);
    expect(layersStore.get().staticcams).toBe(false);
  });
  it("signalsStore.applyExact replaces the whole on-set", () => {
    signalsStore.set("earthquakes", true);
    signalsStore.applyExact({ "cyber-c2": true });
    expect(signalsStore.isOn("cyber-c2")).toBe(true);
    expect(signalsStore.isOn("earthquakes")).toBe(false);
  });
});
