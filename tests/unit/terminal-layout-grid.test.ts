import { describe, it, expect } from "vitest";
import {
  COLS,
  MIN_W,
  MIN_H,
  clampRect,
  overlaps,
  settle,
  compact,
  resolveCollisions,
  readingOrder,
  rowsUsed,
  place,
  arrangeWall,
  type GridItem,
} from "@/lib/terminal/layoutGrid";

// ── Helpers ─────────────────────────────────────────────────────────────────
const it_ = (id: string, x: number, y: number, w: number, h: number): GridItem => ({ id, x, y, w, h });

/** The one invariant every operation in this file has to preserve. */
function expectValid(items: GridItem[]) {
  for (const r of items) {
    expect(r.x, `${r.id}.x`).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w, `${r.id} right edge`).toBeLessThanOrEqual(COLS);
    expect(r.y, `${r.id}.y`).toBeGreaterThanOrEqual(0);
    expect(r.w, `${r.id}.w`).toBeGreaterThanOrEqual(MIN_W);
    expect(r.h, `${r.id}.h`).toBeGreaterThanOrEqual(MIN_H);
    expect(Number.isInteger(r.x) && Number.isInteger(r.y), `${r.id} integral`).toBe(true);
  }
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      expect(
        overlaps(items[i], items[j]),
        `${items[i].id} overlaps ${items[j].id}`,
      ).toBe(false);
    }
  }
}

