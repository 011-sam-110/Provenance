import { describe, expect, it } from "vitest";
import {
  EYE_BUILDING_OPACITY,
  EYE_LIGHT,
  HEIGHT_RAMP,
  IMAGERY_GRADE,
  IMAGERY_LAYER,
  buildingColorByHeight,
  buildingOpacity,
  EYE_SIGNAL_SINK,
  eyePaintOps,
  eyeSignalPaintOps,
} from "@/lib/eye/look";
import * as signalLayerIds from "@/lib/map/signalLayerIds";
import { BUILDING_LAYER, BUILDINGS_LIGHT, BUILDINGS_MIN_ZOOM } from "@/lib/map/buildings";
import { BASEMAPS } from "@/lib/basemaps";

/** Relative luminance of a #rrggbb colour (WCAG). */
function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

describe("buildings by height", () => {
  it("colours by the building's own OSM height", () => {
    const expr = buildingColorByHeight();
    expect(expr.slice(0, 3)).toEqual(["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 0]]);
    expect(expr.slice(3)).toEqual(HEIGHT_RAMP.flat());
  });

  it("steps up in height and in lightness, so a taller building never reads darker", () => {
    for (let i = 1; i < HEIGHT_RAMP.length; i++) {
      expect(HEIGHT_RAMP[i][0]).toBeGreaterThan(HEIGHT_RAMP[i - 1][0]);
      expect(luminance(HEIGHT_RAMP[i][1])).toBeGreaterThan(luminance(HEIGHT_RAMP[i - 1][1]));
    }
    for (const [, colour] of HEIGHT_RAMP) expect(colour).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("is solid from one zoom level after the buildings start", () => {
    expect(EYE_BUILDING_OPACITY).toBe(1);
    expect(buildingOpacity()).toEqual(["interpolate", ["linear"], ["zoom"], BUILDINGS_MIN_ZOOM, 0, BUILDINGS_MIN_ZOOM + 0.6, 1]);
  });
});

describe("the sun", () => {
  it("is anchored to the map, stronger and higher than the console's", () => {
    expect(EYE_LIGHT.anchor).toBe("map");
    const [, azimuth, polar] = EYE_LIGHT.position as [number, number, number];
    const [, , consolePolar] = BUILDINGS_LIGHT.position as [number, number, number];
    expect(azimuth).toBeGreaterThan(180); // south-west
    expect(azimuth).toBeLessThan(270);
    expect(polar).toBeLessThan(consolePolar); // 0° is straight overhead
    expect(EYE_LIGHT.intensity).toBeGreaterThan(BUILDINGS_LIGHT.intensity as number);
    expect(EYE_LIGHT.intensity).toBeLessThanOrEqual(1);
  });
});

describe("the imagery grade", () => {
  it("names the satellite style's own raster layer", () => {
    const style = BASEMAPS.satellite.style as { layers: { id: string; type: string }[] };
    expect(style.layers.some((l) => l.id === IMAGERY_LAYER && l.type === "raster")).toBe(true);
  });

  it("stays inside the ranges MapLibre accepts, and darkens rather than brightens", () => {
    expect(IMAGERY_GRADE["raster-saturation"]).toBeGreaterThanOrEqual(-1);
    expect(IMAGERY_GRADE["raster-saturation"]).toBeLessThan(0);
    expect(IMAGERY_GRADE["raster-brightness-max"]).toBeGreaterThan(0);
    expect(IMAGERY_GRADE["raster-brightness-max"]).toBeLessThan(1);
    expect(Math.abs(IMAGERY_GRADE["raster-contrast"])).toBeLessThan(1);
  });
});

describe("eyePaintOps", () => {
  it("touches only the imagery and the buildings", () => {
    const layers = new Set(eyePaintOps().map((op) => op.layer));
    expect([...layers].sort()).toEqual([BUILDING_LAYER, IMAGERY_LAYER].sort());
  });
});

describe("eyeSignalPaintOps", () => {
  const ids = new Set<string>(Object.values(signalLayerIds));
  const COUNTRY_LAYERS = [
    signalLayerIds.SIGNAL_COUNTRY_FILL,
    signalLayerIds.SIGNAL_COUNTRY_OUTLINE,
    signalLayerIds.SIGNAL_RING_LAYER,
    signalLayerIds.SIGNAL_ANCHOR_HIT,
    signalLayerIds.SIGNAL_FIGURE_LAYER,
  ];

  it("touches only layers WorldMap names in lib/map/signalLayerIds.ts, and none of the country layers", () => {
    const touched = new Set(eyeSignalPaintOps().map((op) => op.layer));
    for (const layer of touched) expect(ids.has(layer), layer).toBe(true);
    for (const layer of COUNTRY_LAYERS) expect(touched.has(layer), layer).toBe(false);
    for (const layer of EYE_SIGNAL_SINK) expect(ids.has(layer), layer).toBe(true);
  });

  it("lays the points flat and sinks them under the buildings, and keeps the discs above them", () => {
    const ops = eyeSignalPaintOps();
    const on = (layer: string, property: string) => ops.find((o) => o.layer === layer && o.property === property)?.value;
    expect(on(signalLayerIds.SIGNAL_LAYER, "circle-pitch-alignment")).toBe("map");
    expect(on(signalLayerIds.SIGNAL_LAYER, "circle-stroke-color")).toBe("rgba(6,10,12,0.9)");
    expect(on(signalLayerIds.SIGNAL_ICON_LAYER, "icon-pitch-alignment")).toBe("map");
    expect(EYE_SIGNAL_SINK).toEqual([signalLayerIds.SIGNAL_LAYER, signalLayerIds.SIGNAL_ICON_LAYER]);
    // Areas stay above the buildings: they are never in the sink, only repainted faint and flat.
    expect(EYE_SIGNAL_SINK).not.toContain(signalLayerIds.SIGNAL_DISC_LAYER);
    expect(on(signalLayerIds.SIGNAL_DISC_LAYER, "circle-opacity")).toBe(0.18);
    expect(on(signalLayerIds.SIGNAL_DISC_LAYER, "circle-stroke-opacity")).toBe(0.8);
    expect(on(signalLayerIds.SIGNAL_DISC_LAYER, "circle-pitch-alignment")).toBe("map");
    expect(on(signalLayerIds.SIGNAL_FILL_LAYER, "fill-opacity")).toBe(0.08);
    expect(on(signalLayerIds.SIGNAL_FILL_OUTLINE, "line-width")).toBe(1);
  });

  it("hides both sets of labels: this view names a mark in its own tags", () => {
    const ops = eyeSignalPaintOps();
    for (const layer of [signalLayerIds.SIGNAL_LABEL, signalLayerIds.SIGNAL_ANCHOR_LABEL]) {
      expect(ops.find((o) => o.layer === layer)).toMatchObject({ kind: "layout", property: "visibility", value: "none" });
    }
  });

  it("is a second list: the imagery and buildings pass still touches two layers", () => {
    expect(new Set(eyePaintOps().map((op) => op.layer)).size).toBe(2);
  });

  it("keeps the layer ids' values as WorldMap always had them", () => {
    expect(signalLayerIds.SIGNAL_LAYER).toBe("signal-dots");
    expect(signalLayerIds.SIGNAL_ICON_LAYER).toBe("signal-icons");
    expect(signalLayerIds.SIGNAL_DISC_LAYER).toBe("signal-area-discs");
    expect(signalLayerIds.SIGNAL_FILL_LAYER).toBe("signal-fill-areas");
  });
});
