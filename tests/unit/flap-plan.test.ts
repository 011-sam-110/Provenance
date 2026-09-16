import { describe, expect, it } from "vitest";
import {
  FLAP_BUDGET_MS,
  FLAP_DURATION_MS,
  FLAP_KILL_SWITCH,
  FLAP_STAGGER_MAX_MS,
  planFlaps,
  visibleAt,
  type FlapPlan,
} from "@/lib/hud/flapPlan";

// The split-flap diff planner, exhaustively: insert / delete / replace, budget
// compression, interruption mid-cascade, reduced motion, and the kill switch.
// Pure functions only — this file runs in the repo's node vitest environment.

const stepAt = (p: FlapPlan, i: number) => p.steps.find((s) => s.index === i);

describe("no-op cascades", () => {
  it("identical strings plan nothing and animate nothing", () => {
    const p = planFlaps("123", "123");
    expect(p.steps).toEqual([]);
    expect(p.columns).toBe(3);
    expect(p.totalMs).toBe(0);
    expect(p.animate).toBe(false);
    expect(p.text).toBe("123");
  });

  it("empty to empty plans nothing", () => {
    expect(planFlaps("", "").steps).toEqual([]);
  });

  it("plan.text is always the target string", () => {
    expect(planFlaps("12", "345").text).toBe("345");
    expect(planFlaps("345", "12").text).toBe("12");
    expect(planFlaps("", "AB").text).toBe("AB");
  });
});

describe("diff shapes", () => {
  it("a single replaced character is one step at its own column", () => {
    const p = planFlaps("12", "13");
    expect(p.steps).toHaveLength(1);
    expect(p.steps[0]).toMatchObject({ index: 1, from: "2", to: "3", duration: FLAP_DURATION_MS });
    expect(p.totalMs).toBe(FLAP_DURATION_MS);
  });

  it("a full replace animates every column, staggered", () => {
    const p = planFlaps("1234", "5678");
    expect(p.steps.map((s) => s.index)).toEqual([0, 1, 2, 3]);
    expect(p.steps.map((s) => s.from)).toEqual(["1", "2", "3", "4"]);
    expect(p.steps.map((s) => s.to)).toEqual(["5", "6", "7", "8"]);
    // Natural stagger runs free on a small cascade: 0, 60, 120, 180.
    expect(p.steps.map((s) => s.start)).toEqual([0, 60, 120, 180]);
    expect(p.totalMs).toBe(180 + FLAP_DURATION_MS);
    expect(p.totalMs).toBeLessThanOrEqual(FLAP_BUDGET_MS);
  });

  it("invariant (a): unchanged characters never animate — only the diff flaps", () => {
    const p = planFlaps("1234", "1274");
    expect(p.steps.map((s) => s.index)).toEqual([2]);
    expect(p.steps[0]).toMatchObject({ from: "3", to: "7" });
    // Unchanged columns carry no step at all.
    for (const i of [0, 1, 3]) expect(stepAt(p, i)).toBeUndefined();
  });

  it("growth flaps new columns up from a blank", () => {
    const p = planFlaps("12", "12345");
    expect(p.columns).toBe(5);
    expect(p.steps).toHaveLength(3);
    expect(p.steps[0]).toMatchObject({ index: 2, from: "", to: "3" });
    expect(p.steps[1]).toMatchObject({ index: 3, from: "", to: "4" });
    expect(p.steps[2]).toMatchObject({ index: 4, from: "", to: "5" });
    for (const i of [0, 1]) expect(stepAt(p, i)).toBeUndefined(); // unchanged prefix
  });

  it("invariant (e): shrinking labels flap trailing columns to a blank IN PLACE", () => {
    const p = planFlaps("12345", "12");
    expect(p.columns).toBe(5); // columns never renumber
    expect(p.steps).toHaveLength(3);
    expect(p.steps[0]).toMatchObject({ index: 2, from: "3", to: "" });
    expect(p.steps[1]).toMatchObject({ index: 3, from: "4", to: "" });
    expect(p.steps[2]).toMatchObject({ index: 4, from: "5", to: "" });
  });

  it("mixed shrink replaces in place — unchanged leading columns stay put", () => {
    const p = planFlaps("12X45", "12");
    expect(p.columns).toBe(5);
    expect(p.steps.map((s) => s.index)).toEqual([2, 3, 4]);
    expect(p.steps.map((s) => s.from)).toEqual(["X", "4", "5"]);
    expect(p.steps.map((s) => s.to)).toEqual(["", "", ""]);
    for (const i of [0, 1]) expect(stepAt(p, i)).toBeUndefined();
  });

  it("every step carries a single glyph or a blank, never a run", () => {
    for (const p of [planFlaps("abc", "xyz"), planFlaps("", "XYZ"), planFlaps("XYZ", "")]) {
      for (const s of p.steps) {
        expect(s.from.length).toBeLessThanOrEqual(1);
        expect(s.to.length).toBeLessThanOrEqual(1);
      }
    }
  });

  it("indexes are always positional — a step's index IS its column", () => {
    const p = planFlaps("12345", "19");
    // One replaced column (1) and three trailing columns folding to blank; their
    // indexes are 1..4, exactly where they sit on the board, in ascending order.
    expect(p.steps.map((s) => s.index)).toEqual([1, 2, 3, 4]);
    expect(p.steps.map((s) => s.from)).toEqual(["2", "3", "4", "5"]);
    p.steps.forEach((s, k) => expect(s.index).toBe(k + 1));
  });
});

