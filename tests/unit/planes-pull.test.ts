/**
 * The adsb.lol type pull (lib/sources/adsb.ts fetchAdsbTypePull), driven through an
 * injected fetch so the tests are offline, deterministic and fast.
 *
 * WHY A HARNESS AND NOT LIVE CALLS: the previous sweep's only networked function
 * was never tested, which is how production ran for weeks serving 1 of 40 cells
 * with every failure swallowed silently. Every branch here — pacing, 429 retry,
 * Retry-After, a non-429 failure, a network error, the time budget, a saturated
 * response — is exercised against recorded-shape responses, and the warn lines
 * that make failures visible in runtime logs are asserted too.
 *
 * Row shape follows the live capture in planes.adsb.test.ts; nothing is invented.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchAdsbTypePull,
  PACE_MS,
  PULL_BUDGET_MS,
  RETRY_BACKOFF_MS,
  TYPE_BATCHES,
  typeBatchUrl,
  type AdsbRow,
} from "@/lib/sources/adsb";

// --- fixtures ---------------------------------------------------------------

function row(hex: string, lat = 51.5, lon = -0.1): AdsbRow {
  return { hex, flight: `T${hex}`, t: "B738", alt_baro: 35000, gs: 450, track: 90, category: "A3", lat, lon };
}

function body(rows: AdsbRow[], total = rows.length): string {
  return JSON.stringify({ ac: rows, total, now: 1788707084500, msg: "No error", ctime: 1, ptime: 1 });
}

const ok = (rows: AdsbRow[], total?: number) => () => new Response(body(rows, total), { status: 200 });
const status = (code: number, headers: Record<string, string> = {}) => () =>
  new Response("<html>nope</html>", { status: code, headers });

type Handler = (attempt: number) => Response | Promise<Response>;

/**
 * A scripted upstream. `script` maps a batch URL to a handler receiving the
 * 1-based attempt number. Unscripted URLs answer 200 with no rows. The fake clock
 * advances `latencyMs` per request and by the full amount of every sleep, so the
 * budget logic sees time pass without the test waiting for it.
 */
function harness(script: Record<string, Handler>, latencyMs = 500) {
  const calls: string[] = [];
  const sleeps: number[] = [];
  const attempts = new Map<string, number>();
  let clock = 0;
  const fetchImpl = async (url: string): Promise<Response> => {
    calls.push(url);
    clock += latencyMs;
    const n = (attempts.get(url) ?? 0) + 1;
    attempts.set(url, n);
    const h = script[url];
    return h ? h(n) : ok([])();
  };
  const sleep = async (ms: number) => {
    sleeps.push(ms);
    clock += ms;
  };
  return { deps: { fetchImpl, sleep, now: () => clock }, calls, sleeps };
}

const A = typeBatchUrl(TYPE_BATCHES[0]);
const B = typeBatchUrl(TYPE_BATCHES[1]);
const C = typeBatchUrl(TYPE_BATCHES[2]);
const D = typeBatchUrl(TYPE_BATCHES[3]);

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

// --- the happy path ---------------------------------------------------------

describe("fetchAdsbTypePull — every batch, in order, paced", () => {
  it("asks for each batch in order and unions the rows", async () => {
    const h = harness({
      [A]: ok([row("a00001"), row("a00002")]),
      [B]: ok([row("b00001")]),
      [C]: ok([row("c00001")]),
      [D]: ok([row("d00001")]),
    });
    const r = await fetchAdsbTypePull(TYPE_BATCHES, h.deps);
    expect(h.calls).toEqual([A, B, C, D]);
    expect(r.objects.map((o) => o.id).sort()).toEqual(
      ["plane:a00001", "plane:a00002", "plane:b00001", "plane:c00001", "plane:d00001"],
    );
    expect(r).toMatchObject({ batchesPlanned: 4, batchesAttempted: 4, batchesSucceeded: 4, mainlineSucceeded: true });
    expect(r.typesPlanned).toBe(TYPE_BATCHES.reduce((n, b) => n + b.length, 0));
    expect(warn).not.toHaveBeenCalled();
  });

  it("waits PACE_MS between batches and not after the last one", async () => {
    const h = harness({});
    await fetchAdsbTypePull(TYPE_BATCHES, h.deps);
    expect(h.sleeps).toEqual([PACE_MS, PACE_MS, PACE_MS]);
  });

  it("counts an aircraft once when two batches both report it", async () => {
    const h = harness({ [A]: ok([row("a00001")]), [B]: ok([row("a00001")]) });
    const r = await fetchAdsbTypePull(TYPE_BATCHES, h.deps);
    expect(r.objects).toHaveLength(1);
  });

  it("does not stamp an upstreamLimit when every response held all its rows", async () => {
    const h = harness({ [A]: ok([row("a00001")]) });
    expect((await fetchAdsbTypePull(TYPE_BATCHES, h.deps)).upstreamLimit).toBeUndefined();
  });

  it("stamps upstreamLimit when a response says it held more than it returned", async () => {
    const h = harness({ [A]: ok([row("a00001"), row("a00002"), row("a00003")], 9999) });
    expect((await fetchAdsbTypePull(TYPE_BATCHES, h.deps)).upstreamLimit).toBe(3);
  });
});

