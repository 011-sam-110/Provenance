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
import { layoutSignature } from "@/lib/console/boards";

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

/** A layout with one identifiable widget at an identifiable rail placement. */
function layoutWith(height: number): ShellLayout {
  const base = createDefaultLayout();
  return {
    ...base,
    widgets: [{
      id: "w-test", type: "events", segment: "left", order: 0,
      height, collapsed: false, config: {},
    }],
  };
}

test("a board with no edits has no slot, and reads back as null", async () => {
  const { readBoardLayout, isBoardEdited } = await import("@/lib/console/boards");
  expect(readBoardLayout("streets")).toBeNull();
  expect(isBoardEdited("streets")).toBe(false);
});

test("each board keeps its own layout — they do not share one slot", async () => {
  const { writeBoardLayout, readBoardLayout } = await import("@/lib/console/boards");
  writeBoardLayout("streets", layoutWith(360));
  writeBoardLayout("overview", layoutWith(180));

  expect(readBoardLayout("streets")!.widgets[0].height).toBe(360);
  expect(readBoardLayout("overview")!.widgets[0].height).toBe(180);
});

test("a corrupt slot degrades to null rather than rendering a broken board", async () => {
  const { readBoardLayout } = await import("@/lib/console/boards");
  store.set("tn.console.boards.v1", JSON.stringify({ v: 1, d: { streets: { widgets: "not an array" } } }));
  expect(readBoardLayout("streets")).toBeNull();
});

test("forgetting a board's layout is what makes Reset mean something", async () => {
  const { writeBoardLayout, forgetBoardLayout, isBoardEdited } = await import("@/lib/console/boards");
  writeBoardLayout("streets", layoutWith(360));
  expect(isBoardEdited("streets")).toBe(true);
  forgetBoardLayout("streets");
  expect(isBoardEdited("streets")).toBe(false);
});

// ── layoutSignature — the trap this milestone exists to avoid ───────────────
//
// layoutSignature used to fingerprint `w.rect` and `l.stageRect`. Left alone
// once rects left the type, every board would report "edited" forever the
// instant it was opened — the customised dot lighting on all seven built-ins
// and Reset no longer meaning anything. These pin the replacement directly,
// independent of `presets.ts` (a rail-order difference is constructed by hand
// rather than through a board template).

test("layoutSignature: two layouts differing only in rail order produce different signatures", () => {
  const base = createDefaultLayout();
  const a: ShellLayout = {
    ...base,
    widgets: [
      { id: "x", type: "events", segment: "left", order: 0, height: 260, collapsed: false, config: {} },
      { id: "y", type: "aviation", segment: "left", order: 1, height: 260, collapsed: false, config: {} },
    ],
  };
  // Same two widgets, same rail, swapped order — nothing else differs.
  const b: ShellLayout = {
    ...base,
    widgets: [
      { id: "x", type: "events", segment: "left", order: 1, height: 260, collapsed: false, config: {} },
      { id: "y", type: "aviation", segment: "left", order: 0, height: 260, collapsed: false, config: {} },
    ],
  };
  expect(layoutSignature(a)).not.toBe(layoutSignature(b));
});

test("layoutSignature: an unedited board's freshly-built layout matches its own template", () => {
  const l = layoutWith(260);
  // Rebuilding the identical layout (as re-opening an unedited board does)
  // must sign identically — that identity is what lets "opening a board is not
  // editing it" hold.
  const rebuilt: ShellLayout = { ...l, widgets: l.widgets.map((w) => ({ ...w })) };
  expect(layoutSignature(l)).toBe(layoutSignature(rebuilt));
});

// ── The regression itself ───────────────────────────────────────────────────
//
// These exercise the board-archive machinery through `applyPreset` /
// `resetActiveBoard`, which live in `lib/console/presets.ts` — out of scope for
// this change (it is still authored against the deleted grid and is being
// converted separately). They are left in the rail vocabulary they should use
// once that conversion lands: `resizeWidget` standing in for a drag, since a
// rail has no free x/y to drag to — only a height to change, a rail to move
// between (`move`), or a place in the rail to move to.

// THE BOARD IDS HERE CHANGED WITH THE LINEUP, and only the ids. These tests exercise
// the board-archive machinery (applyPreset / resetActiveBoard / isBoardEdited), never
// the identity of a particular board — they only need one board that HAS widgets to
// resize and a second board to switch away to. "earth" (Hazards) and "situation"
// (Conflict) were removed, so the non-empty board is now Streets and the away-board is
// the landing globe, which is empty and therefore cannot be the one being resized.
test("REGRESSION: a board switch no longer destroys the board you came from", async () => {
  const { applyPreset } = await import("@/lib/console/presets");
  const { shellLayoutStore } = await import("@/lib/console/store");

  applyPreset("streets");
  const moved = shellLayoutStore.get().widgets[0];
  // Stand in for a drag: the store's write path for a height change.
  shellLayoutStore.resizeWidget(moved.id, 620);
  const edited = shellLayoutStore.get().widgets.find((w) => w.id === moved.id)!.height;

  applyPreset("overview");
  applyPreset("streets");

  expect(
    shellLayoutStore.get().widgets.find((w) => w.id === moved.id)?.height,
    "the card came back where the template puts it, not where the user left it",
  ).toEqual(edited);
});

test("opening a board is not editing it — an untouched board stays clean", async () => {
  const { applyPreset } = await import("@/lib/console/presets");
  const { isBoardEdited } = await import("@/lib/console/boards");

  applyPreset("streets");
  applyPreset("overview");
  applyPreset("streets");

  expect(isBoardEdited("streets"), "merely viewing a board must not mark it edited").toBe(false);
});

test("a drag marks the board edited; Reset puts the template back and clears the mark", async () => {
  const { applyPreset, resetActiveBoard } = await import("@/lib/console/presets");
  const { shellLayoutStore } = await import("@/lib/console/store");
  const { isBoardEdited } = await import("@/lib/console/boards");

  applyPreset("streets");
  const template = shellLayoutStore.get().widgets.map((w) => w.height);
  shellLayoutStore.resizeWidget(shellLayoutStore.get().widgets[0].id, 620);
  expect(isBoardEdited("streets")).toBe(true);

  resetActiveBoard();

  expect(shellLayoutStore.get().widgets.map((w) => w.height)).toEqual(template);
  expect(isBoardEdited("streets"), "a reset board must not still read as edited").toBe(false);
});

test("edits to one board do not leak into another board's slot", async () => {
  const { applyPreset } = await import("@/lib/console/presets");
  const { shellLayoutStore } = await import("@/lib/console/store");
  const { isBoardEdited } = await import("@/lib/console/boards");

  applyPreset("streets");
  shellLayoutStore.resizeWidget(shellLayoutStore.get().widgets[0].id, 620);
  applyPreset("overview");

  expect(isBoardEdited("streets")).toBe(true);
  expect(isBoardEdited("overview"), "the board just opened was never touched").toBe(false);
});
