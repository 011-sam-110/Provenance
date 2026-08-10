import { describe, it, expect } from "vitest";
import { distribution, timeModel, sortFeatures, relativeAge, filterDetailFeatures, detailKpis } from "@/lib/console/signals/signalDetail";
import type { SignalFeature, SignalMetric } from "@/lib/signals/types";
import type { CountSample } from "@/lib/widgets/history";

const f = (over: Partial<SignalFeature>): SignalFeature =>
  ({ id: "x", lat: 0, lon: 0, title: "t", signalId: "s", ...over });

describe("distribution", () => {
  it("uses a magnitude histogram when numeric magnitudes exist", () => {
    const d = distribution([f({ props: { magnitude: 2 } }), f({ props: { magnitude: 6 } })]);
    expect(d.kind).toBe("magnitude");
    expect(d.bins.reduce((n, b) => n + b.count, 0)).toBe(2);
  });
  it("falls back to declared severity when no magnitudes", () => {
    const d = distribution([f({ props: { alertLevel: "Red" } }), f({ props: { severity: "warning" } })]);
    expect(d.kind).toBe("severity");
    expect(d.bins.find((b) => b.label === "Severe")!.count).toBe(1);
  });
  it("is 'none' when neither magnitude nor severity exists (honest hide)", () => {
    expect(distribution([f({ props: { note: "hi" } })]).kind).toBe("none");
  });
  it("gives the top INTEGER magnitude its own bucket (off-by-one guard)", () => {
    // [5,6] must render as two bars (5→1, 6→1), not one "5: 2" that swallows the max.
    const d = distribution([f({ props: { magnitude: 5 } }), f({ props: { magnitude: 6 } })]);
    expect(d.kind).toBe("magnitude");
    expect(d.bins.find((b) => b.label === "5")?.count).toBe(1);
    expect(d.bins.find((b) => b.label === "6")?.count).toBe(1);
    expect(d.bins.reduce((n, b) => n + b.count, 0)).toBe(2);
  });
});

describe("timeModel", () => {
  it("splits dated from undated", () => {
    const m = timeModel([f({ ts: "2026-07-08T00:00:00Z" }), f({})]);
    expect(m.values.length).toBe(1);
    expect(m.undated).toBe(1);
  });
});

describe("sortFeatures", () => {
  it("sorts by magnitude descending with dir -1", () => {
    const out = sortFeatures([f({ id: "a", props: { magnitude: 1 } }), f({ id: "b", props: { magnitude: 9 } })], "magnitude", -1);
    expect(out[0].id).toBe("b");
  });
  it("ranks metric-only sources (no props.magnitude) by the resolved metric value", () => {
    const metric: SignalMetric = { field: "score", domain: [0, 100] };
    const out = sortFeatures(
      [f({ id: "a", props: { score: 10 } }), f({ id: "b", props: { score: 80 } })],
      "magnitude", -1, metric,
    );
    expect(out[0].id).toBe("b");
  });
  it("with a metric, the metric wins over an overloaded props.magnitude proxy", () => {
    // instability-shaped: score is the real scalar, magnitude is a rescaled radius proxy.
    const metric: SignalMetric = { field: "score", domain: [0, 100] };
    const out = sortFeatures(
      [f({ id: "a", props: { score: 90, magnitude: 9 } }), f({ id: "b", props: { score: 20, magnitude: 2 } })],
      "magnitude", -1, metric,
    );
    expect(out[0].id).toBe("a");
  });
});

describe("relativeAge", () => {
  const now = Date.parse("2026-07-10T12:00:00Z");
  it("returns '' for undated or unparseable timestamps", () => {
    expect(relativeAge(undefined, now)).toBe("");
    expect(relativeAge("not-a-date", now)).toBe("");
  });
  it("formats seconds / minutes / hours / days", () => {
    expect(relativeAge("2026-07-10T11:59:48Z", now)).toBe("12s");
    expect(relativeAge("2026-07-10T11:55:00Z", now)).toBe("5m");
    expect(relativeAge("2026-07-10T10:00:00Z", now)).toBe("2h");
    expect(relativeAge("2026-07-07T12:00:00Z", now)).toBe("3d");
  });
  // Future stamps used to clamp to "0s", which is why every rocket launch in the
  // schedule read "· 0s" whether it was tomorrow or in three months. A forward-
  // looking layer needs the sign shown, not hidden.
  it("counts DOWN to a future timestamp instead of clamping it to 0s", () => {
    expect(relativeAge("2026-07-10T12:00:30Z", now)).toBe("in 30s");
    expect(relativeAge("2026-07-10T16:00:00Z", now)).toBe("in 4h");
    expect(relativeAge("2026-07-13T12:00:00Z", now)).toBe("in 3d");
  });
});

describe("filterDetailFeatures", () => {
  const feats = [
    f({ id: "a", title: "Tokyo quake", props: { magnitude: 6 } }),
    f({ id: "b", title: "Osaka quake", props: { magnitude: 3 } }),
    f({ id: "c", title: "Kyoto note", props: {} }),
  ];
  it("filters by case-insensitive title substring", () => {
    const out = filterDetailFeatures(feats, { query: "OSAKA", min: 0 });
    expect(out.map((x) => x.id)).toEqual(["b"]);
  });
  it("filters by min value and drops valueless features when min > 0", () => {
    const out = filterDetailFeatures(feats, { query: "", min: 5 });
    expect(out.map((x) => x.id)).toEqual(["a"]);
  });
  it("min 0 lets everything through (incl. valueless)", () => {
    expect(filterDetailFeatures(feats, { query: "", min: 0 }).length).toBe(3);
  });
  it("uses the declared metric for the min threshold", () => {
    const metric: SignalMetric = { field: "score", domain: [0, 100] };
    const scored = [f({ id: "a", props: { score: 80 } }), f({ id: "b", props: { score: 20 } })];
    const out = filterDetailFeatures(scored, { query: "", min: 50 }, metric);
    expect(out.map((x) => x.id)).toEqual(["a"]);
  });
});

describe("detailKpis", () => {
  const samples: CountSample[] = [
    { t: Date.parse("2026-07-10T00:00:00Z"), n: 10 },
    { t: Date.parse("2026-07-10T12:00:00Z"), n: 15 },
  ];
  it("reports in-view count and the peak value + label", () => {
    const k = detailKpis([f({ props: { magnitude: 4 } }), f({ props: { magnitude: 6.2 } })], samples);
    expect(k.inView).toBe(2);
    expect(k.peak).toEqual({ value: 6.2, label: "6.2" });
  });
  it("computes a signed 24h percent change from the series", () => {
    expect(detailKpis([], samples).change24h).toBe("+50%");
  });
  it("returns '—' change and null peak when uncomputable", () => {
    const k = detailKpis([f({ props: {} })], [{ t: 1, n: 5 }]);
    expect(k.change24h).toBe("—");
    expect(k.peak).toBeNull();
  });
  it("peak uses the declared metric label (with unit) when present", () => {
    const metric: SignalMetric = { field: "wind", domain: [0, 120], unit: "kt" };
    const k = detailKpis([f({ props: { wind: 88 } }), f({ props: { wind: 40 } })], samples, metric);
    expect(k.peak).toEqual({ value: 88, label: "88kt" });
  });
});
