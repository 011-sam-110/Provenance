import { describe, it, expect } from "vitest";
import type { SignalFeature, SignalMetric } from "@/lib/signals/types";
import { projectSignal, rowMetric } from "@/lib/console/signals/signalCard";
import { WORLD_SCOPE, type Scope } from "@/lib/shell/scope";

const sf = (over: Partial<SignalFeature>): SignalFeature => ({
  id: "x", lat: 1, lon: 2, title: "T", signalId: "s", ...over,
});

describe("projectSignal", () => {
  it("ranks by magnitude desc when any feature carries one", () => {
    const r = projectSignal([
      sf({ id: "a", props: { magnitude: 4 } }),
      sf({ id: "b", props: { magnitude: 7 } }),
      sf({ id: "c", props: { magnitude: 5 } }),
    ], WORLD_SCOPE, {});
    expect(r.rows.map((x) => x.id)).toEqual(["b", "c", "a"]);
  });

  it("ranks by recency desc when no feature has a magnitude (undated last)", () => {
    const r = projectSignal([
      sf({ id: "old", ts: "2026-06-20T00:00:00Z" }),
      sf({ id: "new", ts: "2026-06-28T00:00:00Z" }),
      sf({ id: "undated" }),
    ], WORLD_SCOPE, {});
    expect(r.rows.map((x) => x.id)).toEqual(["new", "old", "undated"]);
  });

  it("puts scheduled (future-dated) rows first, soonest first, ahead of past rows", () => {
    // Launch Library 2 stamps ts with the launch time, so a recency-desc sort put the
    // FURTHEST launch at the top of the card (prod, 2026-09-12: 24 Nov above 13 Sep).
    const now = Date.parse("2026-09-13T12:00:00Z");
    const r = projectSignal([
      sf({ id: "nov", ts: "2026-11-24T00:00:00Z" }),
      sf({ id: "sep15", ts: "2026-09-15T01:21:07Z" }),
      sf({ id: "sep13", ts: "2026-09-13T18:49:00Z" }),
      sf({ id: "launchedYesterday", ts: "2026-09-12T10:00:00Z" }),
      sf({ id: "launchedLastWeek", ts: "2026-09-06T10:00:00Z" }),
      sf({ id: "undated" }),
    ], WORLD_SCOPE, { now });
    expect(r.rows.map((x) => x.id)).toEqual([
      "sep13", "sep15", "nov", "launchedYesterday", "launchedLastWeek", "undated",
    ]);
  });

  it("trims to the active scope and reports total vs shown", () => {
    const near: Scope = { mode: "region", center: { lat: 51.5, lon: -0.12 }, radiusKm: 50, label: "London" };
    const r = projectSignal([
      sf({ id: "in", lat: 51.51, lon: -0.13 }),
      sf({ id: "out", lat: 35, lon: 139 }),
    ], near, {});
    expect(r.rows.map((x) => x.id)).toEqual(["in"]);
    expect(r.total).toBe(2);
    expect(r.shown).toBe(1);
  });

  it("emits no alerts by default for a plain feed", () => {
    const r = projectSignal([
      sf({ id: "a", props: { magnitude: 9 } }),
    ], WORLD_SCOPE, {});
    expect(r.alerts).toEqual([]);
  });

  it("alerts on magnitude at/above alertMin, escalating to critical", () => {
    const r = projectSignal([
      sf({ id: "lo", title: "Quake A", props: { magnitude: 4 } }),
      sf({ id: "mid", title: "Quake B", props: { magnitude: 5.5 } }),
      sf({ id: "big", title: "Quake C", props: { magnitude: 8 } }),
    ], WORLD_SCOPE, { alertMin: 5 });
    const byRef = Object.fromEntries(r.alerts.map((a) => [a.ref, a.severity]));
    expect(byRef.lo).toBeUndefined();          // below floor
    expect(byRef.mid).toBe("warn");            // >= 5, < 7
    expect(byRef.big).toBe("critical");        // >= alertMin + 2
    expect(r.alerts[0].ref).toBe("big");       // critical sorts first
  });

  it("surfaces declared-severe features via alert-level props", () => {
    const r = projectSignal([
      sf({ id: "red", title: "GDACS storm", props: { alertlevel: "Red" } }),
      sf({ id: "green", title: "GDACS calm", props: { alertlevel: "Green" } }),
    ], WORLD_SCOPE, {});
    expect(r.alerts.map((a) => a.ref)).toEqual(["red"]);
    expect(r.alerts[0].severity).toBe("critical");
  });

  it("collapses a feature that trips both magnitude and prop severity into one alert", () => {
    const r = projectSignal([
      sf({ id: "dup", title: "Big severe", props: { magnitude: 9, severity: "extreme" } }),
    ], WORLD_SCOPE, { alertMin: 5 });
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0].ref).toBe("dup");
    expect(r.alerts[0].severity).toBe("critical");
  });

  it("caps rows at the configured limit", () => {
    const many = Array.from({ length: 80 }, (_, i) => sf({ id: `q${i}`, props: { magnitude: i } }));
    const r = projectSignal(many, WORLD_SCOPE, { limit: 10 });
    expect(r.rows).toHaveLength(10);
    expect(r.shown).toBe(80);
    expect(r.rows[0].magnitude).toBe(79); // highest first
  });

  it("threads feature colour and a resolved metric onto rows", () => {
    const metric: SignalMetric = { field: "magnitude", domain: [2, 8] };
    const r = projectSignal([
      sf({ id: "q", title: "M5.8", color: "#dc2626", props: { magnitude: 5.8 } }),
    ], WORLD_SCOPE, {}, metric);
    expect(r.rows[0].color).toBe("#dc2626");
    expect(r.rows[0].metric).toEqual({ value: 5.8, domain: [2, 8], label: "5.8" });
  });

  it("leaves metric undefined when the source declares none (dot fallback)", () => {
    const r = projectSignal([sf({ id: "a", color: "#16a34a", props: { magnitude: 3 } })], WORLD_SCOPE, {});
    expect(r.rows[0].color).toBe("#16a34a");
    expect(r.rows[0].metric).toBeUndefined();
  });
});

describe("rowMetric", () => {
  const m = (over: Partial<SignalMetric> = {}): SignalMetric => ({ field: "magnitude", domain: [2, 8], ...over });

  it("reads the DECLARED field, not the overloaded radius proxy", () => {
    // instability's props.magnitude is a score/10 proxy; the metric names `score`.
    const f = sf({ props: { magnitude: 8.8, score: 88 } });
    expect(rowMetric(f, m({ field: "score", domain: [0, 100] }))).toEqual({ value: 88, domain: [0, 100], label: "88" });
  });

  it("formats integers bare and non-integers to one decimal, with an optional unit", () => {
    expect(rowMetric(sf({ props: { magnitude: 6 } }), m())!.label).toBe("6");
    expect(rowMetric(sf({ props: { magnitude: 5.83 } }), m())!.label).toBe("5.8");
    expect(rowMetric(sf({ props: { maxWindKt: 120 } }), m({ field: "maxWindKt", unit: "kt" }))!.label).toBe("120kt");
  });

  it("returns undefined for no metric, missing field, or a non-finite value", () => {
    expect(rowMetric(sf({ props: { magnitude: 5 } }), undefined)).toBeUndefined();
    expect(rowMetric(sf({ props: {} }), m())).toBeUndefined();
    expect(rowMetric(sf({ props: { magnitude: Number.NaN } }), m())).toBeUndefined();
  });
});
