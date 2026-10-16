import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { StyleSpecification } from "maplibre-gl";
import { describe, expect, test } from "vitest";
import {
  expression,
  featureFilter,
  latest,
  validateStyleMin,
} from "@maplibre/maplibre-gl-style-spec";
import {
  BUILDINGS_LIGHT,
  BUILDINGS_MIN_ZOOM,
  BUILDING_LAYER,
  BUILDING_SRC,
  BUILDING_TILEJSON,
  OMT_SOURCE,
  STYLE_OWN_BUILDING_3D,
  buildingLabelOps,
  buildingLabelPlan,
  buildingsBeforeId,
  buildingsFilter,
  buildingsPaint,
  buildingsSourceId,
  needsOwnBuildingSource,
  type LabelOp,
} from "@/lib/map/buildings";
import { BASEMAPS, type BasemapKey } from "@/lib/basemaps";

// ---------------------------------------------------------------------------
// The 3D buildings layer, and the limit of what this file can claim.
//
// WorldMap cannot be mounted here: it is a client component that imports maplibre's
// CSS, and vitest runs in a node environment with no jsdom. So nothing below can
// tell you a building appeared on screen. What it CAN hold are the failures that
// are silent in a browser -- an invalid paint expression, a duplicate layer id, a
// filter that drops every building, a colour that evaluates to black -- plus the
// real style validator over the layer we actually build.
// ---------------------------------------------------------------------------

const ALL_KEYS = Object.keys(BASEMAPS) as BasemapKey[];

/**
 * The verbatim Liberty capture style-trim.test.ts already pins (see the header
 * there for when and how it was taken). The slot and the label plan are decided
 * against layer ids we do not own, so they are tested against the real list.
 */
const liberty = JSON.parse(
  readFileSync(resolve(__dirname, "../fixtures/liberty-style.captured.json"), "utf8"),
) as StyleSpecification;
const libertyIds = liberty.layers.map((l) => l.id);

/** Evaluate a fill-extrusion-color expression for one building, as MapLibre would. */
function colourFor(basemap: BasemapKey, properties: Record<string, unknown>) {
  const spec = latest["paint_fill-extrusion"]["fill-extrusion-color"];
  const parsed = expression.createPropertyExpression(
    buildingsPaint(basemap)["fill-extrusion-color"],
    spec as never,
  );
  if (parsed.result !== "success") throw new Error(JSON.stringify(parsed.value));
  const c = parsed.value.evaluate(
    { zoom: 15 },
    { type: "Polygon", properties, geometry: [] } as never,
  ) as { r: number; g: number; b: number };
  return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
}

/** The basemap's neutral, as the expression produces it for a building with no colour. */
const neutralOf = (basemap: BasemapKey) => colourFor(basemap, {});

