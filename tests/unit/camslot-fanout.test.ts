import { describe, expect, it } from "vitest";
import { WALL_TILES, orderForWall, planFanOut } from "@/lib/console/widgets/camslot.fanout";
import { pickKey, type PickedCamera } from "@/lib/console/widgets/camslot.pick";

const centre = { lat: 32.7641, lon: -117.1577 };

/** `n` cameras walking away from the centre, so distance order is id order. */
const cam = (id: string, opts: { live?: boolean; away?: number } = {}): PickedCamera => ({
  ref: { k: "cam", id },
  key: pickKey({ k: "cam", id }),
  label: id,
  lat: centre.lat + (opts.away ?? 0) * 0.01,
  lon: centre.lon,
  ...(opts.live === undefined ? {} : { live: opts.live }),
});

const many = (n: number, live = false) =>
  Array.from({ length: n }, (_, i) => cam(`c${i}`, { live, away: i + 1 }));

describe("orderForWall", () => {
  it("puts every live camera ahead of every still one", () => {
    const rows = [
      cam("still-near", { live: false, away: 1 }),
      cam("live-far", { live: true, away: 9 }),
      cam("still-far", { live: false, away: 8 }),
      cam("live-near", { live: true, away: 2 }),
    ];
    expect(orderForWall(rows, centre).map((p) => p.label))
      .toEqual(["live-near", "live-far", "still-near", "still-far"]);
  });

  it("orders within each group by distance from the centre", () => {
    const rows = [cam("c3", { live: true, away: 3 }), cam("c1", { live: true, away: 1 }), cam("c2", { live: true, away: 2 })];
    expect(orderForWall(rows, centre).map((p) => p.label)).toEqual(["c1", "c2", "c3"]);
  });

  it("treats a missing live flag as not live", () => {
    const rows = [cam("unknown", { away: 1 }), cam("live", { live: true, away: 9 })];
    expect(orderForWall(rows, centre)[0].label).toBe("live");
  });
});

describe("planFanOut", () => {
  it("gives one camera per tile when there are fewer than nine", () => {
    const tiles = planFanOut(many(4, true), centre);
    expect(tiles).toHaveLength(4);
    for (const t of tiles) expect(t.streams).toHaveLength(1);
  });

  it("caps at nine tiles and spreads the rest across them", () => {
    const tiles = planFanOut(many(30, true), centre);
    expect(tiles).toHaveLength(WALL_TILES);
    const counts = tiles.map((t) => t.streams.length);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(30);
    // 30 across 9 is 3 or 4 each — never 0, never lopsided.
    expect(Math.min(...counts)).toBe(3);
    expect(Math.max(...counts)).toBe(4);
  });

  it("deals ROUND-ROBIN, so neighbouring cameras land in different tiles", () => {
    const tiles = planFanOut(many(18, true), centre);
    // c0 and c1 are adjacent on the road; they must not share a tile.
    expect(tiles[0].streams[0]).toEqual({ k: "cam", id: "c0" });
    expect(tiles[1].streams[0]).toEqual({ k: "cam", id: "c1" });
    expect(tiles[0].streams[1]).toEqual({ k: "cam", id: "c9" });
  });

  it("returns no tiles for an empty selection", () => {
    expect(planFanOut([], centre)).toEqual([]);
  });

  it("makes exactly one tile for one camera", () => {
    const tiles = planFanOut([cam("only", { live: true })], centre);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].streams).toEqual([{ k: "cam", id: "only" }]);
  });

  it("names a single-camera tile after that camera, and a shared tile by count", () => {
    expect(planFanOut([cam("Trafalgar Sq", { live: true })], centre)[0].name).toBe("Trafalgar Sq");
    const tiles = planFanOut(many(18, true), centre);
    expect(tiles[0].name).toBe("2 cameras");
  });

  it("puts live cameras in the first tiles when the ring holds both kinds", () => {
    const rows = [...many(3, false), ...[cam("L1", { live: true, away: 20 }), cam("L2", { live: true, away: 21 })]];
    const tiles = planFanOut(rows, centre);
    expect(tiles[0].streams[0]).toEqual({ k: "cam", id: "L1" });
    expect(tiles[1].streams[0]).toEqual({ k: "cam", id: "L2" });
  });

  it("honours a caller-supplied tile count", () => {
    expect(planFanOut(many(12, true), centre, 4)).toHaveLength(4);
  });
});
