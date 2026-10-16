"use client";
// The colours a drawn area can be, and the rules about them.
//
// WHY A FIXED PALETTE AND NOT A FREE COLOUR FIELD. The colour is painted as a ring on
// a map that is already carrying a basemap, a choropleth, camera pins and up to
// thirty-odd signal layers. Eight colours chosen to stay apart from each other AND
// legible over both the pale vector basemaps and satellite imagery is a decision that
// can be made once, well; a free picker hands the user a way to make their own area
// invisible and calls it freedom. So the palette is the offer, and `input type=color`
// is still there in the picker for anyone who wants a specific hex — the custom value
// is stored as given (see coerceAreaColor) and simply is not guaranteed against the
// basemap.
//
// PURE, AND IN ITS OWN FILE, for the reason every other table in this tree is: vitest
// is node-environment over `tests/unit/**/*.test.ts`, so a palette left inside a
// component cannot be tested at all. tests/unit/area-colors.test.ts holds it.

export interface AreaColor {
  /** #rrggbb, lowercase — the only form the map and the persisted envelope see. */
  hex: string;
  /** Said aloud by a screen reader, because "circle, #0ea5e9" is not a name. */
  name: string;
}

/**
 * The palette, in the order the picker draws it.
 *
 * SKY IS FIRST AND IS THE DEFAULT, which is not an aesthetic choice: it is the colour
 * every area has been painted since areas were first drawn on the map (`#0ea5e9` in
 * lib/map/aoi.ts), so a stored area from before this feature keeps the colour it had
 * rather than changing under the user on upgrade.
 *
 * The rest are picked to sit apart in hue AND to hold up over satellite imagery,
 * where a dark, desaturated ring disappears into terrain. Every one of them is a
 * mid-tone with enough chroma to read against both a pale vector map and a photograph.
 */
export const AREA_COLORS: readonly AreaColor[] = [
  { hex: "#0ea5e9", name: "Sky" },
  { hex: "#22c55e", name: "Green" },
  { hex: "#f59e0b", name: "Amber" },
  { hex: "#ef4444", name: "Red" },
  { hex: "#a855f7", name: "Violet" },
  { hex: "#14b8a6", name: "Teal" },
  { hex: "#ec4899", name: "Pink" },
  { hex: "#64748b", name: "Slate" },
] as const;

export const DEFAULT_AREA_COLOR = AREA_COLORS[0].hex;

/** #rrggbb, and nothing else. Shorthand (#abc), names and rgb() are not colours here. */
const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Pure: is this a colour this feature can paint and persist?
 *
 * Deliberately strict. The value goes into a MapLibre paint expression and into
 * localStorage, and MapLibre SILENTLY DROPS a layer whose paint expression it cannot
 * parse — so a malformed colour would not paint a wrong ring, it would remove the
 * ring and take the layer with it. A rejection here is the difference between "that
 * colour is not used" and "the areas are gone".
 */
export function isAreaColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value.trim());
}

/**
 * Pure: a colour that is safe to paint, from whatever was stored.
 *
 * Everything saved before this feature existed has no colour field at all, and that
 * is the case this exists for: those areas get DEFAULT_AREA_COLOR, which is the colour
 * they were already being drawn in. A stored value that is not a hex — a hand-edited
 * envelope, or a palette entry from a future version — falls back the same way rather
 * than reaching the map.
 */
export function coerceAreaColor(value: unknown): string {
  if (!isAreaColor(value)) return DEFAULT_AREA_COLOR;
  return value.trim().toLowerCase();
}

/**
 * Pure: the colour to give a NEW area, given the ones already on the map.
 *
 * ROTATION RATHER THAN RANDOMNESS, and rather than always the default. Two areas drawn
 * in a row used to be two identical rings — indistinguishable on the map and
 * indistinguishable in the list until you renamed one — and the fix costs a walk of a
 * palette. It picks the first colour that is not in use, so the second area differs
 * from the first, the ninth wraps back to sky, and deleting an area hands its colour
 * to the next one drawn. That last part is deliberate: the palette is a fixed set of
 * eight and a user with eight areas has to repeat, so repeating the one they just
 * deleted is the least surprising way to do it.
 */
