import { describe, expect, it } from "vitest";
import { tilesToLayout } from "@/lib/console/widgets/camslot.apply";
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
