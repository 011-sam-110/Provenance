// The person on the console's map (components/console/EyePerson.tsx): its rules, pure.
// No DOM and no MapLibre, so the node test suite holds all of them
// (tests/unit/eye-person.test.ts). Where a drop goes is in lib/eye/coverage.ts. This file is what
// the pointer means, what a release does, and how the figure moves. The numbers without a source
// here were measured on Google's Pegman, 2026-10-31. We copy its behaviour, not its art.
//
// A DROP MUST NOT OPEN A WRONG PLACE, and `map.unproject` alone would. On a globe it never
// says "nothing here": for a point in the space off the disc it answers with the nearest
// point on the horizon, a real latitude and longitude that the pointer is nowhere near. So
// `spotAtPoint` sends the answer back through `map.project` and refuses it unless it lands
// where the pointer is. Two more refusals are plain: a longitude past the edge of a flat world
// (the console draws no world copies, so there is nothing there), and a latitude past
// EYE_MAX_LAT, which /eye reads as a broken link and answers with its first preset. That is
// Westminster, whatever was under the ring.
//
// THE VIEW IT OPENS. The console's zoom is no use as the view's zoom: at world zoom it asks
// for nothing, and /eye would open at its floor. So the view opens at EYE_SPOT_ZOOM, or
// closer if the console already was. The tilt is always EYE_DEFAULT_TILT, the oblique city
// view, because a console that is flat or a little tilted is no reason to open a flat one.
// The heading is the map's bearing, so the view faces the way the map did.
//
// THE LINK CARRIES NO NAME. A city's name for a place with its cameras in shot is a fair claim,
// so the preview and /eye's title both say it (`placeName`), but each looks it up from the
// coordinates itself: a crafted link must not be able to title the page. A drag sends no location
// to any server. The name lookup asks about the chosen camera's cell, once, after the ring has
// settled, and never about the pointer. At zoom 12 and closer, where the ring would be the pointer's
// place, there is no lookup during a carry at all.

import { EYE_DEFAULT_TILT, EYE_MAX_LAT, EYE_MAX_ZOOM, EYE_SPOT_ZOOM, eyePlaceHref, eyeSpotHref } from "@/lib/eye/places";
import { findDrop, type CoverageIndex, type CoveragePoint, type DropResult } from "@/lib/eye/coverage";

/** The accessible name, which says what the button does in each state. */
export function personName(on: boolean): string {
  return on
    ? "Hide camera coverage. Arrow keys move the map, Enter opens God's eye view at its centre"
    : "Show camera coverage. Drag onto the map to open God's eye view there";
}
/** The tooltip, about a second after a hover. */
export const PERSON_TITLE = "Drag onto the map to open God's eye view. Click to show coverage";
/** The plate under the ring while a release would open here or at the card's place. */
export const DROP_WORDS = "Drop to open God's eye view";
/** The plate while the ring is over the map and nothing is in reach. */
export const MISS_WORDS = "No cameras near here";
/** The plate while a release would open nothing because the ring is not on the world. */
export const OFF_MAP_WORDS = "Not on the map. Let go to cancel";
/** The plate after a drop, until the page changes. */
export const OPENING_WORDS = "Opening God's eye view";
/** The quiet note when the index could not be read: it still opens, at the ring. */
export const NO_INDEX_WORDS = "Coverage is not available. Opens here";
/** The legend while coverage is on. */
export const LEGEND_TITLE = "Camera coverage";
export function legendHint(touch: boolean): string {
  return `${touch ? "Tap" : "Click"} the map to open God's eye view`;
}

