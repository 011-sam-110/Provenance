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
