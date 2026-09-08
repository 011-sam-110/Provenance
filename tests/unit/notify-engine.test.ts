import { describe, it, expect } from "vitest";
import { diff, EMPTY_OBSERVATION } from "@/lib/notify/engine";
import type { AreaRule, ObservedRow, Observation } from "@/lib/notify/types";

/** A square ring around the origin, big enough to hold (0,0) and exclude (10,10). */
const RING: [number, number][] = [
  [-1, -1], [1, -1], [1, 1], [-1, 1],
];

const row = (id: string, lat = 0, lon = 0, scalars: Record<string, number> = {}): ObservedRow => ({
  id, lat, lon, scalars, title: id,
});

const rule = (params: AreaRule["params"]): AreaRule => ({
  id: "rule:1",
  areaId: "area:1",
  sourceId: "earthquakes",
  params,
  channels: { browser: true, telegram: false, discord: false },
  enabled: true,
  createdAt: 0,
});

const OK = { ok: true, lastOk: 1_000 };

describe("diff — appears", () => {
  it("fires for a row that was not in the previous observation", () => {
    const prev: Observation = { ...EMPTY_OBSERVATION, rows: { a: { inside: true, scalars: {} } }, count: 1 };
    const { events } = diff(prev, [row("a"), row("b")], RING, [rule({ kind: "appears" })], OK, 2_000);
    expect(events).toHaveLength(1);
    expect(events[0].rowId).toBe("b");
    expect(events[0].kind).toBe("appears");
  });

  it("does not fire for a row that was already there", () => {
    const prev: Observation = { ...EMPTY_OBSERVATION, rows: { a: { inside: true, scalars: {} } }, count: 1 };
    const { events } = diff(prev, [row("a")], RING, [rule({ kind: "appears" })], OK, 2_000);
    expect(events).toHaveLength(0);
  });

  it("ignores a new row OUTSIDE the ring, because the rule is about a place", () => {
    const prev: Observation = { ...EMPTY_OBSERVATION, rows: { a: { inside: true, scalars: {} } }, count: 1 };
    const { events } = diff(prev, [row("a"), row("far", 10, 10)], RING, [rule({ kind: "appears" })], OK, 2_000);
    expect(events).toHaveLength(0);
  });

  it("treats every row as inside when the ring is null, which is the World context", () => {
    const prev: Observation = { ...EMPTY_OBSERVATION, rows: {}, count: 0, lastOk: 500 };
    const { events } = diff(prev, [row("far", 10, 10)], null, [rule({ kind: "appears" })], OK, 2_000);
    expect(events).toHaveLength(1);
  });

  it("does not fire for a disabled rule", () => {
    const prev: Observation = { ...EMPTY_OBSERVATION, rows: {}, count: 0, lastOk: 500 };
    const r = { ...rule({ kind: "appears" }), enabled: false };
    const { events } = diff(prev, [row("a")], RING, [r], OK, 2_000);
    expect(events).toHaveLength(0);
  });

  it("records the current rows in `next`, so the following poll compares against this one", () => {
    const prev: Observation = { ...EMPTY_OBSERVATION, rows: {}, count: 0, lastOk: 500 };
    const { next } = diff(prev, [row("a"), row("far", 10, 10)], RING, [rule({ kind: "appears" })], OK, 2_000);
    expect(next.rows.a.inside).toBe(true);
    expect(next.rows.far.inside).toBe(false);
    expect(next.count).toBe(1);
    expect(next.lastOk).toBe(1_000);
  });
});

// A DELIBERATELY ASYMMETRIC ring: 20 degrees of longitude by 2 of latitude. The
// existing RING is a square centred on the origin and every point the other tests
// use is symmetric under swapping x and y, so `pointInRing(lat, lon, ...)` — the
// arguments the wrong way round — passes the entire suite. lib/shell/scope.ts takes
// LONGITUDE FIRST. This is the only fixture that can tell.
const WIDE_RING: [number, number][] = [
  [0, 0], [20, 0], [20, 2], [0, 2],
];

describe("diff — ring geometry pins the lon/lat argument order", () => {
  it("counts a row at lat 1, lon 10 as INSIDE a ring 20 wide and 2 tall — swapping the arguments would read it as lat 10 and put it outside", () => {
    const prev: Observation = { ...EMPTY_OBSERVATION, rows: {}, count: 0, lastOk: 500 };
    const { next } = diff(prev, [row("wide", 1, 10)], WIDE_RING, [rule({ kind: "appears" })], OK, 2_000);
    expect(next.rows.wide.inside).toBe(true);
    expect(next.count).toBe(1);
  });

  it("counts a row at lat 10, lon 1 as OUTSIDE the same ring, which is the mirror of the case above", () => {
    const prev: Observation = { ...EMPTY_OBSERVATION, rows: {}, count: 0, lastOk: 500 };
    const { next } = diff(prev, [row("tall", 10, 1)], WIDE_RING, [rule({ kind: "appears" })], OK, 2_000);
    expect(next.rows.tall.inside).toBe(false);
    expect(next.count).toBe(0);
  });
});
