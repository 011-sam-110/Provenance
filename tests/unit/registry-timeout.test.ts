import { describe, expect, test } from "vitest";
import { withTimeout } from "@/lib/sources/registry";

// Coverage-panel-latency workstream: /api/coverage's ~12s comes from a cold
// getRegistry() rebuild with no per-upstream ceiling — the single slowest of the
// 11 camera feeds (Castle Rock's paginated fetch has been observed at ~40s cold)
// sets the whole refresh's latency. This exercises the timeout wrapper in
// isolation, with no network involved, using short real-timer delays so it stays
// fast and deterministic without fake-timer/microtask ordering pitfalls.

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function delay<T>(ms: number, value: T): Promise<T> {
  return wait(ms).then(() => value);
}

function delayReject(ms: number, err: Error): Promise<never> {
  return wait(ms).then(() => {
    throw err;
  });
}

describe("withTimeout", () => {
  test("resolves with the value when the promise settles before the deadline", async () => {
    await expect(withTimeout(delay(5, "ok"), 200, "feed")).resolves.toBe("ok");
  });

  test("rejects once the deadline passes and the promise is still pending", async () => {
    await expect(withTimeout(delay(200, "too-late"), 10, "slow-feed")).rejects.toThrow(
      /slow-feed timed out after 10ms/,
    );
  });

  test("propagates the original rejection when the promise fails before the deadline", async () => {
    const boom = new Error("upstream 500");
    await expect(withTimeout(delayReject(5, boom), 200, "feed")).rejects.toBe(boom);
  });

  test("a late settlement after the timeout is consumed, not left as an unhandled rejection", async () => {
    // The inner promise keeps running and settles ~40ms after we've already
    // rejected on timeout. This must not crash the process or double-settle.
    await expect(withTimeout(delay(30, "late"), 5, "feed")).rejects.toThrow(
      /feed timed out after 5ms/,
    );
    await wait(40); // give the inner promise time to resolve past the timeout
  });

  test("a late rejection after the timeout is consumed, not left as an unhandled rejection", async () => {
    const boom = new Error("boom after deadline");
    await expect(withTimeout(delayReject(30, boom), 5, "feed")).rejects.toThrow(
      /feed timed out after 5ms/,
    );
    await wait(40);
  });
});
