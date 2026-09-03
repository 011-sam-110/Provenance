"use client";
import { useEffect, useState, type RefObject } from "react";
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

/**
 * The live size of the workspace grid, tracked as it changes.
 *
 * `visibleShell()` answers "how big is it right now?" once, which is all a board
 * preset needs when it composes itself. The rail clamp needs the answer to keep
 * arriving: `railSizes` divides the container width between the two side rails
 * and the map, so a window the user drags narrower has to push the rails in
 * rather than let them push the map below `STAGE_MIN_PX`.
 *
 * ── WHY THIS CANNOT LOOP ─────────────────────────────────────────────────────
 * A resize observer that feeds a value which changes the observed element is the
 * classic infinite render. It is safe here for a structural reason rather than a
 * lucky one: the observed element is the GRID CONTAINER, which fills its parent
 * band. Rail sizes redistribute space INSIDE it and never change its own box,
 * so a rail drag cannot re-trigger this. The identity check below is a second
 * belt — React bails out of a re-render when the state object is unchanged, so
 * a sub-pixel jitter cannot produce a render either.
 */
export function useShellBox(ref: RefObject<HTMLElement | null>): { w: number; h: number } {
  const [box, setBox] = useState<{ w: number; h: number }>(visibleShell);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const read = () => {
      const r = el.getBoundingClientRect();
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      // A zero box is a layout that has not happened yet, not a real size. The
      // authored fallback is better than dividing a stage into nothing.
      if (w <= 0 || h <= 0) return;
      setBox((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };

    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return box;
}
