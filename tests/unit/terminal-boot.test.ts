// The launch sequence is a five-second animation, which is exactly the kind of
// thing that rots silently: a beat pushed past the dissolve renders for zero
// frames, and nobody notices because the sequence still "works". These assert the
// timeline's shape rather than its taste — that it fits inside BOOT_MS, that every
// beat is reachable, and that the two live figures on the plate come from the
// caller's registries rather than from a literal typed in this repo.

import { describe, expect, it } from "vitest";
import {
  BOOT_FADE_MS,
  BOOT_MIN_MS,
  BOOT_MS,
  BOOT_READY_HOLD_MS,
  BOOT_REDUCED_MS,
  BOOT_STAGES,
  BOOT_VERSION,
  MARK_ASSEMBLE_MS,
  bootEndMs,
  bootOverrideFromSearch,
  bootTimeline,
  checksAt,
  shouldPlayBoot,
  stageAt,
  stageIndex,
  timelineScale,
} from "@/lib/terminal/boot";

const COUNTS = { layers: 35, feeds: 11 };
const beats = bootTimeline(COUNTS, BOOT_MS);

/** Every total the sequence can actually run at, so no assertion below is only true
 *  of the speed that happened to be the default when it was written. */
const TOTALS = [BOOT_MIN_MS, 3200, 4000, BOOT_MS];

describe("boot timeline", () => {
  it("runs between the floor and the ceiling", () => {
    expect(BOOT_MS).toBe(5000);
    expect(BOOT_MIN_MS).toBe(2600);
    expect(BOOT_MIN_MS).toBeLessThan(BOOT_MS);
    expect(BOOT_FADE_MS + BOOT_READY_HOLD_MS).toBeLessThan(BOOT_MIN_MS);
    expect(BOOT_REDUCED_MS).toBeLessThan(1000);
  });

  it("is unchanged at the ceiling — the source table IS a five-second boot", () => {
    // The scale is 1 at BOOT_MS by arithmetic, not by a special case: the offsets
    // already reserve exactly the fade and the read-time. If someone edits an offset
    // without moving the others this goes red, which is the point.
    expect(timelineScale(BOOT_MS)).toBe(1);
    expect(beats.map((b) => b.at)).toEqual([0, 240, 1460, 2000, 2260, 2520, 2780, 3040, 3300, 3620, 4180]);
  });

  it("never plays slower than designed, however long the total", () => {
    expect(timelineScale(BOOT_MS * 2)).toBe(1);
  });

  it("starts at zero and never goes backwards, at every speed", () => {
    for (const total of TOTALS) {
      const b = bootTimeline(COUNTS, total);
      expect(b[0].at).toBe(0);
      expect(b[0].stage).toBe("power");
      for (let i = 1; i < b.length; i++) {
        expect(b[i].at).toBeGreaterThan(b[i - 1].at);
      }
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

  it("leaves the whole dissolve inside its total, at every speed", () => {
    // The handoff starts BOOT_FADE_MS before the end. A beat at or after that point
    // would be painted for zero frames — and compressing the sequence is exactly how
    // that would happen without anyone seeing it.
    for (const total of TOTALS) {
      const b = bootTimeline(COUNTS, total);
      expect(b[b.length - 1].at).toBeLessThan(total - BOOT_FADE_MS);
    }
  });

  it("gives the last beat time to be read, at every speed", () => {
    for (const total of TOTALS) {
      const b = bootTimeline(COUNTS, total);
      const gap = total - BOOT_FADE_MS - b[b.length - 1].at;
      expect(gap).toBeGreaterThanOrEqual(BOOT_READY_HOLD_MS - 1); // -1 absorbs rounding
    }
  });

  it("never resolves the identity before the mark has finished drawing", () => {
    // The one relationship that spans this file and app/globals.css. `identify`
    // switches the mark from `playing` to `idle`, so landing it early snaps a
    // half-drawn logo to its finished state. It holds at every speed only because
    // the mark's CSS is scaled by the same factor — see MARK_ASSEMBLE_MS.
    for (const total of TOTALS) {
      const b = bootTimeline(COUNTS, total);
      const scale = timelineScale(total);
      const assemble = b.find((x) => x.stage === "assemble")!;
      const identify = b.find((x) => x.stage === "identify")!;
      expect(identify.at).toBeGreaterThanOrEqual(assemble.at + MARK_ASSEMBLE_MS * scale);
    }
  });
});

describe("bootEndMs", () => {
  it("waits out the ceiling when the map never reports", () => {
    // The safe direction. No WebGL, a context that never comes up, a page with no
    // map: all must behave exactly as the boot did before it learned to listen.
    expect(bootEndMs({ mapIdleMs: null })).toBe(BOOT_MS);
    expect(bootEndMs({ mapIdleMs: NaN })).toBe(BOOT_MS);
  });

  it("ends when the map is ready, once the sequence has played", () => {
    expect(bootEndMs({ mapIdleMs: 3400 })).toBe(3400);
  });

  it("never cuts the sequence short for a fast map", () => {
    expect(bootEndMs({ mapIdleMs: 900 })).toBe(BOOT_MIN_MS);
    expect(bootEndMs({ mapIdleMs: 0 })).toBe(BOOT_MIN_MS);
    // A map that reported before the boot even mounted reads as negative here.
    expect(bootEndMs({ mapIdleMs: -200 })).toBe(BOOT_MIN_MS);
  });

  it("never holds the plate longer than it used to, for a slow map", () => {
    expect(bootEndMs({ mapIdleMs: 26_000 })).toBe(BOOT_MS);
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