/** How far a mouse or a pen moves before a press is a carry, in CSS px. One px did not lift Pegman. */
const DRAG_THRESHOLD_PX = 3;
/** A finger lands less exactly, and a tap must stay a tap. */
const DRAG_THRESHOLD_TOUCH_PX = 10;
/** With a mouse he hangs from the pointer, and the ring under his feet is this far below it. */
export const HANG_PX = 58;
/** How far above a finger the ring sits, so the finger does not cover the drop point. */
export const TOUCH_LIFT_PX = 72;
/** The figure's top above the ring, for the card's side of it. */
const FIGURE_TOP_PX = 70;
/** The solid ring's edge below its middle, and the arrow under it. */
const CARD_GAP_PX = 24;
const EDGE_MARGIN_PX = 8;
/** The arrow stays this far inside the card's corners. */
const ARROW_INSET_PX = 16;
/**
 * How far `project(unproject(p))` may land from p before p is off the world. The horizon
 * answer is as far off as the pointer is from the disc, so this is the width of the band
 * outside the disc that still counts as on it. Measured on the real globe (2026-10-31): a
 * point on the disc comes back at 0.0000 px.
 */
const ON_WORLD_TOLERANCE_PX = 3;
/** A result this close on screen is under the ring, and needs no marker and no line. */
const UNDER_RING_PX = 24;
/** The solid ring's radius. A camera inside it is "in the ring". */
export const RING_RADIUS_PX = 16;

/** The ring has stopped moving after this long without a move. */
export const SETTLE_MS = 120;
/** The preview comes this long after the last move. Our index is local: Google takes 670 ms. */
export const PREVIEW_MS = 200;
/** The lift, in EyePerson.module.css. */
export const LIFT_MS = 216;
/** The fall, in EyePerson.module.css, then the page loads. */
export const FALL_MS = 300;
/** The flight home, in EyePerson.module.css. */
export const HOME_MS = 500;
/** The tooltip's wait. */
export const TIP_MS = 1000;

/** A pointer this close to the map's edge pans the map... */
export const EDGE_BAND_PX = 30;
/** ...up to this fast. */
export const EDGE_MAX_PX_S = 1000;

export interface Point {
  x: number;
  y: number;
}

export interface Spot {
  lat: number;
  lon: number;
}

