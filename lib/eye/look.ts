// The God's eye view's look: the same keyless ground and buildings the console loads,
// repainted. Pure values only; components/eye/EyeApp.tsx turns them into MapLibre
// calls once WorldMap has its own layers in place (WorldMap's `onStyleReady`), so
// neither paint undoes the other. Pinned by tests/unit/eye-look.test.ts.
//
// NOTHING NEW IS DOWNLOADED. The imagery is the console's Esri World Imagery and the
// buildings are its OpenFreeMap extrusions (lib/map/buildings.ts), from zoom 14 as
// there. The grade runs on the GPU as raster paint; the colours are an expression
// over each building's own OSM height.
//
// NO ANTI-ALIASING here either. lib/map/buildings.ts has the measurement: it took a
// rotating city from an 8.4 ms to a 25 ms median frame on the console's laptop.

import type { LightSpecification } from "maplibre-gl";
import { BUILDING_LAYER, BUILDINGS_MIN_ZOOM } from "@/lib/map/buildings";

/** The Esri raster layer in the satellite style (lib/basemaps.ts). */
export const IMAGERY_LAYER = "esri-imagery";

/**
 * Night-operations grade for the photograph: less colour, a lower white point, a
 * little more contrast. The cards and tags sit on dark plates over it, and the
 * plates read cleaner over a cool, dark ground than over a bright afternoon roof.
 */
export const IMAGERY_GRADE = {
  "raster-saturation": -0.42,
  "raster-brightness-max": 0.74,
  "raster-contrast": 0.16,
} as const;

/**
 * Building colour by OSM `render_height`, in metres. Low blocks stay dark so the
 * street grid and the river read first; towers lift out lighter. The stops are the
 * data's heights, not decoration: two buildings of one height always match.
 */
export const HEIGHT_RAMP: readonly (readonly [number, string])[] = [
  [0, "#141c22"],
  [20, "#1f2d36"],
  [45, "#2f4452"],
  [90, "#4a6677"],
  [160, "#7896a8"],
];

/** The `fill-extrusion-color` expression for HEIGHT_RAMP. */
export function buildingColorByHeight(): unknown[] {
  return ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 0], ...HEIGHT_RAMP.flat()];
}

/** Solid: a frosted tower over a photograph reads as glass, not as a building. */
export const EYE_BUILDING_OPACITY = 1;

/** The opacity expression: the console's fade-in over one zoom level, to solid. */
export function buildingOpacity(): unknown[] {
  return ["interpolate", ["linear"], ["zoom"], BUILDINGS_MIN_ZOOM, 0, BUILDINGS_MIN_ZOOM + 0.6, EYE_BUILDING_OPACITY];
}

/**
 * A stronger sun than the console's (BUILDINGS_LIGHT: intensity 0.5 from 45°), from
 * the south-west and higher in the sky (polar 35°, where 0° is straight overhead).
 * Anchored to the MAP, so it is a sun: when the view turns, the shade stays on the
 * walls that face away from it.
 */
export const EYE_LIGHT: LightSpecification = {
  anchor: "map",
  position: [1.4, 215, 35],
  color: "#ffffff",
  intensity: 0.62,
};

/** One MapLibre paint write. */
export interface PaintOp {
  layer: string;
  property: string;
  value: unknown;
}

/** Every paint write the look makes, in order. Layers a style lacks are skipped by the caller. */
export function eyePaintOps(): PaintOp[] {
  const ops: PaintOp[] = Object.entries(IMAGERY_GRADE).map(([property, value]) => ({
    layer: IMAGERY_LAYER,
    property,
    value,
  }));
  ops.push(
    { layer: BUILDING_LAYER, property: "fill-extrusion-color", value: buildingColorByHeight() },
    { layer: BUILDING_LAYER, property: "fill-extrusion-opacity", value: buildingOpacity() },
    { layer: BUILDING_LAYER, property: "fill-extrusion-vertical-gradient", value: true },
  );
  return ops;
}
