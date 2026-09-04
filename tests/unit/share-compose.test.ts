import { describe, it, expect } from "vitest";
import { composeViewState } from "@/lib/share/deepLink";
import { variantStore } from "@/lib/variants/store";

const stubMap = {
  getCenter: () => ({ lat: 1, lng: 2 }),
  getZoom: () => 3,
} as unknown as import("maplibre-gl").Map;

/**
 * A shared link carries the VIEW — where the camera is, which layers are on, the
 * basemap, the open dossier — and not the board. The board is per-browser state, so
 * two people opening the same link see the same map on whichever board each of them
 * last used.
 *
 * This used to be the opposite, and the round trip cost more than it looked: the
 * server had to read `?v=` back to mint the social card, which made `/app` a
 * per-request render for every visitor. See lib/share/url.ts.
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
});
