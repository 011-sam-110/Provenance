/**
 * lib/http/hostLane.ts: one queue per upstream host, shared by every route.
 *
 * The bug it fixes: the planes pull and the military-air layer each paced their own
 * adsb.lol requests and knew nothing of each other, so a /v2/mil poll landed inside
 * the type pull and the tail batch got 429 (prod, 3 of 5 snapshots, 2026-10-16).
 */

import { afterEach, describe, expect, it } from "vitest";
import { HOST_GAP_MS, reserveSlot, resetLanes, takeTurn } from "@/lib/http/hostLane";

afterEach(() => resetLanes());

describe("reserveSlot", () => {
  it("lets the first request to a host go at once", () => {
    expect(reserveSlot(undefined, 1_000, 2_000)).toEqual({ waitMs: 0, nextFreeAt: 3_000 });
  });

  it("makes a request that arrives inside the gap wait for the rest of it", () => {
    expect(reserveSlot(3_000, 1_500, 2_000)).toEqual({ waitMs: 1_500, nextFreeAt: 5_000 });
  });

  it("queues a third request behind the second, not behind the first", () => {
    const a = reserveSlot(undefined, 0, 2_000);
    const b = reserveSlot(a.nextFreeAt, 100, 2_000);
    const c = reserveSlot(b.nextFreeAt, 200, 2_000);
    expect([a.waitMs, b.waitMs, c.waitMs]).toEqual([0, 1_900, 3_800]);
  });

  it("does not make a request wait when the host has been idle past the gap", () => {
    expect(reserveSlot(3_000, 10_000, 2_000)).toEqual({ waitMs: 0, nextFreeAt: 12_000 });
  });
});

describe("the host table", () => {
  it("paces adsb.lol by at least 2 s and adsb.fi by at least its 1 request per second", () => {
    expect(HOST_GAP_MS["api.adsb.lol"]).toBeGreaterThanOrEqual(2_000);
    expect(HOST_GAP_MS["opendata.adsb.fi"]).toBeGreaterThan(1_000);
  });
});

describe("takeTurn", () => {
  it("returns at once for a host with no gap", async () => {
    const t = Date.now();
    await takeTurn("example.org");
    await takeTurn("example.org");
    expect(Date.now() - t).toBeLessThan(50);
  });

  it("spaces two turns on one host by the gap, whichever caller asks", async () => {
    const t = Date.now();
    await takeTurn("lane.test", 120);
    await takeTurn("lane.test", 120);
    expect(Date.now() - t).toBeGreaterThanOrEqual(110);
  });
});
