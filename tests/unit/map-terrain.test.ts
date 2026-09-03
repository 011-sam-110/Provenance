import { describe, expect, it } from "vitest";
import { TERRAIN_EXAGGERATION, terrainChanged, wantedTerrain } from "@/lib/map/terrain";
import {
  ATTRIB_COMPACT_CLASS,
  ATTRIB_SHOW_CLASS,
  collapseAttribution,
} from "@/lib/map/attribution";

// The regression these pin is not cosmetic. WorldMap calls syncTerrain from
// map.on("zoom"), which MapLibre fires once per RENDER FRAME. MapLibre's
// setTerrain builds a new Terrain + a new RenderToTexture render pool on its add
// branch and never destroys the pair it replaces, so an unguarded call per frame
// exhausted GPU memory and the WebGL context was LOST mid-gesture. Measured on a
// production build, one wheel-zoom over London on a real GPU: 53 calls and a lost
// context before the guard, 1 call and a live context after.

describe("wantedTerrain", () => {
  it("asks for the DEM source when terrain is on", () => {
    expect(wantedTerrain(true, "dem")).toEqual({ source: "dem", exaggeration: TERRAIN_EXAGGERATION });
  });

  it("asks for nothing when terrain is off", () => {
    expect(wantedTerrain(false, "dem")).toBeNull();
  });
});

describe("terrainChanged", () => {
  it("is FALSE for a fresh object with identical values — the whole point", () => {
    // syncTerrain builds a new object every frame, so an identity check would
    // never match and the guard would never fire. This must compare by value.
    expect(terrainChanged({ source: "dem", exaggeration: 1.3 }, wantedTerrain(true, "dem"))).toBe(false);
  });

  it("is false when terrain is already off and stays off", () => {
    expect(terrainChanged(null, null)).toBe(false);
  });

  it("treats undefined from getTerrain() the same as null", () => {
    // map.getTerrain() returns `this.terrain?.options ?? null`, but a stubbed or
    // future MapLibre could hand back undefined; both mean "no terrain".
    expect(terrainChanged(undefined, null)).toBe(false);
  });

  it("is true when switching terrain on", () => {
    expect(terrainChanged(null, wantedTerrain(true, "dem"))).toBe(true);
  });

  it("is true when switching terrain off", () => {
    expect(terrainChanged({ source: "dem", exaggeration: 1.3 }, null)).toBe(true);
  });

  it("is true when the DEM source changes", () => {
    expect(terrainChanged({ source: "old-dem", exaggeration: 1.3 }, wantedTerrain(true, "dem"))).toBe(true);
  });

  it("is true when only the exaggeration changes", () => {
    expect(terrainChanged({ source: "dem", exaggeration: 1 }, wantedTerrain(true, "dem"))).toBe(true);
  });

  it("treats a missing exaggeration as MapLibre's default of 1", () => {
    expect(terrainChanged({ source: "dem" }, { source: "dem", exaggeration: 1 })).toBe(false);
    expect(terrainChanged({ source: "dem" }, { source: "dem", exaggeration: 1.3 })).toBe(true);
  });

  it("stays false across repeated frames once the state has settled", () => {
    // The freeze was 53 calls in one gesture. After the guard, a settled state
    // must report unchanged however many frames go by.
    const current = wantedTerrain(true, "dem");
    for (let frame = 0; frame < 120; frame++) {
      expect(terrainChanged(current, wantedTerrain(true, "dem"))).toBe(false);
    }
  });
});

/** Records class mutations without a DOM — vitest runs in the node environment. */
function stubTarget(initial: string[] = []) {
  const classes = new Set(initial);
  return {
    classes,
    classList: {
      add: (t: string) => void classes.add(t),
      remove: (t: string) => void classes.delete(t),
    },
  };
}

describe("collapseAttribution", () => {
  it("takes the -show class off a control MapLibre mounted expanded", () => {
    // This is the state { compact: true } actually produces: _updateCompact adds
    // BOTH classes, so the credit line renders across the map on first paint.
    const el = stubTarget([ATTRIB_COMPACT_CLASS, ATTRIB_SHOW_CLASS]);
    collapseAttribution(el);
    expect(el.classes.has(ATTRIB_SHOW_CLASS)).toBe(false);
  });

  it("KEEPS the compact class, which is what makes the info button visible", () => {
    // .maplibregl-ctrl-attrib-button is display:none unless .maplibregl-compact is
    // present, and _toggleAttribution returns early without it. Dropping this class
    // would hide the credit AND the way back to it — a licensing regression, not a
    // tidier map.
    const el = stubTarget([ATTRIB_COMPACT_CLASS, ATTRIB_SHOW_CLASS]);
    collapseAttribution(el);
    expect(el.classes.has(ATTRIB_COMPACT_CLASS)).toBe(true);
  });

  it("ADDS the compact class when MapLibre never got round to it", () => {
    // _updateCompact skips a control whose attribution is still empty at mount, so
    // the control can exist with neither class and render as a plain expanded bar.
    const el = stubTarget([]);
    collapseAttribution(el);
    expect(el.classes.has(ATTRIB_COMPACT_CLASS)).toBe(true);
    expect(el.classes.has(ATTRIB_SHOW_CLASS)).toBe(false);
  });

  it("is idempotent, so a basemap swap can call it again", () => {
    const el = stubTarget([ATTRIB_COMPACT_CLASS, ATTRIB_SHOW_CLASS]);
    collapseAttribution(el);
    collapseAttribution(el);
    expect([...el.classes].sort()).toEqual([ATTRIB_COMPACT_CLASS]);
  });

  it("does nothing when the control is not there yet", () => {
    expect(() => collapseAttribution(null)).not.toThrow();
    expect(() => collapseAttribution(undefined)).not.toThrow();
  });
});