/** The part of a MapLibre map these rules read. Points are in the map's own CSS px. */
export interface PersonMap {
  unproject(point: [number, number]): { lat: number; lng: number };
  project(lngLat: [number, number]): Point;
  getZoom(): number;
  getBearing(): number;
  getProjection(): { type?: unknown } | undefined;
  getTerrain(): unknown;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Any longitude into [-180, 180). */
const wrapLon = (lng: number) => ((((lng + 180) % 360) + 360) % 360) - 180;

/** Has the pointer moved far enough from where it went down to be a carry? */
export function isDrag(dx: number, dy: number, pointerType: string): boolean {
  return Math.hypot(dx, dy) >= (pointerType === "touch" ? DRAG_THRESHOLD_TOUCH_PX : DRAG_THRESHOLD_PX);
}

/** The drop point for a pointer: below a mouse, above a finger. */
export function ringPoint(x: number, y: number, pointerType: string): Point {
  return { x, y: pointerType === "touch" ? y - TOUCH_LIFT_PX : y + HANG_PX };
}

/** The place under a point of the map, or null when there is no place there. */
export function spotAtPoint(map: PersonMap, x: number, y: number): Spot | null {
  const at = map.unproject([x, y]);
  if (!Number.isFinite(at.lat) || !Number.isFinite(at.lng)) return null;
  if (Math.abs(at.lat) > EYE_MAX_LAT) return null;
  const globe = map.getProjection()?.type === "globe";
  if (!globe && Math.abs(at.lng) > 180) return null;
  // Terrain, which only the flat map has, sends the answer through the relief both ways, and it
  // comes back well off where the ground is steep: 1.95 px over the Alps at zoom 10, and enough at
  // zoom 13 to call the map "not on the map" (measured 2026-10-31). The flat map has no horizon
  // answer to guard against, because the console cannot tilt it far enough to show sky.
  if (!globe && map.getTerrain()) return { lat: at.lat, lon: wrapLon(at.lng) };
  const back = map.project([at.lng, at.lat]);
  if (Math.hypot(back.x - x, back.y - y) > ON_WORLD_TOLERANCE_PX) return null;
  return { lat: at.lat, lon: wrapLon(at.lng) };
}

/**
 * Where a place is on screen, in the map's px, or null when it is round the far side of the
 * globe, where `project` still answers with a point on the disc.
 */
export function targetOnMap(map: PersonMap, spot: Spot): Point | null {
  const p = map.project([spot.lon, spot.lat]);
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  if (map.getProjection()?.type !== "globe") return p;
  const back = map.unproject([p.x, p.y]);
  const gap = Math.abs(wrapLon(back.lng - spot.lon)) + Math.abs(back.lat - spot.lat);
  return gap < 1 ? p : null;
}

/** Is the place far enough from the ring on screen to need a marker and a line? */
export function needsMarker(ring: Point, target: Point | null): boolean {
  return target != null && Math.hypot(target.x - ring.x, target.y - ring.y) > UNDER_RING_PX;
}

/** The view's zoom: a city at the least, or closer if the console already is. */
export function personZoom(consoleZoom: number): number {
  return Number.isFinite(consoleZoom) ? clamp(consoleZoom, EYE_SPOT_ZOOM, EYE_MAX_ZOOM) : EYE_SPOT_ZOOM;
}

/** The address of God's eye view at a spot, from the console's zoom and bearing. */
export function personHref(spot: Spot, consoleZoom: number, bearing: number): string {
  return eyeSpotHref({
    lat: spot.lat,
    lon: spot.lon,
    zoom: personZoom(consoleZoom),
    tilt: EYE_DEFAULT_TILT,
    heading: bearing,
  });
}

/** The address a result opens: a preset by its own link, or the spot. */
export function dropHref(drop: DropResult, ringSpot: Spot, consoleZoom: number, bearing: number): string | null {
  if (drop.kind === "miss") return null;
  if (drop.kind === "exact") return personHref(ringSpot, consoleZoom, bearing);
  if (drop.place) return eyePlaceHref(drop.place.id);
  return personHref(drop.spot, consoleZoom, bearing);
}

export type DropOutcome =
  | { kind: "open"; href: string; drop: DropResult }
  | { kind: "cancel"; why: "off-map" | "off-globe" | "miss" };

/**
 * What a release does. `point` is in the map's own px, or null when it is not over the map.
 * `index` is null when there is no index, and the drop then opens at the ring.
 */
export function dropOutcome(map: PersonMap, point: Point | null, index: CoverageIndex | null): DropOutcome {
  if (!point) return { kind: "cancel", why: "off-map" };
  const spot = spotAtPoint(map, point.x, point.y);
  if (!spot) return { kind: "cancel", why: "off-globe" };
  const zoom = map.getZoom();
  const drop = findDrop(index, zoom, spot);
  const href = dropHref(drop, spot, zoom, map.getBearing());
  return href ? { kind: "open", href, drop } : { kind: "cancel", why: "miss" };
}

export interface CameraInRing {
  stillId: string;
  name: string;
  count: number;
}

/** The cameras inside the ring, the nearest first, from a box's exact points. Closer in only. */
export function camerasInRing(
  map: PersonMap,
  ring: Point,
  points: readonly CoveragePoint[],
  radiusPx: number = RING_RADIUS_PX,
): CameraInRing | null {
  let best: CoveragePoint | null = null;
  let bestPx = Number.POSITIVE_INFINITY;
  let count = 0;
  for (const point of points) {
    const p = map.project([point[1], point[0]]);
    const px = Math.hypot(p.x - ring.x, p.y - ring.y);
    if (px > radiusPx) continue;
    count++;
    // A camera with a still beats a closer one without.
    const better = !best || (Boolean(point[2]) && !best[2]) || (Boolean(point[2]) === Boolean(best[2]) && px < bestPx);
    if (better) {
      best = point;
      bestPx = px;
    }
  }
  return best ? { stillId: best[2], name: best[4], count } : null;
}

const plural = (n: number) => `${n.toLocaleString("en-GB")} camera${n === 1 ? "" : "s"}`;

/** The count, as the card says it. Never "live": these are counts, and most are stills. */
export function cameraCountWords(cameras: number): string {
  return plural(cameras);
}

/** The count for cameras inside the ring. */
export function ringCountWords(cameras: number): string {
  return cameras === 1 ? "A camera in the ring" : `${plural(cameras)} in the ring`;
}

interface NamedResult {
  locality?: string;
  name?: string;
}

/** The place's name from the geocoder's answer, or the region, or null. */
export function placeName(results: unknown, region: string): string | null {
  const first = Array.isArray(results) ? (results[0] as NamedResult | undefined) : undefined;
  const name = first?.locality?.trim();
  if (name) return name;
  return region.trim() || null;
}

// ── The preview's place ─────────────────────────────────────────────────────────────────────

export interface CardPlace {
  /** The card's left and top, from the ring. */
  x: number;
  y: number;
  side: "below" | "above";
  /** The arrow's middle, from the card's left. */
  arrowX: number;
}

/**
 * Where a card goes. Below the ring on a mouse, above the figure on a finger, because a finger
 * covers what is under it. Google's stays below and went off the screen at the bottom edge. This
 * one flips, slides along the edge with its arrow still on the ring, and on a window too short for
 * either side it takes the roomier side and stays on the screen.
 */
export function cardPlace(
  ring: Point,
  card: { width: number; height: number },
  win: { width: number; height: number },
  pointerType: string,
): CardPlace {
  const below = ring.y + CARD_GAP_PX;
  const above = ring.y - FIGURE_TOP_PX - card.height - EDGE_MARGIN_PX;
  const fitsBelow = below + card.height + EDGE_MARGIN_PX <= win.height;
  const fitsAbove = above >= EDGE_MARGIN_PX;
  const prefersAbove = pointerType === "touch";
  let side: "below" | "above";
  if (prefersAbove ? fitsAbove : !fitsBelow && fitsAbove) side = "above";
  else if (fitsBelow) side = "below";
  else if (prefersAbove && !fitsAbove && !fitsBelow) side = win.height - ring.y > ring.y ? "below" : "above";
  else side = win.height - ring.y > ring.y ? "below" : "above";
  const top = clamp(side === "below" ? below : above, EDGE_MARGIN_PX, Math.max(EDGE_MARGIN_PX, win.height - card.height - EDGE_MARGIN_PX));
  const lo = EDGE_MARGIN_PX;
  const hi = Math.max(lo, win.width - card.width - EDGE_MARGIN_PX);
  const left = clamp(ring.x - card.width / 2, lo, hi);
  const arrowX = clamp(ring.x - left, ARROW_INSET_PX, Math.max(ARROW_INSET_PX, card.width - ARROW_INSET_PX));
  return { x: Math.round(left - ring.x), y: Math.round(top - ring.y), side, arrowX: Math.round(arrowX) };
}

// ── The edge pan ────────────────────────────────────────────────────────────────────────────

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function edgeSpeed(inside: number): number {
  if (inside >= EDGE_BAND_PX) return 0;
  if (inside < -EDGE_BAND_PX) return 0;
  const closeness = clamp(1 - inside / EDGE_BAND_PX, 0, 1);
  return EDGE_MAX_PX_S * closeness * closeness;
}

/**
 * How fast to pan, in the map's px a second, from a pointer near the map's edge. Up to
 * EDGE_MAX_PX_S at the edge and just past it, and nothing once the pointer is well outside, so
 * dragging off the map to cancel does not also spin the world. The figure hangs between the pointer
 * and the ring, so the top edge reads the higher of the two and the bottom edge the lower: otherwise
 * the bottom edge could only be reached with the ring already off the map.
 */
export function edgePan(pointer: Point, ring: Point, box: Box): Point {
  const high = Math.min(pointer.y, ring.y);
  const low = Math.max(pointer.y, ring.y);
  const inX = pointer.x >= box.left - EDGE_BAND_PX && pointer.x <= box.right + EDGE_BAND_PX;
  const inY = high <= box.bottom + EDGE_BAND_PX && low >= box.top - EDGE_BAND_PX;
  if (!inX || !inY) return { x: 0, y: 0 };
  const x = edgeSpeed(box.right - pointer.x) - edgeSpeed(pointer.x - box.left);
  const y = edgeSpeed(box.bottom - low) - edgeSpeed(high - box.top);
  return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y };
}

