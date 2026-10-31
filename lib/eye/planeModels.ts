// The God's eye view's aircraft models, the pure half: no DOM, no three. Which model a plane
// gets, how long it is drawn, how high it is drawn and what the camera can see.
// components/eye/planeLayer.ts is the three.js half and reads every number from here.
// Pinned by tests/unit/eye-plane-models.test.ts.
//
// THE MODELS are built from each type's published dimensions by scripts/plane-models/build.py
// (public/models/planes/<id>.glb, packed with gltfpack). Their sources are in
// scripts/plane-models/dimensions.json and docs/IMAGE-LICENSES.md. A file holds two meshes named
// `lod0` and `lod1`, its length along its own Z axis is exactly 1, the nose points to -Z, its
// fuselage's centre line is y = 0 (glTF's Y is up), and each vertex carries its colour.
//
// A TYPE THE TABLE DOES NOT HOLD GETS A PLAIN MODEL, NEVER A NAMED ONE. The plain models have no
// engines, so they make no claim about what the aircraft is, and they are drawn at the floor
// size, a mark and not a measurement: the vessels' `plain` hull's rule.
//
// THE HEIGHT IS CAPPED, AND SAYS SO. At the view's opening zoom the camera is about 500 m up, and
// 78% of aircraft are above 3 km (measured 2026-10-31), so at true height almost every plane is
// behind the camera. A plane is drawn at its reported height up to HEIGHT_CAP_SHARE of the
// camera's height, and higher ones at that cap. Its spot on the map never moves: a thin line runs
// down to it. The tag and the details panel always give the height it reported, and the panel
// says when the plane is drawn lower than that (lib/eye/detail.ts).

import { PLANE_TYPES } from "@/lib/eye/planeTypes.data";
import { metresPerMercatorUnit } from "@/lib/eye/vesselModels";

export { LOD1_BELOW_PX, MIN_DRAWN_PX } from "@/lib/eye/vesselModels";

export const PLAIN_MODELS = ["plain-jet", "plain-light", "plain-heli"] as const;
export type PlainModel = (typeof PLAIN_MODELS)[number];

/** A plane is drawn no higher than this share of the camera's height above the ground. */
export const HEIGHT_CAP_SHARE = 0.5;
/** A point nearer the camera than this, in metres along the view, is not drawn. */
export const NEAREST_DRAWN_M = 20;
export const METRES_PER_FOOT = 0.3048;
/** The ring on a plane's real spot, as a radius in px on the ground. */
export const RING_RADIUS_PX = 9;

export const planeModelFile = (model: string): string => `/models/planes/${model}.glb`;

/** The plain model for a class label ("Airliner", "Regional", "Light", "Helicopter"), or for none. */
export function plainModelFor(classLabel?: string): PlainModel {
  if (classLabel === "Helicopter") return "plain-heli";
  if (classLabel === "Light") return "plain-light";
  return "plain-jet";
}

export interface PlaneModelChoice {
  model: string;
  /** True length in metres from the type's published figure, or 0 when the type is unknown. */
  lengthM: number;
  /** True when the model is of this type or its closest listed type, not a plain one. */
  named: boolean;
}

/** Which model a plane gets. The type code is what the feed sent, and upper case in the table. */
export function planeModelFor(a: { typeCode?: string; classLabel?: string }): PlaneModelChoice {
  const row = a.typeCode ? PLANE_TYPES[a.typeCode.trim().toUpperCase()] : undefined;
  if (row) return { model: row.model, lengthM: row.lengthM, named: true };
  return { model: plainModelFor(a.classLabel), lengthM: 0, named: false };
}

/** What the camera is doing, in metres from the view's centre, east, north and up. */
export interface ViewGeometry {
  /** Screen pixels per metre at the view's centre on the ground. */
  groundPxPerMetre: number;
  /** Pixels from the eye to the screen. One metre, `d` metres from the eye, is `focalPx / d` px long. */
  focalPx: number;
  /** The camera's height above the ground, metres. */
  cameraHeightM: number;
  camera: { east: number; north: number; up: number };
  /** A unit vector along the view. */
  forward: { east: number; north: number; up: number };
}

/**
 * Pure: the camera, from what the map says. MapLibre puts it `focalPx` screen pixels from the
 * view's centre (`cameraToCenterDistance`), so its distance in metres is that over the ground
 * scale, tipped back by the pitch and away from the bearing.
 */
export function viewGeometry(view: {
  heightPx: number;
  fovDeg: number;
  zoom: number;
  lat: number;
  pitchDeg: number;
  bearingDeg: number;
}): ViewGeometry {
  const DEG = Math.PI / 180;
  const focalPx = (0.5 / Math.tan((view.fovDeg * DEG) / 2)) * view.heightPx;
  const groundPxPerMetre = (512 * 2 ** view.zoom) / metresPerMercatorUnit(view.lat);
  const distance = focalPx / groundPxPerMetre;
  const pitch = view.pitchDeg * DEG;
  const bearing = view.bearingDeg * DEG;
  const forward = { east: Math.sin(bearing) * Math.sin(pitch), north: Math.cos(bearing) * Math.sin(pitch), up: -Math.cos(pitch) };
  return {
    groundPxPerMetre,
    focalPx,
    cameraHeightM: distance * Math.cos(pitch),
    camera: { east: -forward.east * distance, north: -forward.north * distance, up: -forward.up * distance },
    forward,
  };
}

/** Pure: how far along the view a point is from the camera, metres. At or below zero it is behind. */
export function depthAlongView(view: ViewGeometry, east: number, north: number, up: number): number {
  return (
    (east - view.camera.east) * view.forward.east +
    (north - view.camera.north) * view.forward.north +
    (up - view.camera.up) * view.forward.up
  );
}

export interface DrawnHeight {
  heightM: number;
  /** "lowered": drawn lower than it reported. "unsent": it reported no height, so the cap is a stand-in. */
  note: "lowered" | "unsent" | null;
}

/** Pure: how high a plane is drawn. Reported height up to the cap, the cap above it or with none sent. */
export function drawnHeightM(feet: number | null, cameraHeightM: number): DrawnHeight {
  const cap = Math.max(cameraHeightM, 0) * HEIGHT_CAP_SHARE;
  if (feet == null || !Number.isFinite(feet)) return { heightM: cap, note: "unsent" };
  const real = Math.max(feet, 0) * METRES_PER_FOOT;
  return real > cap ? { heightM: cap, note: "lowered" } : { heightM: real, note: null };
}

/** Pure: how long, in metres, a plane is drawn: its true length, but at least `minPx` at its depth. */
export function drawnPlaneLengthM(lengthM: number, depth: number, view: ViewGeometry, minPx: number): number {
  const pxPerMetre = view.focalPx / Math.max(depth, NEAREST_DRAWN_M);
  return Math.max(lengthM, minPx / pxPerMetre);
}
