import { describe, expect, test } from "vitest";
import { COLLAPSE_MAX_ROUNDS, mergeResults } from "@/lib/sources/registry";
import type { Camera } from "@/lib/types";

const cam = (id: string, source = "x"): Camera => ({
  id, source, country: "US", name: id, lat: 0, lon: 0,
  mediaType: "jpeg", refreshSeconds: 60, license: "L", attribution: "A", available: true,
});
const ok = (cams: Camera[]): PromiseSettledResult<Camera[]> => ({ status: "fulfilled", value: cams });
const fail = (): PromiseSettledResult<Camera[]> => ({ status: "rejected", reason: new Error("boom") });

const FEEDS = [{ key: "alpha" }, { key: "beta" }];
const empty = () => new Map<string, Camera[]>();

describe("mergeResults", () => {
  test("unions every feed that answered", () => {
    const m = mergeResults([ok([cam("a")]), ok([cam("b"), cam("c")])], empty(), FEEDS);
    expect(m.cameras.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(m.health).toEqual([
      { key: "alpha", ok: true, count: 1, stale: false },
      { key: "beta", ok: true, count: 2, stale: false },
    ]);
  });

  // THE BUG THIS EXISTS FOR. A failing feed used to vanish from the merged set
  // and the smaller total was written straight back to the cache. An audit caught
  // the same server reporting 19,328 cameras at 11:06 and 14,985 at 12:17 — 4,343
  // gone, presented by /api/coverage as fact. Losing a feed for one cycle is
  // normal; deleting its whole region silently is not.
  test("keeps a failed feed's last-good cameras instead of deleting its region", () => {
    const previous = new Map([["beta", [cam("b1"), cam("b2")]]]);
    const m = mergeResults([ok([cam("a")]), fail()], previous, FEEDS);
    expect(m.cameras.map((c) => c.id)).toEqual(["a", "b1", "b2"]);
    expect(m.health[1]).toEqual({ key: "beta", ok: false, count: 2, stale: true });
  });

  test("marks kept cameras as stale so the count can be qualified", () => {
    const previous = new Map([["alpha", [cam("a1")]]]);
    const m = mergeResults([fail(), ok([cam("b")])], previous, FEEDS);
    expect(m.health.filter((h) => h.stale).map((h) => h.key)).toEqual(["alpha"]);
  });

  // A feed answering with an empty array is indistinguishable from a failure for
  // a camera network — they do not legitimately go to zero — so it is treated the
  // same way rather than wiping the region.
  test("treats an empty answer as a failure, not as 'the region has no cameras'", () => {
    const previous = new Map([["alpha", [cam("a1")]]]);
    const m = mergeResults([ok([]), ok([cam("b")])], previous, FEEDS);
    expect(m.cameras.map((c) => c.id)).toEqual(["a1", "b"]);
    expect(m.health[0]).toEqual({ key: "alpha", ok: false, count: 1, stale: true });
  });

  test("carries last-good forward for feeds that answered, ready for the next round", () => {
    const m = mergeResults([ok([cam("a")]), fail()], empty(), FEEDS);
    expect(m.lastGood.get("alpha")?.map((c) => c.id)).toEqual(["a"]);
    expect(m.lastGood.has("beta")).toBe(false);
  });

  test("returns nothing when every feed fails and there is no last-good", () => {
    const m = mergeResults([fail(), fail()], empty(), FEEDS);
    expect(m.cameras).toEqual([]);
    expect(m.health.every((h) => !h.ok && !h.stale)).toBe(true);
  });
});

// A fan-out adapter resolves whatever part of its upstream answered, so a round that
// lost most of its pages arrives as a success. Prod served Georgia 0 of 4,331 and
// Caltrans 897 of 3,598 that way with every feed reading ok (2026-10-16 audit).
describe("mergeResults collapse guard", () => {
  const many = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => cam(`${prefix}${i}`));

  test("a round far below last-good is served as last-good, marked stale", () => {
    const previous = new Map([["alpha", many("a", 100)]]);
    const m = mergeResults([ok(many("a", 30)), ok([cam("b")])], previous, FEEDS);
    expect(m.cameras.filter((c) => c.id.startsWith("a"))).toHaveLength(100);
    expect(m.health[0]).toEqual({ key: "alpha", ok: false, count: 100, stale: true });
    expect(m.lastGood.get("alpha")).toHaveLength(100);
    expect(m.collapses.get("alpha")).toBe(1);
  });

  test("an ordinary dip is accepted as the new count", () => {
    const previous = new Map([["alpha", many("a", 100)]]);
    const m = mergeResults([ok(many("a", 85)), ok([cam("b")])], previous, FEEDS);
    expect(m.health[0]).toEqual({ key: "alpha", ok: true, count: 85, stale: false });
    expect(m.collapses.has("alpha")).toBe(false);
  });

  test("a network that really shrank is accepted after the guard's last round", () => {
    let previous = new Map([["alpha", many("a", 100)]]);
    let collapses = new Map<string, number>();
    for (let round = 1; round < COLLAPSE_MAX_ROUNDS; round++) {
      const m = mergeResults([ok(many("a", 30)), ok([cam("b")])], previous, FEEDS, collapses);
      expect(m.health[0].stale).toBe(true);
      previous = m.lastGood;
      collapses = m.collapses;
    }
    const last = mergeResults([ok(many("a", 30)), ok([cam("b")])], previous, FEEDS, collapses);
    expect(last.health[0]).toEqual({ key: "alpha", ok: true, count: 30, stale: false });
    expect(last.lastGood.get("alpha")).toHaveLength(30);
    expect(last.collapses.has("alpha")).toBe(false);
  });

  test("a feed with no last-good is never held back", () => {
    const m = mergeResults([ok(many("a", 3)), ok([cam("b")])], empty(), FEEDS);
    expect(m.health[0]).toEqual({ key: "alpha", ok: true, count: 3, stale: false });
  });
});
