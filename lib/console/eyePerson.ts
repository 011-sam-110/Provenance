// The person on the console's map (components/console/EyePerson.tsx): its rules, pure.
// No DOM and no MapLibre, so the node test suite holds all of them
// (tests/unit/eye-person.test.ts).
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
// THE TITLE IS HONEST WITHOUT HELP FROM HERE. A spot has no name, so /eye titles it with its
// coordinates (`titleFor` in EyeApp.tsx, `fmtSpot`), in a city and in mid-ocean alike. Do not
// add a place name to this link: a reverse geocode would be a claim about what is on screen.

import { EYE_DEFAULT_TILT, EYE_MAX_LAT, EYE_MAX_ZOOM, EYE_SPOT_ZOOM, eyeSpotHref } from "@/lib/eye/places";

/** The accessible name: what a tap, Enter or Space does. */
export const PERSON_NAME = "Open God's eye view at the centre of the map";
/** The tooltip: what the drag does. */
export const PERSON_TITLE = "Drag onto the map to open God's eye view there";
/** The plate under the ring while it is over the map. */
export const DROP_WORDS = "Drop to open God's eye view";
/** The plate while a release would open nothing. */
export const OFF_MAP_WORDS = "Not on the map. Let go to cancel";
/** The plate after a drop, until the page changes. */
export const OPENING_WORDS = "Opening God's eye view";

/** How far a mouse or a pen moves before a press is a drag, in CSS px. */
const DRAG_THRESHOLD_PX = 5;
/** A finger lands less exactly, and a tap must stay a tap. */
const DRAG_THRESHOLD_TOUCH_PX = 10;
/** How far above a finger the ring sits, so the finger does not cover the drop point. */
export const TOUCH_LIFT_PX = 72;
/**
 * How far `project(unproject(p))` may land from p before p is off the world. The horizon
 * answer is as far off as the pointer is from the disc, so this is the width of the band
 * outside the disc that still counts as on it. Measured on the real globe (2026-10-31): a
 * point on the disc comes back at 0.0000 px.
 */
const ON_WORLD_TOLERANCE_PX = 3;
/**
 * The same with terrain on, which only the flat map has. The answer goes through the relief
 * both ways and comes back a little off: 1.95 px at worst over the Alps, at zoom 10 and 55
 * degrees of tilt. There is no horizon answer on the flat map, so this one can be generous.
 */
const ON_TERRAIN_TOLERANCE_PX = 16;

/** The figure's height while carried, and the label's height: for the label's two sides. */
const CARRIED_FIGURE_PX = 48;
const LABEL_PX = 30;
const RING_HALF_PX = 7;
const EDGE_MARGIN_PX = 8;

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
  getCenter(): { lat: number; lng: number };
  getZoom(): number;
  getBearing(): number;
  getProjection(): { type?: unknown } | undefined;
  getTerrain(): unknown;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Any longitude into [-180, 180). */
const wrapLon = (lng: number) => ((((lng + 180) % 360) + 360) % 360) - 180;

/** Has the pointer moved far enough from where it went down to be a drag? */
export function isDrag(dx: number, dy: number, pointerType: string): boolean {
  return Math.hypot(dx, dy) >= (pointerType === "touch" ? DRAG_THRESHOLD_TOUCH_PX : DRAG_THRESHOLD_PX);
}

/** The exact drop point for a pointer, in the same coordinates it came in. */
export function ringPoint(x: number, y: number, pointerType: string): Point {
  return { x, y: pointerType === "touch" ? y - TOUCH_LIFT_PX : y };
}

/** How far to move the centred label so all of it stays in the window, in whole px. */
export function labelShift(x: number, labelWidth: number, windowWidth: number): number {
  const lo = labelWidth / 2 + EDGE_MARGIN_PX;
  const hi = windowWidth - labelWidth / 2 - EDGE_MARGIN_PX;
  const centre = hi < lo ? windowWidth / 2 : clamp(x, lo, hi);
  return Math.round(centre - x);
}

/**
 * Does the label go above the figure? A mouse leaves room under the ring. A finger is under
 * the ring, so the label goes above the figure for it. Each changes side at the window's edge.
 */
export function labelAbove(ringY: number, pointerType: string, windowHeight: number): boolean {
  const fitsBelow = ringY + RING_HALF_PX + LABEL_PX + EDGE_MARGIN_PX <= windowHeight;
  const fitsAbove = ringY - CARRIED_FIGURE_PX - LABEL_PX - EDGE_MARGIN_PX >= 0;
  return pointerType === "touch" ? fitsAbove : !fitsBelow;
}

/** The place under a point of the map, or null when there is no place there. */
export function spotAtPoint(map: PersonMap, x: number, y: number): Spot | null {
  const at = map.unproject([x, y]);
  if (!Number.isFinite(at.lat) || !Number.isFinite(at.lng)) return null;
  if (Math.abs(at.lat) > EYE_MAX_LAT) return null;
  const globe = map.getProjection()?.type === "globe";
  if (!globe && Math.abs(at.lng) > 180) return null;
  const back = map.project([at.lng, at.lat]);
  const tolerance = map.getTerrain() ? ON_TERRAIN_TOLERANCE_PX : ON_WORLD_TOLERANCE_PX;
  if (Math.hypot(back.x - x, back.y - y) > tolerance) return null;
  return { lat: at.lat, lon: wrapLon(at.lng) };
}

/**
 * The middle of the map, for a tap. Unlike a drop it claims no exact spot, so a camera past
 * the poles' limit opens at the limit rather than doing nothing.
 */
export function centreSpot(map: PersonMap): Spot {
  const c = map.getCenter();
  return { lat: clamp(c.lat, -EYE_MAX_LAT, EYE_MAX_LAT), lon: wrapLon(c.lng) };
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

export type DropOutcome = { kind: "open"; href: string } | { kind: "cancel"; why: "off-map" | "off-globe" };

/** What a release does. `point` is in the map's own px, or null when it is not over the map. */
export function dropOutcome(map: PersonMap, point: Point | null): DropOutcome {
  if (!point) return { kind: "cancel", why: "off-map" };
  const spot = spotAtPoint(map, point.x, point.y);
  if (!spot) return { kind: "cancel", why: "off-globe" };
  return { kind: "open", href: personHref(spot, map.getZoom(), map.getBearing()) };
}
