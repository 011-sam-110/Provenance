// The God's eye view's vessel models, the pure half: no DOM, no three. Which of the ten
// models a vessel gets, how long it is drawn, where it stands and how it is lit.
// components/eye/vesselLayer.ts is the three.js half and reads every number from here.
// Pinned by tests/unit/eye-vessel-models.test.ts.
//
// THE TEN CLASSES are the AIS ship-type groups `shipTypeLabel` (lib/signals/aisDigitraffic.ts)
// can name, plus `plain`: a bare hull for a vessel that sent no type, a military one, and
// anything not listed. An untyped boat is NEVER drawn as cargo, so the default is `plain`.
//
// THE MODELS are stylised and untextured, made once by scripts/vessel-models/bake.py and
// packed with gltfpack (public/models/vessels/<class>.glb). Their licences are in
// docs/IMAGE-LICENSES.md. Each file holds two meshes named `lod0` (at most 1,200
// triangles) and `lod1` (at most 250), the length along its own Z axis is exactly 1, the
// bow points to -Z, the waterline is y = 0 (glTF's Y is up), and each vertex carries its
// colour (COLOR_0, linear), so a model needs no material of its own.

import { EYE_LIGHT, HEIGHT_RAMP } from "@/lib/eye/look";

export type VesselModelClass =
  | "cargo"
  | "tanker"
  | "passenger"
  | "highspeed"
  | "tug"
  | "service"
  | "fishing"
  | "sailing"
  | "pleasure"
  | "plain";

/** Every class, in the order the review sheet shows them. */
export const VESSEL_MODEL_CLASSES: readonly VesselModelClass[] = [
  "cargo",
  "tanker",
  "passenger",
  "highspeed",
  "tug",
  "service",
  "fishing",
  "sailing",
  "pleasure",
  "plain",
];

/**
 * The class a ship type label belongs to. `type` is what `shipTypeLabel` says
 * ("cargo", "tanker", "passenger", "high-speed craft", "towing", "dredging", "tug",
 * "pilot", "search and rescue", "law enforcement", "fishing", "sailing", "pleasure craft",
 * "military") or undefined. Anything else, military included, is `plain`.
 */
export function modelClassFor(type?: string): VesselModelClass {
  switch (type) {
    case "cargo":
      return "cargo";
    case "tanker":
      return "tanker";
    case "passenger":
      return "passenger";
    case "high-speed craft":
      return "highspeed";
    case "tug":
    case "towing":
    case "dredging":
      return "tug";
    case "pilot":
    case "search and rescue":
    case "law enforcement":
      return "service";
    case "fishing":
      return "fishing";
    case "sailing":
      return "sailing";
    case "pleasure craft":
      return "pleasure";
    default:
      return "plain";
  }
}

export const VESSEL_MODEL_FILES: Record<VesselModelClass, string> = {
  cargo: "/models/vessels/cargo.glb",
  tanker: "/models/vessels/tanker.glb",
  passenger: "/models/vessels/passenger.glb",
  highspeed: "/models/vessels/highspeed.glb",
  tug: "/models/vessels/tug.glb",
  service: "/models/vessels/service.glb",
  fishing: "/models/vessels/fishing.glb",
  sailing: "/models/vessels/sailing.glb",
  pleasure: "/models/vessels/pleasure.glb",
  plain: "/models/vessels/plain.glb",
};

/** On screen a vessel is never drawn shorter than this, so a far or unmeasured one stays a mark. */
export const MIN_DRAWN_PX = 28;
/** Under this many pixels long, a vessel uses the 250-triangle mesh. */
export const LOD1_BELOW_PX = 48;
/** A vessel that is not under way is drawn at this fraction of its colours' brightness. */
export const STOPPED_TINT = 0.62;
/** An AIS length outside this range, in metres, is a mistake and is ignored. */
export const LENGTH_RANGE_M: readonly [number, number] = [2, 460];

/** The AIS length when it is believable, else 0. */
export function plausibleLengthM(lengthM: number | undefined): number {
  if (typeof lengthM !== "number" || !Number.isFinite(lengthM)) return 0;
  return lengthM >= LENGTH_RANGE_M[0] && lengthM <= LENGTH_RANGE_M[1] ? lengthM : 0;
}

/**
 * How long, in metres, a vessel is drawn: its true length, but at least MIN_DRAWN_PX on
 * screen. An unknown length is the floor itself: a mark, not a measurement (the chevron's
 * own rule). `pxPerMetre` is the scale at the vessel's spot (`pxPerMetreAt`).
 */
