import { describe, it, expect } from "vitest";
import {
  CROSS_INSTANCE_CAVEAT,
  describeEvidenceScope,
  emptyEvidence,
  hasAnyEvidence,
  type UpstreamEvidence,
} from "@/lib/sources/upstreamEvidence";

const NOW = 1_700_000_000_000;

// ===========================================================================
// The workstream this test file covers: the upstream-evidence ledger cannot be
// shared across serverless instances in production (verified 2026-08-11 — a
// forced ACLED fetch's 403 never showed up on the very next /api/status hit).
// Real cross-instance persistence via unstable_cache was investigated and
// rejected (no write/merge primitive on Next's Data Cache; forcing one would
// let a less-informed instance silently erase a real refusal). So instead: the
// gap must be impossible to misread. These tests hold that promise to the pure
// functions that make it so.
// ===========================================================================

describe("hasAnyEvidence", () => {
  it("is false for a snapshot with no entries at all", () => {
    expect(hasAnyEvidence({})).toBe(false);
  });

  it("is true the instant any capability has a record, even an all-null one", () => {
    // emptyEvidence() is what LEDGER.get(id) starts as the first time anything
    // touches an id — every field null, but the KEY existing is itself a fact.
    expect(hasAnyEvidence({ acled: emptyEvidence() })).toBe(true);
  });
});

describe("describeEvidenceScope", () => {
  it("says nothing was observed when the snapshot is empty — the prod-reproduced case", () => {
    const scope = describeEvidenceScope({}, NOW - 5_000, NOW);
    expect(scope.scope).toBe("process");
    expect(scope.anyEvidence).toBe(false);
    expect(scope.capabilitiesObserved).toBe(0);
    expect(scope.observingSinceMs).toBe(NOW - 5_000);
    expect(scope.ageMs).toBe(5_000);
  });

  it("reports zero age and a null window when nothing has been instrumented yet", () => {
    const scope = describeEvidenceScope({}, null, NOW);
    expect(scope.observingSinceMs).toBeNull();
    expect(scope.ageMs).toBeNull();
  });

  it("counts capabilities observed and flips anyEvidence once something is recorded", () => {
    const snapshot: Record<string, UpstreamEvidence> = {
      acled: { ...emptyEvidence(), lastRefusalAt: NOW - 1_000, lastRefusalStatus: 403 },
      ais: emptyEvidence(),
    };
    const scope = describeEvidenceScope(snapshot, NOW - 10_000, NOW);
    expect(scope.anyEvidence).toBe(true);
    expect(scope.capabilitiesObserved).toBe(2);
  });

  it("never lets the age go negative on a clock that stepped backwards", () => {
    const scope = describeEvidenceScope({}, NOW + 1_000, NOW);
    expect(scope.ageMs).toBe(0);
  });

  it("carries the fixed caveat text verbatim, so a raw curl reader sees the warning without reading code", () => {
    const scope = describeEvidenceScope({}, null, NOW);
    expect(scope.caveat).toBe(CROSS_INSTANCE_CAVEAT);
    // The two facts a reader must not conflate: "not shared across instances"
    // and "configured != checked and works".
    expect(scope.caveat).toContain("NOT shared across instances");
    expect(scope.caveat).toContain("never 'this credential was checked and works'");
  });

  it("is a pure function of its inputs — same args, same output, every time", () => {
    const snapshot: Record<string, UpstreamEvidence> = {
      acled: { ...emptyEvidence(), lastRefusalAt: NOW - 1_000, lastRefusalStatus: 403 },
    };
    const a = describeEvidenceScope(snapshot, NOW - 10_000, NOW);
    const b = describeEvidenceScope(snapshot, NOW - 10_000, NOW);
    expect(a).toEqual(b);
  });
});
