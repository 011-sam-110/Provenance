// The split-flap DIFF PLANNER — a pure function from (previous string, next string)
// to a per-column cascade schedule. No React, no DOM, no timers: the component owns
// the one timer, this module owns the arithmetic, and tests/unit/flap-plan.test.ts
// pins every invariant below.
//
// The invariants (ported as ideas from GEV's Solari flipboard, written for this
// repo's calm light identity):
//
//   (a) UNCHANGED CHARACTERS NEVER ANIMATE. The diff is positional, so only columns
//       where prev[i] !== next[i] get a step.
//   (b) THE TRUTH IS THE TEXT. A plan only ever DESCRIBES glyphs; the DOM text node
//       (see SplitFlap.tsx) always holds the target string, and the glyphs are CSS
//       pseudo-elements driven by data attributes.
//   (c) NO LOOP, ONE TIMER. A plan is a schedule of starts; the component schedules
//       exactly one completion timer per change and otherwise lets CSS animation +
//       animationend run the cascade.
//   (d) INTERRUPTION DERIVES FROM WHAT IS VISIBLE. `visibleAt(plan, t)` reconstructs
//       the mixed string actually on screen at time t, so a mid-cascade change
//       re-plans from that — never from the pre-cascade string.
//   (e) COLUMNS NEVER RENUMBER. Indexes are positional and stable; a shrinking value
//       flaps its trailing columns to a blank IN PLACE (to: ""), and growth flaps new
//       columns up from a blank (from: "").

/** THE ONE-LINE KILL SWITCH. Set `FLAP_KILL_SWITCH.on = true` to collapse every
 *  cascade to instant — no stagger, no durations, no timers downstream.
 *  Reduced-motion preference has the same effect per-call via opts.reducedMotion;
 *  this is the global emergency brake a CSS animation bug can be retired behind
 *  without a code change. (An object, not a `let`, so an ESM importer — and the
 *  unit test — can actually throw it.) */
export const FLAP_KILL_SWITCH = { on: false };

/** Total cascade budget — every cascade, however many columns change, settles
 *  inside this many milliseconds. Stagger compresses to fit (see planFlaps). */
export const FLAP_BUDGET_MS = 600;

/** One flap's own animation length. */
export const FLAP_DURATION_MS = 240;

/** The natural stagger between adjacent flaps; compressed when the column count
 *  would otherwise blow the budget. */
export const FLAP_STAGGER_MAX_MS = 60;

export interface FlapStep {
  /** 0-based column index. Positional and stable — never renumbered. */
  index: number;
  /** Glyph visible when this step starts ("" = blank column). */
  from: string;
  /** Glyph to land on ("" = flap to a blank). */
  to: string;
  /** Cascade-relative start, ms. */
  start: number;
  /** Animation length, ms. 0 = instant (reduced motion / kill switch). */
  duration: number;
}

export interface FlapPlan {
  /** The string this plan lands on — always equal to the `next` argument. */
  text: string;
  /** Column count while this cascade runs: max(prev.length, next.length), so a
   *  shrinking label keeps its blank columns in place instead of renumbering. */
  columns: number;
  /** Only the columns that differ. Empty ⇒ nothing moves. */
  steps: FlapStep[];
  /** Start-to-settle length of the whole cascade, ms. */
  totalMs: number;
  /** False when nothing animates (reduced motion, kill switch, or no diff). */
  animate: boolean;
}

export interface FlapOptions {
  /** Cascade budget override, ms. Defaults to FLAP_BUDGET_MS. */
  budgetMs?: number;
  /** prefers-reduced-motion: every step is instant. */
  reducedMotion?: boolean;
}

/** A single-character step (or the empty string for a blank column). */
function charAt(s: string, i: number): string {
  return s[i] ?? "";
}

/**
 * Plan the cascade from `prev` to `next`.
 *
 * Stagger compression: the first flap starts immediately and the last one must
 * settle inside `budgetMs`. With few columns the natural 60ms stagger runs free
 * (a 2-column change settles in 300ms); with many, the stagger shrinks so the
 * whole board still settles within the budget rather than serialising N × 240ms.
 */
export function planFlaps(prev: string, next: string, opts: FlapOptions = {}): FlapPlan {
  const budget = opts.budgetMs ?? FLAP_BUDGET_MS;
  const animate = !FLAP_KILL_SWITCH.on && !opts.reducedMotion;

  const columns = Math.max(prev.length, next.length);
  const changed: { index: number; from: string; to: string }[] = [];
  for (let i = 0; i < columns; i++) {
    const from = charAt(prev, i);
    const to = charAt(next, i);
    if (from !== to) changed.push({ index: i, from, to });
  }

  // Nothing to do, or animation collapsed: steps exist only so callers can see
  // what WOULD have moved, with zero duration and zero stagger — instant.
  if (changed.length === 0 || !animate) {
    return {
      text: next,
      columns,
      steps: changed.map((c) => ({ ...c, start: 0, duration: 0 })),
      totalMs: 0,
      animate: false,
    };
  }

  const duration = FLAP_DURATION_MS;
  const usable = Math.max(0, budget - duration);
  const stagger =
    changed.length > 1
      ? Math.min(FLAP_STAGGER_MAX_MS, usable / (changed.length - 1))
      : 0;
  const steps: FlapStep[] = changed.map((c, k) => ({
    ...c,
    start: k * stagger,
    duration,
  }));

  return {
    text: next,
    columns,
    steps,
    totalMs: (steps.length - 1) * stagger + duration,
    animate: true,
  };
}

/**
 * The string ACTUALLY VISIBLE `elapsedMs` into a running plan — the interruption
 * ground truth. A column shows its `to` glyph only once its own animation has
 * finished (start + duration); before that it still shows `from`. Unchanged
 * columns show their shared glyph throughout.
 *
 * This is what invariant (d) is built on: when a new value arrives mid-cascade,
 * the caller feeds THIS string back into planFlaps as `prev`, so a cancelled
 * half-flipped column re-plans from the glyph the eye actually sees — not from
 * the glyph that was on screen two values ago.
 */
export function visibleAt(plan: FlapPlan, elapsedMs: number): string {
  const t = Math.max(0, elapsedMs);
  const glyphs: string[] = Array.from({ length: plan.columns }, (_, i) => charAt(plan.text, i));
  for (const s of plan.steps) {
    glyphs[s.index] = t >= s.start + s.duration ? s.to : s.from;
  }
  return glyphs.join("");
}
