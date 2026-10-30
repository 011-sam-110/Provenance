// Whether the Sources pane is in the page, for the slide.
//
// WHY THIS EXISTS. The pane used to be swapped for its 26px tab in a single frame:
// `SourceCatalog` returned the tab when the store said "closed" and the aside when it
// said "open". A slide needs the aside to STAY in the page while it travels out, so
// "is the pane in the DOM" is no longer the same question as "is the rail open".
//
//   open     the store says open. The pane is in the page, at rest or sliding in.
//   leaving  the store says closed, the pane is still in the page and is sliding out.
//            It is `inert` and carries `data-leaving`, and the closed layout (the
//            map's room, the Sources tab) is already in force: see the
//            `:has(> .tn-rail:not([data-leaving]))` selectors in app/globals.css.
//   closed   the store says closed and the pane is gone.
//
// Pure, no React and no DOM, so the table is unit-tested and the component only
// decides WHEN `mounted` goes false (the end of the slide, or the fallback below).

export type RailPhase = "closed" | "open" | "leaving";

/** open: the store says open. mounted: the pane is still in the DOM. */
export function railPhase(open: boolean, mounted: boolean): RailPhase {
  if (open) return "open";
  return mounted ? "leaving" : "closed";
}

/**
 * Ends a leave if no `transitionend` ever arrives (a hidden tab, a browser without
 * the CSS). The slide out is 200 ms at most, so this only fires when something is
 * wrong, and the pane then goes the way it used to: in one frame.
 */
export const RAIL_LEAVE_FALLBACK_MS = 450;
