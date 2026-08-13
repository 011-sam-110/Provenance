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

export const MAX_WIDGETS = 50;

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
