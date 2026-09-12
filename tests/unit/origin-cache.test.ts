import { describe, expect, it, beforeEach } from "vitest";
import { cachedBody, originCacheStats, __resetOriginCache } from "@/lib/http/originCache";

/**
 * These assert the two properties the cache exists for, and they are the two that
 * would be silently wrong if it were written the obvious way round:
 *
 *   1. a request that finds the entry stale is answered from the copy in hand and
 *      does NOT await the rebuild, and
 *   2. a burst of such requests runs ONE rebuild between them.
 *
 * Both are observable only through the build counter, because the body a caller sees
 * is the same string either way until the tick lands. A test that only checked the
 * returned strings would pass against an implementation that awaited every refresh
 * and ran one per request.
 */

/** Let every already-queued microtask run. Cheaper to read than counting `await`s. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

/** A build that counts its calls and resolves when told, so "did not await" is testable. */
function deferredBuilder(bodies: string[]) {
  let calls = 0;
  let release: (() => void) | null = null;
  return {
    get calls() {
      return calls;
    },
    /** Let the in-flight build finish, then yield the microtask queue. */
    async finish() {
      release?.();
      release = null;
      await Promise.resolve();
      await Promise.resolve();
    },
    build: () => {
      const body = bodies[Math.min(calls, bodies.length - 1)];
      calls += 1;
      return new Promise<string>((resolve) => {
        release = () => resolve(body);
      });
    },
  };
}

describe("originCache", () => {
  beforeEach(() => __resetOriginCache());

  it("builds once on a cold cache and serves that body to later callers", async () => {
    let calls = 0;
    const build = () => {
      calls += 1;
      return "first";
    };
    const opts = { key: "k", ttlMs: 1_000, build, now: () => 0 };

    expect(await cachedBody(opts)).toBe("first");
    expect(await cachedBody(opts)).toBe("first");
    expect(calls).toBe(1);
  });

  it("shares one cold build between callers that arrive together", async () => {
    const b = deferredBuilder(["cold"]);
    const opts = { key: "k", ttlMs: 1_000, build: b.build, now: () => 0 };

    const a = cachedBody(opts);
    const c = cachedBody(opts);
    await b.finish();

    expect(await a).toBe("cold");
    expect(await c).toBe("cold");
    // One build for two concurrent cold callers — without the shared promise this is 2,
    // which is the thundering herd at the one moment the build is most expensive.
    expect(b.calls).toBe(1);
  });

  it("serves the held body immediately when the TTL has passed, without awaiting the rebuild", async () => {
    const b = deferredBuilder(["old", "new"]);
    let clock = 0;
    const opts = { key: "k", ttlMs: 100, build: b.build, now: () => clock };

    const cold = cachedBody(opts);
    await b.finish();
    expect(await cold).toBe("old");

    clock = 500; // stale
    // The rebuild is now in flight and deliberately NOT resolved. The caller must
    // still get an answer — this await would hang if the cache waited for it.
    expect(await cachedBody(opts)).toBe("old");
    expect(b.calls).toBe(2);

    await b.finish();
    expect(await cachedBody(opts)).toBe("new");
  });

  it("runs one rebuild for a burst of stale requests", async () => {
    const b = deferredBuilder(["old", "new"]);
    let clock = 0;
    const opts = { key: "k", ttlMs: 100, build: b.build, now: () => clock };

    const cold = cachedBody(opts);
    await b.finish();
    await cold;

    clock = 500;
    await Promise.all([cachedBody(opts), cachedBody(opts), cachedBody(opts)]);
    // Cold build + exactly one refresh, not one per caller.
    expect(b.calls).toBe(2);
  });

  it("rebuilds when the version changes even though the TTL has not passed", async () => {
    const b = deferredBuilder(["v1", "v2"]);
    const opts = (version: unknown) => ({
      key: "k",
      ttlMs: 10_000,
      version,
      build: b.build,
      now: () => 0,
    });
    const first = {};
    const second = {};

    const cold = cachedBody(opts(first));
    await b.finish();
    expect(await cold).toBe("v1");

    expect(await cachedBody(opts(second))).toBe("v1"); // still serves the held copy
    await b.finish();
    expect(await cachedBody(opts(second))).toBe("v2");
    expect(b.calls).toBe(2);
  });

  it("does not rebuild while the version is unchanged and the TTL holds", async () => {
    const b = deferredBuilder(["only"]);
    const version = { same: true };
    const opts = { key: "k", ttlMs: 10_000, version, build: b.build, now: () => 0 };

    const cold = cachedBody(opts);
    await b.finish();
    await cold;
    await cachedBody(opts);
    await cachedBody(opts);

    expect(b.calls).toBe(1);
  });

  it("keeps the last good body when a refresh throws, and retries on the next request", async () => {
    let calls = 0;
    let clock = 0;
    const build = () => {
      calls += 1;
      if (calls === 2) throw new Error("upstream down");
      return calls === 1 ? "good" : "recovered";
    };
    const opts = { key: "k", ttlMs: 100, build, now: () => clock };

    expect(await cachedBody(opts)).toBe("good");

    clock = 500;
    // The refresh this starts throws. The caller must not see it: a dead upstream
    // degrades to "the last good answer, held longer", never to a rejected request.
    expect(await cachedBody(opts)).toBe("good");
    await flush();
    expect(calls).toBe(2);

    expect(await cachedBody(opts)).toBe("good"); // still last-good; starts the retry
    await flush();
    expect(await cachedBody(opts)).toBe("recovered");
  });

  it("leaves no entry behind when the COLD build throws", async () => {
    const opts = {
      key: "k",
      ttlMs: 100,
      build: () => {
        throw new Error("cold failure");
      },
      now: () => 0,
    };

    await expect(cachedBody(opts)).rejects.toThrow("cold failure");
    // A placeholder entry here would be served as an empty body forever after.
    expect(originCacheStats().find((s) => s.key === "k")).toBeUndefined();
  });

  it("keeps keys apart", async () => {
    const opts = (key: string, body: string) => ({
      key,
      ttlMs: 1_000,
      build: () => body,
      now: () => 0,
    });
    expect(await cachedBody(opts("a", "A"))).toBe("A");
    expect(await cachedBody(opts("b", "B"))).toBe("B");
    expect(await cachedBody(opts("a", "ignored"))).toBe("A");
  });

  it("reports only built entries in the stats", async () => {
    await cachedBody({ key: "cameras", ttlMs: 1_000, build: () => "12345", now: () => 0 });
    const stats = originCacheStats();
    const cameras = stats.find((s) => s.key === "cameras");
    expect(cameras?.bytes).toBe(5);
    expect(cameras?.ageMs).toBeGreaterThanOrEqual(0);
  });
});
