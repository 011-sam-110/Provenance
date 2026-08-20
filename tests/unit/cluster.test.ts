import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  CAMERA_CLUSTER,
  WEBCAM_CLUSTER,
  CLUSTER_FILL_OPACITY,
  CLUSTER_RADIUS_TIERS,
  CLUSTER_TEXT_ZOOM_SCALE,
  CLUSTER_ZOOM_SCALE,
  clusterRadiusAt,
  clusterRadiusForCount,
  nextClusterZoom,
  rampAt,
  clusterRadiusExpression,
  clusterTextSizeExpression,
  scaledStepExpression,
} from "@/lib/map/cluster";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { toPlaneFC } from "@/lib/map/features";

test("cluster config is sane (positive radius, splits before max map zoom)", () => {
  for (const cfg of [CAMERA_CLUSTER, WEBCAM_CLUSTER]) {
    expect(cfg.clusterRadius).toBeGreaterThan(0);
    expect(cfg.clusterMaxZoom).toBeGreaterThan(0);
    expect(cfg.clusterMaxZoom).toBeLessThan(18); // map maxZoom — clusters fully split before then
  }
});

test("clusterRadiusForCount picks the largest tier whose min ≤ count", () => {
  expect(clusterRadiusForCount(1)).toBe(15); // base tier
  expect(clusterRadiusForCount(24)).toBe(15);
  expect(clusterRadiusForCount(25)).toBe(19); // boundary, inclusive
  expect(clusterRadiusForCount(99)).toBe(19);
  expect(clusterRadiusForCount(100)).toBe(24);
  expect(clusterRadiusForCount(749)).toBe(24);
  expect(clusterRadiusForCount(750)).toBe(30);
  expect(clusterRadiusForCount(13_000)).toBe(30);
});

test("radius tiers are strictly ascending in both min and radius (monotonic ramp)", () => {
  for (let i = 1; i < CLUSTER_RADIUS_TIERS.length; i++) {
    expect(CLUSTER_RADIUS_TIERS[i][0]).toBeGreaterThan(CLUSTER_RADIUS_TIERS[i - 1][0]);
    expect(CLUSTER_RADIUS_TIERS[i][1]).toBeGreaterThan(CLUSTER_RADIUS_TIERS[i - 1][1]);
  }
});

test("nextClusterZoom never zooms out and always makes progress", () => {
  expect(nextClusterZoom(8, 5)).toBe(8); // expansion zoom ahead → use it
  expect(nextClusterZoom(5, 5)).toBe(5.5); // max-zoom cluster → nudge in by 0.5
  expect(nextClusterZoom(3, 6)).toBe(6.5); // never go backwards
});

test("planes are NOT clustered — plane features never carry a point_count", () => {
  const fc = toPlaneFC([
    { kind: "plane", id: "plane:abc", lat: 51, lon: 0, label: "BAW1", heading: 90 },
    { kind: "plane", id: "plane:def", lat: 51.1, lon: 0.1, label: "BAW2", heading: 180 },
  ]);
  for (const f of fc.features) {
    expect(f.properties).not.toHaveProperty("point_count");
    expect(f.properties).not.toHaveProperty("cluster_id");
  }
});

// ---------------------------------------------------------------------------
// Zoom-aware sizing. The investigator asked for a 30px cap and 0.7 opacity; the
// cap was ALREADY 30px, which is why the badges still covered the map. Radius is
// what changed, and only below z5.
// ---------------------------------------------------------------------------

test("rampAt clamps at both ends and interpolates linearly between stops", () => {
  const ramp = [
    [0, 0.5],
    [3, 0.72],
    [5, 1],
  ] as const;
  expect(rampAt(ramp, -4)).toBe(0.5); // below the first stop → clamped
  expect(rampAt(ramp, 0)).toBe(0.5);
  expect(rampAt(ramp, 1.5)).toBeCloseTo(0.61, 5); // midpoint of 0.5→0.72
  expect(rampAt(ramp, 3)).toBe(0.72);
  expect(rampAt(ramp, 4)).toBeCloseTo(0.86, 5);
  expect(rampAt(ramp, 5)).toBe(1);
  expect(rampAt(ramp, 17)).toBe(1); // above the last stop → clamped, never grows
});

test("cluster badges shrink at world zoom and are full size from z5 up", () => {
  // The regression this exists for: at the default world zoom a 750+ cluster
  // painted the same 30px disc it paints at street level.
  expect(clusterRadiusAt(1000, 0)).toBe(15);
  expect(clusterRadiusAt(1000, 5)).toBe(30);
  expect(clusterRadiusAt(1000, 12)).toBe(30); // never larger than the designed cap
  // Every tier is strictly smaller at world zoom than at z5.
  for (const [min] of CLUSTER_RADIUS_TIERS) {
    expect(clusterRadiusAt(min, 0)).toBeLessThan(clusterRadiusAt(min, 5));
  }
});

test("the zoom scale only ever shrinks — it can never inflate a badge past its tier", () => {
  for (let z = 0; z <= 18; z += 0.5) {
    expect(rampAt(CLUSTER_ZOOM_SCALE, z)).toBeLessThanOrEqual(1);
    expect(rampAt(CLUSTER_TEXT_ZOOM_SCALE, z)).toBeLessThanOrEqual(1);
  }
});

