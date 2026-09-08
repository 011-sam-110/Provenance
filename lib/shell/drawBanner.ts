// What the draw banner SAYS, and WHERE it sits. Pure — no React, no DOM.
//
// WHY THE COPY LEFT THE COMPONENT. vitest here is `environment: "node"` over
// `tests/unit/**/*.test.ts` and no React testing library is installed, so anything
// written inside components/shell/DrawBanner.tsx cannot be tested at all. The
// banner is the only on-screen narration of a live draw once the map rail's flyout
// is closed, and its wording carries decisions a later edit would quietly undo —
// see `steps` below. Same split, and the same reason, as lib/shell/devnotice.ts and
// lib/console/mapRail.ts.
//
// WHY THE GEOMETRY IS HERE TOO. `placeBanner` is the arithmetic that stops the pill
// sitting off-centre over the map; it is the half of the fix most likely to be got
// wrong at an edge (a stage narrower than the pill, a viewport narrower than
// either) and the half a browser check is worst at catching, because those edges
// need a window nobody resizes to by accident.

import { MIN_VERTICES, formatRadius, type DrawState } from "@/lib/map/aoi";

/** One instruction, and the keys that perform it. */
export interface DrawStep {
  text: string;
  /** Rendered as <kbd> chips after the text. Empty when the step is a mouse gesture. */
  keys: string[];
}

/** Everything the banner prints, already decided. */
export interface DrawBannerModel {
  /** What is happening. Fixed for the whole gesture, so the eye can lock onto it. */
  lead: string;
  /**
   * The live value the analyst is tracking, given its own weight on screen.
   * `null` while the gesture has produced nothing to report — a radius has no
   * number until a centre has been clicked, and printing "0 m" there would be
   * stating a measurement that has not been taken.
   */
  value: { text: string; label: string } | null;
  /** How to place the next thing, then how to finish. At most two. */
  steps: DrawStep[];
}

/**
 * The banner's words for one draw state.
 *
 * TWO REGISTERS WITH DIFFERENT JOBS, which is why `lead` and `steps` are separate
 * fields rather than one sentence. The lead does not change during a gesture, so it
 * is the thing that can be recognised without being read. The steps change as the
 * gesture progresses and are the part worth re-reading.
 *
 * BELOW THE MINIMUM, THE SECOND STEP NAMES WHAT IS MISSING rather than what is
 * there. The question at that stage is "when does this become an area", not "how
 * far have I come" — and the count beside it is already answering the second one,
 * so repeating it would spend the only other line on a fact the user can already
 * see. This is the one piece of wording in the banner that was reasoned about
 * before it was written; keep it.
 *
 * `circle` is an EXTERNAL tool (see setExternalDraw in lib/map/aoi.ts) — a
 * press-centre-and-drag gesture owned by another surface. It reports the same
 * centre and radiusKm as `radius`, so it differs only in the verb: "click again to
 * set the edge" would be describing the wrong gesture.
 */
export function drawBannerModel(draw: DrawState): DrawBannerModel {
  if (draw.tool === "circle" || draw.tool === "radius") {
    const circle = draw.tool === "circle";
    const started = draw.center != null;
    return {
      lead: circle ? "Drawing a circle" : "Drawing a radius",
      value: started ? { text: formatRadius(draw.radiusKm ?? 0), label: "radius" } : null,
      steps: [
        started
          ? { text: circle ? "Release to set it" : "Click again to set the edge", keys: [] }
          : {
              text: circle
                ? "Press on the map and drag out from the centre"
                : "Click the centre on the map",
              keys: [],
            },
      ],
    };
  }

  const placed = draw.vertices.length;
  const short = MIN_VERTICES - placed;
  return {
    lead: "Drawing an area",
    // Zero is printed, not hidden. "It is hard to tell if you have clicked and if
    // you are actually drawing" is the report this banner exists to answer, and a
    // count that only appears once it is non-zero says nothing at the exact moment
    // the user is asking.
    value: { text: String(placed), label: placed === 1 ? "point" : "points" },
    steps: [
      {
        text: placed === 0 ? "Click the map to place your first point" : "Click the map to add a point",
        keys: [],
      },
      short > 0
        ? {
            // "3 more" reads as a correction when nothing has been placed yet, so
            // the empty state states the requirement instead of a shortfall.
            text: placed === 0 ? `${MIN_VERTICES} points make an area` : `${short} more to make an area`,
            keys: [],
          }
        : { text: "Double-click to finish, or press", keys: ["Enter"] },
    ],
  };
}