export function drawnLengthM(lengthM: number | undefined, pxPerMetre: number): number {
  const known = plausibleLengthM(lengthM);
  if (!(pxPerMetre > 0) || !Number.isFinite(pxPerMetre)) return known || 1;
  return Math.max(known, MIN_DRAWN_PX / pxPerMetre);
}

/**
 * Half the drawn length in pixels: how far from a vessel's point a click still means it,
 * so a long ship is no harder to hit than a small one. The contract with eye-boat-click:
 * `v.lengthM` is AIS Dimension A+B (components/eye/EyeOverlay.tsx's `markRadius` is where
 * a pick would call it).
 */
export function hullRadiusPx(v: { lengthM?: number }, metresPerPixel: number): number {
  if (!(metresPerPixel > 0) || !Number.isFinite(metresPerPixel)) return MIN_DRAWN_PX / 2;
  const pxPerMetre = 1 / metresPerPixel;
  return (drawnLengthM(v.lengthM, pxPerMetre) * pxPerMetre) / 2;
}

const EARTH_RADIUS_M = 6371008.8; // MapLibre's, so the scene and the map agree to the metre
const DEG = Math.PI / 180;

/**
 * Pixels per metre at a spot: the longer of 10 m east and 10 m north, projected, over 10.
 * `project` is the map's (`map.project`), so tilt and zoom are in it. The longer of the
 * two, because at a tilt the north-south metre is the one that shrinks.
 */
export function pxPerMetreAt(
  project: (lngLat: [number, number]) => { x: number; y: number },
  lon: number,
  lat: number,
): number {
  const dLat = (10 / EARTH_RADIUS_M) / DEG;
  const dLon = dLat / Math.max(Math.cos(lat * DEG), 0.01);
  const p = project([lon, lat]);
  const east = project([lon + dLon, lat]);
  const north = project([lon, lat + dLat]);
  return Math.max(Math.hypot(east.x - p.x, east.y - p.y), Math.hypot(north.x - p.x, north.y - p.y)) / 10;
}

/** Spherical Mercator, 0..1 over the world, y growing southward: MapLibre's `MercatorCoordinate`. */
export function mercator(lon: number, lat: number): { x: number; y: number } {
  return {
    x: (180 + lon) / 360,
    y: (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360,
  };
}

/** Metres in one unit of Mercator length at a latitude (the world is 40,030,173.6 m round at the equator). */
export function metresPerMercatorUnit(lat: number): number {
  return 2 * Math.PI * EARTH_RADIUS_M * Math.cos(lat * DEG);
}

/**
 * Where a vessel stands in the layer's own scene, in metres east and north of an origin,
 * and its turn about the vertical (counter-clockwise, radians). `rot` is `Vessel.rot`:
 * degrees clockwise from north, already the course while under way and the bow otherwise.
 * The scene is the origin's metres everywhere (as the layer's camera matrix is), so this
 * is exact in Mercator terms and a sphere never enters into it.
 */
export function placement(
  v: { lon: number; lat: number; rot: number },
  origin: { lon: number; lat: number },
): { east: number; north: number; rotZ: number } {
  const m = mercator(v.lon, v.lat);
  const o = mercator(origin.lon, origin.lat);
  const metres = metresPerMercatorUnit(origin.lat);
  return { east: (m.x - o.x) * metres, north: -(m.y - o.y) * metres, rotZ: -v.rot * DEG };
}

/** The colours baked into the models, which bake.py's PALETTE repeats (a unit test holds them equal). */
export const VESSEL_PALETTE = {
  /** The building ramp's 90 m stop. */
  hull: HEIGHT_RAMP[3][1],
  /** The 160 m stop. */
  deck: HEIGHT_RAMP[4][1],
  /** The camera rings' colour. */
  top: "#e8f1f8",
  /** The ship colour of EyeOverlay's COLOUR.ship. */
  waterline: "#2dd4bf",
} as const;

/** The unit vector toward the sun in east, north, up, from MapLibre's [radial, azimuth, polar]. */
export function sunDirection(light: { position?: unknown } = EYE_LIGHT): { east: number; north: number; up: number } {
  const position = light.position;
  const given =
    Array.isArray(position) && position.length === 3 && position.every((n) => typeof n === "number") ? position : null;
  const [, azimuth, polar] = (given ?? (EYE_LIGHT.position as unknown as number[])) as number[];
  const a = azimuth * DEG;
  const p = polar * DEG;
  return { east: Math.sin(a) * Math.sin(p), north: Math.cos(a) * Math.sin(p), up: Math.cos(p) };
}
