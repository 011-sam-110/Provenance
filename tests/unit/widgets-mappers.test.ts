import { describe, it, expect } from "vitest";
import type { SignalFeature } from "@/lib/signals/types";
import { buildSignalObject } from "@/lib/widgets/signalObject";
import { instabilityRows } from "@/lib/widgets/instability";
import { conflictView } from "@/lib/widgets/conflict";
import { topEventsRows } from "@/lib/widgets/topEvents";
import { riskSummary, riskLevel } from "@/lib/widgets/risk";

const sf = (over: Partial<SignalFeature>): SignalFeature => ({
  id: "x", lat: 1, lon: 2, title: "T", signalId: "s", ...over,
});

describe("buildSignalObject", () => {
  it("maps a SignalFeature into a clickable signal WorldObject", () => {
    const o = buildSignalObject(sf({ id: "cii:UKR", title: "Ukraine", color: "#dc2626", props: { score: 90 } }), "CII");
    expect(o.kind).toBe("signal");
    expect(o.id).toBe("cii:UKR");
    expect(o.label).toBe("Ukraine");
    expect(o.typeLabel).toBe("CII");
    expect((o.meta?.props as { score?: number })?.score).toBe(90);
  });
});

describe("instabilityRows", () => {
  it("ranks by score desc and caps", () => {
    const rows = instabilityRows([
      sf({ id: "a", props: { country: "A", score: 40 } }),
      sf({ id: "b", props: { country: "B", score: 90 } }),
      sf({ id: "c", props: { country: "C", score: 70 } }),
    ], 2);
    expect(rows.map((r) => r.country)).toEqual(["B", "C"]);
    expect(rows[0].score).toBe(90);
  });
  it("drops features without a numeric score", () => {
    expect(instabilityRows([sf({ props: {} })])).toEqual([]);
  });
});

describe("conflictView", () => {
  it("prefers ACLED and sorts by fatalities", () => {
    const v = conflictView(
      [sf({ id: "a", props: { eventType: "Battles", country: "X", fatalities: 3 } }),
       sf({ id: "b", props: { eventType: "Riots", country: "Y", fatalities: 9 } })],
      [],
    );
    expect(v.mode).toBe("acled");
    expect(v.rows[0].metric).toBe(9);
  });
  it("falls back to GDELT when ACLED is empty", () => {
    const v = conflictView([], [sf({ id: "g", props: { place: "Z", articles: 12 } })]);
    expect(v.mode).toBe("gdelt");
    expect(v.rows[0].title).toBe("Z");
  });
  it("returns none when both are empty", () => {
    expect(conflictView([], []).mode).toBe("none");
  });
  it("lists the deadliest UCDP events from the conflict layer, ignoring warnings", () => {
    const v = conflictView([], [
      sf({ id: "u1", props: { source: "UCDP", sides: "A - B", country: "X", date: "2026-08-01", deaths: 4 } }),
      sf({ id: "u2", props: { source: "UCDP", sides: "C - D", country: "Y", date: "2026-08-02", deaths: 40 } }),
      sf({ id: "w", props: { source: "U.S. Embassy alert" } }),
    ]);
    expect(v.mode).toBe("ucdp");
    expect(v.rows.map((r) => r.id)).toEqual(["u2", "u1"]);
    expect(v.rows[0]!.sub).toBe("Y · 2026-08-02");
  });
});

describe("topEventsRows", () => {
  it("merges groups, sorts by severity then recency, caps", () => {
    const rows = topEventsRows([
      { kind: "Quake", features: [sf({ id: "q1", props: { magnitude: 5 }, ts: "2026-06-27T00:00:00Z" })] },
      { kind: "Fire", features: [sf({ id: "f1", props: { magnitude: 8 }, ts: "2026-06-26T00:00:00Z" })] },
      { kind: "Quake", features: [sf({ id: "q2", props: { magnitude: 8 }, ts: "2026-06-27T00:00:00Z" })] },
    ], 2);
    expect(rows.map((r) => r.id)).toEqual(["q2", "f1"]); // sev 8 newer first, then sev 8 older
    expect(rows[0].kind).toBe("Quake");
  });
});

describe("riskSummary", () => {
  it("averages the top-N scores and levels them", () => {
    const s = riskSummary([
      sf({ props: { score: 90 } }), sf({ props: { score: 70 } }), sf({ props: { score: 50 } }),
    ], 2);
    expect(s.score).toBe(80); // mean of 90, 70
    expect(s.level).toBe("Severe");
    expect(s.count).toBe(3);
  });
  it("is 0 / Low for empty input", () => {
    expect(riskSummary([])).toEqual({ score: 0, level: "Low", count: 0 });
  });
  it("levels thresholds", () => {
    expect(riskLevel(29)).toBe("Low");
    expect(riskLevel(30)).toBe("Elevated");
    expect(riskLevel(50)).toBe("High");
    expect(riskLevel(70)).toBe("Severe");
  });
});
