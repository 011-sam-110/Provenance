import { describe, expect, test } from "vitest";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import {
  BUILDINGS_MIN_ZOOM,
  BUILDING_LAYER,
  BUILDING_SRC,
  BUILDING_TILEJSON,
  OMT_SOURCE,
  STYLE_OWN_BUILDING_3D,
  buildingsBeforeId,
  buildingsFilter,
  buildingsPaint,
  buildingsSourceId,
  needsOwnBuildingSource,
} from "@/lib/map/buildings";
import { BASEMAPS, type BasemapKey } from "@/lib/basemaps";

// ---------------------------------------------------------------------------
// The 3D buildings layer, and the limit of what this file can claim.
//
// WorldMap cannot be mounted here: it is a client component that imports maplibre's
// CSS, and vitest runs in a node environment with no jsdom. So nothing below can
// tell you a building appeared on screen. What it CAN hold are the failures that
// are silent in a browser -- an invalid paint expression, a duplicate layer id, a
// filter that drops every building -- plus the real style validator over the layer
// we actually build.
// ---------------------------------------------------------------------------

const ALL_KEYS = Object.keys(BASEMAPS) as BasemapKey[];

describe("buildingsPaint", () => {
  test("every basemap gets its own fallback colour", () => {
    // One colour cannot serve five grounds: pale grey massing that reads on Positron
    // paper vanishes into Esri imagery, and a light block on the near-black Dark
    // basemap becomes the brightest thing on screen.
    const colours = new Set<string>();
    for (const key of ALL_KEYS) {
      const colour = buildingsPaint(key)["fill-extrusion-color"] as unknown[];
      expect(colour[0], `${key} should fall back through coalesce`).toBe("coalesce");
      expect(typeof colour[2], `${key} has no fallback colour`).toBe("string");
      colours.add(colour[2] as string);
    }
    expect(colours.size, "the basemaps must not all share one colour").toBeGreaterThan(1);
  });

  test("height and base default rather than reading a missing field raw", () => {
    // render_min_height is absent on most buildings. Without the coalesce the
    // extrusion base is null and MapLibre draws nothing at all.
    const paint = buildingsPaint("positron");
    expect(paint["fill-extrusion-base"]).toEqual(["coalesce", ["get", "render_min_height"], 0]);
    expect(paint["fill-extrusion-height"]).toEqual(["coalesce", ["get", "render_height"], 0]);
  });

  test("opacity fades in from zero at the minzoom rather than popping", () => {
    const ramp = buildingsPaint("positron")["fill-extrusion-opacity"] as unknown[];
    expect(ramp[0]).toBe("interpolate");
    expect(ramp[3]).toBe(BUILDINGS_MIN_ZOOM);
    expect(ramp[4]).toBe(0);
    expect(ramp[6]).toBeGreaterThan(0);
  });
});

describe("buildingsFilter", () => {
  test("honours hide_3d WITHOUT dropping buildings that lack the field", () => {
    // The trap: ["==", ["get","hide_3d"], false] reads correctly and is wrong. The
    // field is absent on most buildings, and absent is not false -- that version
    // filters out nearly everything and looks exactly like an empty tileset.
    expect(buildingsFilter()).toEqual(["!=", ["get", "hide_3d"], true]);
  });
});

