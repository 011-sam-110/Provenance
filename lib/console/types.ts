export type SegmentId = "left" | "right" | "bottom";
export type StageId = "map3d" | "map2d" | "clock";
export type WidgetTypeId = string;

/** A widget's rectangle on the Terminal grid, in CELLS. See lib/terminal/layoutGrid. */
export interface GridRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WidgetInstance {
  id: string;
  type: WidgetTypeId;
  /** LEGACY. Kept because all six built-in presets, every `?c=` share link and
   *  every persisted `tn.console.v1` layout are authored in these four fields.
   *  They are the input `fromLegacy()` seeds `rect` from on first load, and the
   *  authoring vocabulary presets still use — they are NOT what gets rendered. */
  segment: SegmentId;
  order: number;
  width: number;        // column span 1..12
  height: number;       // px
  /** What the Terminal actually draws. Absent only until the first sanitize pass
   *  fills it — `sanitizeLayout` guarantees every widget has one after load, so
   *  render paths can treat a missing rect as a bug rather than a state. */
  rect?: GridRect;
  collapsed: boolean;   // header-only
  config: Record<string, unknown>;
}

export interface SegmentState { size: number; collapsed: boolean }

/**
 * The map stage's id on the grid. It is a grid item like any widget — draggable
 * and resizable — so it needs an id in the same namespace. Widget ids are minted
 * as `w<base36>` (see store.nextId), so a leading underscore cannot collide.
 */
export const STAGE_ID = "__stage";

export interface ShellLayout {
  segments: Record<SegmentId, SegmentState>;
  stage: StageId;
  widgets: WidgetInstance[];
  /** The map stage's cell on the Terminal grid. Same units as WidgetInstance.rect. */
  stageRect?: GridRect;
  /** The widget expanded onto the center stage, or null when the map is shown. */
  focusedWidgetId: string | null;
}

/**
 * A runaway-writer backstop, not a product limit.
 *
 * Raised from 50 for the Streets board, where "as many camera slots as you want" is
 * the requirement rather than a nice-to-have. Three things were checked before
 * raising it, because a cap removed for the wrong reason is how a console gets slow:
 *
 *  • STORAGE is not the constraint. A camera StreamRef is ~35 bytes of JSON, so even
 *    200 slots holding 10 streams each is ~70 KB against localStorage's ~5 MB.
 *  • NETWORK is not the constraint any more. A camslot only fetches the stream it is
 *    showing, and stops entirely when scrolled out of view (IntersectionObserver), so
 *    200 slots cost what the dozen on screen cost.
 *  • The DRAG PATH is the thing to watch: boards.ts re-parses its whole archive on
 *    every cell crossing of every drag. That is a real cost and it is why this is 200
 *    rather than unbounded.
 */
export const MAX_WIDGETS = 200;

/** The ONLY wording of the widget-cap toast, derived from MAX_WIDGETS so the
 *  number cannot drift out of the copy again. It read "50-widget limit" in four
 *  separate call sites while the cap here was already 200, so every user who hit
 *  the cap was told a number four times too small. Import this; never retype it. */
export const WIDGET_LIMIT_MESSAGE = `${MAX_WIDGETS}-widget limit — remove one to add another`;

export function createDefaultLayout(): ShellLayout {
  return {
    segments: {
      left: { size: 300, collapsed: false },
      right: { size: 300, collapsed: false },
      bottom: { size: 220, collapsed: false },
    },
    stage: "map2d",
    widgets: [],
    // The stage's opening cell: the middle six of twelve columns, leaving a rail
    // either side for the first widgets to land in. Kept as a literal rather than
    // read from layoutGrid's arrangeConsole so this module stays dependency-free —
    // createDefaultLayout is imported by sanitize, which layoutGrid must not import
    // back.
    stageRect: { x: 3, y: 0, w: 6, h: 14 },
    focusedWidgetId: null,
  };
}

/** Deterministic id (no Math.random — keeps reducers pure/testable). */
export function newInstanceId(seq: number): string {
  return `w${seq.toString(36)}`;
}
