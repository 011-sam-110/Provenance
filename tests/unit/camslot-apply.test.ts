import { describe, expect, it } from "vitest";
import { applyMonitorPlan, clearMonitorArea, clearedWall, tilesToLayout } from "@/lib/console/widgets/camslot.apply";
import { shellLayoutStore } from "@/lib/console/store";
import { createDefaultLayout } from "@/lib/console/types";
import type { FanOutTile } from "@/lib/console/widgets/camslot.fanout";

const wall = () => ({ ...createDefaultLayout(), mode: "wall" as const });

/** A deterministic minter, which is the point of `mintId` being a parameter:
 *  the test asserts the LAYOUT, not the shape of a random string. */
const minter = () => { let n = 0; return () => `w${++n}`; };
const tile = (name: string, n: number): FanOutTile => ({
  name,
  streams: Array.from({ length: n }, (_, i) => ({ k: "cam" as const, id: `${name}-${i}` })),
});

describe("tilesToLayout", () => {
  it("creates one widget per tile", () => {
    const l = tilesToLayout(wall(), [tile("a", 1), tile("b", 2), tile("c", 3)], 28, minter());
    expect(l.widgets).toHaveLength(3);
    expect(l.widgets.every((w) => w.type === "camslot")).toBe(true);
  });

  it("gives every widget a rect, so none is mounted-but-undrawn", () => {
    const l = tilesToLayout(wall(), Array.from({ length: 9 }, (_, i) => tile(`t${i}`, 2)), 28, minter());
    expect(l.widgets).toHaveLength(9);
    for (const w of l.widgets) expect(w.rect).toBeDefined();
  });

  it("lays nine tiles out three across", () => {
    const l = tilesToLayout(wall(), Array.from({ length: 9 }, (_, i) => tile(`t${i}`, 1)), 28, minter());
    const xs = l.widgets.map((w) => w.rect!.x);
    expect(new Set(xs)).toEqual(new Set([0, 4, 8]));
    expect(new Set(l.widgets.map((w) => w.rect!.y)).size).toBe(3);
  });

  it("carries each tile's name and streams into its config", () => {
    const l = tilesToLayout(wall(), [tile("Soho", 2)], 28, minter());
    expect(l.widgets[0].config.name).toBe("Soho");
    expect(l.widgets[0].config.streams).toEqual([{ k: "cam", id: "Soho-0" }, { k: "cam", id: "Soho-1" }]);
  });

  it("uses the video dwell for a tile holding several streams", () => {
    const l = tilesToLayout(wall(), [tile("many", 4)], 28, minter());
    expect(l.widgets[0].config.intervalMs).toBe(30_000);
  });

  it("mints ids through the injected factory, so the layout is deterministic", () => {
    const l = tilesToLayout(wall(), [tile("a", 1), tile("b", 1)], 28, minter());
    expect(l.widgets.map((w) => w.id)).toEqual(["w1", "w2"]);
  });

  it("REPLACES whatever the board held, so redrawing does not append", () => {
    const first = tilesToLayout(wall(), [tile("a", 1), tile("b", 1)], 28, minter());
    const second = tilesToLayout(first, [tile("c", 1)], 28, minter());
    expect(second.widgets).toHaveLength(1);
    expect(second.widgets[0].config.name).toBe("c");
  });

  it("leaves an empty tile list as an empty board, which is the prompt state", () => {
    expect(tilesToLayout(wall(), [], 28, minter()).widgets).toEqual([]);
  });
});

