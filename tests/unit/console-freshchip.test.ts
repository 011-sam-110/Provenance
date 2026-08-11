import { describe, it, expect } from "vitest";
import {
  classifyObservation,
  chipLabel,
  chipTitle,
  formatAgeShort,
  freshAgeMs,
  freshChipView,
  isPartial,
  observeCoreSource,
  observeSignalSource,
  type FreshObservation,
} from "@/lib/console/freshChip";

const NOW = 1_700_000_000_000;
const obs = (o: Partial<FreshObservation>): FreshObservation => ({
  lastOk: NOW,
  ok: true,
  count: 10,
  refreshMs: 60_000,
  ...o,
});

describe("classifyObservation", () => {
  it("is unknown with no observation at all", () => {
    expect(classifyObservation(null, NOW)).toBe("unknown");
    expect(classifyObservation(undefined, NOW)).toBe("unknown");
  });

  it("is unknown before the first success", () => {
    expect(classifyObservation(obs({ lastOk: null }), NOW)).toBe("unknown");
  });

  it("is live inside two cadences", () => {
    expect(classifyObservation(obs({ lastOk: NOW - 119_000 }), NOW)).toBe("live");
  });

  // The whole point of the change: a frozen upstream must stop saying "live".
  it("is lagging past two cadences and stale past six", () => {
    expect(classifyObservation(obs({ lastOk: NOW - 120_000 }), NOW)).toBe("lagging");
    expect(classifyObservation(obs({ lastOk: NOW - 359_000 }), NOW)).toBe("lagging");
    expect(classifyObservation(obs({ lastOk: NOW - 360_000 }), NOW)).toBe("stale");
    expect(classifyObservation(obs({ lastOk: NOW - 86_400_000 }), NOW)).toBe("stale");
  });

  it("judges each feed against its own cadence, not a global one", () => {
    // 40s old: stale for a 5s feed, live for a 5-minute one.
    expect(classifyObservation(obs({ lastOk: NOW - 40_000, refreshMs: 5_000 }), NOW)).toBe("stale");
    expect(classifyObservation(obs({ lastOk: NOW - 40_000, refreshMs: 300_000 }), NOW)).toBe("live");
  });

  it("reports a failed last attempt as down at any age", () => {
    expect(classifyObservation(obs({ ok: false }), NOW)).toBe("down");
    expect(classifyObservation(obs({ ok: false, lastOk: null }), NOW)).toBe("down");
  });

  it("treats a fetched-fine-but-zero feed as empty, not down and not live", () => {
    expect(classifyObservation(obs({ count: 0 }), NOW)).toBe("empty");
  });

  // A feed that stopped answering hours ago must not be excused as "quiet".
  it("prefers stale over empty when the data is old AND zero", () => {
    expect(classifyObservation(obs({ count: 0, lastOk: NOW - 3_600_000 }), NOW)).toBe("stale");
  });

  it("never ages a locally-computed layer", () => {
    expect(classifyObservation(obs({ local: true, lastOk: NOW - 86_400_000 }), NOW)).toBe("live");
    expect(classifyObservation(obs({ local: true, count: 0 }), NOW)).toBe("empty");
  });

  it("separates dormant (no key) from down (broken)", () => {
    expect(classifyObservation(obs({ dormant: true, ok: false, lastOk: null }), NOW)).toBe("off");
  });

  // Round 4 folded a refused credential into "down" — directionally right (the
  // fetch did fail) but wrong in substance: the upstream answered promptly and
  // said no, it did not go dark. `refused` must be its own state, reachable even
  // though `ok` is false (a refusal usually fails the underlying fetch too), and
  // must stay distinct from `dormant` (no credential held at all).
  it("separates refused (credential rejected) from down (broken) and from dormant (no key)", () => {
    expect(classifyObservation(obs({ refused: true, ok: false, lastOk: null }), NOW)).toBe("refused");
    // A refusal against otherwise-fine-looking data (ok: true, real lastOk) must
    // still surface — "refused" is not only reachable via a failed fetch.
    expect(classifyObservation(obs({ refused: true }), NOW)).toBe("refused");
    // dormant still wins if both are somehow set — "we never even tried" trumps
    // "we tried and were refused".
    expect(classifyObservation(obs({ dormant: true, refused: true, ok: false, lastOk: null }), NOW)).toBe("off");
  });

  it("does not call a countless widget empty", () => {
    expect(classifyObservation(obs({ count: undefined }), NOW)).toBe("live");
  });

  it("tolerates a clock skew that puts lastOk in the future", () => {
    expect(classifyObservation(obs({ lastOk: NOW + 10_000 }), NOW)).toBe("live");
    expect(freshAgeMs(obs({ lastOk: NOW + 10_000 }), NOW)).toBe(0);
  });
});

describe("formatAgeShort", () => {
  it("steps through seconds, minutes, hours and days", () => {
    expect(formatAgeShort(0)).toBe("0s");
    expect(formatAgeShort(59_000)).toBe("59s");
    expect(formatAgeShort(60_000)).toBe("1m");
    expect(formatAgeShort(3_600_000)).toBe("1h");
    expect(formatAgeShort(47 * 3_600_000)).toBe("47h");
    expect(formatAgeShort(72 * 3_600_000)).toBe("3d");
  });
});

