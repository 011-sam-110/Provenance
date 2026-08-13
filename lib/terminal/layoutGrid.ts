import type { SegmentId, WidgetInstance } from "@/lib/console/types";

// ── The Terminal's layout engine ─────────────────────────────────────────────
//
// This replaces lib/terminal/grid.ts's generated `grid-template-areas`. That file
// decided a widget's size FOR it — which is why the resize handles, the ⋯ menu's
// Width/Height chips and `WidgetInstance.width`/`.height` all became controls that
// wrote values nothing drew. Here a widget owns its own rectangle and the engine's
// only job is to keep the board legal.
//
// WHERE THE PARANOIA WENT. The old file's stated nightmare was that
// grid-template-areas fails SILENTLY: one malformed row and every child
// auto-places into a pile, with no error anywhere. That failure mode is gone —
// `grid-column`/`grid-row` on each item is per-item, so a bad value damages one
// card rather than the board. What replaces it is a failure mode that is visible
// but easy to introduce: two widgets overlapping, or one drifting off the right
// edge. So the guarantees move here, into pure functions that
// tests/unit/terminal-layout-grid.test.ts asserts directly — including a
// randomised pass, because the interesting inputs come from a user's pointer and
// no fixed example covers them.
//
// Everything in this file is pure and DOM-free: vitest runs in the node
// environment in this repo, so anything that needs a browser cannot be tested at
// all.

/** A widget's rectangle in GRID CELLS, never pixels. x/y are 0-based. */
export interface GridRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GridItem extends GridRect {
  id: string;
}

/** Twelve columns, matching `WidgetInstance.width`'s documented "1..12" span, so a
 *  legacy width migrates as itself rather than being reinterpreted. */
export const COLS = 12;

/** Row height in px. 24 lines up with the Terminal's 22px table rows (--tnx-rh)
 *  plus the 1px gutter, so a card's height lands on whole rows of its content. */
export const ROW_PX = 24;

/** The gutter. 1px, and the grid container paints the hairline colour behind it,
 *  so the gaps between panels ARE the rules — no panel needs a border and two
 *  neighbours can never produce a 2px double rule. */
export const GAP_PX = 1;

/** Below these a widget's header controls collide with each other. */
export const MIN_W = 2;
export const MIN_H = 3;

const int = (v: number, fallback = 0): number =>
  Number.isFinite(v) ? Math.round(v) : fallback;

/** Do two rectangles share at least one cell? Touching edges do not count. */
export function overlaps(a: GridRect, b: GridRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Force a rectangle to be legal: whole cells, at least the minimum size, and
 * wholly inside the 12 columns.
 *
 * A rectangle that runs off the right edge is MOVED left, not narrowed. Narrowing
 * would silently resize a widget the user was only dragging, and the size they
 * set is the thing they are most likely to notice losing.
 */
export function clampRect<T extends GridRect>(r: T): T {
  const w = Math.max(MIN_W, Math.min(COLS, int(r.w, MIN_W)));
  const h = Math.max(MIN_H, int(r.h, MIN_H));
  const x = Math.max(0, Math.min(COLS - w, int(r.x, 0)));
  const y = Math.max(0, int(r.y, 0));
  return { ...r, x, y, w, h };
}

/** Reading order: top to bottom, then left to right. Stable for equal positions. */
export function readingOrder<T extends GridRect>(items: readonly T[]): T[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => a.item.y - b.item.y || a.item.x - b.item.x || a.i - b.i)
    .map((e) => e.item);
}

/** How many rows the board occupies — its lowest bottom edge. */
export function rowsUsed(items: readonly GridRect[]): number {
  return items.reduce((max, i) => Math.max(max, i.y + i.h), 0);
}

/**
 * Push overlapping widgets downwards until nothing overlaps.
 *
 * `pinnedId` is the widget the user is holding. It never moves — it always wins
 * the cells it is over, and whatever was there gets displaced instead. Without
 * the pin, a drag would fight the user: they move a card onto a neighbour, the
 * resolver pushes THEIR card back out, and the drop lands somewhere they did not
 * aim at.
 *
 * The loop is bounded. A cascade that cannot settle has to degrade to a slightly
 * wrong board, never to a hung tab — and since every pass either moves a widget
 * down or exits, the bound is a backstop rather than a real limit.
 */
export function resolveCollisions(
  items: readonly GridItem[],
  pinnedId: string | null,
): GridItem[] {
  const out = items.map((i) => ({ ...i }));
  const LIMIT = out.length * out.length + 64;

  for (let pass = 0; pass < LIMIT; pass++) {
    const sorted = readingOrder(out);
    let moved = false;

    for (let i = 0; i < sorted.length && !moved; i++) {
      for (let j = i + 1; j < sorted.length && !moved; j++) {
        const a = sorted[i];
        const b = sorted[j];
        if (!overlaps(a, b)) continue;
        // `b` is later in reading order, so it is the one that yields — unless it
        // is the pinned widget, in which case `a` is pushed below it instead.
        if (b.id === pinnedId) a.y = b.y + b.h;
        else b.y = a.y + a.h;
        moved = true;
      }
    }
    if (!moved) return out;
  }
  return out;
}