/**
 * Is there world to pan towards? The point tested is the ring pulled back in from the edge, because
 * at zoom 3 a globe nearly fills a wide map, and the last few px beside it are worth panning from,
 * while at zoom 1 the same px are out in space, and a pointer there must not spin the world.
 */
export function edgePanHasWorld(map: PersonMap, ringOnMap: Point, pan: Point): boolean {
  const back = EDGE_BAND_PX * 2;
  return spotAtPoint(map, ringOnMap.x - Math.sign(pan.x) * back, ringOnMap.y - Math.sign(pan.y) * back) != null;
}

// ── The swing ───────────────────────────────────────────────────────────────────────────────

export interface Swing {
  /** Degrees. Positive sends the feet left, so a move to the right leans him back. */
  angle: number;
  /** Degrees a second. */
  speed: number;
  /** The pointer's smoothed horizontal speed, px a second. */
  vx: number;
}

export const SWING_START: Swing = { angle: 0, speed: 0, vx: 0 };

const SWING_MAX_DEG = 30;
/** tanh(150/800) x 30 is 5.6 degrees, a slight lean. tanh(1500/800) x 30 is 28.6, a strong one. */
const SWING_SPEED_PX_S = 800;
/** Peak of the overshoot at about +180 ms: pi / sqrt(w^2 - (zw)^2). */
const SWING_OMEGA = 18.1;
/** At rest by about +800 ms: e^(-zw x 0.8) is 2%. */
const SWING_DAMPING = 0.27;
/** Smooths frames with no new pointer position, without moving the peak by much. */
const SWING_SMOOTH_MS = 24;
const SWING_STEP_MS = 4;
/** About a quarter of a px at his feet. Below this he has stopped. */
const SWING_REST_DEG = 0.5;

