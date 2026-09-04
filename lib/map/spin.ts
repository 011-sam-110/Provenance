// How long a resting globe keeps turning, and how it stops.
//
// THE FINDING THIS EXISTS FOR. A rotating globe is the console's resting state and
// the landing hero's opening impression, and it is also the single largest compute
// cost either page has. Measured on production, main-thread busy over a 10 s window
// with nobody touching anything:
//
//                      as shipped   motion off
//   /app  console         60.8%        3.4%
//   /     landing         83.1%       18.9%
//
// At a 4x CPU throttle both pages sit at ~101%, so every scroll, hover and click is
// competing for time that has already been spent.
//
// THE THING THAT DOES NOT WORK, so nobody tries it a third time. Slowing the spin
// down does not help. Rate-limited to 30 fps it measured 99.4% busy; at 20 fps,
// 99.6%. Unchanged. A moving camera forces MapLibre to re-render the whole globe
// regardless of how often the centre actually moves, so the cost is the movement,
// not the frequency of the update. Only NOT MOVING is cheaper.
//
// So the globe turns, and then it settles. It is the arrival impression, kept, with
// the main thread handed back a few seconds later — rather than a choice between an
// animation that never stops and a dead sphere.
//
// The envelope is shared by both globes deliberately. They are two separate spin
// implementations in two files (WorldMap's setCenter loop and HeroGlobe's jumpTo
// loop) and there is no prospect of merging them, so the least that can be done is
// give them one definition of when to stop.

/** How long the globe turns, in total, before it has settled. */
export const SPIN_SETTLE_MS = 8000;

/**
 * The tail of that budget spent easing to a stop rather than turning at full rate.
 *
 * A globe that stops on a frame boundary reads as a dropped frame — the eye sees a
 * stall, not a decision. Easing out over roughly a second reads as coming to rest.
 */
export const SPIN_EASE_MS = 1200;

export interface SpinEnvelope {
  /** Multiplier on the caller's own spin rate, 1 at full speed down to 0 at rest. */
  factor: number;
  /** Once true, the caller should stop scheduling frames entirely. */
  settled: boolean;
}

/** Smoothstep. Eases in and out rather than arriving at zero with a corner. */
function smooth(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/**
 * The spin rate multiplier after `spentMs` of cumulative spinning.
 *
 * `spentMs` counts time actually SPENT SPINNING, not wall-clock since load. That
 * distinction is the whole behaviour: a visitor who grabs the globe, or opens a
 * dossier, or switches tabs pauses the budget rather than burning it, so the globe
 * they come back to still has its remaining turn. Wall-clock would mean a slow first
 * paint could deliver an already-motionless globe, which is the one outcome that
 * makes the settle look like a bug.
 */
export function spinEnvelope(spentMs: number): SpinEnvelope {
  if (!(spentMs > 0)) return { factor: 1, settled: false };
  if (spentMs >= SPIN_SETTLE_MS) return { factor: 0, settled: true };

  const easeStart = SPIN_SETTLE_MS - SPIN_EASE_MS;
  if (spentMs <= easeStart) return { factor: 1, settled: false };

  return { factor: smooth((SPIN_SETTLE_MS - spentMs) / SPIN_EASE_MS), settled: false };
}
