// The decision that says where a webcam is — and, crucially, when we do not yet know.
//
// This test exists because of a bug that shipped past a green suite and a passing
// tsc, and was only caught by looking at the rendered page: a Prague tile announced
// "no data" while its coordinates were still in flight. The resolver returned only
// SUCCESSFUL lookups, so "still asking" and "asked, nothing there" were the same
// absence. Everything below is about keeping those two apart.

import { describe, it, expect } from "vitest";
import { webcamPlaceState, type WebcamPlace } from "@/lib/webcams/places";

const PRAGUE: WebcamPlace = { lat: 50.08112, lon: 14.42852 };
const MADRID: WebcamPlace = { lat: 40.41666, lon: -3.70028 };

const settled = (entries: [string, WebcamPlace | null][]) => new Map(entries);

describe("webcamPlaceState", () => {
  it("uses the directory row when it carries a real pair, and asks nobody", () => {
    const out = webcamPlaceState(51.5074, -0.12765, settled([]), "windy:1420893641");
    expect(out).toEqual({ coord: { lat: 51.5074, lon: -0.12765 }, pending: false });
  });

  it("is PENDING for an id nothing has answered for yet — never 'no data'", () => {
    // The exact Prague case. The directory sample does not carry this row and
    // /api/webcam-place has not come back. Saying "no data" here is a claim we have
    // not earned.
    const out = webcamPlaceState(undefined, undefined, settled([]), "windy:1345327762");
    expect(out.pending).toBe(true);
    expect(out.coord).toBeNull();
  });

  it("takes the resolver's answer once it has settled", () => {
    const out = webcamPlaceState(undefined, undefined, settled([["windy:1606332744", MADRID]]), "windy:1606332744");
    expect(out).toEqual({ coord: MADRID, pending: false });
  });

  it("stops pending when the resolver settles with an explicit null — THIS is 'no data'", () => {
    // A settled miss is a real answer and must end the pending state, or a webcam
    // that genuinely has no position would show "…" forever.
    const out = webcamPlaceState(undefined, undefined, settled([["windy:9", null]]), "windy:9");
    expect(out).toEqual({ coord: null, pending: false });
  });

  it("does not confuse one id's settled miss with another id's silence", () => {
    const map = settled([["windy:9", null]]);
    expect(webcamPlaceState(undefined, undefined, map, "windy:10").pending).toBe(true);
  });

  it("treats a half-populated directory row as no row at all", () => {
    // A row carrying a latitude and no longitude is not a position. Falling back to
    // the resolver is right; treating lat-only as a place would put the camera on
    // the prime meridian.
    expect(webcamPlaceState(50.08112, undefined, settled([]), "x").pending).toBe(true);
    expect(webcamPlaceState(undefined, 14.42852, settled([]), "x").pending).toBe(true);
  });

  it("rejects NaN and Infinity in a directory row rather than passing them upstream", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(webcamPlaceState(bad, 14.42852, settled([]), "x").coord).toBeNull();
      expect(webcamPlaceState(50.08112, bad, settled([]), "x").coord).toBeNull();
    }
  });

  it("prefers the directory over the resolver when both have an answer", () => {
    // Not a correctness question so much as a cost one: the directory row is already
    // in memory, and two sources disagreeing about the same camera is a directory
    // problem to fix at its source, not to arbitrate per tile.
    const out = webcamPlaceState(PRAGUE.lat, PRAGUE.lon, settled([["p", MADRID]]), "p");
    expect(out.coord).toEqual(PRAGUE);
  });
});
