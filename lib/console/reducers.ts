import type { ShellLayout, WidgetInstance, SegmentId, StageId } from "@/lib/console/types";
import { MAX_WIDGETS } from "@/lib/console/types";
import { clampRailSize } from "@/lib/terminal/rails";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function widgetsInSegment(l: ShellLayout, seg: SegmentId): WidgetInstance[] {
  return l.widgets.filter((w) => w.segment === seg).sort((a, b) => a.order - b.order);
}
export function isAtCapacity(l: ShellLayout): boolean {
  return l.widgets.length >= MAX_WIDGETS;
}

export function addWidget(
  l: ShellLayout, type: string, instanceId: string,
  opts: { segment: SegmentId; config?: Record<string, unknown>; height?: number },
): ShellLayout {
  if (isAtCapacity(l)) return l;
  const { segment } = opts;
  const order = l.widgets.filter((w) => w.segment === segment).length;
  const inst: WidgetInstance = {
    id: instanceId, type, segment, order,
    height: opts.height ?? 260,
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
  return {
    ...l,
    focusedWidgetId: l.focusedWidgetId === id ? null : l.focusedWidgetId,
    widgets: kept.map((w) => (orderMap.has(w.id) ? { ...w, order: orderMap.get(w.id)! } : w)),
  };
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

/**
 * The ⋯ menu's S/M/L/XL heights, in px. This is the widget's own height in its
 * rail — the rail scrolls, so nothing else on the board reflows when it
 * changes, unlike the old grid where a height change could push every card
 * below it down a row.
 */
export function setWidgetHeight(l: ShellLayout, id: string, height: number): ShellLayout {
  const px = clamp(height, 120, 1200);
  return { ...l, widgets: l.widgets.map((w) => (w.id === id ? { ...w, height: px } : w)) };
}
export function setWidgetCollapsed(l: ShellLayout, id: string, collapsed: boolean): ShellLayout {
  return { ...l, widgets: l.widgets.map((w) => w.id === id ? { ...w, collapsed } : w) };
}
export function setWidgetConfig(l: ShellLayout, id: string, patch: Record<string, unknown>): ShellLayout {
  return { ...l, widgets: l.widgets.map((w) => w.id === id ? { ...w, config: { ...w.config, ...patch } } : w) };
}
export function setSegmentSize(l: ShellLayout, seg: SegmentId, size: number): ShellLayout {
  return { ...l, segments: { ...l.segments, [seg]: { ...l.segments[seg], size: clampRailSize(seg, size) } } };
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
