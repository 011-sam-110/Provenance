import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MIN_ONLINE,
  WINDOW_MS,
  __resetPresence,
  count,
  heartbeat,
  minOnline,
  sizeForTest,
} from "@/lib/presence/store";

/**
 * The live-visitor count, and the two things it must never do: keep counting
 * somebody who left, and tell a caller a number it is not allowed to publish.
 *
 * The clock is injected throughout. Testing a three-minute window against the
 * real clock would mean either waiting three minutes or trusting fake timers to
 * agree with `Date.now()` inside the module — and the whole point of the
 * parameter is that neither is necessary.
 */
beforeEach(() => { __resetPresence(); });

const NOW = 1_760_000_000_000;

describe("who counts as online", () => {
  it("counts one visitor once, however often they check in", () => {
    for (let i = 0; i < 12; i += 1) heartbeat("visitor-aaaaaaaa", NOW + i * 1000);
    expect(sizeForTest(NOW + 12_000)).toBe(1);
  });

  it("drops a visitor who stops checking in, exactly at the window edge", () => {
    heartbeat("visitor-aaaaaaaa", NOW);
    // Still inside: the window is "no MORE than WINDOW_MS since the last beat",
    // so the boundary itself is in. Asserting the edge rather than a comfortable
    // middle is what makes this a test of the rule instead of of an example.
    expect(sizeForTest(NOW + WINDOW_MS)).toBe(1);
    expect(sizeForTest(NOW + WINDOW_MS + 1)).toBe(0);
  });

  it("keeps a visitor who is still beating and drops the one who is not", () => {
    heartbeat("visitor-staying", NOW);
    heartbeat("visitor-leaving", NOW);
    heartbeat("visitor-staying", NOW + WINDOW_MS - 1);
    expect(sizeForTest(NOW + WINDOW_MS + 1)).toBe(1);
  });
});

describe("what a visitor id is allowed to be", () => {
  // The eviction is time-based, so nothing else bounds the map's size. Without
  // this check a caller could grow it without limit by posting distinct ids, and
  // the failure would be a slow memory leak on the box rather than an error.
  it("refuses an id that could grow the map without bound", () => {
    expect(heartbeat("short", NOW)).toBe(false);
    expect(heartbeat("x".repeat(65), NOW)).toBe(false);
    expect(heartbeat("has spaces in it", NOW)).toBe(false);
    expect(heartbeat("has/slashes/init", NOW)).toBe(false);
    expect(sizeForTest(NOW)).toBe(0);
  });

  it("accepts the shape the client actually sends", () => {
    // A de-hyphenated crypto.randomUUID() — 32 hex characters.
    expect(heartbeat("3f2b1c8d9e4a5b6c7d8e9f0a1b2c3d4e", NOW)).toBe(true);
    expect(sizeForTest(NOW)).toBe(1);
  });
});

describe("what the count is willing to say", () => {
  const fill = (n: number, at: number) => {
    for (let i = 0; i < n; i += 1) heartbeat(`visitor-${i.toString().padStart(8, "0")}`, at);
  };

  it("returns null below the threshold rather than a small number", () => {
    fill(DEFAULT_MIN_ONLINE - 1, NOW);
    expect(count(NOW, DEFAULT_MIN_ONLINE)).toBeNull();
  });

  it("publishes the count at the threshold and above", () => {
    fill(DEFAULT_MIN_ONLINE, NOW);
    expect(count(NOW, DEFAULT_MIN_ONLINE)).toBe(DEFAULT_MIN_ONLINE);
  });

  it("stops publishing once people age out below the threshold", () => {
    fill(DEFAULT_MIN_ONLINE, NOW);
    expect(count(NOW, DEFAULT_MIN_ONLINE)).toBe(DEFAULT_MIN_ONLINE);
    // Everyone goes quiet. The number must not linger.
    expect(count(NOW + WINDOW_MS + 1, DEFAULT_MIN_ONLINE)).toBeNull();
  });
});

describe("the threshold override", () => {
  // It exists so the pill can be SEEN on a preview: above 25 concurrent is a
  // spike number for this site, so without a way to lower it nobody would ever
  // confirm the thing renders.
  it("defaults to 25 and reads a valid override", () => {
    expect(minOnline({})).toBe(DEFAULT_MIN_ONLINE);
    expect(minOnline({ PRESENCE_MIN_ONLINE: "1" })).toBe(1);
    expect(minOnline({ PRESENCE_MIN_ONLINE: "0" })).toBe(0);
  });

  it("falls back to the default rather than to zero on a junk value", () => {
    // A typo'd env var must not silently publish a count of one. Falling back to
    // the SAFE end is the whole reason this is parsed rather than coerced:
    // `Number("")` is 0, which would turn an empty override into "always show".
    expect(minOnline({ PRESENCE_MIN_ONLINE: "" })).toBe(DEFAULT_MIN_ONLINE);
    expect(minOnline({ PRESENCE_MIN_ONLINE: "lots" })).toBe(DEFAULT_MIN_ONLINE);
    expect(minOnline({ PRESENCE_MIN_ONLINE: "-3" })).toBe(DEFAULT_MIN_ONLINE);
  });
});
