"use client";
// SplitFlap — a Solari-style flipboard readout for ONE string value.
//
// THE INVARIANTS (idea ported from GEV's flipboard, written fresh for this repo):
//
//   (a) UNCHANGED CHARACTERS NEVER ANIMATE — the diff planner (lib/hud/flapPlan.ts)
//       returns steps only for columns that differ.
//   (b) THE DOM TEXT NODE NEVER MOVES — every cell's real text node holds the
//       target glyph (the truth) and is sized by it; the VISIBLE glyphs are CSS
//       pseudo-elements driven by data-from / data-to attributes. React keys the
//       cells by index, so a change updates text nodes in place, never reorders
//       or remounts them.
//   (c) NO ANIMATION LOOP, EXACTLY ONE TIMER PER CHANGE — the cascade is pure CSS
//       animation; completion is the LAST cell's animationend, backed by a single
//       setTimeout safety net. Both funnel into one idempotent commit per
//       generation, and an interruption cancels the timer.
//   (d) INTERRUPTED CASCADES DERIVE OUTGOING GLYPHS FROM WHAT IS ACTUALLY VISIBLE —
//       on a new value mid-cascade, visibleAt(inFlight, elapsed) rebuilds the mixed
//       string the eye actually sees and re-plans from THAT.
//   (e) COLUMNS NEVER RENUMBER — indexes are positional; shrinking values flap
//       their trailing columns to a blank in place, growth flaps up from a blank.
//
// Reduced motion is read twice: once here (the planner collapses to instant, so
// no timer is even scheduled) and once in the CSS media query (belt and braces).

import { useEffect, useRef, useState } from "react";
import { planFlaps, visibleAt, type FlapPlan } from "@/lib/hud/flapPlan";
import styles from "./hud.module.css";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

interface CellModel {
  /** 0-based column index — positional, never renumbered. */
  index: number;
  /** The truth glyph for this column (the real text node's content). */
  ch: string;
  /** Glyph shown at rest / at flap start. */
  from: string;
  /** Glyph the flap lands on. */
  to: string;
  /** This column is animating right now. */
  flip: boolean;
  delay: number;
  dur: number;
}

/** Settled board: every column shows its truth glyph, nothing animating. */
function settled(text: string): CellModel[] {
  return Array.from(text, (ch, index) => ({
    index,
    ch,
    from: ch,
    to: ch,
    flip: false,
    delay: 0,
    dur: 0,
  }));
}

export default function SplitFlap({
  value,
  label,
  size = "md",
  animate = true,
  announce = true,
}: {
  /** The target string — always the truth this readout lands on. */
  value: string;
  /** Optional visible + announced label, e.g. "Cameras online". */
  label?: string;
  size?: "sm" | "md" | "lg";
  /** Split-flap animation enabled (the HUD setting). */
  animate?: boolean;
  /** aria-live="polite" for this readout. Clocks pass false — per-second
   *  announcements are noise; the counts and coordinates are the values that
   *  change meaningfully. */
  announce?: boolean;
}) {
  const [cells, setCells] = useState<CellModel[]>(() => settled(value));
  const [running, setRunning] = useState(false);

  const genRef = useRef(0); // cascade generation — stale commits are no-ops
  const visibleRef = useRef(value); // the string the glyphs ACTUALLY show
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<FlapPlan | null>(null);
  const startedAtRef = useRef(0);
  const lastCellRef = useRef(-1);

  function stopTimer() {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  /** The single commit path: settle the board on the in-flight plan's target. */
  function commit(gen: number) {
    if (gen !== genRef.current) return; // a newer cascade took over
    stopTimer();
    const final = inFlightRef.current?.text ?? visibleRef.current;
    inFlightRef.current = null;
    visibleRef.current = final;
    setRunning(false);
    setCells(settled(final));
  }

  useEffect(() => {
    // First mount (or a no-op change): settle in place, no cascade on first paint.
    if (value === visibleRef.current) return;

    genRef.current += 1;
    const gen = genRef.current;
    stopTimer();

    if (inFlightRef.current) {
      // Invariant (d): interrupted mid-cascade — the outgoing glyphs are what is
      // ACTUALLY visible right now, never the pre-cascade string. Cancelled CSS
      // animations snap back to their data-from glyph, which is exactly what
      // visibleAt reports for columns whose time has not yet arrived.
      const elapsed = performance.now() - startedAtRef.current;
      visibleRef.current = visibleAt(inFlightRef.current, elapsed);
    }

    const plan = planFlaps(visibleRef.current, value, {
      reducedMotion: !animate || prefersReducedMotion(),
    });

    if (!plan.animate) {
      // Instant (reduced motion / kill switch / no diff): truth is on screen
      // already, so there is nothing to time — invariant (c) schedules nothing.
      visibleRef.current = plan.text;
      inFlightRef.current = null;
      setRunning(false);
      setCells(settled(plan.text));
      return;
    }

    inFlightRef.current = plan;
    startedAtRef.current = performance.now();
    lastCellRef.current = plan.steps[plan.steps.length - 1].index;
    setRunning(true);

    const byIndex = new Map(plan.steps.map((s) => [s.index, s]));
    setCells(
      Array.from({ length: plan.columns }, (_, index) => {
        const s = byIndex.get(index);
        const ch = value[index] ?? "";
        return s
          ? { index, ch, from: s.from, to: s.to, flip: true, delay: s.start, dur: s.duration }
          : { index, ch, from: ch, to: ch, flip: false, delay: 0, dur: 0 };
      }),
    );

    // Invariant (c): EXACTLY ONE timer per change — a safety net in case the
    // animationend below is lost (hidden element, tab switch). The normal commit
    // is that event; whichever lands first clears the other.
    timerRef.current = setTimeout(() => commit(gen), plan.totalMs + 60);
  }, [value, animate]);

  // Unmount: never leave the one timer behind.
  useEffect(() => stopTimer, []);

  const onAnimationEnd = (e: React.AnimationEvent<HTMLSpanElement>) => {
    // Only the INCOMING fold counts, and only when it belongs to the last cell of
    // the cascade — earlier cells finishing is normal mid-flight noise.
    if (e.pseudoElement !== "::after") return;
    const cell = e.target as HTMLElement;
    if (!cell.classList.contains(styles.flipCell)) return;
    if (Number(cell.dataset.col) !== lastCellRef.current) return;
    commit(genRef.current);
  };

  return (
    <span
      className={`${styles.flap} ${styles[size]}`}
      data-tn-flap={label ?? "value"}
      data-flap-running={running ? "true" : "false"}
    >
      <span className={styles.announce} aria-live={announce ? "polite" : "off"}>
        {label ? `${label}: ${value}` : value}
      </span>
      {label ? (
        <span className={styles.label} aria-hidden="true">
          {label}
        </span>
      ) : null}
      {/* The board is decorative to ATs — the announce span above is the live
          text. aria-hidden, because the per-column text nodes duplicate it. */}
      <span className={styles.board} aria-hidden="true" onAnimationEnd={onAnimationEnd}>
        {cells.map((c) => (
          <span
            key={c.index}
            data-col={c.index}
            data-from={c.from}
            data-to={c.to}
            className={c.flip ? `${styles.cell} ${styles.flipCell}` : styles.cell}
            style={
              c.flip
                ? ({ "--flap-delay": `${c.delay}ms`, "--flap-dur": `${c.dur}ms` } as React.CSSProperties)
                : undefined
            }
          >
            {c.ch}
          </span>
        ))}
      </span>
    </span>
  );
}
