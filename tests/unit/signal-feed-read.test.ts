import { afterEach, describe, it, expect, vi } from "vitest";
import { peekSignalFeed, signalReadSucceeded, subscribeSignalFeed } from "@/lib/console/signals/useSignalFeed";
import { diff, EMPTY_OBSERVATION } from "@/lib/notify/engine";
import type { AreaRule } from "@/lib/notify/types";

/** Let every already-queued microtask run — the module's fetch().then().then() chain. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

// Payload shapes are what production /api/signals/<id> returned on 2026-09-12.
describe("signalReadSucceeded — a 200 is not a successful read", () => {
  it("refuses a declared failure with nothing in it (reliefweb/grid-load \"no key\", fire-active \"http 400\")", () => {
    expect(signalReadSucceeded({ ok: false, degradedReason: "no key", count: 0 }, 0)).toBe(false);
  });

  it("refuses an undeclared outcome with nothing in it", () => {
    expect(signalReadSucceeded({ count: 0 }, 0)).toBe(false);
    expect(signalReadSucceeded(null, 0)).toBe(false);
  });

  it("accepts an upstream that answered, with or without rows", () => {
    expect(signalReadSucceeded({ ok: true, count: 0 }, 0)).toBe(true);
    expect(signalReadSucceeded({ ok: true, count: 12 }, 12)).toBe(true);
  });

  it("keeps a failure that still carries rows as it was, until partial/last-good has a state", () => {
    // gdacs: "partial: VO failed (http 404)" with 36 current events.
    expect(signalReadSucceeded({ ok: false, count: 36 }, 36)).toBe(true);
  });
});

describe("useSignalFeed — sourceAt: the age of the DATA, not of the fetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("carries the server's declared sourceAt through to the feed", async () => {
    const sourceAt = Date.parse("2025-12-31T23:59:59.999Z");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ok: true, observedAt: Date.now(), sourceAt, count: 1, features: [{ id: "a" }] }),
      })),
    );
    const detach = subscribeSignalFeed("test:source-at-present");
    try {
      await flush();
      expect(peekSignalFeed("test:source-at-present")?.sourceAt).toBe(sourceAt);
    } finally {
      detach();
    }
  });

  it("is null when the source declares none — most sources have no better answer than the fetch instant", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ok: true, observedAt: Date.now(), count: 1, features: [{ id: "a" }] }),
      })),
    );
    const detach = subscribeSignalFeed("test:source-at-absent");
    try {
      await flush();
      const feed = peekSignalFeed("test:source-at-absent");
      expect(feed?.ok).toBe(true);
      expect(feed?.sourceAt).toBeNull();
    } finally {
      detach();
    }
  });
});

describe("what that means for a `quiet` rule", () => {
  const RING: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const quiet: AreaRule = {
    id: "rule:q", areaId: "area:1", sourceId: "cyber-ransomware",
    params: { kind: "quiet", silentMs: 30 * 60_000 },
    channels: { browser: true, telegram: false, discord: false },
    enabled: true, createdAt: 0,
  };

  it("announces a source that last read 31 minutes ago and now answers {ok:false, count:0}", () => {
    const lastGood = 1_000;
    const now = lastGood + 31 * 60_000;
    const ok = signalReadSucceeded({ ok: false, degradedReason: "http 404", count: 0 }, 0);
    // readNotifyFeed passes `ok` through and uses updatedAt, which a failed read does not advance.
    const { events } = diff({ ...EMPTY_OBSERVATION, lastOk: lastGood }, [], RING, [quiet], { ok, lastOk: lastGood }, now);
    expect(events.map((e) => e.kind)).toEqual(["quiet"]);
  });
});
