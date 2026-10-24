import { describe, it, expect } from "vitest";
import { refillWall, refillNote, type WallTile } from "@/lib/console/widgets/camslot.refill";
import { isBenched, RETRY_AFTER_MS, type HealthMap } from "@/lib/console/widgets/camslot.health";
import { streamKey, type StreamRef } from "@/lib/console/widgets/camslot.model";

const cam = (id: string): StreamRef => ({ k: "cam", id });
const yt = (videoId: string): StreamRef => ({ k: "yt", videoId });
const tile = (id: string, ...ids: string[]): WallTile => ({ id, streams: ids.map(cam) });
const ids = (s: readonly StreamRef[]) => s.map((r) => (r.k === "yt" ? r.videoId : r.id));
/** Every stream works except the named ones. */
const dead = (...names: string[]) => (s: StreamRef) => !(s.k !== "yt" && names.includes(s.id));

describe("refillWall", () => {
  it("gives a tile with nothing working one camera from the tile with the most", () => {
    const wall = [tile("t1", "a", "b"), tile("t2", "c", "d", "e", "f"), tile("t3", "g")];
    const plan = refillWall(wall, dead("g"));
    expect(ids(plan.get("t3")!.streams)).toEqual(["f"]);
    expect(plan.get("t3")!.borrowed).toEqual(cam("f"));
    // The lender stops showing it, so one camera is never on two tiles at once.
    expect(ids(plan.get("t2")!.streams)).toEqual(["c", "d", "e"]);
    expect(plan.get("t2")!.lent).toBe(1);
    // A tile not involved is exactly its own working streams.
    expect(ids(plan.get("t1")!.streams)).toEqual(["a", "b"]);
    expect(plan.get("t1")!.borrowed).toBeNull();
    expect(plan.get("t1")!.lent).toBe(0);
  });

  it("counts WORKING cameras, not cameras: a full tile of dead ones lends nothing", () => {
    const wall = [tile("t1", "a", "b", "c", "d"), tile("t2", "e", "f"), tile("t3", "g")];
    // t1 holds four, but three are down: t2's two working cameras make it the lender.
    const plan = refillWall(wall, dead("b", "c", "d", "g"));
    expect(ids(plan.get("t3")!.streams)).toEqual(["f"]);
    expect(plan.get("t2")!.lent).toBe(1);
    expect(plan.get("t1")!.lent).toBe(0);
  });

  it("leaves the lender at least one working camera — moving a blank is not a refill", () => {
    const wall = [tile("t1", "a"), tile("t2", "b"), tile("t3", "c")];
    const plan = refillWall(wall, dead("c"));
    expect(plan.get("t3")!.streams).toEqual([]);
    expect(plan.get("t3")!.borrowed).toBeNull();
    expect(ids(plan.get("t1")!.streams)).toEqual(["a"]);
    expect(ids(plan.get("t2")!.streams)).toEqual(["b"]);
  });

  it("breaks a tie for 'most' by board order, so every tile computes the same plan", () => {
    const wall = [tile("t1", "a", "b", "c"), tile("t2", "d", "e", "f"), tile("t3", "g")];
    const plan = refillWall(wall, dead("g"));
    expect(plan.get("t1")!.lent).toBe(1);
    expect(plan.get("t2")!.lent).toBe(0);
  });

  it("recounts after every loan, so several blank tiles spread over the fullest tiles", () => {
    const wall = [
      tile("t1", "a", "b", "c"),
      tile("t2", "d", "e", "f", "g"),
      tile("x1", "x"),
      tile("x2", "y"),
      tile("x3", "z"),
    ];
    const plan = refillWall(wall, dead("x", "y", "z"));
    // x1 takes from t2 (4). Then t1 and t2 both hold 3 and the tie goes to t1. Then
    // t2 (3) is fuller than t1 (2).
    expect(ids(plan.get("x1")!.streams)).toEqual(["g"]);
    expect(ids(plan.get("x2")!.streams)).toEqual(["c"]);
    expect(ids(plan.get("x3")!.streams)).toEqual(["f"]);
    expect(plan.get("t1")!.lent).toBe(1);
    expect(plan.get("t2")!.lent).toBe(2);
    expect(ids(plan.get("t2")!.streams)).toEqual(["d", "e"]);
  });

  it("never shows one camera on two tiles", () => {
    const wall = [tile("t1", "a", "b", "c", "d"), tile("t2", "e"), tile("t3", "f"), tile("t4", "g", "h")];
    const plan = refillWall(wall, dead("e", "f"));
    const shown = [...plan.values()].flatMap((v) => v.streams.map(streamKey));
    expect(new Set(shown).size).toBe(shown.length);
  });

  it("does not touch a tile that still has one working camera of its own", () => {
    const wall = [tile("t1", "a", "b", "c"), tile("t2", "d", "e")];
    const plan = refillWall(wall, dead("d"));
    expect(ids(plan.get("t2")!.streams)).toEqual(["e"]);
    expect(plan.get("t2")!.borrowed).toBeNull();
    expect(plan.get("t1")!.lent).toBe(0);
  });

  it("leaves an empty slot empty: no streams of its own is somebody's choice, not a dead tile", () => {
    const wall = [tile("t1", "a", "b", "c"), tile("empty")];
    const plan = refillWall(wall, () => true);
    expect(plan.get("empty")!.streams).toEqual([]);
    expect(plan.get("empty")!.borrowed).toBeNull();
    expect(plan.get("t1")!.lent).toBe(0);
  });

  it("never lends a YouTube stream, and passes over a tile that holds nothing else", () => {
    const wall: WallTile[] = [
      { id: "t1", streams: [yt("aaaaaaaaaaa"), yt("bbbbbbbbbbb"), yt("ccccccccccc")] },
      { id: "t2", streams: [cam("a"), yt("ddddddddddd")] },
      tile("t3", "z"),
    ];
    const plan = refillWall(wall, dead("z"));
    // t1 has the most working streams, but only embeds: t2 lends its camera instead,
    // even though that is the end of its list.
    expect(ids(plan.get("t3")!.streams)).toEqual(["a"]);
    expect(plan.get("t1")!.lent).toBe(0);
    expect(ids(plan.get("t2")!.streams)).toEqual(["ddddddddddd"]);
  });

  it("gives the loan back on its own when the tile's camera comes off the bench", () => {
    // The retry rule is the bench's, and the plan follows it with no state of its own:
    // a borrow is not remembered anywhere, so there is nothing to undo.
    const T = 1_786_745_000_000;
    const health: HealthMap = { "cam:g": { failures: 2, lastFailedAt: T, reason: "placeholder" } };
    const wall = [tile("t1", "a", "b", "c"), tile("t2", "g")];
    const at = (now: number) => refillWall(wall, (s) => !isBenched(health[streamKey(s)], now));

    expect(ids(at(T + 1000).get("t2")!.streams)).toEqual(["c"]);
    const back = at(T + RETRY_AFTER_MS);
    expect(ids(back.get("t2")!.streams)).toEqual(["g"]);
    expect(back.get("t2")!.borrowed).toBeNull();
    expect(ids(back.get("t1")!.streams)).toEqual(["a", "b", "c"]);
    expect(back.get("t1")!.lent).toBe(0);
  });

  it("is deterministic and leaves its input alone", () => {
    const wall = [tile("t1", "a", "b", "c"), tile("t2", "d")];
    const before = JSON.stringify(wall);
    const one = refillWall(wall, dead("d"));
    const two = refillWall(wall, dead("d"));
    expect(JSON.stringify([...one])).toBe(JSON.stringify([...two]));
    expect(JSON.stringify(wall)).toBe(before);
  });
});

describe("refillNote", () => {
  it("says where a borrowed picture came from", () => {
    expect(refillNote({ borrowed: cam("f"), lent: 0 })).toBe("Showing a camera lent by another tile.");
  });

  it("says where a lent camera went, so a tile counting four that rotates three explains itself", () => {
    expect(refillNote({ borrowed: null, lent: 1 })).toBe("1 camera here is lent to a tile with none working.");
    expect(refillNote({ borrowed: null, lent: 2 })).toBe("2 cameras here are lent to tiles with none working.");
  });

  it("says nothing when nothing moved", () => {
    expect(refillNote({ borrowed: null, lent: 0 })).toBeNull();
  });
});