test("the count label never outgrows its own disc", () => {
  // A 3-char count ("13k") needs roughly 1.1x the text size in half-width. If the
  // label scaled with the disc it would spill out of the shrunken world-zoom badge.
  for (let z = 0; z <= 5; z += 0.5) {
    const radius = clusterRadiusAt(13_000, z);
    const size = 15 * rampAt(CLUSTER_TEXT_ZOOM_SCALE, z);
    expect(size * 1.1).toBeLessThan(radius * 2);
  }
});

test("opacity is the number the investigator actually asked for", () => {
  expect(CLUSTER_FILL_OPACITY).toBe(0.7);
});

// ---------------------------------------------------------------------------
// The guard cluster.ts USED to claim in a comment and never had. Both cluster
// layer pairs in WorldMap must be built from the exported ramps, not retyped —
// that is how the camera ramp (15/19/24/30) and the webcam ramp (14/18/23/29)
// drifted a pixel apart at every tier without anything going red.
// ---------------------------------------------------------------------------

test("WorldMap builds its cluster paint from this module, never hand-typed", () => {
  const src = readFileSync(
    join(process.cwd(), "components", "WorldMap.tsx"),
    "utf8",
  );
  // Both circle layers and both label layers reference the shared expressions.
  expect(src.match(/"circle-radius": CLUSTER_RADIUS_PAINT/g)).toHaveLength(2);
  expect(src.match(/"text-size": CLUSTER_TEXT_PAINT/g)).toHaveLength(2);
  expect(src.match(/"circle-opacity": CLUSTER_FILL_OPACITY/g)).toHaveLength(2);
  // And no literal step ramp keyed on point_count survives anywhere in the file.
  expect(src).not.toMatch(/\["step", \["get", "point_count"\]/);
});

test("scaledStepExpression scales every tier and rounds off binary-float noise", () => {
  expect(scaledStepExpression(CLUSTER_RADIUS_TIERS, 1)).toEqual([
    "step", ["get", "point_count"], 15, 25, 19, 100, 24, 750, 30,
  ]);
  // 15 * 0.72 is 10.799999999999999 in IEEE754; the expression must not carry that.
  expect(scaledStepExpression(CLUSTER_RADIUS_TIERS, 0.72)).toEqual([
    "step", ["get", "point_count"], 10.8, 25, 13.68, 100, 17.28, 750, 21.6,
  ]);
});

test("the zoom ramp is the OUTER expression, with the count tiers nested inside", () => {
  const expr = clusterRadiusExpression() as unknown[];
  expect(expr[0]).toBe("interpolate");
  expect(expr[2]).toEqual(["zoom"]); // top level, which is the only legal place
  // Full size at z5 — the designed tiers, untouched.
  expect(expr[expr.length - 1]).toEqual([
    "step", ["get", "point_count"], 15, 25, 19, 100, 24, 750, 30,
  ]);
});

// ---------------------------------------------------------------------------
// THE GUARD THAT WOULD HAVE CAUGHT THE BUG.
//
// The first version of this paint multiplied a zoom `interpolate` by a
// point_count `step`. MapLibre forbids that — "zoom" may only be the input to a
// TOP-LEVEL step/interpolate — and the way it refuses is the problem: no throw,
// nothing on the console, just a message on the map's `error` event and the
// layer quietly not added. tsc was clean, every unit test was green, and the map
// shipped with no cluster badges on it whatsoever.
//
// createExpression() does NOT enforce the rule and calls the illegal form valid.
// validateStyleMin() — the validator the map itself runs — does.
// ---------------------------------------------------------------------------

/** A minimal style carrying one clustered source and both cluster layer pairs. */
function styleWithClusterLayers() {
  return {
    version: 8 as const,
    sources: {
      cameras: {
        type: "geojson" as const,
        data: { type: "FeatureCollection" as const, features: [] },
        cluster: true,
        clusterRadius: CAMERA_CLUSTER.clusterRadius,
        clusterMaxZoom: CAMERA_CLUSTER.clusterMaxZoom,
      },
    },
    layers: [
      {
        id: "camera-clusters",
        type: "circle" as const,
        source: "cameras",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#0ea5e9",
          "circle-opacity": CLUSTER_FILL_OPACITY,
          "circle-radius": clusterRadiusExpression(),
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
          "circle-stroke-opacity": 0.9,
        },
      },
      {
        id: "camera-cluster-count",
        type: "symbol" as const,
        source: "cameras",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Open Sans Regular"],
          "text-size": clusterTextSizeExpression(),
          "text-allow-overlap": true,
        },
        paint: { "text-color": "#ffffff" },
      },
    ],
  };
}

test("MapLibre's own validator accepts the cluster layers as built", () => {
  const errors = validateStyleMin(styleWithClusterLayers() as never);
  expect(errors.map((e) => e.message)).toEqual([]);
});

test("...and REJECTS the multiply form, which is why the shape above is what it is", () => {
  const style = styleWithClusterLayers();
  // The exact expression that shipped broken: zoom ramp x count tiers.
  style.layers[0].paint["circle-radius"] = [
    "*",
    ["interpolate", ["linear"], ["zoom"], 0, 0.5, 3, 0.72, 5, 1],
    ["step", ["get", "point_count"], 15, 25, 19, 100, 24, 750, 30],
  ] as never;
  const errors = validateStyleMin(style as never);
  expect(errors).toHaveLength(1);
  expect(errors[0].message).toContain(
    '"zoom" expression may only be used as input to a top-level "step" or "interpolate"',
  );
});
