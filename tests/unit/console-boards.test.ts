// tests/unit/console-boards.test.ts
//
// The regression these tests exist for: every board shared ONE saved layout, so
// clicking a board tab rebuilt that board from its template and destroyed whatever
// the user had arranged. A reload restored edits correctly, which is what made the
// bug survive so long — persistence looked like it worked, and only a board switch
// exposed it.
//
// vitest runs in the node environment here, so there is no `window`. `persist.ts`
// checks `typeof window === "undefined"` and silently no-ops, which would make every
// assertion below vacuously pass against a store that saves nothing. The stub is
// therefore load-bearing, not scaffolding: without it these tests prove nothing.

import { afterEach, beforeEach, expect, test } from "vitest";
import { createDefaultLayout, type ShellLayout } from "@/lib/console/types";

function installStorage(): Map<string, string> {
  const map = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { map.set(k, v); },
      removeItem: (k: string) => { map.delete(k); },
    },
  };
  return map;
}

let store: Map<string, string>;
beforeEach(async () => {
  store = installStorage();
  const { activePresetStore } = await import("@/lib/console/activePreset");
  const { shellLayoutStore } = await import("@/lib/console/store");
  activePresetStore.set(null);
  shellLayoutStore.replace(createDefaultLayout(), { archive: false });
  store.clear();
});
afterEach(() => { delete (globalThis as { window?: unknown }).window; });

/** A layout with one identifiable widget at an identifiable rect. */
function layoutWith(rect: { x: number; y: number; w: number; h: number }): ShellLayout {
  const base = createDefaultLayout();
  return {
    ...base,
    widgets: [{
      id: "w-test", type: "events", segment: "left", order: 0,
      width: 12, height: 260, rect, collapsed: false, config: {},
    }],
  };
}

test("a board with no edits has no slot, and reads back as null", async () => {
  const { readBoardLayout, isBoardEdited } = await import("@/lib/console/boards");
  expect(readBoardLayout("earth")).toBeNull();
  expect(isBoardEdited("earth")).toBe(false);
});

test("each board keeps its own layout — they do not share one slot", async () => {
  const { writeBoardLayout, readBoardLayout } = await import("@/lib/console/boards");
  // Both rects are already SETTLED against the default stage cell ({x:3,y:0,w:6,h:14}):
  // one sits directly below it, one beside it in columns the stage does not use. A
  // rect that overlapped the stage, or that floated when compacted, would come back
  // moved — legally — and the test would then be asserting against the collision
  // resolver rather than against storage.
  writeBoardLayout("earth", layoutWith({ x: 0, y: 14, w: 6, h: 6 }));
  writeBoardLayout("situation", layoutWith({ x: 0, y: 0, w: 3, h: 9 }));

  expect(readBoardLayout("earth")!.widgets[0].rect).toEqual({ x: 0, y: 14, w: 6, h: 6 });
  expect(readBoardLayout("situation")!.widgets[0].rect).toEqual({ x: 0, y: 0, w: 3, h: 9 });
});

test("a corrupt slot degrades to null rather than rendering a broken board", async () => {
  const { readBoardLayout } = await import("@/lib/console/boards");
  store.set("tn.console.boards.v1", JSON.stringify({ v: 1, d: { earth: { widgets: "not an array" } } }));
  expect(readBoardLayout("earth")).toBeNull();
});

test("forgetting a board's layout is what makes Reset mean something", async () => {
  const { writeBoardLayout, forgetBoardLayout, isBoardEdited } = await import("@/lib/console/boards");
  writeBoardLayout("earth", layoutWith({ x: 0, y: 14, w: 6, h: 6 }));
  expect(isBoardEdited("earth")).toBe(true);
  forgetBoardLayout("earth");
  expect(isBoardEdited("earth")).toBe(false);
});

// ── The regression itself ───────────────────────────────────────────────────

test("REGRESSION: a board switch no longer destroys the board you came from", async () => {
  const { applyPreset } = await import("@/lib/console/presets");
  const { shellLayoutStore } = await import("@/lib/console/store");

  applyPreset("earth");
  const moved = shellLayoutStore.get().widgets[0];
  // Stand in for a drag: the store's single write path for every pointer gesture.
  shellLayoutStore.placeItem(moved.id, { x: 0, y: 14, w: 6, h: 6 });
  const edited = shellLayoutStore.get().widgets.find((w) => w.id === moved.id)!.rect;

  applyPreset("overview");
  applyPreset("earth");

  expect(
    shellLayoutStore.get().widgets.find((w) => w.id === moved.id)?.rect,
    "the card came back where the template puts it, not where the user left it",
  ).toEqual(edited);
});

test("opening a board is not editing it — an untouched board stays clean", async () => {
  const { applyPreset } = await import("@/lib/console/presets");
  const { isBoardEdited } = await import("@/lib/console/boards");

  applyPreset("earth");
  applyPreset("overview");
  applyPreset("earth");

  expect(isBoardEdited("earth"), "merely viewing a board must not mark it edited").toBe(false);
});

test("a drag marks the board edited; Reset puts the template back and clears the mark", async () => {
  const { applyPreset, resetActiveBoard } = await import("@/lib/console/presets");
  const { shellLayoutStore } = await import("@/lib/console/store");
  const { isBoardEdited } = await import("@/lib/console/boards");

  applyPreset("earth");
  const template = shellLayoutStore.get().widgets.map((w) => w.rect);
  shellLayoutStore.placeItem(shellLayoutStore.get().widgets[0].id, { x: 0, y: 14, w: 6, h: 6 });
  expect(isBoardEdited("earth")).toBe(true);

  resetActiveBoard();

  expect(shellLayoutStore.get().widgets.map((w) => w.rect)).toEqual(template);
  expect(isBoardEdited("earth"), "a reset board must not still read as edited").toBe(false);
});

test("edits to one board do not leak into another board's slot", async () => {
  const { applyPreset } = await import("@/lib/console/presets");
  const { shellLayoutStore } = await import("@/lib/console/store");
  const { isBoardEdited } = await import("@/lib/console/boards");

  applyPreset("earth");
  shellLayoutStore.placeItem(shellLayoutStore.get().widgets[0].id, { x: 0, y: 14, w: 6, h: 6 });
  applyPreset("situation");

  expect(isBoardEdited("earth")).toBe(true);
  expect(isBoardEdited("situation"), "the board just opened was never touched").toBe(false);
});