export function nextAreaColor(inUse: readonly string[]): string {
  const taken = new Set(inUse.map((c) => coerceAreaColor(c)));
  return AREA_COLORS.find((c) => !taken.has(c.hex))?.hex ?? DEFAULT_AREA_COLOR;
}

/** Pure: what to call a colour in a label. Falls back to the hex for a custom one. */
export function areaColorName(hex: string): string {
  const found = AREA_COLORS.find((c) => c.hex === coerceAreaColor(hex));
  return found?.name ?? hex;
}

// --- opacity ----------------------------------------------------------------
//
// HOW STRONGLY AN AREA SHOWS, one number per area, 0 to 1. Sam's report: "once you
// have marked it its impossible to see". An area that is not being edited is a 50%
// dashed outline with no fill, which is right for a reference ring over a busy map
// and wrong for an area someone is actually watching. So the strength is the user's
// call, per area, beside its colour.
//
// 0 IS TODAY'S LOOK, and that is the default. Every area saved before this existed
// has no opacity field, and it must not change on upgrade any more than its colour
// did. The top of the scale is a solid outline and a 60% fill rather than 100%: an
// area is drawn OVER the cameras and signals it scopes, and a fully opaque fill would
// hide the very things it was drawn around.

export const DEFAULT_AREA_OPACITY = 0;
/** The slider's step. Fine enough to tune, coarse enough that the stored value is tidy. */
export const AREA_OPACITY_STEP = 0.05;
/** The fill at opacity 1. */
export const AREA_FILL_MAX = 0.6;
/** The outline at opacity 0 — the dashed ring every area has always had. */
export const AREA_LINE_MIN = 0.5;
/** The fill the area being EDITED always gets, however low its own opacity is. */
export const AREA_EDITING_FILL = 0.06;
/** The outline of the area being edited, the same floor as before this feature. */
export const AREA_EDITING_LINE = 0.95;

/**
 * Pure: an opacity that is safe to paint and persist, from whatever was stored.
 *
 * Clamped to 0..1 and snapped to the slider's step. Anything that is not a finite
 * number — a missing field on an old area, a hand-edited envelope — is the default.
 * The value ends up in a MapLibre paint property, and a NaN there is the same
 * silent-layer-drop failure an unparseable colour is.
 */
export function coerceAreaOpacity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_AREA_OPACITY;
  const clamped = Math.min(1, Math.max(0, value));
  // toFixed after the snap: 7 * 0.05 is 0.35000000000000003 in floating point, and
  // that is what would otherwise be persisted and shown as a percentage.
  return Number((Math.round(clamped / AREA_OPACITY_STEP) * AREA_OPACITY_STEP).toFixed(2));
}

/**
 * Pure: the fill and outline strength an area is painted with.
 *
 * ONE KNOB, TWO PAINTS, because the user is asking one question ("how visible is
 * this area") and two sliders would make them answer it twice. The fill runs from
 * none to AREA_FILL_MAX; the outline from its old 50% to solid. The area being edited
 * keeps the floor it always had, so turning an area's opacity down never makes the
 * one you are working on harder to find.
 */
export function areaPaint(opacity: unknown, editing: boolean): { fill: number; line: number } {
  const o = coerceAreaOpacity(opacity);
  const fill = Number((o * AREA_FILL_MAX).toFixed(3));
  const line = Number((AREA_LINE_MIN + o * (1 - AREA_LINE_MIN)).toFixed(3));
  if (!editing) return { fill, line };
  return { fill: Math.max(AREA_EDITING_FILL, fill), line: Math.max(AREA_EDITING_LINE, line) };
}
