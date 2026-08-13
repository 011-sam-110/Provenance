// tests/unit/signal-row-label.test.ts
//
// Every string asserted here was READ OFF THE RUNNING APP, not invented. They are
// the rows six independent reviewers flagged: the value column repeats what the
// title already says, so the first characters of every row carry no information,
// and in the weather case the two copies disagree with each other.

import { describe, expect, it } from "vitest";
import { rowLabel, rowMetric } from "@/lib/console/signals/signalCard";
import type { SignalFeature } from "@/lib/signals/types";

const m = (value: number, label: string) => ({ value, domain: [0, 100] as [number, number], label });

describe("rowLabel — the real rows", () => {
  it("drops the leading magnitude stanza from a USGS quake", () => {
    // Chip reads "5.5"; the title said it again, first thing.
    expect(rowLabel("M 5.5 — 69 km SSW of Chirilagua, El Salvador", m(5.5, "5.5")))
      .toBe("69 km SSW of Chirilagua, El Salvador");
  });

  it("drops the restated AQI and keeps the category", () => {
    // The parenthesis stays. Unwrapping it would be a second, unrelated edit to
    // the adapter's wording, and "London — (Moderate)" already reads fine once
    // the number is not said twice.
    expect(rowLabel("London — AQI 55 (Moderate)", m(55, "55 AQI")))
      .toBe("London — (Moderate)");
  });

  it("drops the ROUNDED temperature, which is not the metric's own value", () => {
    // The chip carries 31.5; the title carried Math.round(31.5) = 32. Matching only
    // the raw value would leave the disagreement on screen, which is the whole
    // reason this row was reported.
    expect(rowLabel("London — 32°C ☀ Clear", m(31.5, "31.5 °C")))
      .toBe("London — ☀ Clear");
  });

  it("drops the grouped displacement count and the word that was its unit", () => {
    // "displaced" goes with the number it qualified; the card is already titled
    // Forced Displacement, so the row is left saying the one thing it should.
    expect(rowLabel("United States — 4,176,592 displaced", m(4176592, "4,176,592")))
      .toBe("United States");
  });

  it("drops an instability score written as a bounded fraction", () => {
    expect(rowLabel("Nigeria — instability ≥47/100 (floor, 3/4 factors)", m(47, "47")))
      .toBe("Nigeria — instability (floor, 3/4 factors)");
  });
});

describe("rowLabel — leaves alone what it cannot improve", () => {
  it("returns the title unchanged when the source declares no metric", () => {
    // GDELT's title is the bare place name — its row collided for a different
    // reason (a fixed-width value column overflowing), not duplication.
    expect(rowLabel("Iran", undefined)).toBe("Iran");
  });

  it("returns the title unchanged when the number is not in it", () => {
    expect(rowLabel("Kyiv, Kyyiv, Misto, Ukraine", m(45, "45 articles")))
      .toBe("Kyiv, Kyyiv, Misto, Ukraine");
  });

  it("keeps a title that is ONLY the number rather than emptying the row", () => {
    // Losing the place name is worse than keeping a redundant one.
    expect(rowLabel("47", m(47, "47"))).toBe("47");
  });

  it("does not strip a digit that is part of the place name", () => {
    expect(rowLabel("Route 66 Interchange", m(5.5, "5.5"))).toBe("Route 66 Interchange");
  });

  it("handles an empty title without throwing", () => {
    expect(rowLabel("", m(5, "5"))).toBe("");
  });
});

describe("rowMetric — the value column's own formatting", () => {
  const feat = (props: Record<string, unknown>): SignalFeature => ({
    id: "x", title: "t", lat: 0, lon: 0, props,
  } as SignalFeature);

  it("groups thousands so the chip and the title cannot spell one number two ways", () => {
    const r = rowMetric(feat({ displacedCount: 4176592 }), { field: "displacedCount", domain: [0, 5_000_000] });
    expect(r?.label).toBe("4,176,592");
  });

  it("keeps one decimal for non-integers", () => {
    const r = rowMetric(feat({ magnitude: 5.53 }), { field: "magnitude", domain: [2, 8] });
    expect(r?.label).toBe("5.5");
  });

  it("appends the declared unit", () => {
    const r = rowMetric(feat({ usAqi: 55 }), { field: "usAqi", domain: [0, 300], unit: " AQI" });
    expect(r?.label).toBe("55 AQI");
  });
});
