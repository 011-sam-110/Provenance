import { describe, expect, test } from "vitest";
import { SPIN_EASE_MS, SPIN_SETTLE_MS, spinEnvelope } from "@/lib/map/spin";

describe("spinEnvelope", () => {
  test("turns at full rate for the first stretch", () => {
    for (const t of [0, 1, 1000, 4000, SPIN_SETTLE_MS - SPIN_EASE_MS]) {
      expect(spinEnvelope(t)).toEqual({ factor: 1, settled: false });
    }
  });

  test("has settled once the budget is spent, and stays settled", () => {
    for (const t of [SPIN_SETTLE_MS, SPIN_SETTLE_MS + 1, 60_000]) {
      expect(spinEnvelope(t)).toEqual({ factor: 0, settled: true });
    }
  });

  test("eases down rather than stopping on a frame boundary", () => {
    const easeStart = SPIN_SETTLE_MS - SPIN_EASE_MS;
    const mid = spinEnvelope(easeStart + SPIN_EASE_MS / 2);
    expect(mid.settled).toBe(false);
    expect(mid.factor).toBeGreaterThan(0);
    expect(mid.factor).toBeLessThan(1);
    // Smoothstep is symmetric about its midpoint, so half way through the ease is
    // half rate. Pinned because a linear ramp would also pass every other assertion
    // here, and the two look different on screen.
    expect(mid.factor).toBeCloseTo(0.5, 5);
  });

  test("never speeds up as time passes", () => {
    let last = Infinity;
    for (let t = 0; t <= SPIN_SETTLE_MS + 500; t += 50) {
      const { factor } = spinEnvelope(t);
      expect(factor).toBeLessThanOrEqual(last + 1e-9);
      last = factor;
    }
  });

  test("stays inside 0..1 for every input, including nonsense", () => {
    for (const t of [-1000, -1, 0, 0.5, 1e9, Number.MAX_SAFE_INTEGER]) {
      const { factor } = spinEnvelope(t);
      expect(factor).toBeGreaterThanOrEqual(0);
      expect(factor).toBeLessThanOrEqual(1);
    }
  });

  /**
   * NaN is not a hypothetical. `spentMs` accumulates from frame deltas, and a
   * single bad delta poisons every later value. A NaN factor multiplied into a
   * setCenter longitude gives MapLibre a NaN centre, which does not throw — it
   * blanks the globe silently. Full rate is the safe fallback: it degrades to
   * today's behaviour, a globe that keeps turning, rather than to a dead one.
   */
  test("NaN falls back to full rate rather than poisoning the camera", () => {
    expect(spinEnvelope(Number.NaN)).toEqual({ factor: 1, settled: false });
  });

  test("the ease is a real part of the budget, not longer than it", () => {
    expect(SPIN_EASE_MS).toBeGreaterThan(0);
    expect(SPIN_EASE_MS).toBeLessThan(SPIN_SETTLE_MS);
  });

  /**
   * The behaviour Sampo asked for, stated as a number rather than a vibe: the globe
   * turns for about eight seconds and then rests. If someone changes the budget,
   * this is the test that makes them say so out loud.
   */
  test("the globe settles after about eight seconds of turning", () => {
    expect(SPIN_SETTLE_MS).toBe(8000);
    expect(spinEnvelope(7999).settled).toBe(false);
    expect(spinEnvelope(8000).settled).toBe(true);
  });
});
