// Which mark a click or a tap means, in the God's eye view. Pure, so
// tests/unit/eye-pick.test.ts holds it without a map.
//
// WHY NOT ASK THE GPU. A vessel or an aircraft is a small chevron on a symbol layer,
// 21 to 29 px across and about 11 to 15 px tall at the view's tilt, and moored vessels
// share spots (four work boats within 25 m of each other in Helsinki). Hit-testing a
// layer would answer "which feature is under this pixel" and miss a thumb that landed a
// little off. So EyeOverlay projects every mark to the screen and this module picks the
// nearest one within reach, and lists its neighbours so none is hidden behind another.
//
// A ROAD NOTICE IS A MARK WITH A LINE. TfL gives a notice one point and, often, the
// street lines it covers, so a click on any stretch of the street means it, not only a
// click near the point. Its distance to a click is the smaller of the two. A vessel or an
// aircraft always wins a click shared with a notice (a boat is small and a street runs
// under everything), and "Also here" lists the notices that were under the click as well.

export type PickKind = "ship" | "plane" | "road";

export interface PickCandidate {
  id: string;
  kind: PickKind;
  /** Screen pixels, in the map's own box. A road notice: TfL's own point, projected. */
  x: number;
  y: number;
  /** This mark's own reach in px, when it is larger than the minimum (a longer hull). */
  r?: number;
  /** A road notice's street lines on screen, already cut to the frame (runsInside). */
  path?: { x: number; y: number }[][];
}

interface Pt {
  x: number;
  y: number;
}
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Splits a projected line into runs of consecutive points inside `box` (its edge counts
 * as inside), and drops the rest: a run of one point, and any point that is not finite.
 *
 * WHY. `map.project()` mirrors a point behind the camera to above the horizon, so a
 * segment from a point on screen to one behind the camera would cross the whole screen and
 * answer clicks that touch nothing. Cutting every line to a frame padded around the screen
 * keeps only the stretches that are really there.
 */
export function runsInside(line: readonly Pt[], box: Box): Pt[][] {
  const runs: Pt[][] = [];
  let run: Pt[] = [];
  const flush = () => {
    if (run.length >= 2) runs.push(run);
    run = [];
  };
  for (const p of line) {
    const inside = Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= box.x0 && p.x <= box.x1 && p.y >= box.y0 && p.y <= box.y1;
    if (inside) run.push({ x: p.x, y: p.y });
    else flush();
  }
  flush();
  return runs;
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
const finitePt = (p: Pt): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);

/** The distance from `p` to the segment `a`-`b`, in px. */
function toSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * How far a mark is from a point: the distance to its own point, or, for a road notice,
 * to the nearest stretch of its street lines if that is nearer. Points that are not
 * finite are skipped; a mark with nothing finite is infinitely far.
 */
function distanceTo(c: PickCandidate, at: Pt): number {
  let best = finite(c) ? Math.hypot(c.x - at.x, c.y - at.y) : Number.POSITIVE_INFINITY;
  for (const run of c.path ?? []) {
    for (let i = 0; i < run.length; i++) {
      const a = run[i];
      if (!finitePt(a)) continue;
      const b = run[i + 1];
      const d = b && finitePt(b) ? toSegment(at, a, b) : Math.hypot(a.x - at.x, a.y - at.y);
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * The marks within reach of a point, nearest first; equal distances keep their input
 * order. A mark's reach is the larger of `minR` and its own `r`.
 */
function within(cands: readonly PickCandidate[], at: Pt, minR: number, skip?: PickCandidate): PickCandidate[] {
  const found: { c: PickCandidate; d: number; i: number }[] = [];
  cands.forEach((c, i) => {
    if (c === skip) return;
    const d = distanceTo(c, at);
    if (d <= reachOf(c, minR)) found.push({ c, d, i });
  });
  found.sort((a, b) => a.d - b.d || a.i - b.i);
  return found.map((f) => f.c);
}

/** Every other mark within reach of `centre`'s own point, nearest first (not capped). */
function around(cands: readonly PickCandidate[], centre: PickCandidate, minR: number): PickCandidate[] {
  return finite(centre) ? within(cands, centre, minR, centre) : [];
}

/**
 * The other marks within reach of `centre`'s own point (not of a click), nearest first. A
 * road notice's own point is its centre, and a notice among the others is measured to its
 * nearest street line as well.
 */
export function marksAround(cands: readonly PickCandidate[], centre: PickCandidate, minR: number): PickCandidate[] {
  return around(cands, centre, minR).slice(0, ALSO_MAX);
}

/**
 * The mark a click means, and the marks to list beside it.
 *
 * The hit is the nearest vessel or aircraft within reach; only if there is none, the
 * nearest road notice. The list is the marks around the hit's own point, nearest first,
 * then every other mark within reach of the click that is not listed yet, nearest to the
 * click first, so a notice under the click is never hidden behind a boat.
 */
export function pickMarks(cands: readonly PickCandidate[], at: Pt, minR: number): Picked {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return { hit: null, also: [] };
  const reached = within(cands, at, minR);
  const hit = reached.find((c) => c.kind !== "road") ?? reached[0] ?? null;
  if (!hit) return { hit: null, also: [] };
  const listed = around(cands, hit, minR);
  const seen = new Set(listed);
  const also = [...listed, ...reached.filter((c) => c !== hit && !seen.has(c))];
  return { hit, also: also.slice(0, ALSO_MAX) };
}