/** The lean a steady horizontal speed asks for. Vertical motion gives none. */
export function swingTarget(vx: number): number {
  return SWING_MAX_DEG * Math.tanh(vx / SWING_SPEED_PX_S);
}

/** One frame of the pendulum: a small spring towards the lean the speed asks for. */
export function swingStep(state: Swing, pointerVx: number, dtMs: number): Swing {
  const dt = clamp(dtMs, 0, 50);
  const blend = 1 - Math.exp(-dt / SWING_SMOOTH_MS);
  const vx = state.vx + (pointerVx - state.vx) * blend;
  const target = swingTarget(vx);
  let { angle, speed } = state;
  const steps = Math.max(1, Math.ceil(dt / SWING_STEP_MS));
  const h = dt / steps / 1000;
  for (let i = 0; i < steps; i++) {
    const accel = -SWING_OMEGA * SWING_OMEGA * (angle - target) - 2 * SWING_DAMPING * SWING_OMEGA * speed;
    speed += accel * h;
    angle += speed * h;
  }
  return { angle, speed, vx: Math.abs(vx) < 0.5 ? 0 : vx };
}

/** Nothing left to draw: stop asking for frames. */
export function swingAtRest(state: Swing): boolean {
  return Math.abs(state.angle) < SWING_REST_DEG && Math.abs(state.speed) < 12 && state.vx === 0;
}
