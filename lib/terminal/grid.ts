import type { TerminalMode } from "@/lib/terminal/mode";

/** A widget's placement: the instance id and the CSS grid-area name generated for it. */
export interface GridSlot { id: string; area: string }

export interface GridSpec {
  /** Value for grid-template-areas (rows already quoted, newline separated). */
  areas: string;
  /** Value for grid-template-columns. */
  columns: string;
  /** Value for grid-template-rows. */
  rows: string;
  /** Every widget that got a cell, in DOM order. */
  slots: GridSlot[];
  /** The map stage's area name, or null when the layout has no room for it. */
  stage: string | null;
}

// ── Why this file is pure, and why it is paranoid ────────────────────────────
// grid-template-areas is the only CSS property in the shell with no observable
// failure mode. A row with the wrong number of tokens, an area name that is not
// a valid custom-ident, or a named area that is not a rectangle does not throw,
// does not warn, and does not appear in devtools as an override — the parser
// discards the whole declaration, every child falls back to auto-placement, and
// the terminal renders as a pile. No runtime check can catch that, so the
// guarantees have to be structural: one code path builds every row, every row
// is built to the same fixed width, and area names are generated rather than
// taken from data. tests/unit/terminal-grid.test.ts asserts those invariants
// directly, which is the only place they can be asserted at all — vitest runs
// in the node environment here, so there is no DOM to render into.

// Both modes are six columns wide. Keeping the count identical across modes is
// what makes a mode switch a pure restyle: same widgets, same area names, only
// the container's style object changes. Nothing unmounts, so nothing refetches.
const COLS = 6;

/** The empty-cell token. A bare "." in grid-template-areas means "no area here". */
const EMPTY = ".";

/** The map stage's area name. `areaName` can never collide with it — see below. */
const STAGE = "stage";

// CONSOLE: the map-dominant template. 300px of left rail, three flexible map
// columns that squeeze to 150px before anything overflows, then two fixed 250px
// columns of right-hand cards.
const CONSOLE_COLUMNS =
  "300px minmax(150px, 1fr) minmax(150px, 1fr) minmax(150px, 1fr) 250px 250px";

/** WALL: everything equal, for scanning. 185px is the narrowest a card body stays readable at. */
const WALL_COLUMNS = `repeat(${COLS}, minmax(185px, 1fr))`;

/** Height of a CONSOLE bottom-dock row. Fixed, so the map above it never reflows as cards update. */
const BOTTOM_ROW = "232px";

/**
 * PURE: a CSS custom-ident safe area name for a widget index. Never collides with "stage".
 *
 * The name comes from the widget's INDEX in the flattened left→right→bottom
 * list, never from its instance id, for three reasons:
 *
 *  1. Instance ids arrive from localStorage and from `?c=` share links, so they
 *     are history-controlled and are not guaranteed to be valid CSS
 *     custom-idents. One bad character silently voids the whole template.
 *  2. The index is the same in CONSOLE and in WALL, so a widget keeps its area
 *     name across a mode switch and React can keep the element mounted.
 *  3. Two widgets can never share a name, so every named area stays a
 *     rectangle. A non-rectangular area is discarded just as silently as a
 *     malformed row.
 *
 * The "w" prefix does the rest of the work: a custom-ident may not start with a
 * digit, and "w" followed by digits can never spell "stage".
 */
export function areaName(index: number): string {
  // Clamp before formatting. Above 1e21 JavaScript stringifies numbers in
  // exponential notation ("1e+21"), and "w1e+21" is not a custom-ident — the
  // sort of value that only arrives from corrupted persisted state, and exactly
  // the sort that would take the whole grid down with no error.
  const raw = Number.isFinite(index) ? Math.floor(index) : 0;
  const i = Math.min(Math.max(raw, 0), Number.MAX_SAFE_INTEGER);
  return `w${i}`;
}

/** Quote each row and join them the way grid-template-areas wants to be written. */
function renderAreas(rows: string[][]): string {
  return rows.map((row) => `"${row.join(" ")}"`).join("\n");
}

/**
 * Spread `slots` across exactly COLS columns as evenly as possible, giving the
 * leftover columns to the earliest slots. Always returns COLS entries, which is
 * the row-width invariant this file exists to protect.
 */
function spreadEvenly(slots: GridSlot[]): string[] {
  if (slots.length === 0) return new Array<string>(COLS).fill(EMPTY);
  const row: string[] = [];
  const base = Math.floor(COLS / slots.length);
  const extra = COLS % slots.length;
  for (let i = 0; i < slots.length; i++) {
    // Callers chunk by COLS first, so `base` is never 0 here. The floor is a
    // guard, not a feature: a zero-width span would drop a widget, and a row
    // one cell too wide is at least visible.
    const span = Math.max(1, base + (i < extra ? 1 : 0));
    for (let s = 0; s < span; s++) row.push(slots[i].area);
  }
  return row;
}

/**
 * CONSOLE — map-dominant.
 *
 *   col 0      : the left segment, one widget per row
 *   cols 1..3  : the stage, spanning every row above the dock
 *   cols 4..5  : the right segment, two per row, left-to-right then down
 *   final rows : the bottom segment, spread across all six columns, 232px each
 *
 * The design's reference template stretches two of its right-hand cards over
 * two rows and gives one bottom card three of the six columns. Those are
 * hand-tuned to that one widget count; the rules here are uniform so they
 * survive any count, which is the whole reason the template is generated rather
 * than shipped as a string.
 *
 * The six columns stay in the template even when a segment is empty. Collapsing
 * the left column whenever the left segment empties would change the map's
 * width every time a widget is added or removed, and a MapLibre canvas resize
 * is not free.
 */
