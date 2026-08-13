// The launch sequence is a five-second animation, which is exactly the kind of
// thing that rots silently: a beat pushed past the dissolve renders for zero
// frames, and nobody notices because the sequence still "works". These assert the
// timeline's shape rather than its taste — that it fits inside BOOT_MS, that every
// beat is reachable, and that the two live figures on the plate come from the
// caller's registries rather than from a literal typed in this repo.

import { describe, expect, it } from "vitest";
import {
  BOOT_FADE_MS,
  BOOT_MS,
  BOOT_REDUCED_MS,
  BOOT_STAGES,
  BOOT_VERSION,
  bootOverrideFromSearch,
  bootTimeline,
  checksAt,
  shouldPlayBoot,
  stageAt,
  stageIndex,
} from "@/lib/terminal/boot";

const COUNTS = { layers: 35, feeds: 11 };
const beats = bootTimeline(COUNTS);

describe("boot timeline", () => {
  it("is the ~5s sequence the design calls for", () => {
    expect(BOOT_MS).toBe(5000);
    expect(BOOT_FADE_MS).toBeLessThan(BOOT_MS);
    expect(BOOT_REDUCED_MS).toBeLessThan(1000);
  });

  it("starts at zero and never goes backwards", () => {
    expect(beats[0].at).toBe(0);
    expect(beats[0].stage).toBe("power");
    for (let i = 1; i < beats.length; i++) {
      expect(beats[i].at).toBeGreaterThan(beats[i - 1].at);
    }
  });

  it("advances through the stages in declared order", () => {
    const seen = beats.map((b) => b.stage);
    let cursor = -1;
    for (const stage of seen) {
      const idx = stageIndex(stage);
      expect(idx).toBeGreaterThanOrEqual(cursor);
      cursor = idx;
    }
    // Every stage is actually reached — a stage nobody schedules is a CSS rule
    // that can never match.
    for (const stage of BOOT_STAGES) expect(seen).toContain(stage);
  });

  it("leaves the whole dissolve inside BOOT_MS", () => {
    // The handoff starts at BOOT_MS - BOOT_FADE_MS. A beat at or after that point
    // would be painted for zero frames.
    const last = beats[beats.length - 1];
    expect(last.at).toBeLessThan(BOOT_MS - BOOT_FADE_MS);
  });

  it("gives the last beat time to be read", () => {
    const last = beats[beats.length - 1];
    expect(BOOT_MS - BOOT_FADE_MS - last.at).toBeGreaterThanOrEqual(300);
  });
});

describe("subsystem check-ins", () => {
  const checks = checksAt(beats, BOOT_MS);

  it("reports six subsystems, each once", () => {
    expect(checks).toHaveLength(6);
    expect(new Set(checks.map((c) => c.label)).size).toBe(6);
  });

  it("quotes the caller's counts and invents none of its own", () => {
    const detail = checks.map((c) => c.detail).join(" | ");
    expect(detail).toContain("35 REGISTERED");
    expect(detail).toContain("11 ADAPTERS");

    // Different counts in, different counts out: if a figure were hard-coded here
    // it would survive this substitution.
    const other = checksAt(bootTimeline({ layers: 7, feeds: 2 }), BOOT_MS)
      .map((c) => c.detail)
      .join(" | ");
    expect(other).toContain("7 REGISTERED");
    expect(other).toContain("2 ADAPTERS");
    expect(other).not.toContain("35");
    expect(other).not.toContain("11 ADAPTERS");
  });

  it("uses generic state words, never a live reading", () => {
    for (const c of checks) {
      expect(["OK", "READY", "MOUNTED", "LOCKED"]).toContain(c.state);
    }
  });
});

describe("stageAt / checksAt", () => {
  it("holds the opening stage before the second beat lands", () => {
    expect(stageAt(beats, 0)).toBe("power");
    expect(stageAt(beats, beats[1].at - 1)).toBe("power");
    expect(checksAt(beats, 0)).toEqual([]);
  });

  it("ends on the final stage with every subsystem in", () => {
    expect(stageAt(beats, BOOT_MS)).toBe("ready");
    expect(checksAt(beats, BOOT_MS)).toHaveLength(6);
  });

  it("reveals the check-ins one at a time", () => {
    const withChecks = beats.filter((b) => b.check);
    expect(checksAt(beats, withChecks[0].at)).toHaveLength(1);
    expect(checksAt(beats, withChecks[2].at)).toHaveLength(3);
  });
});

describe("once per visitor", () => {
  it("plays for someone who has never seen it", () => {
    expect(shouldPlayBoot(null)).toBe(true);
  });

  it("declines for a returning visitor", () => {
    expect(shouldPlayBoot(BOOT_VERSION)).toBe(false);
  });

  it("replays after a version bump", () => {
    expect(shouldPlayBoot(BOOT_VERSION - 1)).toBe(true);
  });

  it("lets ?boot= override the flag in both directions", () => {
    expect(shouldPlayBoot(BOOT_VERSION, "force")).toBe(true);
    expect(shouldPlayBoot(null, "skip")).toBe(false);
  });
});

describe("bootOverrideFromSearch", () => {
  it("reads the replay and decline forms", () => {
    expect(bootOverrideFromSearch("?boot=1")).toBe("force");
    expect(bootOverrideFromSearch("?boot=replay")).toBe("force");
    expect(bootOverrideFromSearch("?boot=ON")).toBe("force");
    expect(bootOverrideFromSearch("?boot=0")).toBe("skip");
    expect(bootOverrideFromSearch("?boot=off")).toBe("skip");
  });

  it("is null for absent, empty and unrecognised values", () => {
    expect(bootOverrideFromSearch("")).toBeNull();
    expect(bootOverrideFromSearch("?c=abc")).toBeNull();
    expect(bootOverrideFromSearch("?boot=maybe")).toBeNull();
  });
});