describe("buildingsPaint", () => {
  test("every basemap gets its own neutral", () => {
    // One colour cannot serve three grounds: pale massing that reads on Liberty's
    // paper vanishes into Esri imagery.
    const neutrals = new Set(ALL_KEYS.map((k) => neutralOf(k).join(",")));
    expect(neutrals.size, "the basemaps must not all share one colour").toBe(ALL_KEYS.length);
  });

  test("an unreadable OSM colour falls back to the neutral, NOT to black", () => {
    // The bug this replaced: OSM's `colour` holds words MapLibre cannot parse
    // ("light_brown", "darkbrown", "black;white", "5" -- all seen over central
    // London on 2026-10-16). `coalesce` passed them through, the colour failed, and
    // the property default won: every one of those buildings rendered pure black.
    for (const basemap of ALL_KEYS) {
      for (const bad of ["light_brown", "darkbrown", "black;white", "5"]) {
        expect(colourFor(basemap, { colour: bad }), `${basemap} / ${bad}`).toEqual(neutralOf(basemap));
      }
    }
  });

  test("a real OSM colour still shows, mixed into the neutral rather than at full strength", () => {
    // #5a81a0 is the most common value in central London (126 of 567 buildings):
    // glass. It must still read as a hint of blue -- different from the neutral --
    // but sit far closer to the neutral than to the raw colour.
    const glass = [0x5a, 0x81, 0xa0];
    const mixed = colourFor("streets", { colour: "#5a81a0" });
    const neutral = neutralOf("streets");
    const dist = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]));
    expect(mixed).not.toEqual(neutral);
    expect(dist(mixed, neutral)).toBeLessThan(dist(mixed, glass));
  });

  test("pure building:colour=blue no longer renders #0000ff", () => {
    const [r, g, b] = colourFor("streets", { colour: "blue" });
    expect(r, "red channel lifted off zero").toBeGreaterThan(100);
    expect(g, "green channel lifted off zero").toBeGreaterThan(100);
    expect(b).toBeGreaterThan(r);
  });

  test("height and base default rather than reading a missing field raw", () => {
    // render_min_height is absent on most buildings. Without the coalesce the
    // extrusion base is null and MapLibre draws nothing at all.
    const paint = buildingsPaint("streets");
    expect(paint["fill-extrusion-base"]).toEqual(["coalesce", ["get", "render_min_height"], 0]);
    expect(paint["fill-extrusion-height"]).toEqual(["coalesce", ["get", "render_height"], 0]);
  });

  test("opacity fades in from zero at the minzoom rather than popping", () => {
    const ramp = buildingsPaint("streets")["fill-extrusion-opacity"] as unknown[];
    expect(ramp[0]).toBe("interpolate");
    expect(ramp[3]).toBe(BUILDINGS_MIN_ZOOM);
    expect(ramp[4]).toBe(0);
    expect(ramp[6]).toBeGreaterThan(0);
  });

  test("solid on the drawn basemaps, all but solid over photography", () => {
    // 0.72 over Esri was the "frosted glass" look: the photo showed through every
    // tower and nothing read as a volume. 0.95 keeps a trace of the imagery.
    const top = (k: BasemapKey) => (buildingsPaint(k)["fill-extrusion-opacity"] as number[])[6];
    expect(top("streets")).toBe(1);
    expect(top("topo")).toBe(1);
    expect(top("satellite")).toBeGreaterThanOrEqual(0.9);
    expect(top("satellite")).toBeLessThan(1);
  });
});