function consoleGrid(left: GridSlot[], right: GridSlot[], bottom: GridSlot[]): GridSpec {
  // At least one row, always: with no widgets at all the stage still needs a
  // row to live in, and a grid with zero rows has nowhere to put the map.
  const rowsAbove = Math.max(left.length, Math.ceil(right.length / 2), 1);

  // Bottom widgets past the sixth wrap onto another 232px row rather than being
  // squeezed into a zero-width column. Dropping a widget to preserve the
  // design's single dock row would be the one failure a user actually notices.
  const bottomRows = Math.ceil(bottom.length / COLS);

  const cells: string[][] = [];
  for (let r = 0; r < rowsAbove; r++) {
    const row = new Array<string>(COLS).fill(EMPTY);
    if (r < left.length) row[0] = left[r].area;
    row[1] = STAGE;
    row[2] = STAGE;
    row[3] = STAGE;
    const a = right[r * 2];
    const b = right[r * 2 + 1];
    if (a !== undefined) row[4] = a.area;
    if (b !== undefined) row[5] = b.area;
    cells.push(row);
  }
  for (let r = 0; r < bottomRows; r++) {
    cells.push(spreadEvenly(bottom.slice(r * COLS, r * COLS + COLS)));
  }

  return {
    areas: renderAreas(cells),
    columns: CONSOLE_COLUMNS,
    rows: [
      ...new Array<string>(rowsAbove).fill("1fr"),
      ...new Array<string>(bottomRows).fill(BOTTOM_ROW),
    ].join(" "),
    slots: [...left, ...right, ...bottom],
    stage: STAGE,
  };
}

/**
 * WALL — everything equal, for scanning.
 *
 * Widgets fill six-wide rows in order; the stage takes the first two columns of
 * the row after the first row of widgets, so it sits bottom-left exactly as the
 * design shows. Every logical row is emitted TWICE, which is what gives the
 * stage its 2x2 block: the stage is one logical row tall, and the doubling
 * turns that into two template rows without any widget needing to be two rows
 * tall. Because the doubling is applied to every row uniformly, the cells stay
 * square relative to each other — it costs nothing except a longer string.
 *
 * Rows keep being added until every widget has a cell. A wall that quietly
 * stopped at some row count would lose cards, and losing a card is the one
 * thing this feature must never do.
 */
function wallGrid(slots: GridSlot[]): GridSpec {
  // With no widgets the stage starts at row 0 — there is no widget row for it
  // to sit under, and an empty first row would just be a band of dead pixels.
  const stageRow = slots.length > 0 ? 1 : 0;
  const logical: string[][] = [];

  const ensureRow = (r: number) => {
    while (logical.length <= r) {
      const row = new Array<string>(COLS).fill(EMPTY);
      if (logical.length === stageRow) {
        row[0] = STAGE;
        row[1] = STAGE;
      }
      logical.push(row);
    }
  };
  ensureRow(stageRow);

  let r = 0;
  let c = 0;
  for (const slot of slots) {
    // Walk to the next free cell, stepping over the stage block rather than
    // overwriting it.
    for (;;) {
      ensureRow(r);
      if (c >= COLS) { r += 1; c = 0; continue; }
      if (logical[r][c] === EMPTY) break;
      c += 1;
    }
    logical[r][c] = slot.area;
    c += 1;
  }

  const doubled: string[][] = [];
  for (const row of logical) { doubled.push(row); doubled.push(row); }

  return {
    areas: renderAreas(doubled),
    columns: WALL_COLUMNS,
    rows: new Array<string>(doubled.length).fill("1fr").join(" "),
    slots,
    stage: STAGE,
  };
}

/**
 * Turn a widget layout into a CSS grid template.
 *
 * DOM order is left, then right, then bottom — the segment order the rest of
 * the console already uses — in both modes. Grid areas do the visual placement,
 * so DOM order is purely tab and screen-reader order, and keeping a segment's
 * widgets contiguous there is what makes "the left column" mean anything to a
 * keyboard user.
 *
 * `stage` is typed nullable because a caller must handle a template with no map
 * cell, but neither mode can produce that today: CONSOLE always keeps at least
 * one row above the dock and WALL always places the block. It stays nullable so
 * a future denser mode can say "no room" without breaking every caller.
 */
export function terminalGrid(input: {
  mode: TerminalMode;
  left: string[];    // widget instance ids, in order, from the "left" segment
  right: string[];
  bottom: string[];
}): GridSpec {
  // Segments are defensively defaulted: these come from a persisted layout that
  // sanitizeLayout can hand back with a segment missing entirely.
  const left = input.left ?? [];
  const right = input.right ?? [];
  const bottom = input.bottom ?? [];

  // One index space across all three segments, assigned before either builder
  // runs, so a widget's area name depends only on its position in the layout —
  // not on which mode is drawing it, and not on the id itself.
  const flat: GridSlot[] = [...left, ...right, ...bottom].map((id, i) => ({ id, area: areaName(i) }));

  const leftSlots = flat.slice(0, left.length);
  const rightSlots = flat.slice(left.length, left.length + right.length);
  const bottomSlots = flat.slice(left.length + right.length);

  return input.mode === "wall"
    ? wallGrid(flat)
    : consoleGrid(leftSlots, rightSlots, bottomSlots);
}
