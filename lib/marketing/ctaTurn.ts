// The landing button's character turn, the pure half: which characters turn, which only
// slide, and when. components/marketing/CtaRotor.tsx does the DOM. Pinned by
// tests/unit/landing-cta-turn.test.ts.
//
// WHAT TURNS. "See Madrid in 3D" to "See Tokyo in 3D" keeps "See " and " in 3D": those
// characters slide to their new places and do not turn, so the phrase stays readable and
// the eye goes to the word that changed. Everything between them turns a full 360 about
// its own vertical axis, one after the other from the left, and comes round as the new
// character. A phrase with more characters adds cells that turn out of nothing; one with
// fewer has cells that turn into nothing.

/** How long one character takes to go all the way round. */
export const TURN_MS = 820;
/** The wait between one character starting and the next. */
export const STAGGER_MS = 38;
/** A long word must not take longer than this from its first start to its last. */
export const STAGGER_CAP_MS = 520;

export interface TurnCell {
  from: string;
  to: string;
  /** Where the middle of the character starts and ends, in px from the left of the button's label. */
  fromX: number;
  toX: number;
  /** False: the same character before and after, which only slides. */
  turns: boolean;
  /** When this character starts to turn. */
  delayMs: number;
}

export interface TurnPlan {
  cells: TurnCell[];
  /** From the first character starting to the last one finishing. */
  totalMs: number;
}

/** One entry per character, not per UTF-16 unit, so "São" never splits a letter. */
export const glyphs = (text: string): string[] => Array.from(text);

/**
 * A character turns about its own middle, so every x here is a character's centre.
 *
 * @param fromX  the centre of each character of `from`, measured on the page
 * @param toX    the centre of each character of `to`
 * @param fromEnd  where the old phrase ends, which is where a cell with no old character starts
 * @param toEnd    where the new phrase ends, which is where a cell with no new character ends
 */
export function planTurn(
  from: string,
  to: string,
  fromX: readonly number[],
  toX: readonly number[],
  fromEnd: number,
  toEnd: number,
): TurnPlan {
  const a = glyphs(from);
  const b = glyphs(to);
  const shorter = Math.min(a.length, b.length);
  let head = 0;
  while (head < shorter && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < shorter - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;

  const cells: TurnCell[] = [];
  for (let i = 0; i < head; i++) {
    cells.push({ from: a[i], to: b[i], fromX: fromX[i], toX: toX[i], turns: false, delayMs: 0 });
  }

  const aMid = a.length - head - tail;
  const bMid = b.length - head - tail;
  const mid = Math.max(aMid, bMid);
  const stagger = mid > 1 ? Math.min(STAGGER_MS, STAGGER_CAP_MS / (mid - 1)) : 0;
  const aNext = tail > 0 ? fromX[a.length - tail] : fromEnd;
  const bNext = tail > 0 ? toX[b.length - tail] : toEnd;
  for (let k = 0; k < mid; k++) {
    const hasOld = k < aMid;
    const hasNew = k < bMid;
    cells.push({
      from: hasOld ? a[head + k] : "",
      to: hasNew ? b[head + k] : "",
      fromX: hasOld ? fromX[head + k] : aNext,
      toX: hasNew ? toX[head + k] : bNext,
      turns: true,
      delayMs: k * stagger,
    });
  }

  for (let i = 0; i < tail; i++) {
    const ai = a.length - tail + i;
    const bi = b.length - tail + i;
    cells.push({ from: a[ai], to: b[bi], fromX: fromX[ai], toX: toX[bi], turns: false, delayMs: 0 });
  }

  const spread = mid > 1 ? (mid - 1) * stagger : 0;
  return { cells, totalMs: mid > 0 ? TURN_MS + spread : TURN_MS };
}