/**
 * Float every widget up into any gap above it, in reading order.
 *
 * This is what keeps the wall dense — a scanning surface with a band of dead
 * pixels across it has lost the only thing it was for. Idempotent: running it on
 * its own output changes nothing, which the tests assert because a compactor that
 * drifts would make every drag shuffle the board.
 */
export function compact(items: readonly GridItem[]): GridItem[] {
  const placed: GridItem[] = [];
  for (const item of readingOrder(items)) {
    let y = item.y;
    while (y > 0 && !placed.some((p) => overlaps({ ...item, y: y - 1 }, p))) y--;
    placed.push({ ...item, y });
  }
  return placed;
}

/** Resolve overlaps, then close the gaps. The board state after any user action. */
export function settle(items: readonly GridItem[], pinnedId: string | null): GridItem[] {
  return compact(resolveCollisions(items, pinnedId));
}

/**
 * Move or resize one widget and settle the board around it.
 *
 * Returns the input untouched for an unknown id rather than throwing: callers are
 * pointer handlers reading an id off a DOM node, and a stale id during a re-render
 * should be a no-op, not a crash inside an event listener.
 */
export function place(
  items: readonly GridItem[],
  id: string,
  rect: GridRect,
): GridItem[] {
  if (!items.some((i) => i.id === id)) return items as GridItem[];
  const next = items.map((i) => (i.id === id ? clampRect({ ...i, ...rect }) : i));
  return settle(next, id);
}

/**
 * The first cell a `w`x`h` card fits in, scanning left to right then down.
 *
 * "Append at the bottom" is the obvious alternative and it is wrong here, because
 * compaction would immediately float the card up into the first gap anyway — so
 * appending does not actually put the card at the bottom, it just makes where it
 * lands unpredictable. Scanning for the fit says out loud what the board was going
 * to do regardless.
 *
 * The row bound is one card-height past the current bottom, so there is always a
 * clear row to fall back to and the scan cannot run away on a full board.
 */
export function findFreeSpot(
  items: readonly GridRect[],
  w: number,
  h: number,
): { x: number; y: number } {
  const width = Math.max(MIN_W, Math.min(COLS, Math.round(w)));
  const height = Math.max(MIN_H, Math.round(h));
  const limit = rowsUsed(items) + height;

  for (let y = 0; y <= limit; y++) {
    for (let x = 0; x + width <= COLS; x++) {
      const probe = { x, y, w: width, h: height };
      if (!items.some((i) => overlaps(probe, i))) return { x, y };
    }
  }
  return { x: 0, y: rowsUsed(items) };
}

// ── Pixel ⇄ cell ────────────────────────────────────────────────────────────
// The only two functions here that know about pixels. Column width has to be
// MEASURED rather than assumed: the grid is fluid, and the rail collapsing or a
// window resize changes it without any state change we could react to.

/** Width of one column in px, given the grid's content-box width. */
export function columnWidth(containerWidth: number): number {
  if (!(containerWidth > 0)) return 0;
  return (containerWidth - GAP_PX * (COLS - 1)) / COLS;
}

/** Convert a pointer delta in px to a delta in whole cells. */
export function cellDelta(
  dxPx: number,
  dyPx: number,
  containerWidth: number,
): { dx: number; dy: number } {
  const colW = columnWidth(containerWidth);
  return {
    dx: colW > 0 ? Math.round(dxPx / colW) : 0,
    dy: Math.round(dyPx / (ROW_PX + GAP_PX)),
  };
}

// ── Auto-arrange ────────────────────────────────────────────────────────────
// CONSOLE and WALL used to be templates that decided every widget's size. They
// are now GENERATORS: one click seeds a full set of rects, and everything stays
// draggable afterwards. That is the whole reason resizing can exist at all —
// there is no longer a template overriding what the user set.
//
// Both are total by construction: they place widgets by index with no early exit,
// so every id handed in comes back with a cell. Losing a card is the one failure
// the old file called out as unacceptable, and it stays unacceptable.

/** CONSOLE — map-dominant. A rail down each side, the stage in the middle, the
 *  overflow docked underneath in a four-across strip. */
export function arrangeConsole(ids: readonly string[], stageId: string | null): GridItem[] {
  const RAIL_W = 3;
  const CARD_H = 7;
  const STAGE_H = 14;
  const RAILS = Math.floor(STAGE_H / CARD_H) * 2; // cards that fit beside the stage

  const out: GridItem[] = [];
  if (stageId) out.push({ id: stageId, x: RAIL_W, y: 0, w: COLS - RAIL_W * 2, h: STAGE_H });

  ids.forEach((id, n) => {
    if (stageId && n < RAILS) {
      // Alternate left rail / right rail so both fill evenly.
      const onLeft = n % 2 === 0;
      const slot = Math.floor(n / 2);
      out.push({
        id,
        x: onLeft ? 0 : COLS - RAIL_W,
        y: slot * CARD_H,
        w: RAIL_W,
        h: CARD_H,
      });
      return;
    }
    const k = stageId ? n - RAILS : n;
    const perRow = COLS / RAIL_W; // 4
    out.push({
      id,
      x: (k % perRow) * RAIL_W,
      y: (stageId ? STAGE_H : 0) + Math.floor(k / perRow) * CARD_H,
      w: RAIL_W,
      h: CARD_H,
    });
  });

  return settle(out, null);
}

