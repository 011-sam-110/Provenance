import type { GridRect, ShellLayout, WidgetInstance, SegmentId, StageId } from "@/lib/console/types";
import { MAX_WIDGETS, STAGE_ID } from "@/lib/console/types";
import { clampSpan } from "@/lib/console/resize";
import {
  arrangeConsole, arrangeWall, place, rowsUsed, settle,
  MIN_H, MIN_W, type GridItem,
} from "@/lib/terminal/layoutGrid";

const SEGMENTS: SegmentId[] = ["left", "right", "bottom"];
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function widgetsInSegment(l: ShellLayout, seg: SegmentId): WidgetInstance[] {
  return l.widgets.filter((w) => w.segment === seg).sort((a, b) => a.order - b.order);
}
export function isAtCapacity(l: ShellLayout): boolean {
  return l.widgets.length >= MAX_WIDGETS;
}

function emptiestSegment(l: ShellLayout): SegmentId {
  let best: SegmentId = "left";
  let min = Infinity;
  for (const s of SEGMENTS) {
    const n = l.widgets.filter((w) => w.segment === s).length;
    if (n < min) { min = n; best = s; }
  }
  return best;
}

export function addWidget(
  l: ShellLayout, type: string, instanceId: string,
  opts: { segment?: SegmentId; config?: Record<string, unknown>; height?: number; width?: number } = {},
): ShellLayout {
  if (isAtCapacity(l)) return l;
  const segment = opts.segment ?? emptiestSegment(l);
  const order = l.widgets.filter((w) => w.segment === segment).length;
  // A new widget lands on a fresh row under everything, full width of its rail.
  // Never in a gap: dropping a card the user did not place into a hole halfway up
  // the board makes it look like something moved rather than something arrived.
  const inst: WidgetInstance = {
    id: instanceId, type, segment, order,
    width: opts.width ?? 12,
    height: opts.height ?? 260,
    rect: { x: 0, y: rowsUsed(gridItems(l)), w: 4, h: 7 },
    collapsed: false, config: opts.config ?? {},
  };
  return { ...l, widgets: [...l.widgets, inst] };
}

export function removeWidget(l: ShellLayout, id: string): ShellLayout {
  const removed = l.widgets.find((w) => w.id === id);
  if (!removed) return l;
  const kept = l.widgets.filter((w) => w.id !== id);
  const segSorted = kept.filter((w) => w.segment === removed.segment).sort((a, b) => a.order - b.order);
  const orderMap = new Map(segSorted.map((w, i) => [w.id, i] as const));
  const next: ShellLayout = {
    ...l,
    focusedWidgetId: l.focusedWidgetId === id ? null : l.focusedWidgetId,
    widgets: kept.map((w) => (orderMap.has(w.id) ? { ...w, order: orderMap.get(w.id)! } : w)),
  };
  // Close the hole the removal left, so the board does not slowly fill with gaps.
  return applyItems(next, settle(gridItems(next), null));
}

export function moveWidget(l: ShellLayout, id: string, toSegment: SegmentId, toIndex: number): ShellLayout {
  const moving = l.widgets.find((w) => w.id === id);
  if (!moving) return l;
  const from = widgetsInSegment(l, moving.segment).filter((w) => w.id !== id);
  const to = toSegment === moving.segment ? from : widgetsInSegment(l, toSegment);
  const idx = clamp(toIndex, 0, to.length);
  const nextTo = [...to.slice(0, idx), { ...moving, segment: toSegment }, ...to.slice(idx)];
  const reindex = (arr: WidgetInstance[], seg: SegmentId) => arr.map((w, i) => ({ ...w, segment: seg, order: i }));
  const untouched = l.widgets.filter((w) => w.segment !== moving.segment && w.segment !== toSegment);
  const rebuilt = toSegment === moving.segment
    ? reindex(nextTo, toSegment)
    : [...reindex(from, moving.segment), ...reindex(nextTo, toSegment)];
  return { ...l, widgets: [...untouched, ...rebuilt] };
}

// ── Grid ────────────────────────────────────────────────────────────────────
// The Terminal renders from rects. These are the reducers that own them; the
// legacy segment/order/width/height reducers below stay because presets, share
// links and the palette still speak that vocabulary.