describe("stagger and the total budget", () => {
  it("compresses the stagger so a large cascade settles inside ~600ms", () => {
    const p = planFlaps("0".repeat(30), "1".repeat(30));
    expect(p.steps).toHaveLength(30);
    expect(p.totalMs).toBeLessThanOrEqual(FLAP_BUDGET_MS);
    // The stagger had to shrink below the natural maximum.
    const stagger = (p.totalMs - FLAP_DURATION_MS) / (p.steps.length - 1);
    expect(stagger).toBeLessThanOrEqual(FLAP_STAGGER_MAX_MS);
    expect(stagger).toBeGreaterThan(0);
  });

  it("starts are strictly increasing and the last flap settles within budget", () => {
    const p = planFlaps("0".repeat(12), "1".repeat(12));
    for (let k = 1; k < p.steps.length; k++) {
      expect(p.steps[k].start).toBeGreaterThan(p.steps[k - 1].start);
    }
    const last = p.steps[p.steps.length - 1];
    expect(last.start + last.duration).toBeLessThanOrEqual(FLAP_BUDGET_MS);
  });

  it("a 7-column cascade uses the full 600ms exactly", () => {
    const p = planFlaps("abcdefg", "ABCDEFG");
    expect(p.totalMs).toBe(6 * FLAP_STAGGER_MAX_MS + FLAP_DURATION_MS);
    expect(p.totalMs).toBe(FLAP_BUDGET_MS);
  });

  it("a small cascade never pads up to the budget", () => {
    const p = planFlaps("12", "34");
    expect(p.totalMs).toBe(FLAP_STAGGER_MAX_MS + FLAP_DURATION_MS); // 300ms, not 600
  });

  it("honours an explicit budget override", () => {
    const p = planFlaps("0".repeat(40), "1".repeat(40), { budgetMs: 900 });
    expect(p.totalMs).toBeLessThanOrEqual(900);
  });
});

describe("reduced motion and the kill switch", () => {
  it("reduced motion collapses to instant: zero durations, zero starts, no animate", () => {
    const p = planFlaps("123", "987", { reducedMotion: true });
    expect(p.animate).toBe(false);
    expect(p.totalMs).toBe(0);
    expect(p.steps.map((s) => s.duration)).toEqual([0, 0, 0]);
    expect(p.steps.map((s) => s.start)).toEqual([0, 0, 0]);
    // The diff itself is still correct — instant ≠ wrong.
    expect(p.steps.map((s) => s.to)).toEqual(["9", "8", "7"]);
  });

  it("the one-line kill switch collapses every cascade to instant", () => {
    const before = FLAP_KILL_SWITCH.on;
    try {
      FLAP_KILL_SWITCH.on = true;
      const p = planFlaps("0".repeat(10), "1".repeat(10));
      expect(p.animate).toBe(false);
      expect(p.totalMs).toBe(0);
      expect(p.steps.every((s) => s.duration === 0)).toBe(true);
      expect(p.steps).toHaveLength(10);
    } finally {
      FLAP_KILL_SWITCH.on = before;
    }
  });

  it("reduced motion still reports the steps that WOULD have moved", () => {
    const p = planFlaps("12", "12345", { reducedMotion: true });
    expect(p.steps.map((s) => s.index)).toEqual([2, 3, 4]);
    expect(p.steps.map((s) => s.from)).toEqual(["", "", ""]);
  });
});

describe("invariant (d): interruption derives outgoing glyphs from what is visible", () => {
  // A 4-column cascade: starts 0/60/120/180, each 240ms.
  const plan = planFlaps("1234", "5678");

  it("at time 0 nothing has flipped yet", () => {
    expect(visibleAt(plan, 0)).toBe("1234");
  });

  it("mid-cascade the visible string is a MIX of settled and pending columns", () => {
    // At 300ms: col0 done at 240 ("5"), col1 done at 300 ("6"), col2 lands at 360,
    // col3 at 420 — so the board reads 5 6 3 4.
    expect(visibleAt(plan, 300)).toBe("5634");
  });

  it("re-planning from that mixed string carries the VISIBLE glyphs as `from`", () => {
    const mixed = visibleAt(plan, 300);
    const next = planFlaps(mixed, "9999");
    // Every column differs, and each from-glyph is what the eye sees mid-flight —
    // NOT the original "1234" the first cascade started from.
    expect(next.steps.map((s) => s.from)).toEqual(["5", "6", "3", "4"]);
    expect(next.steps.map((s) => s.index)).toEqual([0, 1, 2, 3]);
  });

  it("an already-settled column re-plans from its NEW glyph, so it flaps once, not twice", () => {
    // Interrupt after col0 and col1 have settled but before col2 moves.
    const mixed = visibleAt(plan, 310);
    expect(mixed).toBe("5634");
    const next = planFlaps(mixed, "5639");
    // Only column 3 differs now — columns 0-2 keep their settled glyphs untouched.
    expect(next.steps.map((s) => s.index)).toEqual([3]);
    expect(next.steps[0]).toMatchObject({ from: "4", to: "9" });
  });

  it("at totalMs the board shows the full target", () => {
    expect(visibleAt(plan, plan.totalMs)).toBe("5678");
    expect(visibleAt(plan, plan.totalMs + 1000)).toBe("5678");
  });

  it("negative elapsed time clamps to the pre-cascade state", () => {
    expect(visibleAt(plan, -5)).toBe("1234");
  });

  it("an instant plan is settled from time zero", () => {
    const p = planFlaps("123", "987", { reducedMotion: true });
    expect(visibleAt(p, 0)).toBe("987");
  });

  it("growth columns read as blank until their own flap lands", () => {
    const p = planFlaps("12", "12345");
    expect(visibleAt(p, 0)).toBe("12"); // trailing blanks
    expect(visibleAt(p, p.totalMs)).toBe("12345");
  });
});