describe("chipLabel", () => {
  it("leaves live bare and gives every other state its evidence", () => {
    expect(chipLabel("live", 1_000)).toBe("live");
    expect(chipLabel("lagging", 240_000)).toBe("4m old");
    expect(chipLabel("stale", 7_200_000)).toBe("stale · 2h");
    expect(chipLabel("empty", 1_000)).toBe("none now");
    expect(chipLabel("down", null)).toBe("down");
    expect(chipLabel("off", null)).toBe("dormant");
    expect(chipLabel("unknown", null)).toBe("connecting…");
    expect(chipLabel("refused", null)).toBe("refused");
  });

  it("degrades gracefully when the age is unknown", () => {
    expect(chipLabel("stale", null)).toBe("stale");
    expect(chipLabel("lagging", null)).toBe("lagging");
  });
});

describe("chipTitle", () => {
  it("carries both clocks — when we fetched, and how old the payload is", () => {
    const t = chipTitle(obs({ lastOk: NOW - 5_000, sourceAt: NOW - 3_600_000 }), NOW);
    expect(t).toContain("Last successful update 5s ago");
    expect(t).toContain("Newest item in the data is 1h old");
  });

  it("says plainly that the last attempt failed", () => {
    expect(chipTitle(obs({ ok: false }), NOW)).toContain("FAILED");
  });

  it("explains dormant as a missing key, not a fault", () => {
    const t = chipTitle(obs({ dormant: true }), NOW);
    expect(t).toContain("API key");
    expect(t).not.toContain("FAILED");
  });

  it("explains refused as an observed rejection, not a broken or non-responding upstream", () => {
    const t = chipTitle(obs({ refused: true, ok: false, lastOk: null }), NOW);
    expect(t).toContain("Refused");
    expect(t).toContain("rejected it");
    // The generic FAILED line would contradict the specific reason just given.
    expect(t).not.toContain("FAILED");
  });

  it("still reports last-good-data age and count alongside a refusal", () => {
    const t = chipTitle(obs({ refused: true, lastOk: NOW - 5_000, count: 42 }), NOW);
    expect(t).toContain("Refused");
    expect(t).toContain("Last successful update 5s ago");
    expect(t).toContain("42 rows");
  });

  it("defends the empty state in words", () => {
    expect(chipTitle(obs({ count: 0 }), NOW)).toContain("not a failure");
  });
});

describe("freshChipView", () => {
  it("bundles state, label and tooltip in one call", () => {
    const v = freshChipView(obs({ lastOk: NOW - 600_000 }), NOW);
    expect(v.kind).toBe("stale");
    expect(v.label).toBe("stale · 10m");
    expect(v.ageMs).toBe(600_000);
    expect(v.title).toContain("Expected every 1m");
  });

  it("classifies and labels a refusal distinctly from down", () => {
    const v = freshChipView(obs({ refused: true, ok: false, lastOk: null }), NOW);
    expect(v.kind).toBe("refused");
    expect(v.label).toBe("refused");
    expect(v.title).toContain("Refused");
  });
});

describe("coverage — the partial fan-out case", () => {
  it("recognises a partial outage but not a total or a clean one", () => {
    expect(isPartial(obs({ coverage: { ok: 7, total: 9 } }))).toBe(true);
    expect(isPartial(obs({ coverage: { ok: 9, total: 9 } }))).toBe(false);
    expect(isPartial(obs({ coverage: { ok: 0, total: 9 } }))).toBe(false);
    expect(isPartial(obs({}))).toBe(false);
  });

  // "live" over two of nine working sources is the most misleading thing a
  // dashboard can say: the number is real, it is just not the whole picture.
  it("puts the denominator on the chip when only some sources answered", () => {
    expect(freshChipView(obs({ coverage: { ok: 7, total: 9 } }), NOW).label).toBe("live · 7/9");
    expect(freshChipView(obs({ coverage: { ok: 9, total: 9 } }), NOW).label).toBe("live");
  });

  it("spells the shortfall out in the tooltip", () => {
    expect(chipTitle(obs({ coverage: { ok: 2, total: 9 } }), NOW)).toContain("Only 2 of 9 sources answered");
    expect(chipTitle(obs({ coverage: { ok: 9, total: 9 } }), NOW)).toContain("All 9 sources answered");
  });
});

describe("store adapters", () => {
  it("maps a core-layer record, and does not vouch for the age of a failed one", () => {
    const live = observeCoreSource({ ok: true, count: 42, lastUpdate: NOW - 1_000, refreshMs: 300_000, local: false });
    expect(classifyObservation(live, NOW)).toBe("live");
    expect(live?.count).toBe(42);

    // lastUpdate on the core store is the last ATTEMPT, so a failed one must not be
    // reported as the last success.
    const failed = observeCoreSource({ ok: false, count: 0, lastUpdate: NOW, refreshMs: 300_000, local: false });
    expect(failed?.lastOk).toBeNull();
    expect(classifyObservation(failed, NOW)).toBe("down");

    expect(observeCoreSource(undefined)).toBeUndefined();
  });

  it("returns a connecting observation for a signal layer that has never reported", () => {
    // Never return undefined here: a missing chip reads as "fine".
    const v = freshChipView(observeSignalSource(undefined, 60_000), NOW);
    expect(v.kind).toBe("unknown");
    expect(v.label).toBe("connecting…");
  });

  it("maps a signal record", () => {
    const o = observeSignalSource({ lastUpdate: NOW - 500_000, ok: true, count: 3 }, 60_000);
    expect(classifyObservation(o, NOW)).toBe("stale");
  });
});