/** A horizontal band on screen, in CSS px: where it starts and how wide it is. */
export interface Band {
  left: number;
  width: number;
  top: number;
}

/**
 * The narrowest the pill may be squeezed before it stops being squeezed.
 *
 * Under this the two step lines break into single words and the pill reads as
 * damage rather than as a narrow layout, so it is allowed to overhang the stage
 * instead — it is `pointer-events: none` everywhere but its Cancel button, so
 * overhanging costs nothing except a few pixels of a rail it is sitting over.
 */
export const MIN_BANNER_PX = 260;

/** Clearance between the pill and the edges of the band it is centred in. */
const GUTTER_PX = 24;
/** Drop from the top of the stage to the top of the pill. */
const TOP_GAP_PX = 14;
/** Clearance between the pill and another banner it has to stack under. */
const STACK_GAP_PX = 8;

export interface BannerPlacement {
  /** Viewport x of the pill's CENTRE — it is positioned with translateX(-50%). */
  left: number;
  /** Viewport y of the pill's top edge. */
  top: number;
  /** The widest the pill may grow. */
  maxWidth: number;
}

export interface BannerAnchors {
  /** The map stage the banner belongs to. */
  stage: Band;
  /** Another top-centred banner on the same stage, if one is up. */
  above: { bottom: number } | null;
  /** window.innerWidth. */
  viewport: number;
}

/**
 * Where the pill goes, measured rather than derived from layout variables.
 *
 * WHY MEASURED. The obvious fix is to reuse `--tn-lw` / `--tn-rw`, the live widget
 * rail widths. They are unreachable from here: ConsoleWorkspace spreads them onto
 * `.tn-cw-shell`, and the banner is mounted by ConsoleShell as a SIBLING of that
 * element, so a `var(--tn-lw)` in its CSS resolves to nothing and takes the whole
 * `calc()` down with it. Nor would they be enough — the Sources rail is not a
 * widget rail at all; it insets the console with `padding-left: var(--tn-rail-w)`
 * on `.tn-cw-shell`, which is a third number in a third place. The stage's own
 * bounding box is the one value that already has all of them folded in, and it
 * cannot drift from the layout the way a second copy of the arithmetic would.
 *
 * `above` stacks the pill under another top-centred banner instead of covering it.
 * Today that is `.tn-arm-hint`, which WorldMap shows for the whole of a camera pick
 * — and picking cameras BY AREA runs a draw inside a pick, so both are up at once.
 * Covering it would hide the only line that says how to leave pick mode.
 *
 * The centre is CLAMPED into the viewport rather than trusted: on a narrow window
 * the stage can be narrower than the pill's floor, and centring on it exactly would
 * push a Cancel button off the edge of the screen.
 */
export function placeBanner(a: BannerAnchors): BannerPlacement {
  const usable = a.stage.width > 0 ? a.stage : { left: 0, width: a.viewport, top: a.stage.top };
  const maxWidth = Math.max(
    MIN_BANNER_PX,
    Math.min(usable.width - GUTTER_PX, Math.max(a.viewport - GUTTER_PX, MIN_BANNER_PX)),
  );

  const half = maxWidth / 2;
  const lo = half + GUTTER_PX / 2;
  const hi = a.viewport - half - GUTTER_PX / 2;
  const wanted = usable.left + usable.width / 2;
  // lo > hi means the pill is wider than the viewport can hold with its gutters —
  // there is no honest clamp, so it is centred and allowed to overhang evenly.
  const left = lo > hi ? a.viewport / 2 : Math.min(Math.max(wanted, lo), hi);

  const base = a.stage.top + TOP_GAP_PX;
  const top = a.above ? Math.max(base, a.above.bottom + STACK_GAP_PX) : base;

  return { left, top, maxWidth };
}
