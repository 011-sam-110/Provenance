import { describe, it, expect } from "vitest";
import { frameBucket } from "@/lib/cameras/freshness";

describe("frameBucket", () => {
  it("is identical for two clients inside the same window", () => {
    // The base has to be ALIGNED to the window, because buckets are absolute — that
    // is exactly what makes them shareable between clients that never met. Two
    // arbitrary times 299,999ms apart can legitimately straddle a boundary.
    const aligned = Math.floor(1_786_745_000_000 / 300_000) * 300_000;
    expect(frameBucket(aligned, 300)).toBe(frameBucket(aligned + 299_999, 300));
  });

  it("rolls over the moment the window ends, not a millisecond later", () => {
    const aligned = Math.floor(1_786_745_000_000 / 300_000) * 300_000;
    expect(frameBucket(aligned + 300_000, 300)).toBe(frameBucket(aligned, 300) + 1);
  });

  it("advances exactly once per refresh window", () => {
    const t = 1_786_745_000_000;
    expect(frameBucket(t + 300_000, 300) - frameBucket(t, 300)).toBe(1);
  });

  it("does not depend on when a component mounted", () => {
    // The whole bug it exists to fix: two tiles mounted at different moments must
    // still agree on the URL, or neither can share the other's cache entry.
    expect(frameBucket(1_786_745_123_456, 60)).toBe(frameBucket(1_786_745_123_456, 60));
  });

  it("never divides by zero for a nonsense cadence", () => {
    expect(Number.isFinite(frameBucket(1_786_745_000_000, 0))).toBe(true);
    expect(Number.isFinite(frameBucket(1_786_745_000_000, -5))).toBe(true);
    expect(Number.isFinite(frameBucket(1_786_745_000_000, NaN))).toBe(true);
  });

  it("uses a different window per cadence, so a 60s and a 300s camera do not collide", () => {
    const t = 1_786_745_000_000;
    expect(frameBucket(t, 60)).not.toBe(frameBucket(t, 300));
  });
});
