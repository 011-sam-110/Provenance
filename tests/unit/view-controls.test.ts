import { describe, expect, it } from "vitest";
import { BASEMAPS } from "@/lib/basemaps";
import { basemapKeys, modeForStage, stageForMode } from "@/lib/console/viewControls";

// The pure tables behind the Inspector rail's MAP SETTINGS tool. Split out of
// tests/unit/map-rail.test.ts when the stage rail was retired: the projection
// round-trip and the basemap drift guard are about the map, not about the rail, and
// they outlived the surface they were first written for.

describe("stageForMode / modeForStage", () => {
  it("round-trips both real modes", () => {
    expect(modeForStage(stageForMode("3d"))).toBe("3d");
    expect(modeForStage(stageForMode("2d"))).toBe("2d");
  });

  it("maps 3D to the globe stage and 2D to the flat one", () => {
    expect(stageForMode("3d")).toBe("map3d");
    expect(stageForMode("2d")).toBe("map2d");
  });

  it("returns null for the legacy clock stage rather than guessing", () => {
    expect(modeForStage("clock")).toBe(null);
  });
});

describe("the basemap rows", () => {
  it("iterates in the registry's own order, which lib/basemaps.ts says is load-bearing", () => {
    expect(basemapKeys()).toEqual(Object.keys(BASEMAPS));
  });

  it("every registered basemap gets a row, and the tool invents none", () => {
    // A drift guard. Adding a sixth basemap must fail HERE rather than rendering a
    // row with nothing in it.
    //
    // THIS USED TO ASSERT A SHORT-LABEL TABLE. RAIL_BASEMAP_LABEL mapped each key to
    // "Streets"/"Sat"/"Topo" because the strip had to stay lateral and three full
    // names did not fit across it. The rail is vertical now and each basemap is a
    // full-width row, so the rows read BASEMAPS[k].label directly — which is also
    // one fewer place a basemap's name could be spelled differently from the
    // registry's own. What is left to guard is that every basemap HAS one.
    expect(basemapKeys().sort()).toEqual(Object.keys(BASEMAPS).sort());
    for (const k of basemapKeys()) {
      expect(BASEMAPS[k].label.length).toBeGreaterThan(0);
    }
  });

  it("no basemap the old dark/light pair button used to hide is still in the registry", () => {
    // Pins a removal rather than a feature. `?base=dark` and `?base=positron` were
    // published values in shared links; they are meant to fail lib/share/url.ts's
    // guard now and fall back to the default, which only works while these two are
    // genuinely gone. The pair button went with the console's dark skin.
    expect(Object.keys(BASEMAPS)).not.toContain("dark");
    expect(Object.keys(BASEMAPS)).not.toContain("positron");
  });
});
