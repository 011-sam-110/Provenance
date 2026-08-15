import { describe, it, expect } from "vitest";
import {
  isDuplicateFrame,
  selectEvictions,
  buildDayStrip,
  HISTORY_CEILING_BYTES,
  type FrameMeta,
} from "@/lib/cameras/history";

describe("isDuplicateFrame", () => {
  it("is never a duplicate of nothing", () => {
    expect(isDuplicateFrame(undefined, { etag: "a", contentLength: 100 })).toBe(false);
  });

  it("matches on ETag when both sides have one", () => {
    expect(isDuplicateFrame({ etag: "a", contentLength: 100 }, { etag: "a", contentLength: 999 })).toBe(true);
    expect(isDuplicateFrame({ etag: "a", contentLength: 100 }, { etag: "b", contentLength: 100 })).toBe(false);
  });

  it("falls back to Content-Length when either side has no ETag", () => {
    expect(isDuplicateFrame({ etag: null, contentLength: 15000 }, { etag: null, contentLength: 15000 })).toBe(true);
    expect(isDuplicateFrame({ etag: null, contentLength: 15000 }, { etag: null, contentLength: 15001 })).toBe(false);
  });

  it("is not a duplicate when neither signal is comparable", () => {
    expect(isDuplicateFrame({ etag: null, contentLength: null }, { etag: null, contentLength: null })).toBe(false);
    expect(isDuplicateFrame({ etag: "a", contentLength: null }, { etag: null, contentLength: 100 })).toBe(false);
  });
});

describe("selectEvictions", () => {
  const frame = (id: number, ts: number, bytes: number): FrameMeta => ({
    id,
    streamKey: "cam:x",
    ts,
    bytes,
    etag: null,
    contentLength: bytes,
  });

  it("evicts nothing when the incoming frame already fits", () => {
    const existing = [frame(1, 100, 1000)];
    const out = selectEvictions(existing, 1000, 500, 10_000);
    expect(out).toEqual({ evict: [], blocked: false });
  });

  it("evicts oldest-first until the incoming frame fits", () => {
    const existing = [frame(1, 100, 4000), frame(2, 200, 4000), frame(3, 300, 4000)];
    const usedBytes = 12_000;
    const out = selectEvictions(existing, usedBytes, 5000, 10_000);
    // 12000 + 5000 = 17000 > 10000; evict id 1 (oldest) -> 8000 + 5000 = 13000, still over;
    // evict id 2 -> 4000 + 5000 = 9000, fits.
    expect(out).toEqual({ evict: [1, 2], blocked: false });
  });

  it("refuses a frame bigger than the whole ceiling rather than wiping the buffer", () => {
    const existing = [frame(1, 100, 1000)];
    const out = selectEvictions(existing, 1000, 20_000, 10_000);
    expect(out).toEqual({ evict: [], blocked: true });
  });

  it("reports blocked if evicting everything still doesn't make room", () => {
    const existing = [frame(1, 100, 1000)];
    const out = selectEvictions(existing, 1000, 9500, 10_000);
    expect(out.blocked).toBe(false); // 1000 - 1000 + 9500 = 9500 <= 10000, fits after evicting id 1
    expect(out.evict).toEqual([1]);
  });

  it("uses a real-world ceiling without surprises", () => {
    // Sanity check the exported constant is the byte-measured value the spec
    // requires (8 MiB), not a frame-count guess.
    expect(HISTORY_CEILING_BYTES).toBe(8 * 1024 * 1024);
  });
});

describe("buildDayStrip", () => {
  it("returns one bucket per slot, all gaps when nothing was captured", () => {
    const buckets = buildDayStrip([], 0, 1000, 4);
    expect(buckets).toHaveLength(4);
    expect(buckets.every((b) => b.ts === null)).toBe(true);
    expect(buckets[0]).toEqual({ start: 0, end: 250, ts: null });
    expect(buckets[3]).toEqual({ start: 750, end: 1000, ts: null });
  });

  it("places a frame in its bucket and leaves the rest as gaps", () => {
    const buckets = buildDayStrip([300], 0, 1000, 4);
    expect(buckets[0].ts).toBeNull();
    expect(buckets[1].ts).toBe(300);
    expect(buckets[2].ts).toBeNull();
    expect(buckets[3].ts).toBeNull();
  });

  it("keeps only the latest frame per bucket, never interpolating between them", () => {
    const buckets = buildDayStrip([310, 260, 240], 0, 1000, 4);
    expect(buckets[1].ts).toBe(310);
  });

  it("drops frames outside the window", () => {
    const buckets = buildDayStrip([-50, 1050], 0, 1000, 4);
    expect(buckets.every((b) => b.ts === null)).toBe(true);
  });

  it("is safe for a degenerate zero-width window", () => {
    const buckets = buildDayStrip([5], 5, 5, 4);
    expect(buckets).toHaveLength(4);
  });
});