/** Every grid item on the board — the stage included, since it is one. */
export function gridItems(l: ShellLayout): GridItem[] {
  const items: GridItem[] = [];
  if (l.stageRect) items.push({ id: STAGE_ID, ...l.stageRect });
  for (const w of l.widgets) if (w.rect) items.push({ id: w.id, ...w.rect });
  return items;
}

/** Write a settled board back onto the layout. Items with no matching widget are
 *  dropped silently — the only such id is the stage, handled explicitly. */
function applyItems(l: ShellLayout, items: readonly GridItem[]): ShellLayout {
  const byId = new Map(items.map((i) => [i.id, i]));
  const stage = byId.get(STAGE_ID);
  return {
    ...l,
    stageRect: stage ? { x: stage.x, y: stage.y, w: stage.w, h: stage.h } : l.stageRect,
    widgets: l.widgets.map((w) => {
      const r = byId.get(w.id);
      return r ? { ...w, rect: { x: r.x, y: r.y, w: r.w, h: r.h } } : w;
    }),
  };
}

/** Move or resize one item (widget or stage) and settle the board around it. */
export function setItemRect(l: ShellLayout, id: string, rect: GridRect): ShellLayout {
  return applyItems(l, place(gridItems(l), id, rect));
}

/** Re-seed every position from one of the two named arrangements. Sizes the user
 *  set are deliberately NOT preserved — that is what makes this a reset. */
export function arrangeBoard(l: ShellLayout, mode: "console" | "wall"): ShellLayout {
  const ids = l.widgets.map((w) => w.id);
  const stageId = l.stageRect ? STAGE_ID : null;
  return applyItems(l, mode === "wall" ? arrangeWall(ids, stageId) : arrangeConsole(ids, stageId));
}

/**
 * The ⋯ menu's S/M/L/XL heights, in px.
 *
 * These wrote `height` and nothing else, which the Terminal never read — so the
 * chips were live, `aria-pressed` reflected a value on screen nowhere, and
 * clicking one did nothing at all. They now drive the rect as well, converting px
 * to whole rows; `height` is still written so the legacy field stays truthful for
 * share links and the migration.
 */
export function setWidgetHeight(l: ShellLayout, id: string, height: number): ShellLayout {
  const px = clamp(height, 120, 1200);
  const withPx = { ...l, widgets: l.widgets.map((w) => w.id === id ? { ...w, height: px } : w) };
  const cur = withPx.widgets.find((w) => w.id === id)?.rect;
  if (!cur) return withPx;
  return setItemRect(withPx, id, { ...cur, h: Math.max(MIN_H, Math.round(px / 25)) });
}

/** The ⋯ menu's ⅓/½/⅔/Full widths. Same story as the heights above: the span is
 *  now board columns, which is what those fractions always claimed to be. */
export function setWidgetWidth(l: ShellLayout, id: string, width: number): ShellLayout {
  const span = clampSpan(width);
  const withSpan = { ...l, widgets: l.widgets.map((w) => w.id === id ? { ...w, width: span } : w) };
  const cur = withSpan.widgets.find((w) => w.id === id)?.rect;
  if (!cur) return withSpan;
  return setItemRect(withSpan, id, { ...cur, w: Math.max(MIN_W, span) });
}
export function setWidgetCollapsed(l: ShellLayout, id: string, collapsed: boolean): ShellLayout {
  return { ...l, widgets: l.widgets.map((w) => w.id === id ? { ...w, collapsed } : w) };
}
export function setWidgetConfig(l: ShellLayout, id: string, patch: Record<string, unknown>): ShellLayout {
  return { ...l, widgets: l.widgets.map((w) => w.id === id ? { ...w, config: { ...w.config, ...patch } } : w) };
}
export function setSegmentSize(l: ShellLayout, seg: SegmentId, size: number): ShellLayout {
  return { ...l, segments: { ...l.segments, [seg]: { ...l.segments[seg], size: clamp(size, 0, 900) } } };
}
export function setSegmentCollapsed(l: ShellLayout, seg: SegmentId, collapsed: boolean): ShellLayout {
  return { ...l, segments: { ...l.segments, [seg]: { ...l.segments[seg], collapsed } } };
}
export function setStage(l: ShellLayout, stage: StageId): ShellLayout {
  return { ...l, stage };
}
export function setFocus(l: ShellLayout, id: string | null): ShellLayout {
  return { ...l, focusedWidgetId: id };
}
