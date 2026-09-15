import { describe, it, expect } from "vitest";
import {
  allExplainers,
  confidenceLabel,
  explainerFor,
  orphanedExplainerIds,
  undocumentedLayerIds,
} from "@/lib/signals/explain";
import { SIGNALS } from "@/lib/signals/registry";
import { computeInstability } from "@/lib/signals/instability";

// This file IS the feature. Our nearest competitor shipped the same
// source/confidence/limitations card and completed 8 of their 20 layers; the rest
// render "a curated source and confidence card has not been added yet". A trust
// feature with a hole in it teaches people not to trust the feature. These tests
// make the hole impossible: you cannot register a layer without saying what it
// can't do.

describe("coverage — no layer ships without an explainer", () => {
  it("documents every registered layer", () => {
    const missing = undocumentedLayerIds();
    expect(
      missing,
      `these registered layers have no explainer in lib/signals/explain.ts:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("has no explainer for a layer that no longer exists", () => {
    expect(orphanedExplainerIds()).toEqual([]);
  });

  it("has exactly one explainer per layer", () => {
    const ids = allExplainers().map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(SIGNALS.length);
  });
});

describe("quality — an entry that says nothing is worse than none", () => {
  it("names at least one real limitation for every layer", () => {
    for (const e of allExplainers()) {
      expect(e.limitations.length, `${e.id} lists no limitation`).toBeGreaterThan(0);
      for (const l of e.limitations) {
        // Long enough to be an actual caveat rather than a shrug like "may vary".
        expect(l.length, `${e.id} has a throwaway limitation: "${l}"`).toBeGreaterThan(40);
      }
    }
  });

  it("says what a pin is and how the value is derived, for every layer", () => {
    for (const e of allExplainers()) {
      expect(e.whatItShows.length, `${e.id}.whatItShows is too thin`).toBeGreaterThan(40);
      expect(e.method.length, `${e.id}.method is too thin`).toBeGreaterThan(25);
      expect(e.coverage.length, `${e.id}.coverage is too thin`).toBeGreaterThan(5);
    }
  });

  it("gives every confidence level a human label", () => {
    for (const e of allExplainers()) expect(confidenceLabel(e.confidence).length).toBeGreaterThan(5);
  });
});

describe("the caveats we most need to be right about", () => {
  // Each of these is a real misreading we would otherwise invite. If someone
  // softens one of these entries, this test should stop them.
  it("warns that the NHC cyclone layer is not global", () => {
    const e = explainerFor("tropical-cyclones")!;
    expect(e.coverage).toMatch(/Atlantic|Eastern Pacific/i);
    expect(e.limitations.join(" ")).toMatch(/typhoon|Western Pacific/i);
  });

  it("warns that FIRMS detects heat rather than fire", () => {
    expect(explainerFor("fire-active")!.limitations.join(" ")).toMatch(/heat, not fire/i);
  });

  it("warns that the GDELT layers measure coverage rather than events", () => {
    for (const id of ["conflict", "protests"]) {
      expect(explainerFor(id)!.limitations.join(" ")).toMatch(/media attention|attention, not events/i);
    }
  });

  it("warns that AIS is a sample and that the interesting ships switch it off", () => {
    const l = explainerFor("ais")!.limitations.join(" ");
    expect(l).toMatch(/sample/i);
    expect(l).toMatch(/switched off|spoofed/i);
  });

  it("warns that UK crime is UK-only and monthly, not live", () => {
    const e = explainerFor("crime")!;
    expect(e.coverage).toMatch(/England|UK|Wales/i);
    expect(e.limitations.join(" ")).toMatch(/monthly/i);
  });

  // ACLED was removed on 2026-09-05. Two explainers kept talking about it as if it were
  // still in the app: the instability card blamed "ACLED dormant" for a missing conflict
  // factor (conflict comes from GDELT now), and the conflict card sent readers to "the
  // ACLED layer", which does not exist. A trust card that points at a missing source is
  // the same hole this file exists to close.
  it("never describes a removed source as present or dormant", () => {
    for (const e of allExplainers()) {
      const text = [e.whatItShows, e.method, e.coverage, ...e.limitations].join(" ");
      expect(text, `${e.id} still points at ACLED as part of the app`).not.toMatch(/ACLED (layer|dormant)|with ACLED/i);
    }
  });

  it("states the instability ceiling the formula actually allows", () => {
    // Every input at its maximum: the conflict ramp is hard-capped, so this is the top.
    const [top] = computeInstability([
      { iso3: "SYR", factors: { conflict: 1e9, food: 1, displacement: 1e9, outages: 1e9 } },
    ]);
    const ceiling = top!.props?.score as number;
    expect(explainerFor("instability")!.limitations.join(" ")).toContain(`${ceiling}`);
  });

  it("admits the instability index is ours and is not validated", () => {
    const e = explainerFor("instability")!;
    expect(e.confidence).toBe("derived");
    expect(e.limitations.join(" ")).toMatch(/not an established index|has not been validated/i);
  });

  it("admits ransomware leak sites are a biased sample published by the attackers", () => {
    const l = explainerFor("cyber-ransomware")!.limitations.join(" ");
    expect(l).toMatch(/attackers' claim|self-published/i);
    expect(l).toMatch(/biased sample|did NOT pay/i);
  });
});
