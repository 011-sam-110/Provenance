import { expect, test } from "vitest";
// Live-captured NOAA SWPC Kp series + current storm-scale block.
import fixture from "@/tests/fixtures/space-weather.json";
// Every SWPC + GFZ feed the adapter reads, captured together on 2026-10-16 ~19:47Z.
import live from "@/tests/fixtures/space-weather-2026-10-16.json";
import { normalizeSpaceWeather, gScaleColor, SPACE_WEATHER_SOURCE, swpcIso, KP_1M_MAX_AGE_MS } from "@/lib/signals/space-weather";
import { rowMetric } from "@/lib/console/signals/signalCard";

test("emits a single status pin from the latest Kp + current scales", () => {
  const out = normalizeSpaceWeather(fixture as never);
  expect(out).toHaveLength(1);
  const f = out[0];
  expect(f.id).toBe("swpc:status");
  expect(f.signalId).toBe("space-weather");
  // Latest Kp in the fixture is 2.0 → quiet, geomagnetic storm "none".
  expect(f.props?.kp).toBe(2);
  expect(f.props?.condition).toBe("quiet");
  expect(f.props?.geomagneticStorm).toBe("none");
  expect(f.color).toBe(gScaleColor(0)); // G0 → green
  // Anchored near the north geomagnetic pole.
  expect(f.lat).toBeGreaterThan(75);
});

test("source metric resolves the real Kp index over the 0–9 domain", () => {
  const f = normalizeSpaceWeather(fixture as never)[0];
  // The declared metric must name the real Kp scalar, not the radius proxy.
  expect(SPACE_WEATHER_SOURCE.metric).toEqual({ field: "kp", domain: [0, 9] });
  expect(typeof f.props?.kp).toBe("number");
  const m = rowMetric(f, SPACE_WEATHER_SOURCE.metric);
  expect(m).toEqual({ value: 2, domain: [0, 9], label: "2" });
});

test("registers as a forecast index with Kp bands + storm-scale chips", () => {
  expect(SPACE_WEATHER_SOURCE.kind).toBe("forecast");
  expect(SPACE_WEATHER_SOURCE.forecast?.quietBelow).toBe(4); // Kp < 4 ⇒ compact all-clear
  expect(SPACE_WEATHER_SOURCE.forecast?.scaleKeys).toEqual(["geomagneticStorm", "radioBlackout", "solarRadiation"]);
  expect(SPACE_WEATHER_SOURCE.forecast?.bands?.some((b) => b.label.includes("G1"))).toBe(true);
});

test("empty Kp series yields no feature; G-scale colours escalate", () => {
  expect(normalizeSpaceWeather({ kp: [], scales0: undefined })).toHaveLength(0);
  expect(gScaleColor(0)).toBe("#16a34a");
  expect(gScaleColor(3)).toBe("#ea580c");
  expect(gScaleColor(5)).toBe("#7f1d1d");
});

test("storm conditions raise the Kp label and marker magnitude", () => {
  const out = normalizeSpaceWeather({
    kp: [{ time_tag: "t", Kp: 7.33 }],
    scales0: { G: { Scale: "3" }, R: { Scale: "1" }, S: { Scale: "0" } },
  });
  const f = out[0];
  expect(f.props?.condition).toBe("severe storm");
  expect(f.props?.geomagneticStorm).toBe("G3");
  expect(f.props?.radioBlackout).toBe("R1");
  expect(f.color).toBe(gScaleColor(3));
  expect(Number(f.props?.magnitude)).toBeGreaterThan(7);
});

// --- the headline is the 1-minute Kp, stamped with its own time (2026-10-16) ------

const NOW = Date.parse(live.capturedAt);
const liveInput = () => ({ kp: live.kp, scales0: live.scales["0"], kp1m: live.kp1m, now: NOW });

test("REGRESSION: a stale 3-hour block does not pose as now", () => {
  // At 18:35 UTC on 2026-10-16 the pin said "Kp 3.3" (the 15:00 block) while SWPC's
  // 1-minute estimate was 1.33, and `updated` printed the scales file's time.
  const out = normalizeSpaceWeather({
    kp: [{ time_tag: "2026-10-16T15:00:00", Kp: 3.33 }],
    scales0: { DateStamp: "2026-10-16", TimeStamp: "18:32:00" },
    kp1m: [{ time_tag: "2026-10-16T18:33:00", estimated_kp: 1.33 }],
    now: Date.parse("2026-10-16T18:35:00Z"),
  });
  const f = out[0];
  expect(f.props?.kp).toBe(1.33);
  expect(f.props?.kpSource).toBe("SWPC 1-minute estimate");
  expect(f.props?.kpBlock).toBe(3.33);
  expect(f.props?.kpBlockStart).toBe("2026-10-16T15:00:00Z");
  expect(f.props?.updated).toBe("2026-10-16 18:33 UTC");
  expect(f.props?.scalesUpdated).toBe("2026-10-16 18:32:00 UTC");
  expect(f.ts).toBe("2026-10-16T18:33:00Z");
  expect(f.title).toContain("Kp 1.3");
});

test("a frozen 1-minute file falls back to the official block, with the block's time", () => {
  const out = normalizeSpaceWeather({
    kp: [{ time_tag: "2026-10-16T15:00:00", Kp: 3.33 }],
    scales0: undefined,
    kp1m: [{ time_tag: "2026-10-16T12:00:00", estimated_kp: 1 }],
    now: Date.parse("2026-10-16T12:00:00Z") + KP_1M_MAX_AGE_MS + 60_000,
  });
  expect(out[0].props?.kp).toBe(3.33);
  expect(out[0].props?.kpSource).toBe("SWPC 3-hour block");
  expect(out[0].props?.updated).toBe("2026-10-16 15:00 UTC");
});

test("the captured feeds give a headline from the newest 1-minute row", () => {
  const f = normalizeSpaceWeather(liveInput())[0];
  const newest = live.kp1m[live.kp1m.length - 1];
  expect(f.props?.kp).toBe(newest.estimated_kp);
  expect(f.ts).toBe(swpcIso(newest.time_tag));
  expect(swpcIso("2026-10-16T19:43:00")).toBe("2026-10-16T19:43:00Z");
  expect(swpcIso("2026-10-16T19:38:00Z")).toBe("2026-10-16T19:38:00Z");
  expect(swpcIso("nonsense")).toBeUndefined();
});
