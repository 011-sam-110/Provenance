import { describe, it, expect } from "vitest";
import { bboxAround, parseBbox, bboxKey, bboxSpan, DEFAULT_RADIUS_KM } from "@/lib/webcams/bbox";

describe("bboxAround", () => {
  it("puts the point in the middle", () => {
    const [n, e, s, w] = bboxAround(40.4168, -3.7038); // Madrid
    expect((n + s) / 2).toBeCloseTo(40.4168, 6);
    expect((e + w) / 2).toBeCloseTo(-3.7038, 6);
  });

  it("widens the longitude span with latitude", () => {
    // A degree of longitude is cos(lat) as long as a degree of latitude, so the
    // same radius in km needs a wider degree span the further from the equator.
    const equator = bboxSpan(bboxAround(0, 0));
    const reykjavik = bboxSpan(bboxAround(64.15, -21.94));
    expect(reykjavik.lon).toBeGreaterThan(equator.lon * 2);
    expect(reykjavik.lat).toBeCloseTo(equator.lat, 6);
  });

  it("does not run away at the pole", () => {
    const b = bboxAround(89.99, 0);
    expect(Number.isFinite(b[1])).toBe(true);
    expect(bboxSpan(b).lon).toBeLessThanOrEqual(120);
  });

  it("clamps latitude to the real world", () => {
    const [n, , s] = bboxAround(89.9, 0, 200);
    expect(n).toBeLessThanOrEqual(90);
    expect(s).toBeGreaterThanOrEqual(-90);
  });

  it("clamps an absurd or missing radius rather than trusting it", () => {
    expect(bboxSpan(bboxAround(51.5, -0.12, 99999)).lat).toBeLessThan(
      bboxSpan(bboxAround(51.5, -0.12, 201)).lat + 0.001,
    );
    expect(bboxSpan(bboxAround(51.5, -0.12, NaN))).toEqual(
      bboxSpan(bboxAround(51.5, -0.12, DEFAULT_RADIUS_KM)),
    );
    expect(bboxSpan(bboxAround(51.5, -0.12, -5)).lat).toBeGreaterThan(0);
  });
});

describe("parseBbox", () => {
  it("accepts a well-formed box", () => {
    expect(parseBbox("40.55,-3.5,40.3,-3.85")).toEqual([40.55, -3.5, 40.3, -3.85]);
  });

  it("tolerates whitespace", () => {
    expect(parseBbox(" 40.55 , -3.5 , 40.3 , -3.85 ")).toEqual([40.55, -3.5, 40.3, -3.85]);
  });

  it("rejects junk rather than guessing", () => {
    expect(parseBbox(null)).toBeNull();
    expect(parseBbox("")).toBeNull();
    expect(parseBbox("40.55,-3.5,40.3")).toBeNull();
    expect(parseBbox("a,b,c,d")).toBeNull();
    expect(parseBbox("40.55,-3.5,40.3,-3.85,9")).toBeNull();
  });

  it("rejects out-of-range coordinates", () => {
    expect(parseBbox("91,0,40,-1")).toBeNull();
    expect(parseBbox("40,181,30,-1")).toBeNull();
  });

  it("rejects a TRANSPOSED box, which would silently return nothing", () => {
    // north below south reads to Windy as an empty box, and an empty box looks
    // exactly like "there are no cameras here" — which is the one lie this
    // feature must not tell.
    expect(parseBbox("40.3,-3.5,40.55,-3.85")).toBeNull();
    expect(parseBbox("40.55,-3.85,40.3,-3.5")).toBeNull();
  });
});

describe("bboxKey", () => {
  it("collapses sub-kilometre panning onto one cache entry", () => {
    expect(bboxKey([40.5512, -3.5011, 40.3009, -3.8502])).toBe(
      bboxKey([40.5514, -3.5013, 40.3011, -3.8504]),
    );
  });

  it("still separates genuinely different places", () => {
    expect(bboxKey(bboxAround(40.4168, -3.7038))).not.toBe(bboxKey(bboxAround(51.5074, -0.1278)));
  });
});
