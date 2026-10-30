import { describe, it, expect } from "vitest";
import { composeViewState } from "@/lib/share/deepLink";
import { variantStore } from "@/lib/variants/store";
import { activePresetStore } from "@/lib/console/activePreset";
import { encodeViewState } from "@/lib/share/url";

const stubMap = {
  getCenter: () => ({ lat: 1, lng: 2 }),
  getZoom: () => 3,
} as unknown as import("maplibre-gl").Map;

/**
 * A shared link carries the VIEW — where the camera is, which layers are on, the
 * basemap, the open dossier — and the name of the VIEW (Globe / Streets / News) it
 * was copied from, as `preset`. It never carries `v`, the variant, and never a saved
 * board's id, which means nothing in another browser.
 *
 * `preset` is what makes "Globe and Streets have separate sources" survive sharing:
 * the link's sources land in the view it was copied from, in the other browser, and
 * nowhere else. `v` used to be written for the opposite reason and the round trip cost
 * more than it looked: the server had to read it back to mint the social card, which
 * made `/app` a per-request render for every visitor. See lib/share/url.ts.
 */
describe("composeViewState", () => {
  it("does not carry the board, whichever one is active", () => {
    variantStore.setActive("intel");
    const state = composeViewState(stubMap);
    expect("v" in state).toBe(false);
    expect(state).toMatchObject({ lat: 1, lon: 2, zoom: 3 }); // the view still round-trips
  });
  it("does not carry the board for the default one either", () => {
    variantStore.setActive("explore");
    expect("v" in composeViewState(stubMap)).toBe(false);
  });
  it("carries the open view's id as preset, for each built-in view", () => {
    for (const id of ["overview", "streets", "news"]) {
      activePresetStore.set(id);
      expect(composeViewState(stubMap).preset).toBe(id);
      expect(encodeViewState(composeViewState(stubMap)).startsWith(`preset=${id}&`)).toBe(true);
    }
  });
  it("never writes a saved board's id", () => {
    activePresetStore.set("custom-m3x9a");
    expect("preset" in composeViewState(stubMap)).toBe(false);
    expect(encodeViewState(composeViewState(stubMap))).not.toContain("preset");
  });
  it("writes no preset before any board is open", () => {
    activePresetStore.set(null);
    expect("preset" in composeViewState(stubMap)).toBe(false);
  });
  it("still never carries the variant, with a view named", () => {
    activePresetStore.set("streets");
    variantStore.setActive("intel");
    expect("v" in composeViewState(stubMap)).toBe(false);
  });
});
