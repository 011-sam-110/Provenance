import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  camerasOnBoard,
  clearedLabel,
  clearedStatus,
  dropWallUndo,
  noteClearance,
  offerWallUndo,
  requestNewAreaFocus,
  restoreWallUndo,
  restoredLabel,
  takeNewAreaFocus,
  wallUndoStore,
} from "@/lib/console/wallUndo";
import { applyMonitorPlan, clearMonitorArea } from "@/lib/console/widgets/camslot.apply";
import { shellLayoutStore } from "@/lib/console/store";
import { activePresetStore } from "@/lib/console/activePreset";
import { createDefaultLayout, type ShellLayout, type WidgetInstance } from "@/lib/console/types";
import type { MonitorPlan } from "@/lib/console/widgets/camslot.monitor";

const wall = (): ShellLayout => ({ ...createDefaultLayout(), mode: "wall" });

const camslot = (id: string, streams: unknown[]): WidgetInstance => ({
  id, type: "camslot", segment: "left", order: 0, height: 200, collapsed: false,
  config: { streams },
});

const withWidgets = (widgets: WidgetInstance[]): ShellLayout => ({ ...wall(), widgets });

describe("camerasOnBoard", () => {
  it("counts every camera on every wall", () => {
    const l = withWidgets([
      camslot("a", [{ k: "cam", id: "c1" }, { k: "cam", id: "c2" }]),
      camslot("b", [{ k: "cam", id: "c3" }]),
    ]);
    expect(camerasOnBoard(l)).toBe(3);
  });

  it("counts a camera that two tiles share once", () => {
    const l = withWidgets([
      camslot("a", [{ k: "cam", id: "c1" }, { k: "cam", id: "c2" }]),
      camslot("b", [{ k: "cam", id: "c2" }, { k: "cam", id: "c3" }]),
    ]);
    expect(camerasOnBoard(l)).toBe(3);
  });

  it("counts YouTube and webcam refs as cameras, and tells them apart from a camera of the same id", () => {
    const l = withWidgets([
      camslot("a", [
        { k: "yt", videoId: "dQw4w9WgXcQ" },
        { k: "webcam", id: "1606332744" },
        { k: "cam", id: "1606332744" },
      ]),
    ]);
    expect(camerasOnBoard(l)).toBe(3);
  });

  it("counts a widget that is not a camera wall as nothing", () => {
    const other: WidgetInstance = {
      id: "e", type: "events", segment: "left", order: 1, height: 200, collapsed: false,
      config: { streams: [{ k: "cam", id: "c1" }] },
    };
    expect(camerasOnBoard(withWidgets([other]))).toBe(0);
  });

  it("ignores junk in a config", () => {
    const l = withWidgets([
      camslot("a", [null, 4, "x", { k: "cam" }, { k: "cam", id: "bad id!" }, { k: "yt", videoId: "short" }, { k: "cam", id: "ok" }]),
      { ...camslot("b", []), config: "nonsense" as never },
    ]);
    expect(camerasOnBoard(l)).toBe(1);
  });

  it("is 0 for an empty board", () => {
    expect(camerasOnBoard(wall())).toBe(0);
  });
});

describe("the note's words", () => {
  it("clearedLabel is Leon's sentence, with the right singular", () => {
    expect(clearedLabel(0)).toBe("Board cleared. Click to undo.");
    expect(clearedLabel(1)).toBe("1 camera cleared. Click to undo.");
    expect(clearedLabel(21)).toBe("21 cameras cleared. Click to undo.");
  });

  it("clearedStatus is the same line without the action", () => {
    expect(clearedStatus(0)).toBe("Board cleared.");
    expect(clearedStatus(1)).toBe("1 camera cleared.");
    expect(clearedStatus(21)).toBe("21 cameras cleared.");
  });

  it("restoredLabel says what came back", () => {
    expect(restoredLabel(0)).toBe("Board restored.");
    expect(restoredLabel(1)).toBe("1 camera restored.");
    expect(restoredLabel(21)).toBe("21 cameras restored.");
  });
});

