import { describe, expect, it } from "vitest";
import { EMPTY_RETRY_MS, cacheTtlMs } from "@/lib/signals/cacheTtl";

// Regression cover for a real outage shape: the submarine-cable layer enriches ~700
// keyless per-cable JSONs on a cold load. One slow cold load resolved to [] (the
// adapters are dormant-safe and never throw), that empty answer was cached for the
// source's own 6-hour refresh interval, and the layer stayed blank app-wide for six
// hours even though the upstream was healthy the whole time.
describe("cacheTtlMs", () => {
  it("holds a populated result for the source's own refresh interval", () => {
    expect(cacheTtlMs(6 * 60 * 60 * 1000, false)).toBe(6 * 60 * 60 * 1000);
    expect(cacheTtlMs(60_000, false)).toBe(60_000);
  });

  it("caps an empty result so a transient miss cannot blank a slow layer for hours", () => {
    expect(cacheTtlMs(6 * 60 * 60 * 1000, true)).toBe(EMPTY_RETRY_MS);
    expect(cacheTtlMs(24 * 60 * 60 * 1000, true)).toBe(EMPTY_RETRY_MS);
  });

  it("never EXTENDS a fast layer's interval just because it came back empty", () => {
    // A quiet 60s layer must keep re-asking every 60s, not settle into 5 minutes.
    expect(cacheTtlMs(60_000, true)).toBe(60_000);
    expect(cacheTtlMs(12_000, true)).toBe(12_000);
  });

  it("treats the boundary exactly", () => {
    expect(cacheTtlMs(EMPTY_RETRY_MS, true)).toBe(EMPTY_RETRY_MS);
    expect(cacheTtlMs(EMPTY_RETRY_MS + 1, true)).toBe(EMPTY_RETRY_MS);
    expect(cacheTtlMs(EMPTY_RETRY_MS - 1, true)).toBe(EMPTY_RETRY_MS - 1);
  });
});
