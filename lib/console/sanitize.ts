import {
  createDefaultLayout, MAX_WIDGETS, STAGE_ID,
  type GridRect, type ShellLayout, type SegmentId, type StageId, type WidgetInstance,
} from "@/lib/console/types";
import { clampSpan } from "@/lib/console/resize";
import { clampRect, fromLegacy, settle, type GridItem } from "@/lib/terminal/layoutGrid";

const SEGMENTS: SegmentId[] = ["left", "right", "bottom"];
const STAGES: StageId[] = ["map3d", "map2d", "clock"];
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** A rect only if the input is a complete, finite one — a half-written rect is
 *  treated as absent so the board falls back to the legacy migration rather than
 *  rendering one widget at a corrupt position. */
function readRect(v: unknown): GridRect | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const nums = [r.x, r.y, r.w, r.h];
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return clampRect({ x: r.x as number, y: r.y as number, w: r.w as number, h: r.h as number });
}

/**
 * Give every widget a rect, and guarantee the board is legal.
 *
 * ALL-OR-NOTHING on purpose. If even one widget arrives without a rect the whole
 * board is re-seeded from the legacy segment/order/width/height fields, rather
 * than migrating that one widget and leaving the rest. A half-migrated board mixes
 * two coordinate systems — positions that were relative to a segment sitting
 * beside positions relative to the grid — and lands widgets on top of each other
 * with no way to tell which reading was intended.
 *
 * The cases that reach the legacy path: the first load after this feature ships, a
 * `?c=` share link written by an older build, and all six built-in presets (which
 * stay authored in segments, because that is a far more readable way to write a
 * board by hand than a table of x/y/w/h).
 */
function withRects(widgets: WidgetInstance[], stageRect: GridRect | null): {
  widgets: WidgetInstance[];
  stageRect: GridRect | undefined;
} {
  const everyoneHasOne = widgets.every((w) => w.rect);
  const items: GridItem[] = everyoneHasOne
    ? [
        ...(stageRect ? [{ id: STAGE_ID, ...stageRect }] : []),
        ...widgets.map((w) => ({ id: w.id, ...w.rect! })),
      ]
    : fromLegacy(widgets, stageRect ? STAGE_ID : null);

  // Settle regardless of provenance: persisted rects are user-editable JSON and a
  // hand-edited (or older-build) board can overlap.
  const byId = new Map(settle(items, null).map((i) => [i.id, i]));
  const stage = byId.get(STAGE_ID);

  return {
    widgets: widgets.map((w) => {
      const r = byId.get(w.id);
      return r ? { ...w, rect: { x: r.x, y: r.y, w: r.w, h: r.h } } : w;
    }),
    stageRect: stage ? { x: stage.x, y: stage.y, w: stage.w, h: stage.h } : undefined,
  };
}

/** Coerce arbitrary/untrusted input into a valid ShellLayout, or null if unrecoverable.
 *  Guarantees: all three segment keys present; sizes clamped [0,900]; each widget has a
 *  valid segment, clamped height [120,1200], object config, and a legal non-overlapping
 *  grid rect; total widgets <= MAX_WIDGETS. */
export function sanitizeLayout(raw: unknown): ShellLayout | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.widgets)) return null;
  if (typeof r.stage !== "string" || !STAGES.includes(r.stage as StageId)) return null;
  if (!r.segments || typeof r.segments !== "object") return null;

  const base = createDefaultLayout();
  const segsIn = r.segments as Record<string, unknown>;
  const segments = {} as ShellLayout["segments"];
  for (const id of SEGMENTS) {
    const s = segsIn[id] && typeof segsIn[id] === "object" ? (segsIn[id] as Record<string, unknown>) : {};
    segments[id] = {
      size: clamp(num(s.size, base.segments[id].size), 0, 900),
      collapsed: s.collapsed === true,
    };
  }

  const widgets: WidgetInstance[] = [];
  for (const w of r.widgets as unknown[]) {
    if (widgets.length >= MAX_WIDGETS) break;
    if (!w || typeof w !== "object") continue;
    const o = w as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.type !== "string") continue;
    const rect = readRect(o.rect);
    widgets.push({
      id: o.id,
      type: o.type,
      segment: SEGMENTS.includes(o.segment as SegmentId) ? (o.segment as SegmentId) : "left",
      order: num(o.order, widgets.length),
      width: clampSpan(num(o.width, 12)),
      height: clamp(num(o.height, 240), 120, 1200),
      ...(rect ? { rect } : {}),
      collapsed: o.collapsed === true,
      config: o.config && typeof o.config === "object" ? (o.config as Record<string, unknown>) : {},
    });
  }
  const ids = new Set(widgets.map((w) => w.id));
  const focusedWidgetId =
    typeof r.focusedWidgetId === "string" && ids.has(r.focusedWidgetId) ? r.focusedWidgetId : null;

  // The stage always has a cell. Its absence in the input means "not written yet",
  // never "no map" — the Terminal has no state in which the stage is not on the board.
  const placed = withRects(widgets, readRect(r.stageRect) ?? base.stageRect ?? null);

  return {
    segments,
    stage: r.stage as StageId,
    widgets: placed.widgets,
    stageRect: placed.stageRect,
    focusedWidgetId,
  };
}
