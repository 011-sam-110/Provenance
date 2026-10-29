// The God's eye view's Previews switch, the pure half: what is remembered, when a film
// or a recording ignores it, the words, the sizes of a camera icon, and which side of
// its camera an opened card hangs. components/eye/* does the DOM; tests/unit/
// eye-previews.test.ts holds this file.
//
// PREVIEWS ARE THE PICTURES IN THE CAMERA CARDS (a stream, a clip or a still). With
// them off each camera is a small icon that fetches nothing, and one tapped icon opens
// that one camera's card. The choice is kept in this browser only: it is not in a link
// and not in the account's synced keys (a setting for one screen stays on the device).

import { GAP, cardBox, insideFrame, overlaps, type Box, type CardSize, type Frame } from "@/lib/eye/declutter";

/** localStorage key, through lib/shell/persist.ts. */
export const EYE_PREFS_KEY = "tn.eye.v1";
export const EYE_PREFS_VERSION = 1;

export interface EyePrefs {
  previews: boolean;
}

/**
 * What was stored, read defensively. Only a stored `{ previews: false }` turns previews
 * off: a miss, a stale shape or anything else leaves them on, which is the default.
 */
export function readEyePrefs(raw: unknown): EyePrefs {
  if (raw && typeof raw === "object" && (raw as { previews?: unknown }).previews === false) return { previews: false };
  return { previews: true };
}

/**
 * Whether the pictures are shown. A recording (record=1) and a film (clock=manual) always
 * show them, whatever is stored: a stored "off" must never reach a reel.
 */
export function previewsInEffect(stored: boolean, ctx: { record: boolean; film: boolean }): boolean {
  return stored || ctx.record || ctx.film;
}

// The words. A still is never called live, so none of these says "live".
export const PREVIEWS_LABEL = "Previews";
export const showLabel = (name: string): string => `Show ${name}`;
export const closeLabel = (name: string): string => `Close ${name}`;

/**
 * A camera icon's box for placement, like a card's CardSize: the button's hit area and
 * the stalk under it, and how many may stand at once. The phone's hit area is 44 px.
 */
export type IconSize = CardSize & { max: number };
export const ICON_WIDE: IconSize = { width: 32, height: 32, stalk: 14, max: 16 };
export const ICON_PHONE: IconSize = { width: 44, height: 44, stalk: 10, max: 10 };

/** A card that hangs BELOW its camera: the stalk on top, the plate under it. */
export function cardBoxBelow(x: number, y: number, s: CardSize): Box {
  return {
    x0: x - s.width / 2 - GAP,
    x1: x + s.width / 2 + GAP,
    y0: y - GAP,
    y1: y + s.stalk + s.height + GAP,
  };
}

/**
 * Which side of its camera an opened card stands: above, as every card does, when that
 * fits inside the frame and clear of the HUD's boxes (`kept`); else below; and above
 * again where neither fits, because a card the user opened is shown, not dropped.
 */
export function openCardSide(x: number, y: number, size: CardSize, frame: Frame, kept: readonly Box[]): "above" | "below" {
  const fits = (b: Box) => insideFrame(b, frame) && !kept.some((k) => overlaps(k, b));
  if (fits(cardBox(x, y, size))) return "above";
  return fits(cardBoxBelow(x, y, size)) ? "below" : "above";
}
