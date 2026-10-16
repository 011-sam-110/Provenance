import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FIRST_RETRY_MS,
  nextPollMs,
  readMapSignal,
  startMapSignalPoll,
  type MapSignalRead,
} from "@/lib/signals/mapFeedPoll";
import { EMPTY_RETRY_MS } from "@/lib/signals/cacheTtl";
import { CABLES_SOURCE, CABLE_LANDINGS_SOURCE } from "@/lib/signals/cables";
import type { SignalFeature } from "@/lib/signals/types";

// Sampo, 2026-10-16: "Submarine cables" and "Cable landing stations" ON in the rail,
// and neither drawn. The map read each layer once and then waited the layer's
// cadence, six hours for both, whatever that read returned. One failed read (a 502
// while the server restarts after a deploy, a cold server's degraded answer, a body
// cut off mid-stream) left the layer empty for six hours. See lib/signals/mapFeedPoll.ts.

const SIX_HOURS = 6 * 60 * 60 * 1000;

function rows(n: number): SignalFeature[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `cable:${i}`,
    lat: 0,
    lon: 0,
    title: `Cable ${i}`,
    signalId: "cables",
  })) as SignalFeature[];
}

function response(status: number, body: string): Response {
  return new Response(body, { status, headers: { "Content-Type": status === 200 ? "application/json" : "text/html" } });
}

describe("nextPollMs: when the map asks a layer again", () => {
  it("the cable layers really do wait six hours after a good read", () => {
    expect(CABLES_SOURCE.refreshMs).toBe(SIX_HOURS);
    expect(CABLE_LANDINGS_SOURCE.refreshMs).toBe(SIX_HOURS);
    expect(nextPollMs(SIX_HOURS, 0)).toBe(SIX_HOURS);
  });

  it("asks a six-hour layer again within five minutes after a failed read, not six hours", () => {
    for (let failures = 1; failures <= 20; failures += 1) {
      expect(nextPollMs(SIX_HOURS, failures)).toBeLessThanOrEqual(EMPTY_RETRY_MS);
    }
    expect(nextPollMs(SIX_HOURS, 1)).toBe(FIRST_RETRY_MS);
    expect(nextPollMs(SIX_HOURS, 2)).toBe(FIRST_RETRY_MS * 2);
  });

  it("never slows a fast layer down because it failed", () => {
    expect(nextPollMs(60_000, 0)).toBe(60_000);
    expect(nextPollMs(60_000, 5)).toBeLessThanOrEqual(60_000);
  });

  it("floors a misconfigured cadence so it cannot spin", () => {
    expect(nextPollMs(0, 0)).toBe(30_000);
    expect(nextPollMs(Number.NaN, 0)).toBe(30_000);
  });
});