describe("BUILDINGS_LIGHT", () => {
  test("is fixed to the map, so turning the map moves the shade like daylight", () => {
    // MapLibre's default anchor is the viewport: the light turns with the camera and
    // every wall facing the screen gets the same grey whichever way the map points.
    expect(BUILDINGS_LIGHT.anchor).toBe("map");
  });

  test("validates as a style's light", () => {
    const errors = validateStyleMin({ version: 8, sources: {}, layers: [], light: BUILDINGS_LIGHT } as never);
    expect(errors, errors.map((e) => e.message).join("\n")).toEqual([]);
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
    expect(libertyIds).not.toContain(BUILDING_LAYER);
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
  test("on Liberty, takes the slot straight after the style's own building-3d", () => {
    expect(buildingsBeforeId(liberty.layers)).toBe(libertyIds[libertyIds.indexOf(STYLE_OWN_BUILDING_3D) + 1]);
  });

  test("on Liberty, sits ABOVE every bridge and the flat footprints", () => {
    // The bug this replaced: "first symbol layer" is Liberty's one-way arrows at
    // layer 61, under all twenty bridge layers and the 2D `building` fill, so a
    // railway bridge behind a tower was drawn across it.
    const at = libertyIds.indexOf(buildingsBeforeId(liberty.layers)!);
    const below = libertyIds.filter((id) => id.startsWith("bridge_") || id === "building");
    expect(below.length).toBeGreaterThan(10);
    for (const id of below) expect(libertyIds.indexOf(id), id).toBeLessThan(at);
  });

  test("without a building-3d, picks the FIRST symbol layer, so buildings sit under the labels", () => {
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

describe("buildingLabelPlan against the real Liberty style", () => {
  const plan = buildingLabelPlan(liberty.layers as never);

  test("sinks exactly the names laid flat along a line, in style order", () => {
    // These lie on the ground, so a building in front hiding them is what the eye
    // expects. Shields and one-way arrows carry an icon and are left alone.
    expect(plan.sink.map((s) => s.id)).toEqual([
      "waterway_line_label",
      "water_name_line_label",
      "highway-name-path",
      "highway-name-minor",
      "highway-name-major",
    ]);
  });

  test("each sunk layer remembers the layer it sat in front of", () => {
    for (const s of plan.sink) {
      expect(s.restoreBefore, s.id).toBe(libertyIds[libertyIds.indexOf(s.id) + 1]);
    }
  });

  test("cuts every POI layer and the point water names, keeping each original filter", () => {
    // Sinking the street names hands their label space to whatever point layer is
    // above them. Measured on production 2026-10-16: shop pins went 29 -> 93 over
    // the City of London; with shops gone, bus stops flooded Midtown (36 -> 82).
    expect(plan.filter.map((f) => f.id).sort()).toEqual([
      "poi_r1",
      "poi_r20",
      "poi_r7",
      "poi_transit",
      "water_name_point_label",
    ]);
    for (const f of plan.filter) {
      const original = liberty.layers.find((l) => l.id === f.id) as { filter?: unknown };
      expect(f.off, f.id).toEqual(original.filter);
    }
  });

  test("from the buildings' zoom, the cut keeps a station and an airport and drops a shop and a bus stop", () => {
    const point = (properties: Record<string, unknown>) =>
      ({ type: 1, properties, geometry: [[{ x: 0, y: 0 }]] }) as never;
    const r1 = featureFilter(plan.filter.find((f) => f.id === "poi_r1")!.on as never);
    expect(r1.filter({ zoom: 16 }, point({ class: "railway", subclass: "subway", rank: 3 }))).toBe(true);
    expect(r1.filter({ zoom: 16 }, point({ class: "shop", subclass: "bakery", rank: 3 }))).toBe(false);
    const transit = featureFilter(plan.filter.find((f) => f.id === "poi_transit")!.on as never);
    expect(transit.filter({ zoom: 16 }, point({ class: "airport" }))).toBe(true);
    expect(transit.filter({ zoom: 16 }, point({ class: "bus", subclass: "bus_stop" }))).toBe(false);
  });

  test("below the buildings' zoom nothing is cut", () => {
    // There are no buildings there to make room for.
    const point = (properties: Record<string, unknown>) =>
      ({ type: 1, properties, geometry: [[{ x: 0, y: 0 }]] }) as never;
    const transit = featureFilter(plan.filter.find((f) => f.id === "poi_transit")!.on as never);
    expect(transit.filter({ zoom: BUILDINGS_MIN_ZOOM - 1 }, point({ class: "bus", subclass: "bus_stop" }))).toBe(true);
  });

  test("point water names go from the buildings' zoom, and the sea names stay below it", () => {
    // Fountains and ponds floated over the towers once the street names went. The
    // same layer carries "North Sea" at globe zoom, so it is cut, never hidden.
    const water = plan.filter.find((f) => f.id === "water_name_point_label")!;
    const original = liberty.layers.find((l) => l.id === water.id) as { filter?: unknown };
    expect(water.off).toEqual(original.filter);
    const f = featureFilter(water.on as never);
    const sea = { type: 1, properties: { class: "sea", name: "North Sea" }, geometry: [[{ x: 0, y: 0 }]] } as never;
    expect(f.filter({ zoom: 4 }, sea)).toBe(true);
    expect(f.filter({ zoom: BUILDINGS_MIN_ZOOM }, sea)).toBe(false);
  });

  test("never touches place names, road numbers or the airport label", () => {
    const touched = new Set([...plan.sink, ...plan.filter].map((x) => x.id));
    for (const id of libertyIds) {
      if (/^(label_|highway-shield|road_shield|airport$)/.test(id)) expect(touched.has(id), id).toBe(false);
    }
  });

  test("Liberty with the plan applied is still a valid style", () => {
    // A filter MapLibre refuses is not thrown: setFilter emits on `error` and the
    // POIs simply stay. The validator is the only place that failure shows up.
    const style = structuredClone(liberty) as StyleSpecification;
    for (const op of buildingLabelOps(plan, true)) {
      const layer = style.layers.find((l) => l.id === op.id) as Record<string, unknown> | undefined;
      if (!layer) continue;
      if (op.kind === "filter") layer.filter = op.filter;
    }
    const errors = validateStyleMin(style as never);
    expect(errors, errors.map((e) => e.message).join("\n")).toEqual([]);
  });
});

describe("buildingLabelPlan scope", () => {
  test("is empty on the inline raster styles", () => {
    for (const key of ["satellite", "topo"] as const) {
      const style = BASEMAPS[key].style as StyleSpecification;
      const plan = buildingLabelPlan(style.layers as never);
      expect(plan, key).toEqual({ sink: [], filter: [] });
    }
  });

  test("never takes one of our own layers, only the basemap's", () => {
    // Our pins, cameras and signals ride on their own sources and must stay on top.
    const plan = buildingLabelPlan([
      { id: "ours-line", type: "symbol", source: "tn-signals", layout: { "symbol-placement": "line" } },
      { id: "ours-poi", type: "symbol", source: "tn-pins", "source-layer": "poi" },
    ]);
    expect(plan).toEqual({ sink: [], filter: [] });
  });

  test("handles a missing layer list", () => {
    expect(buildingLabelPlan(undefined)).toEqual({ sink: [], filter: [] });
  });
});

describe("buildingLabelOps", () => {
  // A stand-in for MapLibre's moveLayer, so the order the ops produce can be read.
  function run(order: string[], ops: LabelOp[]) {
    const out = [...order];
    for (const op of ops) {
      if (op.kind !== "move") continue;
      out.splice(out.indexOf(op.id), 1);
      const at = op.before === undefined ? out.length : out.indexOf(op.before);
      out.splice(at, 0, op.id);
    }
    return out;
  }
  const slotted = (() => {
    const ids = [...libertyIds];
    ids.splice(ids.indexOf(buildingsBeforeId(liberty.layers)!), 0, BUILDING_LAYER);
    return ids;
  })();
  const plan = buildingLabelPlan(
    slotted.map((id) => liberty.layers.find((l) => l.id === id) ?? { id, type: "fill-extrusion" }) as never,
  );

  test("on: the flat names end up straight under the buildings, in their own order", () => {
    const after = run(slotted, buildingLabelOps(plan, true));
    const b = after.indexOf(BUILDING_LAYER);
    expect(after.slice(b - plan.sink.length, b)).toEqual(plan.sink.map((s) => s.id));
  });

  test("off after on puts every layer back exactly where the style had it", () => {
    const back = run(run(slotted, buildingLabelOps(plan, true)), buildingLabelOps(plan, false));
    expect(back).toEqual(slotted);
  });

  test("on twice is the same as on once", () => {
    const once = run(slotted, buildingLabelOps(plan, true));
    expect(run(once, buildingLabelOps(plan, true))).toEqual(once);
  });

  test("off restores the filters the style shipped", () => {
    const ops = buildingLabelOps(plan, false);
    expect(plan.filter.length).toBeGreaterThan(0);
    for (const f of plan.filter) {
      expect(ops).toContainEqual({ kind: "filter", id: f.id, filter: f.off });
    }
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
    const style = styleWithBuildings("streets");
    style.layers[0].paint = {
      ...style.layers[0].paint,
      "fill-extrusion-opacity": ["*", ["interpolate", ["linear"], ["zoom"], 14, 0, 15, 1], 0.9],
    } as never;
    expect(validateStyleMin(style as never).length).toBeGreaterThan(0);
  });
});
