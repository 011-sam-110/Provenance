import { describe, expect, it } from "vitest";
import { glyphs, planTurn, STAGGER_CAP_MS, TURN_MS } from "@/lib/marketing/ctaTurn";

/** One unit per character: enough to tell one cell from the next. */
const xs = (text: string) => glyphs(text).map((_, i) => i * 10);
const plan = (from: string, to: string) =>
  planTurn(from, to, xs(from), xs(to), glyphs(from).length * 10, glyphs(to).length * 10);
const turning = (from: string, to: string) => plan(from, to).cells.filter((c) => c.turns);
const final = (from: string, to: string) =>
  plan(from, to)
    .cells.map((c) => c.to)
    .join("");

describe("which characters turn", () => {
  it("keeps the words that stay, and turns the word that changes", () => {
    const cells = turning("See Madrid in 3D", "See Tokyo in 3D");
    expect(cells.map((c) => c.from).join("")).toBe("Madrid");
    expect(cells.map((c) => c.to).join("")).toBe("Tokyo");
  });

  it("slides the words that stay to where the new phrase needs them", () => {
    const { cells } = plan("See Rome in 3D", "See Toronto in 3D");
    const d = cells.find((c) => c.from === "D")!;
    expect(d.turns).toBe(false);
    expect(d.toX - d.fromX).toBe(30);
  });

  it("always ends on exactly the new phrase", () => {
    for (const [a, b] of [
      ["See Madrid in 3D", "See the news on a map"],
      ["See the news on a map", "See GPS jamming"],
      ["See GPS jamming", "See São Paulo in 3D"],
      ["See Miami in 3D", "See Milan in 3D"],
      ["See Oslo in 3D", "See Oslo in 3D"],
    ]) {
      expect(final(a, b)).toBe(b);
    }
  });

  it("turns a new character out of nothing, and an old one into nothing", () => {
    const longer = turning("See Rome in 3D", "See Toronto in 3D");
    expect(longer.some((c) => c.from === "" && c.to !== "")).toBe(true);
    const shorter = turning("See Toronto in 3D", "See Rome in 3D");
    expect(shorter.some((c) => c.to === "" && c.from !== "")).toBe(true);
  });

  it("never splits a letter that takes two code units", () => {
    expect(glyphs("🌍 é").length).toBe(3);
    expect(() => plan("See Bogotá in 3D", "See 🌍 in 3D")).not.toThrow();
  });
});

describe("when they turn", () => {
  it("goes left to right", () => {
    const delays = turning("See Madrid in 3D", "See Tokyo in 3D").map((c) => c.delayMs);
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    expect(delays[0]).toBe(0);
    expect(delays[1]).toBeGreaterThan(0);
  });

  it("holds a long change to the cap, so the phrase never takes long to read", () => {
    const { totalMs } = plan("See the news on a map", "See nuclear power plants");
    expect(totalMs).toBeLessThanOrEqual(TURN_MS + STAGGER_CAP_MS);
  });

  it("does not stagger a single character", () => {
    const only = turning("See Rome in 3D", "See Rone in 3D");
    expect(only).toHaveLength(1);
    expect(only[0].delayMs).toBe(0);
  });

  it("does not turn anything when the phrase is the same", () => {
    expect(turning("See Oslo in 3D", "See Oslo in 3D")).toHaveLength(0);
  });
});
