import { describe, expect, it } from "vitest";
import { isFirstRun, planBootSeed, type BootSeedInput } from "@/lib/console/bootSeed";
import { DEFAULT_PRESET_ID } from "@/lib/console/presets";

// The board step of console boot as a pure decision. The store-driven boots live in
// boot-reload-keeps-signals, boot-sig-link and boot-first-run; this pins the table.

const BASE: BootSeedInput = {
  c: null, preset: null, presetKnown: false, widgetCount: 0, firstRun: false, sig: undefined,
};

describe("isFirstRun", () => {
  it("is true only when nothing at all is saved", () => {
    expect(isFirstRun({ restoredVariant: false, activeBoard: null })).toBe(true);
    expect(isFirstRun({ restoredVariant: true, activeBoard: null })).toBe(false);
    expect(isFirstRun({ restoredVariant: false, activeBoard: "overview" })).toBe(false);
    expect(isFirstRun({ restoredVariant: true, activeBoard: "streets" })).toBe(false);
  });
});

describe("planBootSeed", () => {
  it("does NOT re-seed a returning user's empty board (the reload bug)", () => {
    expect(planBootSeed({ ...BASE, widgetCount: 0, firstRun: false })).toEqual({
      board: { kind: "none" }, reassertSig: null,
    });
  });

  it("seeds the default board on a true first run", () => {
    expect(planBootSeed({ ...BASE, firstRun: true }).board).toEqual({ kind: "preset", id: DEFAULT_PRESET_ID });
  });

  it("does not seed over a layout that already has widgets, even on a first run", () => {
    expect(planBootSeed({ ...BASE, firstRun: true, widgetCount: 3 }).board).toEqual({ kind: "none" });
  });

  it("puts a ?sig= set back on after the first-run seed", () => {
    expect(planBootSeed({ ...BASE, firstRun: true, sig: ["earthquakes", "volcanoes"] }).reassertSig)
      .toEqual(["earthquakes", "volcanoes"]);
  });

  it("leaves ?sig= to the variant spine when no preset runs", () => {
    // Returning user: bootstrap already applied sig and nothing at boot overwrites it.
    expect(planBootSeed({ ...BASE, sig: ["earthquakes"] }).reassertSig).toBeNull();
  });

  it("opens a known ?preset= and puts ?sig= back on after it", () => {
    expect(planBootSeed({ ...BASE, preset: "streets", presetKnown: true, sig: ["volcanoes"] })).toEqual({
      board: { kind: "preset", id: "streets" }, reassertSig: ["volcanoes"],
    });
  });

  it("ignores an unknown ?preset= and falls through to the first-run rule", () => {
    expect(planBootSeed({ ...BASE, preset: "nope", presetKnown: false }).board).toEqual({ kind: "none" });
    expect(planBootSeed({ ...BASE, preset: "nope", presetKnown: false, firstRun: true }).board)
      .toEqual({ kind: "preset", id: DEFAULT_PRESET_ID });
  });

  it("lets ?c= outrank ?preset=, and re-applies nothing because a layout writes no map state", () => {
    expect(planBootSeed({ ...BASE, c: "abc", preset: "streets", presetKnown: true, firstRun: true, sig: ["volcanoes"] }))
      .toEqual({ board: { kind: "layout", encoded: "abc" }, reassertSig: null });
  });
});
