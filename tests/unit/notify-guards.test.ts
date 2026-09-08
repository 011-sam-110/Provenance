import { describe, it, expect } from "vitest";
import { diff, EMPTY_OBSERVATION } from "@/lib/notify/engine";
import type { AreaRule, ObservedRow, Observation } from "@/lib/notify/types";

const RING: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const row = (id: string): ObservedRow => ({ id, lat: 0, lon: 0, scalars: {}, title: id });
const rule = (params: AreaRule["params"]): AreaRule => ({
  id: "rule:1", areaId: "area:1", sourceId: "earthquakes", params,
  channels: { browser: true, telegram: false, discord: false },
  enabled: true, createdAt: 0,
});

describe("G1 — the first observation seeds silently", () => {
  it("announces nothing when there is no previous observation, so arming over a busy area does not fire ninety times", () => {
    const rows = Array.from({ length: 90 }, (_, i) => row(`e${i}`));
    const { events } = diff(undefined, rows, RING, [rule({ kind: "appears" })], { ok: true, lastOk: 1_000 }, 2_000);
    expect(events).toHaveLength(0);
  });

  it("still records the seed, so the NEXT poll compares against it and a genuinely new row does fire", () => {
    const seed = diff(undefined, [row("a")], RING, [rule({ kind: "appears" })], { ok: true, lastOk: 1_000 }, 2_000);
    expect(seed.next.rows.a).toBeTruthy();
    const then = diff(seed.next, [row("a"), row("b")], RING, [rule({ kind: "appears" })], { ok: true, lastOk: 2_000 }, 3_000);
    expect(then.events).toHaveLength(1);
    expect(then.events[0].rowId).toBe("b");
  });

  it("seeds a count rule silently too, so arming above the level does not fire immediately", () => {
    const { events } = diff(
      undefined, [row("a"), row("b"), row("c")], RING,
      [rule({ kind: "count", dir: "atOrAbove", level: 2 })],
      { ok: true, lastOk: 1_000 }, 2_000,
    );
    expect(events).toHaveLength(0);
  });
});

describe("G2 — a failed or suspicious poll is not a disappearance", () => {
  const countRule = rule({ kind: "count", dir: "below", level: 2 });
  const healthy: Observation = { ...EMPTY_OBSERVATION, rows: { a: { inside: true, scalars: {} }, b: { inside: true, scalars: {} } }, count: 2, lastOk: 1_000 };

  it("emits nothing when the fetch errored, whatever the rows say", () => {
    const { events } = diff(healthy, [], RING, [countRule], { ok: false, lastOk: 1_000 }, 2_000);
    expect(events).toHaveLength(0);
  });

  it("LEAVES THE OBSERVATION UNTOUCHED on a failed poll, so the next healthy poll compares against the last state we trusted", () => {
    const { next } = diff(healthy, [], RING, [countRule], { ok: false, lastOk: 1_000 }, 2_000);
    expect(next.count).toBe(2);
    expect(next.rows.a).toBeTruthy();
    expect(next.rows.b).toBeTruthy();
  });

  it("emits nothing when a healthy count collapses to zero, because that is an upstream hiccup wearing the costume of an evacuation", () => {
    const { events } = diff(healthy, [], RING, [countRule], { ok: true, lastOk: 2_000 }, 2_000);
    expect(events).toHaveLength(0);
  });

  it("leaves the observation untouched on a collapse to zero as well", () => {
    const { next } = diff(healthy, [], RING, [countRule], { ok: true, lastOk: 2_000 }, 2_000);
    expect(next.count).toBe(2);
  });

  it("ACCEPTS a genuine zero when the previous observation was also zero, so an empty area is not frozen forever", () => {
    const empty: Observation = { ...EMPTY_OBSERVATION, rows: {}, count: 0, lastOk: 1_000 };
    const { next } = diff(empty, [], RING, [countRule], { ok: true, lastOk: 2_000 }, 2_000);
    expect(next.lastOk).toBe(2_000);
  });

  it("still fires a `quiet` rule on a failed poll, because a dead feed is exactly what that trigger is for", () => {
    const prev: Observation = { ...EMPTY_OBSERVATION, lastOk: 1_000 };
    const { events } = diff(prev, [], RING, [rule({ kind: "quiet", silentMs: 60_000 })], { ok: false, lastOk: 0 }, 1_000 + 120_000);
    expect(events).toHaveLength(1);
  });
});
