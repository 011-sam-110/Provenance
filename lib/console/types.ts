export type SegmentId = "left" | "right" | "bottom";
export type StageId = "map3d" | "map2d" | "clock";
export type WidgetTypeId = string;

/**
 * A widget's rectangle on the twelve-column grid, in CELLS. x/y are 0-based.
 *
 * This was legacy-only between #146 and now: the rails reskin deleted the grid,
 * and the shape survived purely so `sanitize.ts` could read a rect off an older
 * `?c=` link or `tn.console.v1` blob and migrate it away. It is load-bearing
 * again for `mode: "wall"` boards, where it IS the widget's position — but the
 * legacy read is unchanged and still runs for every rails-mode layout.
 *
 * `lib/terminal/layoutGrid.ts` owns the arithmetic over this shape and re-exports
 * the type rather than declaring a second one.
 */
export interface GridRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Which engine lays a board out.
 *
 * `"rails"` — a fixed hero map with three resizable rails around it. A widget's
 * position is which rail it is in and where in that rail's stack it sits. This is
 * every board, and it is what a layout with no `mode` at all means.
 *
 * `"wall"` — a free twelve-column grid of tiles with the map moved out of it into
 * a dock. A widget's position is its `rect`. Exactly one board ships this today:
 * Streets, whose entire purpose is a camera wall the user arranges.
 *
 * THE DEFAULT IS LOAD-BEARING. Reading an absent `mode` as `"rails"` is what lets
 * every layout already in localStorage, every archived board and every `?c=` link
 * minted before this change keep behaving exactly as it does now, with no layout
 * version bump and therefore nobody's saved board wiped to add a field.
 */
export type LayoutMode = "rails" | "wall";

export interface WidgetInstance {
  id: string;
  type: WidgetTypeId;
  segment: SegmentId;   // which rail
  order: number;        // place in that rail, 0-based, contiguous
  height: number;       // px, its own height in the rail; the rail scrolls
  collapsed: boolean;   // header-only
  config: Record<string, unknown>;
  /**
   * Its rectangle on a `mode: "wall"` board. Absent in rails mode.
   *
   * `segment`, `order` and `height` stay populated and valid in BOTH modes — a
   * wall simply does not read them for placement. That is deliberate rather than
   * lazy: it means switching a board between modes needs no migration in either
   * direction, because `railsFromRects` can already derive a rail placement from
   * a rect and `arrangeWall` can derive rects from an ordered list.
   */
  rect?: GridRect;
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
  /** Which engine lays this board out. Absent on stored input means "rails". */
  mode: LayoutMode;
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
    mode: "rails",
  };
}

/** Deterministic id (no Math.random — keeps reducers pure/testable). */
export function newInstanceId(seq: number): string {
  return `w${seq.toString(36)}`;
}
