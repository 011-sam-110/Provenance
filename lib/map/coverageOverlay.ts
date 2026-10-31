// The person's coverage overlay on the console's map: one source and one pair of circle layers, a
// bright core and a soft halo. Nothing here imports MapLibre, so a fake map can test it.
//
// NO COST AT REST. Nothing is added until the first carry or the first toggle, and hiding sets both
// layers to `visibility: none`, which leaves MapLibre nothing to load or draw for this source. The
// source stays, because adding 9,700 points again costs more than keeping them in the worker.
//
// THE COLOUR IS THE PERSON'S OWN, #e8c25a, with a dark edge on the core. Measured against the three
// grounds on 2026-10-31: on satellite and the dark skin the yellow carries itself, and on the pale
// basemap, where it is 1.6:1, the edge carries it. The base map is not faded: Google does not, and
// a carry that dims the world would make the place under the ring harder to read.

/** Classed in NEVER_FADE_SOURCES (lib/map/sourceHighlight.ts): it is on only while it is asked for. */
export const COVERAGE_SRC = "eye-coverage";
export const COVERAGE_HALO = "eye-coverage-halo";
export const COVERAGE_CORE = "eye-coverage-core";
export const COVERAGE_COLOUR = "#e8c25a";

/** The part of a MapLibre map this reads. */
export interface OverlayMap {
  getSource(id: string): { setData?: (data: never) => unknown } | undefined;
  addSource(id: string, source: never): unknown;
  getLayer(id: string): unknown;
  addLayer(layer: never): unknown;
  setLayoutProperty(layer: string, name: string, value: never): unknown;
}

const SQRT_COUNT = ["sqrt", ["get", "c"]];
const byCount = (base: number, per: number) => ["+", base, ["*", per, SQRT_COUNT]];

/** Sizes by count while the map is wide, and one size once the points are single cameras. */
export const CORE_RADIUS = [
  "interpolate",
  ["linear"],
  ["zoom"],
  1,
  byCount(1, 0.12),
  4,
  byCount(1.5, 0.2),
  8,
  byCount(2.2, 0.36),
  9,
  3.5,
  14,
  5,
];
export const HALO_RADIUS = [
  "interpolate",
  ["linear"],
  ["zoom"],
  1,
  byCount(2.6, 0.3),
  4,
  byCount(4, 0.5),
  8,
  byCount(7, 0.9),
  9,
  10,
  14,
  14,
];

function layers(): unknown[] {
  return [
    {
      id: COVERAGE_HALO,
      type: "circle",
      source: COVERAGE_SRC,
      layout: { visibility: "visible" },
      paint: {
        "circle-color": COVERAGE_COLOUR,
        "circle-radius": HALO_RADIUS,
        "circle-opacity": 0.42,
        "circle-blur": 1,
      },
    },
    {
      id: COVERAGE_CORE,
      type: "circle",
      source: COVERAGE_SRC,
      layout: { visibility: "visible" },
      paint: {
        "circle-color": COVERAGE_COLOUR,
        "circle-radius": CORE_RADIUS,
        "circle-stroke-color": "rgba(16, 13, 4, 0.82)",
        // Thin while the dots are small: at whole-world zoom a full edge turned them dark.
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 2, 0.2, 5, 0.5, 8, 0.75],
      },
    },
  ];
}

/** The data each map holds, so the same index is not sent to the worker twice. */
const held = new WeakMap<object, unknown>();

/**
 * Show coverage, adding the source and layers if this style does not hold them: a basemap swap wipes
 * both. Returns false if the style cannot take them yet (it is mid-swap). The caller tries again.
 */
export function showCoverage(map: OverlayMap, data: unknown): boolean {
  try {
    const source = map.getSource(COVERAGE_SRC);
    if (!source) {
      map.addSource(COVERAGE_SRC, { type: "geojson", data, buffer: 16, tolerance: 0 } as never);
      held.set(map, data);
    } else if (held.get(map) !== data) {
      source.setData?.(data as never);
      held.set(map, data);
    }
    for (const layer of layers() as { id: string }[]) {
      if (map.getLayer(layer.id)) map.setLayoutProperty(layer.id, "visibility", "visible" as never);
      else map.addLayer(layer as never);
    }
    return true;
  } catch {
    return false;
  }
}

/** Hide it, at once. Safe on a style that holds none of it. */
export function hideCoverage(map: OverlayMap): void {
  try {
    for (const id of [COVERAGE_HALO, COVERAGE_CORE]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none" as never);
    }
  } catch {
    // A style torn down mid-swap holds nothing to hide.
  }
}
