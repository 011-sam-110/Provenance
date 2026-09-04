import { expect, test, vi, beforeEach } from "vitest";
import { sanitizeLayout } from "@/lib/console/sanitize";
import { COLS, overlaps } from "@/lib/terminal/layoutGrid";
import type { GridRect } from "@/lib/console/types";

// ── The two hazards this feature was built around ───────────────────────────
//
// Both were found by reading the code rather than by a failure, and neither has
// a symptom anyone could see:
//
//   1. `sanitize.ts` does not IGNORE a stored rect, it CONVERTS it. Left alone,
//      a wall silently reverts to a stack on the next page load.
//   2. `emit()` re-parsed the whole board archive on every drag commit — tens of
//      times per gesture. Dormant since #146 only because nothing dragged.
//
// These are the tests that make each one loud.

const SEGMENTS = {
  left: { size: 320, collapsed: false },
  right: { size: 400, collapsed: true },
  bottom: { size: 0, collapsed: false },
};

function widget(id: string, rect: GridRect | null) {
  return {
    id,
    type: "camslot",
    segment: "left",
    order: 0,
    height: 240,
    collapsed: false,
    config: { streams: [] },
    ...(rect ? { rect } : {}),
  };
}

function blob(mode: string | undefined, rects: (GridRect | null)[]) {
  return {
    stage: "map2d",
    segments: SEGMENTS,
    ...(mode ? { mode } : {}),
    widgets: rects.map((r, i) => widget(`w${i}`, r)),
  };
}

// ── Hazard 1 — sanitize ─────────────────────────────────────────────────────

test("a wall layout keeps its rects across a round trip", () => {
  const rects = [
    { x: 0, y: 0, w: 6, h: 12 },
    { x: 6, y: 0, w: 3, h: 6 },
  ];
  const out = sanitizeLayout(blob("wall", rects));
  expect(out).not.toBeNull();
  expect(out!.mode).toBe("wall");
  expect(out!.widgets.map((w) => w.rect)).toEqual(rects);
});

test("a rails layout still migrates its rects away, exactly as before", () => {
  // The legacy path is UNCHANGED and that is the point of asserting it here: a
  // rect on a rails board can only have come from a pre-rails build, and
  // `railsFromRects` converting it into a rail placement is correct.
  const out = sanitizeLayout(blob("rails", [{ x: 8, y: 0, w: 4, h: 10 }]));
  expect(out!.mode).toBe("rails");
  expect(out!.widgets[0].rect).toBeUndefined();
});

test("a layout with NO mode reads as rails — every board already in the wild", () => {
  // This is the whole compatibility story. If this ever flips, every saved board,
  // every archived board and every `?c=` link minted before walls existed changes
  // behaviour at once, with no version bump to explain it.
  const out = sanitizeLayout(blob(undefined, [{ x: 8, y: 0, w: 4, h: 10 }]));
  expect(out!.mode).toBe("rails");
  expect(out!.widgets[0].rect).toBeUndefined();
});

test("an unknown mode falls back to rails rather than rendering nothing", () => {
  const out = sanitizeLayout(blob("mosaic", [null]));
  expect(out!.mode).toBe("rails");
});

test("a wall tile that arrives with no rect is given one", () => {
  // The failure this prevents has no symptom: an unplaced tile is mounted, holds
  // its config and its fetches, and draws nothing at all.
  const out = sanitizeLayout(blob("wall", [null, null, null]));
  expect(out!.widgets).toHaveLength(3);
  for (const w of out!.widgets) expect(w.rect).toBeTruthy();
});

test("seeding the unplaced does not disturb the placed, and never overlaps", () => {
  const pinned = { x: 0, y: 0, w: 6, h: 12 };
  const out = sanitizeLayout(blob("wall", [pinned, null, null]));
  expect(out!.widgets[0].rect).toEqual(pinned);

  const rects = out!.widgets.map((w) => w.rect!);
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      expect(overlaps(rects[i], rects[j]), `tile ${i} overlaps tile ${j}`).toBe(false);
    }
  }
});

test("a rect that runs off the board is clamped, not trusted", () => {
  const out = sanitizeLayout(blob("wall", [{ x: 10, y: 0, w: 8, h: 6 }]));
  const r = out!.widgets[0].rect!;
  expect(r.x + r.w).toBeLessThanOrEqual(COLS);
});