describe("readMapSignal: what counts as a failed read", () => {
  it("skips the browser HTTP cache (a cut-off cache write was a failed read with a clean 200)", async () => {
    const fetchImpl = vi.fn(async () => response(200, JSON.stringify({ ok: true, features: rows(2) })));
    await readMapSignal("cables", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith("/api/signals/cables", expect.objectContaining({ cache: "no-store" }));
  });

  it("a 502 error page from the proxy is a failure, not an empty layer", async () => {
    const r = await readMapSignal("cables", async () => response(502, "<html>502 Bad Gateway</html>"));
    expect(r.ok).toBe(false);
  });

  it("a body cut off mid-stream is a failure", async () => {
    const r = await readMapSignal("cables", async () => response(200, '{"ok":true,"features":[{"id":"a"'));
    expect(r.ok).toBe(false);
  });

  it("a refused request is a failure", async () => {
    const r = await readMapSignal("cables", async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(r.ok).toBe(false);
  });

  it("a cold server's declared failure with no rows is a failure (cables: geometry fetch failed)", async () => {
    const body = JSON.stringify({ ok: false, degradedReason: "geometry fetch failed", count: 0, features: [] });
    const r = await readMapSignal("cables", async () => response(200, body));
    expect(r).toEqual({ ok: false, reason: "no rows: geometry fetch failed" });
  });

  it("a declared failure that still carries last-good rows is a read", async () => {
    const body = JSON.stringify({ ok: false, degradedReason: "fetch failed", count: 3, features: rows(3) });
    const r = (await readMapSignal("cables", async () => response(200, body))) as Extract<MapSignalRead, { ok: true }>;
    expect(r.ok).toBe(true);
    expect(r.features).toHaveLength(3);
  });

  it("a healthy layer that is quiet right now is a read with no rows", async () => {
    const r = await readMapSignal("volcanoes", async () => response(200, JSON.stringify({ ok: true, features: [] })));
    expect(r).toEqual({ ok: true, features: [], declaredOk: true });
  });
});

describe("startMapSignalPoll: one failed read no longer blanks a layer for six hours", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  }

  it("draws the cables a few minutes after a failed first read", async () => {
    vi.useFakeTimers();
    const reads: MapSignalRead[] = [{ ok: false, reason: "HTTP 502" }, { ok: true, features: rows(712), declaredOk: true }];
    const read = vi.fn(async () => reads.shift() ?? { ok: true as const, features: rows(712), declaredOk: true });
    const drawn: number[] = [];
    const stop = startMapSignalPoll({
      id: "cables",
      refreshMs: SIX_HOURS,
      read,
      onRows: (f) => drawn.push(f.length),
      onFailure: () => {},
    });
    await settle();
    expect(read).toHaveBeenCalledTimes(1);
    expect(drawn).toEqual([]);

    await vi.advanceTimersByTimeAsync(EMPTY_RETRY_MS);
    expect(read).toHaveBeenCalledTimes(2);
    expect(drawn).toEqual([712]);
    stop();
  });

  it("keeps retrying, with backoff, while the failures go on", async () => {
    vi.useFakeTimers();
    const read = vi.fn(async (): Promise<MapSignalRead> => ({ ok: false, reason: "HTTP 502" }));
    const stop = startMapSignalPoll({ id: "cables", refreshMs: SIX_HOURS, read, onRows: () => {}, onFailure: () => {} });
    await settle();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000); // one hour of an outage
    // 30 s, 60 s, 120 s, 240 s, then every 5 min: far more than the one read of before.
    expect(read.mock.calls.length).toBeGreaterThanOrEqual(12);
    stop();
  });

  it("a failed refresh keeps the rows already drawn (last-good), and says so", async () => {
    vi.useFakeTimers();
    const reads: MapSignalRead[] = [{ ok: true, features: rows(712), declaredOk: true }, { ok: false, reason: "HTTP 502" }];
    const read = vi.fn(async () => reads.shift() ?? { ok: false as const, reason: "HTTP 502" });
    const drawn: number[] = [];
    const failures: boolean[] = [];
    const stop = startMapSignalPoll({
      id: "cables",
      refreshMs: SIX_HOURS,
      read,
      onRows: (f) => drawn.push(f.length),
      onFailure: (_reason, hadRows) => failures.push(hadRows),
    });
    await settle();
    await vi.advanceTimersByTimeAsync(SIX_HOURS);
    expect(drawn).toEqual([712]);
    expect(failures[0]).toBe(true);
    stop();
  });

  it("delivers nothing and reads nothing after stop (the layer was switched off)", async () => {
    vi.useFakeTimers();
    let release: (r: MapSignalRead) => void = () => {};
    const read = vi.fn(() => new Promise<MapSignalRead>((res) => (release = res)));
    const onRows = vi.fn();
    const stop = startMapSignalPoll({ id: "cables", refreshMs: SIX_HOURS, read, onRows, onFailure: () => {} });
    stop();
    release({ ok: true, features: rows(1), declaredOk: true });
    await settle();
    await vi.advanceTimersByTimeAsync(SIX_HOURS * 2);
    expect(onRows).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("a callback that throws does not end the loop", async () => {
    vi.useFakeTimers();
    const read = vi.fn(async (): Promise<MapSignalRead> => ({ ok: true, features: rows(1), declaredOk: true }));
    const stop = startMapSignalPoll({
      id: "volcanoes",
      refreshMs: 60_000,
      read,
      onRows: () => {
        throw new Error("bad row");
      },
      onFailure: () => {},
    });
    await settle();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(2);
    stop();
  });
});
