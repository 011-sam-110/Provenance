import type { ShellLayout, WidgetInstance, SegmentId, StageId, GridRect } from "@/lib/console/types";
import { MAX_WIDGETS } from "@/lib/console/types";
import { clampRailSize } from "@/lib/terminal/rails";
import {
  arrangeWall, clampRect, findFreeSpot, place, rectOf,
  COLS, GAP_PX, MIN_H, MIN_W, ROW_PX, type GridItem,
} from "@/lib/terminal/layoutGrid";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** A wall tile's default opening size, in cells. Four of twelve columns is three
 *  across with no uncovered cell, and at a 16:9 frame that is what a camera is. */
const NEW_TILE_W = 4;
const NEW_TILE_H = 6;

/** px ⇄ rows, for the ⋯ menu's height chips. They write `height` in px in both
 *  modes; on a wall they have to move the rect too or they are dead controls
 *  again — which is the exact bug lib/terminal/layoutGrid.ts was written over. */
const rowsFromPx = (px: number) => Math.max(MIN_H, Math.round(px / (ROW_PX + GAP_PX)));

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

  // On a wall the new tile needs a rect, and it is minted HERE rather than by each
  // caller. There are four doors into this function — the ⌘K palette, the Source
  // Catalog's ＋, PlacementPicker and the map's camera-pick flow — and a tile that
  // arrived through one of them without a rect would simply not render. Making
  // every caller remember is how three of them would eventually forget.
  //
  // `findFreeSpot` scans left-to-right then down for the first cell the tile fits
  // in, which is what compaction would do to an appended tile anyway; scanning
  // just says out loud where it is going to land.
  if (l.mode === "wall") {
    const taken = l.widgets.map((w) => rectOf(w)).filter((r): r is GridRect => Boolean(r));
    const spot = findFreeSpot(taken, NEW_TILE_W, NEW_TILE_H);
    inst.rect = { x: spot.x, y: spot.y, w: NEW_TILE_W, h: NEW_TILE_H };
  }

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
  const next = { ...l, widgets: l.widgets.map((w) => (w.id === id ? { ...w, height: px } : w)) };

  // On a wall, `height` alone is a value nothing draws. Drive the rect too and let
  // the board settle around it, so the chips behave exactly like dragging the south
  // edge — same push, same compaction, same result. `height` is still written so
  // the field stays truthful for a share link and for the rails migration.
  if (l.mode !== "wall") return next;
  const cur = next.widgets.find((w) => w.id === id);
  const rect = cur ? rectOf(cur) : null;
  if (!rect) return next;
  return setItemRect(next, id, { ...rect, h: rowsFromPx(px) });
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

// ── Wall ────────────────────────────────────────────────────────────────────
//
// A `mode: "wall"` board renders from rects. These are the reducers that own them.
// The rail reducers above are NOT superseded — both modes keep segment / order /
// height populated, so a board can change mode without a migration in either
// direction.
//
// THE STAGE IS NOT A GRID ITEM HERE, and that is the difference from the version
// of this code that #146 deleted. It used to carry `l.stageRect` and put the map
// on the board as an item with its own rect, which is what made "you could shove
// the map into a corner and leave it there" possible. On a wall the map lives in
// the right-hand dock and the grid holds camera tiles only, so `gridItems` has no
// stage branch and `applyItems` has no stage to write back.

/** Every tile on the board. A widget with no rect is skipped rather than defaulted:
 *  a rails-mode layout read by mistake should render nothing, not a pile at 0,0. */
export function gridItems(l: ShellLayout): GridItem[] {
  const items: GridItem[] = [];
  for (const w of l.widgets) {
    const r = rectOf(w);
    if (r) items.push({ id: w.id, ...r });
  }
  return items;
}

/** Write a settled board back onto the layout. Items with no matching widget are
 *  dropped silently. Exported because presets.ts composes a wall from
 *  `arrangeWall` and needs the same rects-onto-layout step every reducer here
 *  uses — a second copy living in presets is how the two would drift. */
export function applyItems(l: ShellLayout, items: readonly GridItem[]): ShellLayout {
  const byId = new Map(items.map((i) => [i.id, i]));
  return {
    ...l,
    widgets: l.widgets.map((w) => {
      const r = byId.get(w.id);
      return r ? { ...w, rect: { x: r.x, y: r.y, w: r.w, h: r.h } } : w;
    }),
  };
}

/**
 * Move or resize one tile and settle the board around it.
 *
 * `prevRect` is the rect the tile came FROM, and only a live gesture has one.
 * Given it, a tile dragged onto a neighbour swaps with it instead of shoving it
 * down. Omitted, the board settles exactly as it always has.
 */
export function setItemRect(
  l: ShellLayout,
  id: string,
  rect: GridRect,
  prevRect: GridRect | null = null,
): ShellLayout {
  return applyItems(l, place(gridItems(l), id, rect, prevRect));
}

/**
 * The ⋯ menu's width chips: a span of the board's twelve columns.
 *
 * Width is a wall-only control. A rails card is as wide as its rail and there is
 * nothing to set, which is why `resize.ts` says it has no width half any more.
 */
export function setWidgetWidth(l: ShellLayout, id: string, span: number): ShellLayout {
  const w = l.widgets.find((x) => x.id === id);
  const rect = w ? rectOf(w) : null;
  if (!rect) return l;
  return setItemRect(l, id, { ...rect, w: clamp(Math.round(span), MIN_W, COLS) });
}

/**
 * Re-seed every tile from the wall arrangement, fitted to `rows`.
 *
 * Sizes the user set are deliberately NOT preserved — that is what makes this a
 * reset rather than a nudge. `rows` is what stops the reset re-creating the bug it
 * rescues you from: an arrangement that ignores the window is how boards came to
 * be 1249px tall in an 820px band in the first place.
 */
export function arrangeBoard(l: ShellLayout, rows?: number): ShellLayout {
  return applyItems(l, arrangeWall(l.widgets.map((w) => w.id), rows));
}

/**
 * Give every tile a rect, keeping the ones that already have one.
 *
 * The repair path, and it has to be TOTAL. A wall layout can legitimately reach us
 * with tiles that have no rect — a `?c=` link minted in rails mode and then opened
 * on a wall board, a widget added by a build that predates this change, a rect
 * that failed validation in sanitize. Every one of those tiles would otherwise be
 * mounted but never drawn, which reads as data loss and is impossible to diagnose
 * from the screen.
 */
export function seedWallRects(l: ShellLayout, rows?: number): ShellLayout {
  if (l.widgets.every((w) => Boolean(w.rect))) return l;
  if (l.widgets.every((w) => !w.rect)) return arrangeBoard(l, rows);

  // A mix: keep what is placed, and fit the rest into the gaps around it.
  const placed = gridItems(l);
  const out = [...placed];
  for (const w of l.widgets) {
    if (w.rect) continue;
    const spot = findFreeSpot(out, NEW_TILE_W, NEW_TILE_H);
    out.push({ id: w.id, x: spot.x, y: spot.y, w: NEW_TILE_W, h: NEW_TILE_H });
  }
  return applyItems(l, out.map((i) => ({ ...i, ...clampRect(i) })));
}
