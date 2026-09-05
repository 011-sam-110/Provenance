import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { StyleSpecification } from "maplibre-gl";
import { describe, expect, test } from "vitest";
import { BASEMAPS, type BasemapKey } from "@/lib/basemaps";
import { LABEL_MIN_ZOOM, MAPLIBRE_DEFAULT_MAXZOOM, RELIEF_MIN_ZOOM, layersToTrim } from "@/lib/map/styleTrim";

/**
 * `tests/fixtures/liberty-style.captured.json` is a verbatim capture of
 * https://tiles.openfreemap.org/styles/liberty taken on 2026-09-04, the style the
 * console actually loads (lib/basemaps.ts, DEFAULT_BASEMAP = "streets").
 *
 * It is committed because the trim decision is made against layer ids and source
 * definitions we do NOT own. If OpenFreeMap renames `natural_earth` or moves the
 * country labels, the right outcome is this test going red rather than the saving
 * silently evaporating in production — the fetch would simply come back and nothing
 * else would look wrong.
 *
 * Re-capture with:
 *   curl -s https://tiles.openfreemap.org/styles/liberty -o tests/fixtures/liberty-style.captured.json
 */
const liberty = JSON.parse(
  readFileSync(resolve(__dirname, "../fixtures/liberty-style.captured.json"), "utf8"),
) as StyleSpecification;

describe("layersToTrim against the real Liberty style", () => {
  test("raises the Natural Earth relief layer and nothing else raster", () => {
    const relief = layersToTrim(liberty).filter((t) => t.minzoom === RELIEF_MIN_ZOOM);
    // maxzoom 7 is Liberty's own ceiling and must survive the trim: above it the
    // vector landcover takes over, and a Natural Earth raster drawn over street-level
    // tiles is what dropping it would look like.
    expect(relief).toEqual([{ id: "natural_earth", minzoom: RELIEF_MIN_ZOOM, maxzoom: 7 }]);
  });

  test("raises exactly the label layers that draw below z2", () => {
    const labels = layersToTrim(liberty)
      .filter((t) => t.minzoom === LABEL_MIN_ZOOM)
      .map((t) => t.id)
      .sort();
    // The two country-name layers are the Noto Sans Bold cost (15 glyph ranges on
    // first paint); the two water-name layers are the Italic one.
    expect(labels).toEqual([
      "label_country_1",
      "label_country_2",
      "poi_transit",
      "water_name_line_label",
      "water_name_point_label",
    ]);
  });

  test("leaves every other layer alone", () => {
    // 111 layers in, 6 trimmed. If this number moves, the style changed upstream and
    // the two assertions above should be read before it is updated.
    expect(liberty.layers).toHaveLength(111);
    expect(layersToTrim(liberty)).toHaveLength(6);
  });

  test("does not mutate the style, and never touches sources", () => {
    const before = JSON.stringify(liberty);
    layersToTrim(liberty);
    expect(JSON.stringify(liberty)).toBe(before);
  });

  /**
   * This is the assertion that justifies carrying `maxzoom` at all, and it is not
   * hypothetical: the two country-label layers stop at z9 in Liberty. A trim that
   * called setLayerZoomRange(id, 2) without the ceiling would reset them to
   * MapLibre's default 24 and leave country names drawn over street-level tiles —
   * a visible regression produced by a performance fix, with nothing to point at.
   */
  test("each trimmed layer keeps its own ceiling, defaulting only where it has none", () => {
    const byId = new Map(layersToTrim(liberty).map((t) => [t.id, t.maxzoom]));
    expect(byId.get("label_country_1")).toBe(9);
    expect(byId.get("label_country_2")).toBe(9);
    expect(byId.get("natural_earth")).toBe(7);
    expect(byId.get("water_name_point_label")).toBe(MAPLIBRE_DEFAULT_MAXZOOM);
    expect(byId.get("water_name_line_label")).toBe(MAPLIBRE_DEFAULT_MAXZOOM);
    expect(byId.get("poi_transit")).toBe(MAPLIBRE_DEFAULT_MAXZOOM);
  });

  test("is idempotent — a style already trimmed asks for no further trims", () => {
    const trims = new Map(layersToTrim(liberty).map((t) => [t.id, t.minzoom]));
    const trimmed = {
      ...liberty,
      layers: liberty.layers.map((l) => (trims.has(l.id) ? { ...l, minzoom: trims.get(l.id) } : l)),
    } as StyleSpecification;
    expect(layersToTrim(trimmed)).toEqual([]);
  });
});

/**
 * THE TRAP THIS GUARDS. Dark, Satellite and Topographic are inline
 * StyleSpecifications whose entire visible content is ONE raster layer. A trim rule
 * loose enough to catch Liberty's relief by type alone would give those layers a
 * minzoom of 3 and blank the basemap completely at globe zoom — where the console
 * opens. There would be no error, just a black sphere.
 */
describe("the inline raster basemaps are left completely alone", () => {
  // Dark left the registry with the console's dark skin; Esri and OpenTopoMap are
  // the inline styles that remain.
  const inlineKeys: BasemapKey[] = ["satellite", "topo"];

  for (const key of inlineKeys) {
    test(`${key} is untouched`, () => {
      const style = BASEMAPS[key].style;
      expect(typeof style).not.toBe("string");
      expect(layersToTrim(style as StyleSpecification)).toEqual([]);
    });
  }

  test("a raster basemap layer is not mistaken for relief", () => {
    // Esri's imagery is a raster layer on a raster source, exactly like Liberty's
    // relief. Only the tile URL tells them apart.
    const esri = BASEMAPS.satellite.style as StyleSpecification;
    expect(esri.layers.some((l) => l.type === "raster")).toBe(true);
    expect(layersToTrim(esri)).toEqual([]);
  });
});

describe("degenerate input", () => {
  test.each([
    ["undefined", undefined],
    ["null", null],
  ])("%s returns no trims", (_label, style) => {
    expect(layersToTrim(style as undefined)).toEqual([]);
  });

  test("a style with no layers returns no trims", () => {
    expect(layersToTrim({ version: 8, sources: {}, layers: [] } as StyleSpecification)).toEqual([]);
  });

  test("a symbol layer that already starts late is not lowered", () => {
    const style = {
      version: 8,
      sources: { v: { type: "vector", url: "https://example.test/tiles.json" } },
      layers: [{ id: "late", type: "symbol", source: "v", minzoom: 9 }],
    } as unknown as StyleSpecification;
    expect(layersToTrim(style)).toEqual([]);
  });
});
