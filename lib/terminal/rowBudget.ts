"use client";
// How many grid rows actually fit on this screen.
//
// ── WHY THIS HAS TO BE MEASURED ──────────────────────────────────────────────
// Board defaults used to be authored in absolute rows with no idea how tall the
// window was, and the result was measured in the running app at 1280x800:
//
//     .tn-cw-shell (the workspace band)  clientHeight  820px
//     .tn-seg      (the grid)            scrollHeight 1249px
//
// 429px — a third of the board — hanging past the bottom of the band. And it was
// not merely below the fold: `.tn-terminal .tn-cw-shell` is `overflow: hidden`,
// while the grid carries an inline `min-height` equal to its own content, so the
// grid never overflows ITSELF and its `overflow: auto` never engages. Setting
// `scrollTop` on it does nothing. The bottom card of every board was unreachable.
//
// So a board has to be laid out against a row budget taken from the real element,
// not a constant. `DEFAULT_BOARD_ROWS` remains the answer off-DOM (server render,
// node tests) — it is not a fallback anybody should be relying on in the browser.

import { DEFAULT_BOARD_ROWS, GAP_PX, ROW_PX } from "@/lib/terminal/layoutGrid";

/** The element the grid is laid out inside. Kept here so the selector that the
 *  measurement depends on is written down once, next to the reason it matters. */
const BAND_SELECTOR = ".tn-terminal .tn-cw-shell";

/** Rows that fit in `px` of vertical space. */
export function rowsForHeight(px: number): number {
  if (!(px > 0)) return DEFAULT_BOARD_ROWS;
  // n rows occupy n*ROW_PX + (n-1)*GAP_PX, so the last gap is added back before
  // dividing. Off by one row here is a clipped card or a dead strip, every time.
  return Math.max(1, Math.floor((px + GAP_PX) / (ROW_PX + GAP_PX)));
}

/**
 * Rows available for a board right now.
 *
 * Measures the workspace band; falls back to the viewport minus the chrome it
 * cannot see, and finally to the authored default. Never throws and never returns
 * 0 — a board with no rows is a blank screen, which is a worse failure than a
 * board sized for the wrong window.
 */
export function visibleRows(): number {
  if (typeof document === "undefined") return DEFAULT_BOARD_ROWS;
  const band = document.querySelector(BAND_SELECTOR);
  if (band && band.clientHeight > 0) return rowsForHeight(band.clientHeight);

  // First paint: the band exists in the tree but has not been laid out yet. The
  // header (34px), the feed-health strip and the status bar are the fixed chrome
  // above and below it — measured, not guessed, from the running app at 900px
  // viewport height where the band came to 820.
  const CHROME_PX = 80;
  if (typeof window !== "undefined" && window.innerHeight > 0) {
    return rowsForHeight(window.innerHeight - CHROME_PX);
  }
  return DEFAULT_BOARD_ROWS;
}