describe("layer and source identity", () => {
  test("the layer id is namespaced away from the ids Liberty already owns", () => {
    // OpenFreeMap Liberty defines building-3d; both OFM styles define building.
    // map.addLayer THROWS on a duplicate id, and that throw takes the whole map down
    // rather than just the buildings.
    expect(BUILDING_LAYER).toBe("tn-buildings-3d");
    expect(BUILDING_LAYER).not.toBe(STYLE_OWN_BUILDING_3D);
    expect(BUILDING_LAYER).not.toBe("building");
    expect(BUILDING_SRC).not.toBe(OMT_SOURCE);
  });

  test("reuses the style's own openmaptiles source when it is there", () => {
    // Same planet TileJSON either way, so adding ours alongside it would fetch
    // identical bytes twice under two source ids.
    expect(buildingsSourceId(["openmaptiles", "ne2_shaded"])).toBe(OMT_SOURCE);
    expect(needsOwnBuildingSource(["openmaptiles", "ne2_shaded"])).toBe(false);
  });

  test("brings its own source on the raster basemaps, which have none", () => {
    expect(buildingsSourceId(["esri-imagery"])).toBe(BUILDING_SRC);
    expect(needsOwnBuildingSource(["esri-imagery"])).toBe(true);
    expect(needsOwnBuildingSource([])).toBe(true);
  });

  test("the TileJSON is referenced as a document, not as a tile pattern", () => {
    // Load-bearing for attribution: the OSM / OpenMapTiles / OpenFreeMap credit lives
    // in the TileJSON, so MapLibre only ever sees it by resolving this URL. A literal
    // {z}/{x}/{y} pattern draws the same buildings with the credit dropped.
    expect(BUILDING_TILEJSON).toBe("https://tiles.openfreemap.org/planet");
    expect(BUILDING_TILEJSON).not.toMatch(/\{z\}|\{x\}|\{y\}/);
  });
});

describe("buildingsBeforeId", () => {
  test("picks the style's FIRST symbol layer, so buildings sit under the labels", () => {
    expect(
      buildingsBeforeId([
        { id: "background", type: "background" },
        { id: "water", type: "fill" },
        { id: "label_city", type: "symbol" },
        { id: "label_country", type: "symbol" },
      ]),
    ).toBe("label_city");
  });

  test("returns undefined for a style with no symbol layer, so addLayer appends", () => {
    // Every inline raster style we ship is exactly this: background plus one raster.
    // There is nothing to sit underneath, and appending is correct.
    expect(buildingsBeforeId([{ id: "background", type: "background" }])).toBeUndefined();
    expect(buildingsBeforeId([])).toBeUndefined();
    expect(buildingsBeforeId(undefined)).toBeUndefined();
  });
});

describe("the real style validator", () => {
  // createExpression alone is NOT enough and has been the trap before: it reports
  // expressions valid that MapLibre then refuses. validateStyleMin is the validator
  // the map itself runs. A layer it rejects is never thrown -- MapLibre emits on the
  // error event, declines the layer and carries on -- so the map simply has no
  // buildings on it, with a green suite and a clean tsc.
  function styleWithBuildings(basemap: BasemapKey) {
    return {
      version: 8 as const,
      sources: { [BUILDING_SRC]: { type: "vector" as const, url: BUILDING_TILEJSON } },
      layers: [
        {
          id: BUILDING_LAYER,
          type: "fill-extrusion" as const,
          source: BUILDING_SRC,
          "source-layer": "building",
          minzoom: BUILDINGS_MIN_ZOOM,
          filter: buildingsFilter(),
          paint: buildingsPaint(basemap),
        },
      ],
    };
  }

  for (const key of ALL_KEYS) {
    test(`the built layer validates on ${key}`, () => {
      const errors = validateStyleMin(styleWithBuildings(key) as never);
      expect(errors, errors.map((e) => e.message).join("\n")).toEqual([]);
    });
  }

  test("a zoom expression nested inside another expression is REJECTED", () => {
    // Proves the validator actually bites, so the passes above mean something. A
    // zoom expression may only be the top-level input to step/interpolate, and this
    // is the exact shape that silently cost the cluster badges their layer once.
    const style = styleWithBuildings("positron");
    style.layers[0].paint = {
      ...style.layers[0].paint,
      "fill-extrusion-opacity": ["*", ["interpolate", ["linear"], ["zoom"], 14, 0, 15, 1], 0.9],
    } as never;
    expect(validateStyleMin(style as never).length).toBeGreaterThan(0);
  });
});