// --- failure, counted not hidden -------------------------------------------

describe("fetchAdsbTypePull — failures are counted, retried only on 429, and logged", () => {
  it("retries a 429 with the backoff schedule and then counts the batch as answered", async () => {
    const h = harness({ [B]: (n) => (n < 3 ? status(429)() : ok([row("b00001")])()) });
    const r = await fetchAdsbTypePull(TYPE_BATCHES, h.deps);
    expect(h.calls.filter((u) => u === B)).toHaveLength(3);
    expect(h.sleeps).toContain(RETRY_BACKOFF_MS[0]);
    expect(h.sleeps).toContain(RETRY_BACKOFF_MS[1]);
    expect(r).toMatchObject({ batchesAttempted: 4, batchesSucceeded: 4 });
    expect(r.objects.some((o) => o.id === "plane:b00001")).toBe(true);
  });

  it("honours a Retry-After header on a 429 instead of the default backoff", async () => {
    const h = harness({ [B]: (n) => (n < 2 ? status(429, { "Retry-After": "3" })() : ok([])()) });
    await fetchAdsbTypePull(TYPE_BATCHES, h.deps);
    expect(h.sleeps).toContain(3000);
    expect(h.sleeps).not.toContain(RETRY_BACKOFF_MS[0]);
  });

  it("gives up on a batch that keeps answering 429 and moves on", async () => {
    const h = harness({ [B]: status(429) });
    const r = await fetchAdsbTypePull(TYPE_BATCHES, h.deps);
    expect(h.calls.filter((u) => u === B)).toHaveLength(RETRY_BACKOFF_MS.length + 1);
    expect(r).toMatchObject({ batchesAttempted: 4, batchesSucceeded: 3, mainlineSucceeded: true });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/429/);
  });

  it("does not retry a non-429 failure, counts it, and leaves the other batches alone", async () => {
    const h = harness({ [C]: status(500), [D]: ok([row("d00001")]) });
    const r = await fetchAdsbTypePull(TYPE_BATCHES, h.deps);
    expect(h.calls.filter((u) => u === C)).toHaveLength(1);
    expect(r).toMatchObject({ batchesAttempted: 4, batchesSucceeded: 3 });
    expect(r.objects.some((o) => o.id === "plane:d00001")).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/500/);
  });

  it("treats a network error as a failed batch, not a failed pull", async () => {
    const h = harness({
      [D]: () => {
        throw new TypeError("fetch failed");
      },
    });
    const r = await fetchAdsbTypePull(TYPE_BATCHES, h.deps);
    expect(r).toMatchObject({ batchesAttempted: 4, batchesSucceeded: 3 });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("reports a failed mainline batch so the caller can refuse to cache a GA-only sky", async () => {
    const h = harness({ [A]: status(503), [D]: ok([row("d00001")]) });
    const r = await fetchAdsbTypePull(TYPE_BATCHES, h.deps);
    expect(r.mainlineSucceeded).toBe(false);
    expect(r.objects).toHaveLength(1);
  });

  it("stops asking when the budget is spent and reports the batches never asked", async () => {
    // Each request takes 9 s on the fake clock: A ends at 9 s, pace to 11 s, B ends
    // at 20 s, and C would start with no time left in the 20 s budget.
    const h = harness({}, 9_000);
    const r = await fetchAdsbTypePull(TYPE_BATCHES, h.deps);
    expect(PULL_BUDGET_MS).toBe(20_000);
    expect(h.calls).toEqual([A, B]);
    expect(r).toMatchObject({ batchesPlanned: 4, batchesAttempted: 2, batchesSucceeded: 2 });
  });

  it("does not sleep past the deadline for a retry it cannot finish", async () => {
    // 6 s per request. A lands at 6 s, pace to 8 s, B 429s at 14 s; the first
    // backoff fits (to 16.5 s) but the retry 429s at 22.5 s and the second backoff
    // would end past the 20 s budget, so the pull gives up on B and stops rather
    // than sleeping on.
    const h = harness({ [B]: status(429) }, 6_000);
    const r = await fetchAdsbTypePull(TYPE_BATCHES, h.deps);
    expect(h.deps.now()).toBeLessThanOrEqual(PULL_BUDGET_MS + 6_000);
    expect(r.batchesSucceeded).toBeGreaterThanOrEqual(1);
  });
});
