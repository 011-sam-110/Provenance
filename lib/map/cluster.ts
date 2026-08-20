// Smart marker clustering for the unified MapLibre engine.
//
// ~13k camera markers render as dot-soup when zoomed out. MapLibre's GeoJSON
// sources cluster natively, so the camera + webcam sources opt in here and
// WorldMap renders cluster circle + count layers on top of them. This module
// holds the (pure, testable) tuning + the cluster-expand interaction; the actual
// `step`/`circle` paint lives inline in WorldMap (it must be a literal to satisfy
// MapLibre's expression types), and mirrors CLUSTER_RADIUS_TIERS below.
//
// Per-type policy (per the smart-marker-clustering PRD): cameras + webcams
// cluster; planes + their trails stay individual (so headings/breadcrumbs read);
// satellites are never clustered. Only the camera + webcam sources set `cluster`.

import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";

/**
 * Cluster tuning shared by the camera + webcam sources.
 * - `clusterRadius` (px): merge markers within this screen distance.
 * - `clusterMaxZoom`: above this zoom every point is individual (clusters split
 *   fully apart), so the detailed icons (minzoom 5) take over on descent.
 */
export const CAMERA_CLUSTER = { clusterRadius: 50, clusterMaxZoom: 11 } as const;
export const WEBCAM_CLUSTER = { clusterRadius: 50, clusterMaxZoom: 11 } as const;

/**
 * point_count → soft circle radius (px) at z5 and above. The inline paint in
 * WorldMap is BUILT from this via {@link stepExpression} rather than retyped, so
 * the two cannot drift; before that they were two hand-written copies under a
 * comment claiming a guard that had never been written.
 * Tiers grow gently so density reads at a glance without shouting (calm-light).
 */
export const CLUSTER_RADIUS_TIERS: ReadonlyArray<readonly [min: number, radius: number]> = [
  [0, 15],
  [25, 19],
  [100, 24],
  [750, 30],
];

/** Largest tier whose `min` ≤ count → the cluster circle radius (px). Pure. */
export function clusterRadiusForCount(count: number): number {
  let radius = CLUSTER_RADIUS_TIERS[0][1];
  for (const [min, r] of CLUSTER_RADIUS_TIERS) if (count >= min) radius = r;
  return radius;
}

/**
 * Zoom → multiplier on the tier radius, and WHY the tiers alone were not enough.
 *
 * The tiers above are SCREEN pixels and were zoom-invariant, so one badge covered
 * a suburb at z9 and half a continent at z0. An OSINT investigator reviewing the
 * console put it plainly: the clusters "tapan toda la geografía". His prescription
 * was a 30px cap and 0.7 opacity — and BOTH were already in the code, which is the
 * tell that the cap was never the mechanism. Measured with queryRenderedFeatures
 * over the Europe rect: 51.9% of it sat under an opaque badge at the default world
 * zoom, against 2.8% at z5. Same badge, same 30px, two orders of consequence.
 *
 * So the size has to fall away with the zoom, not with the count. Below z5 the
 * ramp shrinks; from z5 up (where the detailed icons take over at minzoom 5) it is
 * the full designed size and nothing about the close-in read changes.
 */
/** point_count → count-label size (px) at z5 and above. Mirrored the same way. */
export const CLUSTER_TEXT_TIERS: ReadonlyArray<readonly [min: number, size: number]> = [
  [0, 11],
  [100, 13],
  [750, 15],
];

export const CLUSTER_ZOOM_SCALE: ReadonlyArray<readonly [zoom: number, scale: number]> = [
  [0, 0.5],
  [3, 0.72],
  [5, 1],
];

/**
 * The count label shrinks too — but not as far, or a 3-character count spills out
 * of its own disc. Floored at 0.8 so "13k" still reads at world zoom.
 */
export const CLUSTER_TEXT_ZOOM_SCALE: ReadonlyArray<readonly [zoom: number, scale: number]> = [
  [0, 0.8],
  [5, 1],
];

/** Pure: piecewise-linear interpolation over a [stop, value] ramp, clamped at both ends. */
export function rampAt(
  ramp: ReadonlyArray<readonly [number, number]>,
  x: number,
): number {
  if (x <= ramp[0][0]) return ramp[0][1];
  const last = ramp[ramp.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < ramp.length; i++) {
    const [x0, y0] = ramp[i - 1];
    const [x1, y1] = ramp[i];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return last[1];
}

/** Pure: the radius (px) a cluster of `count` actually paints at `zoom`. */
export function clusterRadiusAt(count: number, zoom: number): number {
  return clusterRadiusForCount(count) * rampAt(CLUSTER_ZOOM_SCALE, zoom);
}

/**
 * Fill opacity for the badge. 0.7 is the investigator's number, taken as given:
 * at this radius the white count still clears contrast on every basemap, and the
 * coastline under the badge stays legible — which was the whole complaint.
 */
export const CLUSTER_FILL_OPACITY = 0.7;

/** A MapLibre `interpolate` expression mirroring one of the zoom ramps above. */
export function zoomScaleExpression(
  ramp: ReadonlyArray<readonly [number, number]>,
): unknown[] {
  return ["interpolate", ["linear"], ["zoom"], ...ramp.flatMap(([z, s]) => [z, s])];
}

/** A MapLibre `step` expression mirroring a [min, value] ramp keyed on point_count. */
export function stepExpression(
  ramp: ReadonlyArray<readonly [number, number]>,
): unknown[] {
  const [, base] = ramp[0];
  return ["step", ["get", "point_count"], base, ...ramp.slice(1).flatMap(([min, v]) => [min, v])];
}

/**
 * Where to ease the camera when splitting a cluster: never zoom out, and always
 * make at least a little progress even if the cluster's expansion zoom is the
 * current zoom (e.g. a max-zoom cluster). Pure → unit-tested.
 */
export function nextClusterZoom(expansionZoom: number, currentZoom: number): number {
  return Math.max(expansionZoom, currentZoom + 0.5);
}

/**
 * Click-a-cluster behaviour: query MapLibre for the zoom at which this cluster
 * splits, then ease the camera into it. Thin DOM/map shell over the pure
 * {@link nextClusterZoom}; degrades to a fixed zoom-in if the query fails.
 */
export async function expandCluster(
  map: MapLibreMap,
  sourceId: string,
  clusterId: number,
  center: [number, number],
): Promise<void> {
  const src = map.getSource(sourceId) as GeoJSONSource | undefined;
  if (!src || typeof src.getClusterExpansionZoom !== "function") return;
  try {
    const zoom = await src.getClusterExpansionZoom(clusterId);
    map.easeTo({ center, zoom: nextClusterZoom(zoom, map.getZoom()), duration: 600 });
  } catch {
    map.easeTo({ center, zoom: map.getZoom() + 2, duration: 600 });
  }
}
