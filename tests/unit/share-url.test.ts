import { expect, test } from "vitest";
import { encodeViewState, decodeViewState, type ViewState } from "@/lib/share/url";

const rt = (s: string) => decodeViewState(new URLSearchParams(s));

test("full view state round-trips encode → decode unchanged", () => {
  const state: ViewState = {
    lat: 51.5074,
    lon: -0.1278,
    zoom: 11.5,
    layers: ["livecams", "planes"],
    basemap: "satellite",
    obj: "tfl:JamCams_00001",
  };
  const out = decodeViewState(new URLSearchParams(encodeViewState(state)));
  expect(out).toEqual(state);
});

test("encode omits absent keys", () => {
  expect(encodeViewState({})).toBe("");
  expect(encodeViewState({ basemap: "topo" })).toBe("base=topo");
});

test("lat/lon/zoom are clamped to bounds on decode", () => {
  const out = rt("lat=200&lon=-999&z=50");
  expect(out.lat).toBe(90);
  expect(out.lon).toBe(-180);
  // 19 MIRRORS WorldMap's maxZoom and must move with it. It was 18 until 3D
  // buildings needed street-level headroom (OpenFreeMap tiles stop at z14 and
  // MapLibre overzooms past that, so you cannot stand in a street at 18). If these
  // two ever disagree, a shared link silently lands at a different zoom than the
  // one it was minted at -- which is the whole job of this codec.
  expect(out.zoom).toBe(19);
});

test("coordinates round to sane precision on encode", () => {
  expect(encodeViewState({ lat: 12.123456789 })).toBe("lat=12.12346");
});

test("garbage params are dropped, never thrown", () => {
  const out = rt("lat=abc&base=nope&obj=");
  expect(out.lat).toBeUndefined();
  expect(out.basemap).toBeUndefined();
  expect(out.obj).toBeUndefined();
});

test("invalid layer keys are filtered, valid kept in canonical order", () => {
  const out = rt("layers=planes,satellites,bogus");
  expect(out.layers).toEqual(["planes", "satellites"]);
});

// A link someone sent before the camera layers were renamed. These are out in the
// world and cannot be reissued, so the decoder still answers them — and `cameras`
// expands to BOTH tiers, because that is the set of pins that link drew. Dropping
// the token instead would open the link with the cameras off, which reads as a
// broken link rather than a renamed layer. See LEGACY_LAYER_ALIASES in lib/layers.ts.
test("a link minted with the retired camera keys still opens the layers it drew", () => {
  expect(rt("layers=cameras,planes").layers).toEqual(["livecams", "staticcams", "planes"]);
  expect(rt("layers=webcams").layers).toEqual(["staticcams"]);
  expect(rt("layers=cameras,webcams").layers).toEqual(["livecams", "staticcams"]);
});

// The expansion is one-way: nothing WRITES a retired key, so a link minted today
// carries only live ones and a round-trip cannot reintroduce the old vocabulary.
test("encode never emits a retired key", () => {
  const qs = encodeViewState({ layers: ["livecams", "staticcams", "planes", "satellites"] });
  expect(qs).not.toContain("cameras=");
  expect(qs).toBe("layers=livecams%2Cstaticcams%2Cplanes%2Csatellites");
});

test("empty layers (all off) round-trips as []", () => {
  const qs = encodeViewState({ layers: [] });
  expect(qs).toBe("layers=");
  expect(rt(qs).layers).toEqual([]);
});

test("absent query yields an empty view state", () => {
  expect(decodeViewState(new URLSearchParams(""))).toEqual({});
});

test("over-long obj ids are rejected", () => {
  const longId = "x".repeat(200);
  expect(encodeViewState({ obj: longId })).toBe("");
  expect(rt(`obj=${longId}`).obj).toBeUndefined();
});