/** Deterministic PRNG — Math.random would make a failure unreproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

describe("overlaps", () => {
  it("is false for boxes that only touch edges", () => {
    expect(overlaps(it_("a", 0, 0, 3, 3), it_("b", 3, 0, 3, 3))).toBe(false);
    expect(overlaps(it_("a", 0, 0, 3, 3), it_("b", 0, 3, 3, 3))).toBe(false);
  });
  it("is true for any shared cell", () => {
    expect(overlaps(it_("a", 0, 0, 4, 4), it_("b", 3, 3, 4, 4))).toBe(true);
  });
  it("is symmetric", () => {
    const a = it_("a", 1, 2, 5, 4);
    const b = it_("b", 3, 1, 4, 6);
    expect(overlaps(a, b)).toBe(overlaps(b, a));
  });
});

describe("clampRect", () => {
  it("keeps a widget inside the 12 columns by moving x, not by shrinking w", () => {
    const r = clampRect(it_("a", 10, 0, 6, 5));
    expect(r.w).toBe(6);
    expect(r.x).toBe(COLS - 6);
  });
  it("enforces the minimums", () => {
    const r = clampRect(it_("a", 0, 0, 1, 1));
    expect(r.w).toBe(MIN_W);
    expect(r.h).toBe(MIN_H);
  });
  it("never lets w exceed the column count", () => {
    expect(clampRect(it_("a", 0, 0, 99, 5)).w).toBe(COLS);
  });
  it("rejects a negative or non-finite position", () => {
    expect(clampRect(it_("a", -4, -9, 4, 4)).x).toBe(0);
    expect(clampRect(it_("a", -4, -9, 4, 4)).y).toBe(0);
    expect(clampRect({ id: "a", x: NaN, y: NaN, w: NaN, h: NaN }).x).toBe(0);
    expect(clampRect({ id: "a", x: Infinity, y: Infinity, w: 4, h: 4 }).y).toBe(0);
  });
  it("rounds fractional drag output to whole cells", () => {
    const r = clampRect({ id: "a", x: 2.6, y: 4.4, w: 3.5, h: 5.5 });
    expect(r).toMatchObject({ x: 3, y: 4, w: 4, h: 6 });
  });
});

describe("compact", () => {
  it("floats widgets up into the gap above them", () => {
    const out = compact([it_("a", 0, 0, 6, 4), it_("b", 0, 10, 6, 4)]);
    expect(out.find((i) => i.id === "b")!.y).toBe(4);
  });
  it("does not float a widget through one above it", () => {
    const out = compact([it_("a", 0, 2, 6, 4), it_("b", 0, 10, 6, 4)]);
    expect(out.find((i) => i.id === "a")!.y).toBe(0);
    expect(out.find((i) => i.id === "b")!.y).toBe(4);
  });
  it("lets a widget rise past one in a different column", () => {
    const out = compact([it_("a", 0, 0, 6, 8), it_("b", 6, 12, 6, 4)]);
    expect(out.find((i) => i.id === "b")!.y).toBe(0);
  });
  it("is idempotent", () => {
    const once = compact([it_("a", 0, 5, 4, 4), it_("b", 4, 9, 4, 4), it_("c", 0, 20, 12, 3)]);
    expect(compact(once)).toEqual(once);
  });
  it("preserves every widget", () => {
    const input = [it_("a", 0, 3, 4, 4), it_("b", 4, 0, 4, 4), it_("c", 8, 7, 4, 4)];
    expect(compact(input).map((i) => i.id).sort()).toEqual(["a", "b", "c"]);
  });
});

describe("resolveCollisions", () => {
  it("pushes the collider down, not the pinned widget", () => {
    const out = resolveCollisions([it_("held", 0, 0, 6, 4), it_("other", 0, 0, 6, 4)], "held");
    expect(out.find((i) => i.id === "held")!.y).toBe(0);
    expect(out.find((i) => i.id === "other")!.y).toBe(4);
  });
  it("cascades through a stack", () => {
    const out = resolveCollisions(
      [it_("held", 0, 0, 12, 4), it_("a", 0, 0, 6, 4), it_("b", 0, 4, 6, 4)],
      "held",
    );
    expectValid(out);
    expect(out.find((i) => i.id === "held")!.y).toBe(0);
  });
  it("resolves even with no pinned id", () => {
    expectValid(resolveCollisions([it_("a", 0, 0, 6, 4), it_("b", 2, 1, 6, 4)], null));
  });
});

describe("place", () => {
  it("moves a widget and pushes whatever was there down", () => {
    const board = [it_("a", 0, 0, 6, 4), it_("b", 6, 0, 6, 4)];
    const out = place(board, "a", { x: 6, y: 0, w: 6, h: 4 });
    expectValid(out);
    expect(out.find((i) => i.id === "a")).toMatchObject({ x: 6, y: 0 });
  });
  it("clamps a drag that ran off the right edge", () => {
    const out = place([it_("a", 0, 0, 4, 4)], "a", { x: 11, y: 0, w: 4, h: 4 });
    expect(out.find((i) => i.id === "a")!.x).toBe(COLS - 4);
  });
  it("is a no-op for an unknown id", () => {
    const board = [it_("a", 0, 0, 6, 4)];
    expect(place(board, "nope", { x: 0, y: 0, w: 3, h: 3 })).toEqual(board);
  });
  it("never drops a widget", () => {
    const board = [it_("a", 0, 0, 6, 4), it_("b", 6, 0, 6, 4), it_("c", 0, 4, 12, 4)];
    const out = place(board, "c", { x: 0, y: 0, w: 12, h: 6 });
    expect(out).toHaveLength(3);
    expectValid(out);
  });
});

describe("settle — randomised", () => {
  // The engine's real contract: whatever a user drags, the board that comes back
  // is valid. Fixed seeds so a failure is reproducible.
  for (const seed of [1, 7, 42, 1337, 90210]) {
    it(`holds every invariant over 200 random moves (seed ${seed})`, () => {
      const rand = rng(seed);
      let board: GridItem[] = compact(
        Array.from({ length: 9 }, (_, i) => it_(`w${i}`, (i % 4) * 3, Math.floor(i / 4) * 5, 3, 5)),
      );
      for (let n = 0; n < 200; n++) {
        const target = board[Math.floor(rand() * board.length)];
        board = place(board, target.id, {
          x: Math.floor(rand() * 14) - 1,
          y: Math.floor(rand() * 24) - 1,
          w: 1 + Math.floor(rand() * 13),
          h: 1 + Math.floor(rand() * 12),
        });
        expect(board).toHaveLength(9);
        expectValid(board);
      }
    });
  }

  it("terminates on a pathological all-overlapping board", () => {
    const board = Array.from({ length: 30 }, (_, i) => it_(`w${i}`, 0, 0, 12, 6));
    const out = settle(board, null);
    expect(out).toHaveLength(30);
    expectValid(out);
  });
});

describe("settle — randomised, with a pre-move rect", () => {
  // The block above drives place() the way every caller did before the swap
  // existed, so it never reaches the pre-pass. This one passes the rect the item
  // is actually leaving, which is what a live drag does, so the swap runs on
  // every single move. Same contract: whatever comes back is a valid board.
  //
  // It exists because the first attempt at this feature put the lift INSIDE the
  // collision loop, which broke that loop's "every pass moves a widget down"
  // termination argument. All 50 deterministic tests passed; the randomised pass
  // failed on 5 of 5 seeds with cards left overlapping. Nothing else caught it.
  for (const seed of [1, 7, 42, 1337, 90210, 5150, 24601]) {
    it(`holds every invariant over 200 swapping moves (seed ${seed})`, () => {
      const rand = rng(seed);
      let board: GridItem[] = compact(
        Array.from({ length: 9 }, (_, i) => it_(`w${i}`, (i % 4) * 3, Math.floor(i / 4) * 5, 3, 5)),
      );
      for (let n = 0; n < 200; n++) {
        const target = board[Math.floor(rand() * board.length)];
        const prev = { x: target.x, y: target.y, w: target.w, h: target.h };
        board = place(
          board,
          target.id,
          {
            x: Math.floor(rand() * 14) - 1,
            y: Math.floor(rand() * 24) - 1,
            w: 1 + Math.floor(rand() * 13),
            h: 1 + Math.floor(rand() * 12),
          },
          prev,
        );
        expect(board).toHaveLength(9);
        expectValid(board);
      }
    });
  }

  it("a downward move past a neighbour exchanges them rather than doing nothing", () => {
    const board = [it_("a", 0, 0, 6, 3), it_("b", 0, 3, 6, 3), it_("c", 0, 6, 6, 3)];
    const out = place(board, "a", { x: 0, y: 3, w: 6, h: 3 }, { x: 0, y: 0, w: 6, h: 3 });
    expectValid(out);
    expect(readingOrder(out).map((i) => i.id)).toEqual(["b", "a", "c"]);
  });

  it("leaves an upward move alone, which already worked", () => {
    const board = [it_("a", 0, 0, 6, 3), it_("b", 0, 3, 6, 3), it_("c", 0, 6, 6, 3)];
    const out = place(board, "c", { x: 0, y: 0, w: 6, h: 3 }, { x: 0, y: 6, w: 6, h: 3 });
    expectValid(out);
    expect(readingOrder(out).map((i) => i.id)).toEqual(["c", "a", "b"]);
  });

  it("without a pre-move rect the board settles exactly as it always did", () => {
    const board = [it_("a", 0, 0, 6, 3), it_("b", 0, 3, 6, 3), it_("c", 0, 6, 6, 3)];
    const legacy = place(board, "a", { x: 0, y: 3, w: 6, h: 3 });
    expect(readingOrder(legacy).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });
});

describe("readingOrder", () => {
  it("sorts top-to-bottom then left-to-right", () => {
    const order = readingOrder([
      it_("br", 6, 4, 6, 4), it_("tl", 0, 0, 6, 4),
      it_("bl", 0, 4, 6, 4), it_("tr", 6, 0, 6, 4),
    ]).map((i) => i.id);
    expect(order).toEqual(["tl", "tr", "bl", "br"]);
  });
  it("is stable for identical positions", () => {
    const a = it_("a", 0, 0, 3, 3);
    const b = it_("b", 0, 0, 3, 3);
    expect(readingOrder([a, b]).map((i) => i.id)).toEqual(["a", "b"]);
  });
});

describe("rowsUsed", () => {
  it("is the lowest bottom edge", () => {
    expect(rowsUsed([it_("a", 0, 0, 6, 4), it_("b", 6, 3, 6, 9)])).toBe(12);
  });
  it("is 0 for an empty board", () => {
    expect(rowsUsed([])).toBe(0);
  });
});
// ── The wall arrangement ────────────────────────────────────────────────────
// WALL stops being a template that overrides a widget's size and becomes a
// generator that SEEDS rects the user can then move. It must be total: every id
// handed in comes back with a cell.
//
// `arrangeConsole` and `fromLegacy` had suites here and they are NOT restored
// with the rest of this file — both functions are gone. arrangeConsole composed
// rails boards, which presets.ts now does over lib/terminal/rails.ts's splitSpan;
// fromLegacy read `WidgetInstance.width`, a field that no longer exists, and its
// job belongs to sanitize.ts, which has to decide by mode. Keeping either suite
// green over a deleted function is the failure mode this repo has already been
// bitten by once — see #146's note about arrangeBoard shipping fully unit-tested
// with zero callers.

describe("arrangeWall", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`);

  for (const n of [0, 1, 2, 3, 7, 13, 50]) {
    it(`places all ${n} tiles validly`, () => {
      const out = arrangeWall(ids(n));
      expect(out).toHaveLength(n);
      expectValid(out);
    });
  }

  it("gives every tile the same size", () => {
    const cards = arrangeWall(ids(8));
    const sizes = new Set(cards.map((c) => `${c.w}x${c.h}`));
    expect(sizes.size).toBe(1);
  });

  it("tiles three across, using every one of the twelve columns", () => {
    const cards = arrangeWall(ids(6));
    expect(new Set(cards.map((c) => c.x))).toEqual(new Set([0, 4, 8]));
    expect(cards.every((c) => c.w === 4)).toBe(true);
  });

  it("reserves no cells for a stage — the map is not on the board", () => {
    // The version this replaced took a stageId and gave it a double-height block
    // in the top-left, which is the arrangement #146 deleted the grid over. A
    // wall's first tile starts at the origin.
    const cards = arrangeWall(ids(3));
    expect(cards.some((c) => c.x === 0 && c.y === 0)).toBe(true);
  });

  it("wraps onto a second band past the third tile", () => {
    const cards = arrangeWall(ids(4));
    const rows = new Set(cards.map((c) => c.y));
    expect(rows.size).toBe(2);
  });

  it("keeps a large wall inside its row budget rather than running off the end", () => {
    const cards = arrangeWall(ids(9), 30);
    expect(rowsUsed(cards)).toBeLessThanOrEqual(30);
  });

  it("never composes a tile below the minimum height, even on a tiny budget", () => {
    const cards = arrangeWall(ids(30), 4);
    expect(cards.every((c) => c.h >= MIN_H)).toBe(true);
    expectValid(cards);
  });
});
