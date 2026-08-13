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
  arrangeConsole,
  arrangeWall,
  fromLegacy,
  type GridItem,
} from "@/lib/terminal/layoutGrid";
import type { WidgetInstance } from "@/lib/console/types";

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

// ── Auto-arrange ────────────────────────────────────────────────────────────
// CONSOLE and WALL stop being templates that override a widget's size and become
// generators that SEED rects the user can then move. Both must be total: every
// widget handed in comes back with a cell.

describe("arrangeConsole / arrangeWall", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`);

  for (const n of [0, 1, 2, 3, 7, 13, 50]) {
    it(`console places all ${n} widgets validly`, () => {
      const out = arrangeConsole(ids(n), "stage");
      expect(out.filter((i) => i.id !== "stage")).toHaveLength(n);
      expectValid(out);
    });
    it(`wall places all ${n} widgets validly`, () => {
      const out = arrangeWall(ids(n), "stage");
      expect(out.filter((i) => i.id !== "stage")).toHaveLength(n);
      expectValid(out);
    });
  }

  it("console always includes the stage and gives it the dominant block", () => {
    const out = arrangeConsole(ids(6), "stage");
    const stage = out.find((i) => i.id === "stage")!;
    expect(stage).toBeDefined();
    expect(stage.w).toBeGreaterThanOrEqual(6);
  });

  it("omits the stage entirely when none is asked for", () => {
    const out = arrangeConsole(ids(4), null);
    expect(out.find((i) => i.id === "stage")).toBeUndefined();
    expect(out).toHaveLength(4);
    expectValid(out);
  });

  it("wall gives every widget the same size", () => {
    const cards = arrangeWall(ids(8), null);
    const sizes = new Set(cards.map((c) => `${c.w}x${c.h}`));
    expect(sizes.size).toBe(1);
  });
});

// ── Migration ───────────────────────────────────────────────────────────────
// Every persisted layout, every `?c=` share link and all 6 built-in presets speak
// segment/order/width/height. None of them may be lost.

describe("fromLegacy", () => {
  const w = (id: string, segment: "left" | "right" | "bottom", order: number, width = 12, height = 260) =>
    ({ id, type: "t", segment, order, width, height, collapsed: false, config: {} }) as WidgetInstance;

  it("gives every legacy widget a valid cell", () => {
    const out = fromLegacy([
      w("a", "left", 0), w("b", "left", 1),
      w("c", "right", 0), w("d", "right", 1),
      w("e", "bottom", 0),
    ], "stage");
    expect(out.filter((i) => i.id !== "stage")).toHaveLength(5);
    expectValid(out);
  });

  it("is deterministic — the same layout always migrates identically", () => {
    const input = [w("a", "left", 0), w("b", "right", 0), w("c", "bottom", 0)];
    expect(fromLegacy(input, "stage")).toEqual(fromLegacy(input, "stage"));
  });

  it("keeps left-segment widgets left of right-segment ones", () => {
    const out = fromLegacy([w("l", "left", 0), w("r", "right", 0)], null);
    const l = out.find((i) => i.id === "l")!;
    const r = out.find((i) => i.id === "r")!;
    expect(l.x).toBeLessThan(r.x);
  });

  it("reads a legacy span as a fraction of ITS SEGMENT, not of the board", () => {
    // The bottom dock owned all 12 columns, so a half-width dock card is 6 of 12.
    expect(fromLegacy([w("half", "bottom", 0, 6)], null)[0].w).toBe(6);
    // The left rail owns 4, so "full width" there means 4 — not the whole screen.
    expect(fromLegacy([w("full", "left", 0, 12)], null)[0].w).toBe(4);
    expect(fromLegacy([w("half", "left", 0, 6)], null)[0].w).toBe(2);
  });

  it("converts a legacy pixel height into whole rows", () => {
    // 260px at 24px rows + 1px gap ≈ 10 rows. Exactness is not the contract;
    // being in the right neighbourhood and never below MIN_H is.
    const out = fromLegacy([w("a", "left", 0, 12, 260)], null);
    expect(out[0].h).toBeGreaterThanOrEqual(8);
    expect(out[0].h).toBeLessThanOrEqual(12);
  });

  it("survives a widget carrying junk numbers", () => {
    const junk = { id: "x", type: "t", segment: "left", order: NaN, width: -3, height: 0, collapsed: false, config: {} } as unknown as WidgetInstance;
    const out = fromLegacy([junk], null);
    expect(out).toHaveLength(1);
    expectValid(out);
  });

  it("handles an empty board", () => {
    expect(fromLegacy([], null)).toEqual([]);
    expect(fromLegacy([], "stage")).toHaveLength(1);
  });

  it("does not drop widgets when the board exceeds one screen", () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      w(`w${i}`, (["left", "right", "bottom"] as const)[i % 3], Math.floor(i / 3)));
    const out = fromLegacy(many, "stage");
    expect(out.filter((i) => i.id !== "stage")).toHaveLength(50);
    expectValid(out);
  });
});
