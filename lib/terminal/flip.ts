"use client";

// ── FLIP, for a CSS-grid board ───────────────────────────────────────────────
//
// The Terminal places cards with `grid-column` / `grid-row`. Those are grid LINE
// numbers, and line numbers do not tween — a card whose row changes from 4 to 9
// is simply drawn in the new place on the next frame. Without help, every move,
// resize, add, remove and auto-arrange is a teleport.
//
// FLIP fixes that without giving up grid: measure every card (First), let the
// layout change (Last), apply the transform that puts each card back where it
// visually was (Invert), then release it to zero over a transition (Play). The
// browser animates a compositor-only `transform` while the real layout is already
// final, so nothing reflows mid-animation.
//
// Scale is included as well as translate, so a card that CHANGED SIZE animates
// too — otherwise a resize that pushes a neighbour wider would slide it but snap
// its width. The cost is that content inside a scaling card is briefly squashed;
// at ~200ms on a card of small text this reads as motion blur rather than as
// distortion, and the alternative (animating width/height) would reflow the whole
// grid on every frame.

/** Elements to animate, keyed so First and Last can be matched up across the DOM
 *  change. Anything present in only one of the two passes is skipped. */
export interface FlipOptions {
  /** ms. 0 disables the animation entirely — what reduced-motion resolves to. */
  duration: number;
  easing: string;
  /** Ids left untouched. The card under the pointer is already tracking it 1:1;
   *  animating it as well would fight the drag. */
  skip?: ReadonlySet<string>;
}

const KEY = "data-grid-id";

function measure(container: HTMLElement): Map<string, DOMRect> {
  const out = new Map<string, DOMRect>();
  for (const el of container.querySelectorAll<HTMLElement>(`[${KEY}]`)) {
    const id = el.getAttribute(KEY);
    if (id) out.set(id, el.getBoundingClientRect());
  }
  return out;
}

/**
 * Capture positions now, and return a function that animates from them to
 * wherever things have ended up by the time it is called.
 *
 * Split into two calls rather than taking a mutate callback because the layout
 * change is a React state update: it does not happen synchronously inside a
 * function we could wrap, it happens when React commits. Callers snapshot in the
 * event handler and play in a layout effect.
 */
export function captureFlip(container: HTMLElement | null): (opts: FlipOptions) => void {
  if (!container) return () => {};
  const first = measure(container);

  return ({ duration, easing, skip }: FlipOptions) => {
    if (duration <= 0) return;

    for (const el of container.querySelectorAll<HTMLElement>(`[${KEY}]`)) {
      const id = el.getAttribute(KEY);
      if (!id || skip?.has(id)) continue;
      const before = first.get(id);
      if (!before) continue; // newly added — it should appear, not fly in

      const after = el.getBoundingClientRect();
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      const sx = after.width > 0 ? before.width / after.width : 1;
      const sy = after.height > 0 ? before.height / after.height : 1;

      // Sub-pixel differences are rounding, not movement. Animating them costs a
      // composited layer per card for something nobody can see.
      const still =
        Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 &&
        Math.abs(sx - 1) < 0.005 && Math.abs(sy - 1) < 0.005;
      if (still) continue;

      el.style.transition = "none";
      el.style.transformOrigin = "top left";
      el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    }

    // One rAF for the whole batch: the inverted transforms above must be painted
    // before the release, or the browser coalesces both into no animation at all.
    requestAnimationFrame(() => {
      for (const el of container.querySelectorAll<HTMLElement>(`[${KEY}]`)) {
        const id = el.getAttribute(KEY);
        if (!id || skip?.has(id) || !el.style.transform) continue;
        el.style.transition = `transform ${duration}ms ${easing}`;
        el.style.transform = "";
      }
    });
  };
}

/** Default motion. Tuned in the design workbench: 200ms is long enough to read as
 *  a move and short enough not to delay the next drag, and the slight overshoot is
 *  what makes a card read as SNAPPING into a cell rather than drifting to a stop. */
export const SNAP_MS = 200;
export const SNAP_EASE = "cubic-bezier(0.34, 1.28, 0.64, 1)";

/** Animate one element from a known box to wherever it is now. Used on release,
 *  where the dragged card has to travel from the pointer into its snapped cell —
 *  the moment the whole feature is judged on. */
export function flipOne(
  el: HTMLElement,
  from: DOMRect,
  opts: { duration: number; easing: string },
): void {
  if (opts.duration <= 0) return;
  const to = el.getBoundingClientRect();
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  const sx = to.width > 0 ? from.width / to.width : 1;
  const sy = to.height > 0 ? from.height / to.height : 1;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.005 && Math.abs(sy - 1) < 0.005) return;

  el.style.transition = "none";
  el.style.transformOrigin = "top left";
  el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
  requestAnimationFrame(() => {
    el.style.transition = `transform ${opts.duration}ms ${opts.easing}`;
    el.style.transform = "";
  });
}

/** Clear anything FLIP left on an element. Safe to call on an element it never
 *  touched — which matters, because a card can be unmounted mid-animation. */
export function clearFlip(el: HTMLElement): void {
  el.style.transition = "";
  el.style.transform = "";
  el.style.transformOrigin = "";
}
