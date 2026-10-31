import { describe, expect, test } from "vitest";
import { FALLBACK_DOTS, MAX_DOTS, dotRadius, memberDots, turnDot } from "@/lib/community/memberGlobe";

describe("the globe of members", () => {
  test("draws one dot per member, and one green dot per person online", () => {
    const dots = memberDots(265, 27);
    expect(dots).toHaveLength(265);
    expect(dots.filter((d) => d.online)).toHaveLength(27);
  });

  test("the count stays exact at every size up to the cap", () => {
    for (const [members, online] of [[1, 1], [2, 0], [99, 14], [1_000, 333], [MAX_DOTS, 1]]) {
      const dots = memberDots(members, online);
      expect(dots).toHaveLength(members);
      expect(dots.filter((d) => d.online)).toHaveLength(online);
    }
  });

  test("more online than members cannot draw more green than dots", () => {
    expect(memberDots(5, 40).filter((d) => d.online)).toHaveLength(5);
  });

  test("past the cap the ball stops growing rather than stalling a phone", () => {
    expect(memberDots(MAX_DOTS * 4, 0)).toHaveLength(MAX_DOTS);
  });

  test("with no count it is only a shape, with no green to read as people online", () => {
    const dots = memberDots(null, null);
    expect(dots).toHaveLength(FALLBACK_DOTS);
    expect(dots.some((d) => d.online)).toBe(false);
  });

  test("every dot sits on the sphere", () => {
    for (const d of memberDots(265, 27)) {
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 6);
    }
  });

  test("the dots spread over the whole ball, not one side of it", () => {
    const dots = memberDots(265, 0);
    const mean = (k: "x" | "y" | "z") => dots.reduce((sum, d) => sum + d[k], 0) / dots.length;
    expect(Math.abs(mean("x"))).toBeLessThan(0.02);
    expect(Math.abs(mean("y"))).toBeLessThan(0.02);
    expect(Math.abs(mean("z"))).toBeLessThan(0.02);
  });

  test("turning a dot keeps it on the sphere", () => {
    const p = turnDot({ x: 0.6, y: 0, z: 0.8 }, 1.3, -0.42);
    expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(1, 6);
  });

  test("the dots shrink as the server grows, and stay visible", () => {
    expect(dotRadius(265, 170)).toBeGreaterThan(dotRadius(3_000, 170));
    expect(dotRadius(3_000, 170)).toBeGreaterThanOrEqual(0.9);
    expect(dotRadius(1, 170)).toBeLessThanOrEqual(3.2);
  });
});