/** WALL — everything equal, for unattended scanning. Uniform 4x5 cards, three
 *  across; the stage takes a double-height block in the top-left. */
export function arrangeWall(ids: readonly string[], stageId: string | null): GridItem[] {
  const CARD_W = 4;
  const CARD_H = 5;
  const STAGE_H = CARD_H * 2;

  const out: GridItem[] = [];
  if (stageId) out.push({ id: stageId, x: 0, y: 0, w: CARD_W, h: STAGE_H });

  // Cells the stage has already claimed, so the walk steps over them.
  const taken = (x: number, y: number) =>
    Boolean(stageId) && x < CARD_W && y < STAGE_H;

  let x = 0;
  let y = 0;
  for (const id of ids) {
    while (taken(x, y)) {
      x += CARD_W;
      if (x + CARD_W > COLS) { x = 0; y += CARD_H; }
    }
    out.push({ id, x, y, w: CARD_W, h: CARD_H });
    x += CARD_W;
    if (x + CARD_W > COLS) { x = 0; y += CARD_H; }
  }

  return settle(out, null);
}

// ── Migration ───────────────────────────────────────────────────────────────

/** Where each legacy segment lands on the board, and how many columns it owns.
 *  `bottom` was a full-width dock, so it gets all twelve. */
const SEGMENT_X: Record<SegmentId, number> = { left: 0, right: 8, bottom: 0 };
const SEGMENT_W: Record<SegmentId, number> = { left: 4, right: 4, bottom: COLS };

/**
 * Legacy `width` is a span of ITS SEGMENT's twelve columns, not of the board —
 * "column span 1..12 of the 12-col segment grid", per lib/console/types. A left-rail
 * widget at width 12 means "fills the rail", not "fills the screen". Reading it as
 * a board span is the one migration mistake that silently makes every rail widget
 * full-bleed and collapses the board into a single stack.
 */
function scaleLegacyWidth(legacy: number, seg: SegmentId): number {
  const own = SEGMENT_W[seg];
  const span = Math.round((own * Math.max(1, Math.min(12, int(legacy, 12)))) / 12);
  return Math.max(MIN_W, Math.min(own, span));
}

/**
 * Seed rects from a layout that only has segment / order / width / height.
 *
 * This is the compatibility path, and it has to be TOTAL and DETERMINISTIC. Every
 * persisted `tn.console.v1` layout, every `?c=` share link and all six built-in
 * presets are authored in those four fields; a migration that dropped a widget or
 * that produced a different board on each load would be indistinguishable from
 * data loss to the person whose board it was.
 *
 * The legacy `width` (a 1..12 span) carries over as-is. The legacy `height` is px
 * and converts to whole rows. Position is seeded from the segment so a board keeps
 * its shape — left stays left of right — and the user can move it from there.
 */
export function fromLegacy(
  widgets: readonly WidgetInstance[],
  stageId: string | null,
): GridItem[] {
  const out: GridItem[] = [];
  if (stageId) out.push({ id: stageId, x: 4, y: 0, w: 4, h: 14 });

  const byOrder = (a: WidgetInstance, b: WidgetInstance) => int(a.order) - int(b.order);
  const of = (seg: SegmentId) =>
    widgets.filter((w) => (w.segment in SEGMENT_X ? w.segment : "left") === seg).sort(byOrder);

  const rowsFor = (w: WidgetInstance) =>
    Math.max(MIN_H, Math.round(int(w.height, 260) / (ROW_PX + GAP_PX)));

  /** Stack one segment's widgets down its column, returning the y it ended at. */
  const stack = (seg: SegmentId, startY: number): number => {
    let y = startY;
    for (const w of of(seg)) {
      const h = rowsFor(w);
      out.push(clampRect({ id: w.id, x: SEGMENT_X[seg], y, w: scaleLegacyWidth(w.width, seg), h }));
      y += h;
    }
    return y;
  };

  // The two rails first, then the dock BELOW both of them. Laying all three out
  // from y=0 and letting settle() sort it out interleaves the full-width dock
  // between the rail cards — which is a legal board, but not the one the preset
  // author wrote: "bottom" has always meant underneath, not "somewhere in the mix".
  const railBottom = Math.max(stack("left", 0), stack("right", 0), stageId ? 14 : 0);
  stack("bottom", railBottom);

  return settle(out, null);
}

/** Read a widget's rect, falling back to a legacy-derived one. Kept here so the
 *  fallback lives beside the migration that defines it. */
export function rectOf(w: WidgetInstance): GridRect | null {
  return w.rect ? clampRect({ ...w.rect }) : null;
}
