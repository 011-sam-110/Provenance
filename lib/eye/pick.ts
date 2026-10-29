// Which mark a click or a tap means, in the God's eye view. Pure, so
// tests/unit/eye-pick.test.ts holds it without a map.
//
// WHY NOT ASK THE GPU. A vessel or an aircraft is a small chevron on a symbol layer,
// 21 to 29 px across and about 11 to 15 px tall at the view's tilt, and moored vessels
// share spots (four work boats within 25 m of each other in Helsinki). Hit-testing a
// layer would answer "which feature is under this pixel" and miss a thumb that landed a
// little off. So EyeOverlay projects every mark to the screen and this module picks the
// nearest one within reach, and lists its neighbours so none is hidden behind another.

export interface PickCandidate {
  id: string;
  kind: "ship" | "plane";
  /** Screen pixels, in the map's own box. */
  x: number;
  y: number;
  /** This mark's own reach in px, when it is larger than the minimum (a longer hull). */
  r?: number;
}

export interface Picked {
  hit: PickCandidate | null;
  /** The other marks that sit close to the hit, nearest first. */
  also: PickCandidate[];
}

/** CSS px. A phone tap is about 48 px across, so it is let reach further than a pointer. */
export const PICK_RADIUS = { wide: 18, phone: 24 } as const;
/** The "Also here" list stops here. */
export const ALSO_MAX = 12;

const reachOf = (c: PickCandidate, minR: number): number => Math.max(minR, c.r ?? 0);
const finite = (c: PickCandidate): boolean => Number.isFinite(c.x) && Number.isFinite(c.y);

/**
 * The marks within reach of a point, nearest first; equal distances keep their input
 * order. A mark's reach is the larger of `minR` and its own `r`.
 */
function within(cands: readonly PickCandidate[], at: { x: number; y: number }, minR: number, skip?: PickCandidate): PickCandidate[] {
  const found: { c: PickCandidate; d: number; i: number }[] = [];
  cands.forEach((c, i) => {
    if (c === skip || !finite(c)) return;
    const d = Math.hypot(c.x - at.x, c.y - at.y);
    if (d <= reachOf(c, minR)) found.push({ c, d, i });
  });
  found.sort((a, b) => a.d - b.d || a.i - b.i);
  return found.map((f) => f.c);
}

/** The other marks within reach of `centre`'s own point (not of a click), nearest first. */
export function marksAround(cands: readonly PickCandidate[], centre: PickCandidate, minR: number): PickCandidate[] {
  if (!finite(centre)) return [];
  return within(cands, centre, minR, centre).slice(0, ALSO_MAX);
}

/** The nearest mark within reach of `at`, and the marks around that one. */
export function pickMarks(cands: readonly PickCandidate[], at: { x: number; y: number }, minR: number): Picked {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return { hit: null, also: [] };
  const hit = within(cands, at, minR)[0] ?? null;
  return { hit, also: hit ? marksAround(cands, hit, minR) : [] };
}