test("a half-written rect is treated as absent and re-seeded", () => {
  const raw = blob("wall", [null]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (raw.widgets[0] as any).rect = { x: 0, y: 0, w: 4 }; // no h
  const out = sanitizeLayout(raw);
  expect(out!.widgets[0].rect).toBeTruthy();
  expect(out!.widgets[0].rect!.h).toBeGreaterThan(0);
});

test("a wall keeps segment and order valid, so a mode switch needs no migration", () => {
  const out = sanitizeLayout(blob("wall", [
    { x: 0, y: 0, w: 4, h: 6 },
    { x: 4, y: 0, w: 4, h: 6 },
  ]));
  expect(out!.widgets.map((w) => w.order)).toEqual([0, 1]);
  for (const w of out!.widgets) expect(w.segment).toBe("left");
});

// ── Hazard 2 — the gesture suspension ───────────────────────────────────────
//
// `lib/console/boards.ts` is the expensive half: `writeBoardLayout` re-reads and
// re-writes the entire archive. Spying on it counts exactly what a drag costs.

vi.mock("@/lib/console/boards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/console/boards")>();
  return { ...actual, writeBoardLayout: vi.fn() };
});

beforeEach(() => {
  vi.clearAllMocks();
});

test("a gesture writes the board archive ONCE, not once per commit", async () => {
  const { shellLayoutStore } = await import("@/lib/console/store");
  const { activePresetStore } = await import("@/lib/console/activePreset");
  const { writeBoardLayout } = await import("@/lib/console/boards");

  activePresetStore.set("streets");
  shellLayoutStore.set({
    segments: SEGMENTS,
    stage: "map2d",
    mode: "wall",
    focusedWidgetId: null,
    widgets: [
      { id: "a", type: "camslot", segment: "left", order: 0, height: 240, collapsed: false, config: {}, rect: { x: 0, y: 0, w: 4, h: 6 } },
    ],
  });
  vi.mocked(writeBoardLayout).mockClear();

  shellLayoutStore.beginGesture();
  // Twenty commits is a short drag. Before the suspension every one of these
  // parsed and re-stringified the whole archive.
  for (let x = 0; x < 20; x++) {
    shellLayoutStore.placeItem("a", { x: x % 8, y: 0, w: 4, h: 6 });
  }
  expect(vi.mocked(writeBoardLayout)).not.toHaveBeenCalled();

  shellLayoutStore.endGesture();
  expect(vi.mocked(writeBoardLayout)).toHaveBeenCalledTimes(1);
});

test("subscribers still fire on every commit — the board has to repaint mid-drag", async () => {
  const { shellLayoutStore } = await import("@/lib/console/store");

  let notifications = 0;
  const off = shellLayoutStore.subscribe(() => { notifications += 1; });

  shellLayoutStore.beginGesture();
  for (let x = 0; x < 5; x++) shellLayoutStore.placeItem("a", { x, y: 0, w: 4, h: 6 });
  shellLayoutStore.endGesture();
  off();

  // What is suspended is PERSISTENCE, never NOTIFICATION. Suspending the latter
  // would freeze the tile under the pointer.
  expect(notifications).toBeGreaterThanOrEqual(5);
});

test("an interrupted gesture still persists — pointercancel is not a black hole", async () => {
  const { shellLayoutStore } = await import("@/lib/console/store");
  const { writeBoardLayout } = await import("@/lib/console/boards");
  vi.mocked(writeBoardLayout).mockClear();

  shellLayoutStore.beginGesture();
  shellLayoutStore.placeItem("a", { x: 4, y: 0, w: 4, h: 6 });
  shellLayoutStore.endGesture(); // useGridDrag routes pointercancel through here

  expect(vi.mocked(writeBoardLayout)).toHaveBeenCalledTimes(1);
});

test("endGesture without a matching begin is a no-op, not an underflow", async () => {
  const { shellLayoutStore } = await import("@/lib/console/store");
  const { writeBoardLayout } = await import("@/lib/console/boards");
  vi.mocked(writeBoardLayout).mockClear();

  shellLayoutStore.endGesture();
  shellLayoutStore.endGesture();
  expect(vi.mocked(writeBoardLayout)).not.toHaveBeenCalled();

  // …and the store is still writable afterwards, i.e. the counter did not go
  // negative and leave persistence suspended forever.
  shellLayoutStore.placeItem("a", { x: 0, y: 0, w: 4, h: 6 });
  expect(vi.mocked(writeBoardLayout)).toHaveBeenCalledTimes(1);
});
