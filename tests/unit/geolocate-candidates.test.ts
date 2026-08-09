import { describe, expect, it } from "vitest";
import { candidatesOf } from "@/lib/geolocate/useGeolocate";
import type { GeolocateResponse, ResolvedCandidate } from "@/lib/geolocate/types";

// REGRESSION GUARD. `result?.candidates ?? []` handed back a fresh array every
// render. The Locate widget reports its export payload to WidgetFrame from an
// effect keyed on that array, so a new identity each render drove an infinite
// update loop: effect -> report() -> setReport -> re-render -> new [] -> effect.
// React's update queue saturated and the Suspense retry that mounts the lazily
// imported <WorldMap> never ran, so the production centre stage was BLANK for
// every first-time visitor, with no console error and no failed request.
//
// Referential stability of the empty case is therefore a CONTRACT, not a perf
// tweak. If this test fails, the map goes blank again.
describe("candidatesOf", () => {
  it("returns the SAME array identity for a null result (the blank-map guard)", () => {
    expect(candidatesOf(null)).toBe(candidatesOf(null));
  });

  it("returns the same identity across repeated calls for a result with no candidates", () => {
    const empty = { candidates: [] } as unknown as GeolocateResponse;
    expect(candidatesOf(empty)).toBe(candidatesOf(empty));
  });

  it("passes the result's own candidates through untouched", () => {
    const candidates = [
      { lat: 51.5, lon: -0.12, place: "London", confidence: 0.8 },
    ] as unknown as ResolvedCandidate[];
    const result = { candidates } as unknown as GeolocateResponse;
    expect(candidatesOf(result)).toBe(candidates);
  });

  it("yields an empty list when there is no result", () => {
    expect(candidatesOf(null)).toEqual([]);
  });
});
