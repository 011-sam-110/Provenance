import type { GridRect, WidgetInstance } from "@/lib/console/types";

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

// `GridRect` is RE-EXPORTED here, not redeclared. It used to be declared in this
// file AND in lib/console/types.ts, and TypeScript's structural typing meant the
// two never disagreed loudly — they would simply have drifted in silence the first
// time one of them gained a field. types.ts owns the persisted shape, so it owns
// the type; this file owns the arithmetic over it.
export type { GridRect };

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
  prevRect: GridRect | null = null,
): GridItem[] {
  const out = items.map((i) => ({ ...i }));

  // ── THE SWAP, applied ONCE and BEFORE the loop below ──────────────────────
  //
  // Drag a card DOWN onto its neighbour and the neighbour should rise into the
  // space you just left. The loop below cannot express that: it only ever moves
  // a widget DOWN, which is exactly what lets it terminate — "every pass either
  // moves a widget down or exits" is the whole argument that its bound is a
  // backstop rather than a real limit. Teaching that loop to lift things breaks
  // the argument, and it breaks it in practice, not just on paper: an earlier
  // attempt failed the randomised no-overlap invariant on 5 of 5 seeds while all
  // 50 deterministic cases passed, because a lift can free space a later pass
  // refills, and the two ping-pong until LIMIT ends the loop mid-overlap.
  //
  // So the exchange happens HERE, once, as a plain assignment, and the loop is
  // left exactly as it was. It needs the rect the held card came FROM, which is
  // why the caller supplies it; without one this is skipped and every existing
  // caller behaves as it always did.
  if (pinnedId !== null && prevRect) {
    const held = out.find((i) => i.id === pinnedId);
    // DOWNWARD ONLY. An upward drag already works: the loop pushes the card that
    // was there down, which is the direction it is allowed to move things, and
    // compaction then closes up behind. prevRect is here to tell the two apart.
    if (held && held.y > prevRect.y) {
      const blocking = out
        .filter((i) => i.id !== pinnedId && overlaps(held, i))
        .sort((a, b) => a.y - b.y)[0];
      if (blocking) {
        // Lift the topmost displaced card to sit directly above the held one.
        // Anything else it now overlaps is left to the loop, which pushes DOWN
        // and therefore still terminates. That is the whole reason this is a
        // single assignment out here rather than a rule inside the loop.
        const y = held.y - blocking.h;
        if (y >= 0 && !overlaps({ ...blocking, y }, held)) blocking.y = y;
      }
    }
  }

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
export function settle(
  items: readonly GridItem[],
  pinnedId: string | null,
  prevRect: GridRect | null = null,
): GridItem[] {
  return compact(resolveCollisions(items, pinnedId, prevRect));
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
  prevRect: GridRect | null = null,
): GridItem[] {
  if (!items.some((i) => i.id === id)) return items as GridItem[];
  const next = items.map((i) => (i.id === id ? clampRect({ ...i, ...rect }) : i));
  return settle(next, id, prevRect);
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

// ── The wall arrangement ────────────────────────────────────────────────────
//
// The Streets board's opening shape, and the ONLY arrangement this file still
// carries.
//
// `arrangeHouse` and `arrangeConsole` are deliberately NOT restored with the rest
// of this file. A rails board is composed by `composeRail` in presets.ts over
// `splitSpan`, which moved to lib/terminal/rails.ts when the reskin landed and is
// the live composer for every board but this one. Bringing back a second,
// competing composer for boards that do not use it would be dead code arriving
// with its own green test suite — which is the exact thing #146's message called
// out about `arrangeBoard` before it deleted it.
//
// `fromLegacy` is not restored either. It read `WidgetInstance.width`, a field
// that no longer exists, and its job — turning a placement-less layout into rects
// — belongs to `sanitize.ts` now, which has to decide by MODE rather than
// unconditionally.

/** Rows a wall is authored against when the real viewport is unknown (SSR, tests). */
export const DEFAULT_BOARD_ROWS = 28;

/**
 * WALL — uniform cards, three across.
 *
 * ── NO STAGE PARAMETER, AND THAT IS THE WHOLE POINT ─────────────────────────
 * This used to take a `stageId` and hand it a double-height block in the top-left,
 * then walk the remaining cards around the cells the stage had claimed. That
 * existed because the map was a tile competing for cells with every card, which is
 * the arrangement #146 removed the grid over.
 *
 * On a wall board the map is not in the grid at all — it lives in the right-hand
 * dock — so all twelve columns belong to the wall, and the step-over walk goes
 * with the claim it was stepping over. A card is 4 of 12 columns, which is three
 * across with no uncovered cell, and at a 16:9 frame that is the aspect ratio a
 * camera actually is. The measured 2.68–6.30 letterboxing that the old
 * `arrangeHouse` rail produced is what this shape exists to avoid.
 *
 * Card height is derived from the row budget rather than fixed, so a wall fills
 * the window it is on instead of stopping partway down a large monitor or running
 * off the bottom of a laptop.
 */
export function arrangeWall(ids: readonly string[], rows = DEFAULT_BOARD_ROWS): GridItem[] {
  const CARD_W = 4;
  const perRow = COLS / CARD_W; // 3
  const bands = Math.max(1, Math.ceil(ids.length / perRow));
  const CARD_H = Math.max(MIN_H, Math.floor(rows / bands));

  const out: GridItem[] = [];
  let x = 0;
  let y = 0;
  for (const id of ids) {
    out.push({ id, x, y, w: CARD_W, h: CARD_H });
    x += CARD_W;
    if (x + CARD_W > COLS) { x = 0; y += CARD_H; }
  }

  return settle(out, null);
}

/**
 * Read a widget's rect, or null when it has none.
 *
 * Null is a real, expected answer rather than a fault: a rails-mode widget never
 * carries one, and a widget just added to a wall has not been placed yet. The
 * caller decides what to do about it — `WallWorkspace` skips it, `sanitize` mints
 * one with `findFreeSpot`.
 */
export function rectOf(w: WidgetInstance): GridRect | null {
  return w.rect ? clampRect({ ...w.rect }) : null;
}
