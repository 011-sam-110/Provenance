import { describe, expect, it } from "vitest";
import { edgeCacheControl, toSeconds, MIN_TTL_SECONDS } from "@/lib/http/cache";

describe("toSeconds", () => {
  it("floors milliseconds to whole seconds", () => {
    expect(toSeconds(60_000)).toBe(60);
    expect(toSeconds(1_999)).toBe(1);
    expect(toSeconds(240_000)).toBe(240);
  });

  it("never returns less than the floor, however small the input", () => {
    expect(toSeconds(0)).toBe(MIN_TTL_SECONDS);
    expect(toSeconds(-5)).toBe(MIN_TTL_SECONDS);
    expect(toSeconds(10)).toBe(MIN_TTL_SECONDS);
  });

  it("treats non-finite input as the floor rather than emitting NaN into a header", () => {
    expect(toSeconds(Number.NaN)).toBe(MIN_TTL_SECONDS);
    expect(toSeconds(Number.POSITIVE_INFINITY)).toBe(MIN_TTL_SECONDS);
  });
});

describe("edgeCacheControl", () => {
  it("emits a shared-cache directive at the interval it was given", () => {
    expect(edgeCacheControl(60_000)).toBe(
      "public, s-maxage=60, stale-while-revalidate=60",
    );
  });

  it("defaults the stale window to the TTL, so the worst case is two intervals old", () => {
    expect(edgeCacheControl(30_000)).toBe(
      "public, s-maxage=30, stale-while-revalidate=30",
    );
  });

  it("accepts an explicit stale window", () => {
    expect(edgeCacheControl(20_000, 60_000)).toBe(
      "public, s-maxage=20, stale-while-revalidate=60",
    );
  });

  it("uses s-maxage, not max-age, so a browser tab still revalidates", () => {
    const header = edgeCacheControl(60_000);
    expect(header).toContain("s-maxage=");
    expect(header).not.toMatch(/(^|[^-])max-age=/);
  });

  it("never emits a zero or negative TTL", () => {
    expect(edgeCacheControl(0)).toBe(
      `public, s-maxage=${MIN_TTL_SECONDS}, stale-while-revalidate=${MIN_TTL_SECONDS}`,
    );
  });
});