describe("noteClearance", () => {
  // The 1440x900 numbers: the stage ends at y 876, the Discord note starts at y 688.
  const stage = { top: 46, bottom: 876, left: 66, right: 1480 };
  const note = { top: 688, bottom: 848, left: 8, right: 408 };

  it("is 0 with no note", () => {
    expect(noteClearance(stage, null, 78)).toBe(0);
  });

  it("is 0 when the note ends before the card begins", () => {
    expect(noteClearance(stage, { ...note, right: 78 }, 78)).toBe(0);
    expect(noteClearance(stage, { ...note, right: 60 }, 78)).toBe(0);
  });

  it("is 0 when the note is below the stage, as on a phone", () => {
    expect(noteClearance(stage, { ...note, top: 876, bottom: 1036 }, 78)).toBe(0);
    expect(noteClearance(stage, { ...note, top: 900, bottom: 1060 }, 78)).toBe(0);
  });

  it("is 0 when the note is above the stage", () => {
    expect(noteClearance(stage, { ...note, top: 0, bottom: 46 }, 78)).toBe(0);
  });

  it("lifts the card 12px clear of an overlapping note: 200 at 1440x900", () => {
    expect(noteClearance(stage, note, 78)).toBe(200);
  });

  it("rounds a fractional overlap up, never down", () => {
    expect(noteClearance(stage, { ...note, top: 688.4 }, 78)).toBe(200);
    expect(noteClearance(stage, { ...note, top: 687.6 }, 78)).toBe(201);
  });

  it("takes a different gap", () => {
    expect(noteClearance(stage, note, 78, 20)).toBe(208);
  });
});

