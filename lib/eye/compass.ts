// The God's eye view's compass, the pure half: the ticks of the strip, where the strip stands
// for a heading, and the words on the chip. components/eye/EyeCompass.tsx does the DOM;
// tests/unit/eye-compass.test.ts holds this file.
//
// ONE STRIP, DRAWN ONCE, MOVED BY A TRANSFORM. The window shows COMPASS_SPAN degrees. The strip
// holds a full turn plus half a window at each end, from -75 to 435, so a window centred on any
// heading in [0, 360) is full. At the seam the picture does not change: 435 is drawn as 75 is,
// and a heading of 359.9 and one of 0 show the same marks, so the strip can jump.

import { wrapHeading } from "@/lib/eye/places";
import { fmtHeading } from "@/lib/eye/wording";

/** How many degrees the window shows. */
export const COMPASS_SPAN = 150;
const TICK_EVERY = 5;
const LABEL_EVERY = 15;
/** The strip's own length in degrees: one turn and one window. */
export const STRIP_DEGREES = 360 + COMPASS_SPAN;

const NAMES: Readonly<Record<number, string>> = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" };
const EIGHT = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** North is the only one with a colour of its own. */
export type TickKind = "north" | "cardinal" | "major" | "minor";

export interface CompassTick {
  /** Degrees along the strip, from -75 to 435. */
  deg: number;
  /** Where it stands along the strip, as a percentage of the strip's width. */
  at: number;
  kind: TickKind;
  label: string;
}

export function compassTicks(): CompassTick[] {
  const out: CompassTick[] = [];
  for (let deg = -COMPASS_SPAN / 2; deg <= 360 + COMPASS_SPAN / 2; deg += TICK_EVERY) {
    const n = ((deg % 360) + 360) % 360;
    const name = NAMES[n];
    const major = n % LABEL_EVERY === 0;
    out.push({
      deg,
      at: ((deg + COMPASS_SPAN / 2) / STRIP_DEGREES) * 100,
      kind: n === 0 ? "north" : name ? "cardinal" : major ? "major" : "minor",
      label: name ?? (major ? String(n) : ""),
    });
  }
  return out;
}

/**
 * The strip's translateX for a heading, as a percentage of the strip's own width. At 0 the strip
 * stands at rest, with its -75 at the window's left edge and its 0 in the middle.
 */
export function compassOffset(heading: number): number {
  return (-wrapHeading(heading) / STRIP_DEGREES) * 100;
}

/** "N", "NE" and so on: the nearest of the eight. */
export function compassDirection(heading: number): string {
  return EIGHT[Math.round(wrapHeading(heading) / 45) % 8];
}

/** The chip: "032° NE". */
export function compassLabel(heading: number): string {
  return `${fmtHeading(wrapHeading(heading))}° ${compassDirection(heading)}`;
}
