export type SegmentId = "left" | "right" | "bottom";
export type StageId = "map3d" | "map2d" | "clock";
export type WidgetTypeId = string;

/**
 * A widget's rectangle on the old Terminal grid, in CELLS. The grid itself is
 * gone — three resizable rails replaced it — but the shape is kept exported
 * because `sanitize.ts` still has to read it off LEGACY input: a `?c=` link
 * minted by an older build, or a `tn.console.v1` blob written before this
 * migration, can still carry `rect`/`stageRect`. `lib/terminal/rails.ts`'s
 * `railsFromRects` is the only thing left that constructs one.
 */
export interface GridRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WidgetInstance {
  id: string;
  type: WidgetTypeId;
  segment: SegmentId;   // which rail
  order: number;        // place in that rail, 0-based, contiguous
  height: number;       // px, its own height in the rail; the rail scrolls
  collapsed: boolean;   // header-only
  config: Record<string, unknown>;
}

export interface SegmentState { size: number; collapsed: boolean }

/**
 * The map stage's id. It predates the rail model, when the stage was a grid item
 * like any widget — draggable and resizable — and needed an id in the same
 * namespace. It survives as the FLIP key (`lib/terminal/flip.ts`) and the stage's
 * `data-grid-id` / DOM id, and `sanitize.ts` still keys legacy `rect` migration
 * off it. Widget ids are minted as `w<base36>` (see store.nextId), so a leading
 * underscore cannot collide.
 */
export const STAGE_ID = "__stage";

export interface ShellLayout {
  segments: Record<SegmentId, SegmentState>;
  stage: StageId;
  widgets: WidgetInstance[];
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
      // The map is the hero: it fills whatever the rails do not take. A fresh
      // layout opens with only the left rail sized — right and bottom are empty
      // and `effectiveRailSize` reports 0 for them regardless, but 0 here is
      // also the honest starting value rather than a size nothing occupies yet.
      left: { size: 320, collapsed: false },
      right: { size: 0, collapsed: false },
      bottom: { size: 0, collapsed: false },
    },
    stage: "map2d",
    widgets: [],
    focusedWidgetId: null,
  };
}

/** Deterministic id (no Math.random — keeps reducers pure/testable). */
export function newInstanceId(seq: number): string {
  return `w${seq.toString(36)}`;
}
