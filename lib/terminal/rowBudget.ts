"use client";
// How much room the workspace actually has on this screen.
//
// ── WHY THIS HAS TO BE MEASURED ──────────────────────────────────────────────
// Board defaults used to be authored in absolute rows with no idea how tall the
// window was, and the result was measured in the running app at 1440x900:
//
//     .tn-cw-shell (the workspace band)  clientHeight  820px
//     .tn-seg      (the grid)            scrollHeight 1249px
//
// 429px — a third of the board — hanging past the bottom of the band. And it was
// not merely below the fold: `.tn-terminal .tn-cw-shell` is `overflow: hidden`,
// while the grid carried an inline `min-height` equal to its own content, so the
// grid never overflowed ITSELF and its `overflow: auto` never engaged. Setting
// `scrollTop` on it did nothing. The bottom card of every board was unreachable.
//
// The grid is gone now — a rail scrolls, so a widget too tall for the window is
// merely a scroll, not a clipped card — but the STAGE still needs a real
// container size to divide with the rails against (`effectiveRailSize`'s
// `container.w`), so the measurement stays. `visibleShell()` reports the same
// `.tn-cw-shell` element's content box in px; there is no more row unit to
// convert it into.

/** The element the rails and the stage share. Kept here so the selector that
 *  the measurement depends on is written down once, next to the reason it
 *  matters. */
const BAND_SELECTOR = ".tn-terminal .tn-cw-shell";

/** The fixed chrome above and below the band that a first-paint measurement
 *  cannot see yet — measured, not guessed, from the running app at a 900px-tall
 *  viewport where the band came to 820. */
const CHROME_PX = 80;

/** A container size nothing can render into: the last-resort fallback when
 *  there is no DOM and no window at all (SSR, a node test). */
const FALLBACK: { w: number; h: number } = { w: 1440, h: 820 };

/**
 * The workspace's content box right now, in px.
 *
 * Measures the band; falls back to the viewport minus the chrome it cannot see,
 * and finally to an authored default. Never throws and never returns a zero
 * size — a stage with no room is a blank screen, which is a worse failure than
 * one sized for the wrong window.
 */
export function visibleShell(): { w: number; h: number } {
  if (typeof document === "undefined") return FALLBACK;
  const band = document.querySelector(BAND_SELECTOR);
  if (band && band.clientWidth > 0 && band.clientHeight > 0) {
    return { w: band.clientWidth, h: band.clientHeight };
  }

  // First paint: the band exists in the tree but has not been laid out yet.
  if (typeof window !== "undefined" && window.innerWidth > 0 && window.innerHeight > 0) {
    return { w: window.innerWidth, h: Math.max(1, window.innerHeight - CHROME_PX) };
  }
  return FALLBACK;
}