describe("applyMonitorPlan only lands on the board that asked for it", () => {
  const plan = (n: number) => ({
    tiles: Array.from({ length: n }, (_, i) => tile(`t${i}`, 2)),
    found: n * 2,
    live: n,
    message: `${n} tiles`,
  });

  it("puts the tiles and the ring onto an open WALL", () => {
    shellLayoutStore.replace(wall());
    const res = applyMonitorPlan(plan(3), [[0, 0], [1, 0], [1, 1]]);
    expect(res.ok).toBe(true);
    expect(res.created).toBe(3);
    expect(shellLayoutStore.get().widgets).toHaveLength(3);
    expect(shellLayoutStore.get().watch?.ring).toHaveLength(3);
  });

  it("REFUSES a board that is not a wall, and leaves it exactly as it was", () => {
    // The gesture can outlive the prompt that started it: press "Draw an area",
    // switch preset, then release. `tilesToLayout` opens by removing EVERY widget,
    // so without the guard that release wipes the board the user switched to — and
    // since a rails board is sanitized without `watch`, they lose the area too.
    shellLayoutStore.replace({ ...createDefaultLayout(), mode: "rails" as const });
    const before = shellLayoutStore.get();
    const res = applyMonitorPlan(plan(9), [[0, 0], [1, 0], [1, 1]]);
    expect(res.ok).toBe(false);
    expect(res.created).toBe(0);
    // Not "some message" — the refusal has to say what to do about it, because the
    // user is holding a circle they just drew and nothing appeared.
    expect(res.message).toMatch(/Streets/);
    expect(shellLayoutStore.get()).toBe(before);
  });

  it("still refuses an EMPTY plan on a wall, and says why rather than clearing the board", () => {
    shellLayoutStore.replace(wall());
    const seeded = applyMonitorPlan(plan(2), [[0, 0], [1, 0], [1, 1]]);
    expect(seeded.ok).toBe(true);
    const res = applyMonitorPlan({ tiles: [], found: 0, live: 0, message: "No cameras in that area." }, [[0, 0]]);
    expect(res.ok).toBe(false);
    expect(res.message).toBe("No cameras in that area.");
    // The board it already drew survives — an empty result is not an instruction
    // to throw away the last one that worked.
    expect(shellLayoutStore.get().widgets).toHaveLength(2);
  });
});

describe("clearing the area — the way back off a drawn board", () => {
  const ring: [number, number][] = [[0, 0], [1, 0], [1, 1]];
  const plan = (n: number) => ({
    tiles: Array.from({ length: n }, (_, i) => tile(`t${i}`, 2)),
    found: n * 2,
    live: n,
    message: `${n} tiles`,
  });

  it("removes every tile, which is what brings the prompt back", () => {
    // The prompt renders on `layout.widgets.length === 0` and nothing else, so
    // this assertion IS the assertion that the board becomes askable again.
    const drawn = tilesToLayout(wall(), [tile("a", 1), tile("b", 1)], 28, minter());
    expect(clearedWall(drawn, 28).widgets).toEqual([]);
  });

  it("DELETES the watch key rather than nulling it", () => {
    // Not a style point. `lib/console/types.ts`: the key's absence is the
    // untouched state, because `layoutSignature()` goes through JSON.stringify,
    // which drops `undefined` and keeps `null`. Setting `watch: null` would light
    // the "customised" dot on a board that was just emptied. `toBeUndefined()`
    // would pass either way, so this asserts on the KEY.
    const drawn = { ...tilesToLayout(wall(), [tile("a", 1)], 28, minter()), watch: { ring } };
    expect("watch" in drawn).toBe(true);
    expect("watch" in clearedWall(drawn, 28)).toBe(false);
  });

  it("is idempotent on a board that is already clear", () => {
    const once = clearedWall(wall(), 28);
    expect(clearedWall(once, 28)).toEqual(once);
  });

  it("clears the live board through the store", () => {
    shellLayoutStore.replace(wall());
    expect(applyMonitorPlan(plan(4), ring).ok).toBe(true);
    expect(shellLayoutStore.get().widgets).toHaveLength(4);

    expect(clearMonitorArea()).toBe(true);
    expect(shellLayoutStore.get().widgets).toEqual([]);
    expect(shellLayoutStore.get().watch).toBeUndefined();
  });

  it("opens the dock, because a closed one leaves the prompt no map to render into", () => {
    // `dockSize` checks `collapsed` BEFORE its empty-wall exception, so clearing
    // a board whose dock is closed would hand the prompt a 0px stage — the board
    // would look broken rather than askable.
    shellLayoutStore.replace(wall());
    expect(applyMonitorPlan(plan(4), ring).ok).toBe(true);
    shellLayoutStore.collapseSegment("right", true);
    expect(shellLayoutStore.get().segments.right.collapsed).toBe(true);

    expect(clearMonitorArea()).toBe(true);
    expect(shellLayoutStore.get().segments.right.collapsed).toBe(false);
  });

  it("REFUSES a board that is not a wall, for the reason applyMonitorPlan does", () => {
    // Same hazard, opposite direction: this removes every widget on the open
    // board, so reaching it from a rails board would delete an Infrastructure or
    // Intel board rather than a camera wall.
    shellLayoutStore.replace({ ...createDefaultLayout(), mode: "rails" as const });
    const before = shellLayoutStore.get();
    expect(clearMonitorArea()).toBe(false);
    expect(shellLayoutStore.get()).toBe(before);
  });
});