describe("the offer", () => {
  const ring: [number, number][] = [[0, 0], [0, 1], [1, 1], [1, 0]];
  const plan = (n: number): MonitorPlan => ({
    tiles: Array.from({ length: n }, (_, i) => ({
      name: `T${i}`,
      streams: [{ k: "cam" as const, id: `t${i}-a` }, { k: "cam" as const, id: `t${i}-b` }],
    })),
    found: n * 2,
    live: n,
    message: `${n} tiles`,
  });

  /** A real wall, drawn the way the app draws one, then cleared the way New area does. */
  function drawnWall(tiles = 4) {
    shellLayoutStore.replace(wall());
    expect(applyMonitorPlan(plan(tiles), ring).ok).toBe(true);
    // Something that proves the restore is exact, not merely "some tiles":
    shellLayoutStore.collapseSegment("right", true);
    return shellLayoutStore.get();
  }

  beforeEach(() => {
    activePresetStore.set("streets");
    dropWallUndo();
  });
  afterEach(() => {
    dropWallUndo();
    activePresetStore.set(null);
  });

  it("restores the board exactly: tiles, their order, rects, the ring and the dock", () => {
    const before = drawnWall(4);
    const snapshot = shellLayoutStore.get();
    expect(clearMonitorArea()).toBe(true);
    expect(shellLayoutStore.get().widgets).toEqual([]);

    offerWallUndo(snapshot, activePresetStore.get(), { focus: false });
    expect(wallUndoStore.get()?.count).toBe(8);

    expect(restoreWallUndo()).toBe(8);
    const after = shellLayoutStore.get();
    expect(after).toEqual(before);
    expect(after.widgets.map((w) => w.id)).toEqual(before.widgets.map((w) => w.id));
    expect(after.widgets.map((w) => w.rect)).toEqual(before.widgets.map((w) => w.rect));
    expect(after.watch).toEqual({ ring });
    expect(after.segments.right.collapsed).toBe(true);
    expect(wallUndoStore.get()).toBeNull();
  });

  it("is used up by a restore: a second one does nothing", () => {
    drawnWall();
    const snapshot = shellLayoutStore.get();
    clearMonitorArea();
    offerWallUndo(snapshot, activePresetStore.get(), { focus: false });
    expect(restoreWallUndo()).toBe(8);
    const after = shellLayoutStore.get();
    expect(restoreWallUndo()).toBeNull();
    expect(shellLayoutStore.get()).toBe(after);
  });

  it("is dropped when new tiles land (a new area was drawn)", () => {
    drawnWall();
    const snapshot = shellLayoutStore.get();
    clearMonitorArea();
    offerWallUndo(snapshot, activePresetStore.get(), { focus: false });
    expect(wallUndoStore.get()).not.toBeNull();

    expect(applyMonitorPlan(plan(2), ring).ok).toBe(true);
    expect(wallUndoStore.get()).toBeNull();
    const landed = shellLayoutStore.get();
    expect(restoreWallUndo()).toBeNull();
    expect(shellLayoutStore.get()).toBe(landed);
  });

  it("is dropped by any other change to the layout", () => {
    drawnWall();
    const snapshot = shellLayoutStore.get();
    clearMonitorArea();
    offerWallUndo(snapshot, activePresetStore.get(), { focus: false });
    shellLayoutStore.add("camslot", { segment: "left" });
    expect(wallUndoStore.get()).toBeNull();
  });

  it("is dropped when the board changes", () => {
    drawnWall();
    const snapshot = shellLayoutStore.get();
    clearMonitorArea();
    offerWallUndo(snapshot, activePresetStore.get(), { focus: false });
    activePresetStore.set("globe");
    expect(wallUndoStore.get()).toBeNull();
    const cleared = shellLayoutStore.get();
    expect(restoreWallUndo()).toBeNull();
    expect(shellLayoutStore.get()).toBe(cleared);
  });

  it("will not restore over a layout that is no longer the cleared one", () => {
    drawnWall();
    const snapshot = shellLayoutStore.get();
    clearMonitorArea();
    offerWallUndo(snapshot, activePresetStore.get(), { focus: false });
    // A change the store's own subscriber would catch; make sure the restore also checks.
    const stranger = withWidgets([camslot("z", [{ k: "cam", id: "zz" }])]);
    shellLayoutStore.replace(stranger);
    expect(restoreWallUndo()).toBeNull();
    expect(shellLayoutStore.get().widgets.map((w) => w.id)).toEqual(["z"]);
  });

  it("remembers whether the click was a keyboard one, and how many cameras it cleared", () => {
    drawnWall(3);
    const snapshot = shellLayoutStore.get();
    clearMonitorArea();
    offerWallUndo(snapshot, activePresetStore.get(), { focus: true });
    expect(wallUndoStore.get()).toMatchObject({ count: 6, focus: true, board: "streets" });
  });

  it("gives each offer its own id, so a second clear restarts the note", () => {
    drawnWall();
    const snapshot = shellLayoutStore.get();
    clearMonitorArea();
    offerWallUndo(snapshot, activePresetStore.get(), { focus: false });
    const first = wallUndoStore.get()!.id;
    offerWallUndo(snapshot, activePresetStore.get(), { focus: false });
    expect(wallUndoStore.get()!.id).not.toBe(first);
  });

  it("tells subscribers when it appears and when it goes", () => {
    drawnWall();
    const snapshot = shellLayoutStore.get();
    clearMonitorArea();
    let calls = 0;
    const off = wallUndoStore.subscribe(() => { calls += 1; });
    offerWallUndo(snapshot, activePresetStore.get(), { focus: false });
    expect(calls).toBe(1);
    dropWallUndo();
    expect(calls).toBe(2);
    dropWallUndo();
    expect(calls).toBe(2);
    off();
  });

  it("is never written to storage", () => {
    // The offer lives in module memory only; a stored copy would outlive the page.
    expect(Object.keys(wallUndoStore)).toEqual(["get", "subscribe"]);
  });
});

describe("the focus hand-off", () => {
  it("is a one-shot", () => {
    expect(takeNewAreaFocus()).toBe(false);
    requestNewAreaFocus();
    expect(takeNewAreaFocus()).toBe(true);
    expect(takeNewAreaFocus()).toBe(false);
  });
});
