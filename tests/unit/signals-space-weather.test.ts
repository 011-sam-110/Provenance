import { expect, test } from "vitest";
// Live-captured NOAA SWPC Kp series + current storm-scale block.
import fixture from "@/tests/fixtures/space-weather.json";
// Every SWPC + GFZ feed the adapter reads, captured together on 2026-10-16 ~19:47Z.
import live from "@/tests/fixtures/space-weather-2026-10-16.json";
import {
  normalizeSpaceWeather,
  gScaleColor,
  SPACE_WEATHER_SOURCE,
  swpcIso,
  KP_1M_MAX_AGE_MS,
  flareClass,
  radioBlackoutScale,
  summarizeXray,
  activeAlerts,
  summarizeSolarWind,
  latestGfz,
  gfzUrl,
  SWPC_ATTRIBUTION,
  type GfzSeries,
} from "@/lib/signals/space-weather";
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
  expect(SPACE_WEATHER_SOURCE.forecast?.scaleKeys).toEqual(["geomagneticStorm", "radioBlackout", "solarRadiation", "flareMax24h"]);
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
const liveInput = () => ({
  kp: live.kp,
  scales0: live.scales["0"],
  kp1m: live.kp1m,
  alerts: live.alerts,
  xray: live.xray,
  wind: live.wind,
  mag: live.mag,
  gfzKp: live.gfzKp as GfzSeries,
  gfzHp30: live.gfzHp30 as GfzSeries,
  now: NOW,
});

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

// --- what the pin missed on 2026-10-16: an M1.3 flare and an electron alert -------

test("flare classes follow the GOES bands and truncate like SWPC", () => {
  expect(flareClass(1.3757e-5)).toBe("M1.3");
  expect(flareClass(6.02e-6)).toBe("C6.0");
  expect(flareClass(1.15e-6)).toBe("C1.1");
  expect(flareClass(2.3e-4)).toBe("X2.3");
  expect(flareClass(4.5e-8)).toBe("A4.5");
  expect(flareClass(0)).toBe("");
  expect([9.9e-6, 1e-5, 5e-5, 1e-4, 1e-3, 2e-3].map(radioBlackoutScale)).toEqual([0, 1, 2, 3, 4, 5]);
});

test("REGRESSION: the captured GOES day shows the 15:42 UTC M1.3 as the 24 h peak (R1)", () => {
  const xr = summarizeXray(live.xray, NOW);
  expect(xr.flareMax24h).toBe("M1.3");
  expect(xr.flareMax24hAt).toBe("2026-10-16T15:42:00Z");
  const f = normalizeSpaceWeather(liveInput())[0];
  expect(f.props?.flareMax24h).toBe("M1.3");
  expect(f.props?.radioBlackout24h).toBe("R1");
  // The scales file's "current" block still says none; both are shown.
  expect(f.props?.radioBlackout).toBe("none");
  expect(typeof f.props?.flareNow).toBe("string");
});

test("REGRESSION: the 14:19 UTC electron alert is listed; expired warnings are not", () => {
  const list = activeAlerts(live.alerts, NOW);
  // By the 19:47Z capture Kp had reached 4: SWPC added ALTK04 and a WARK04 valid to 03:00.
  expect(list.map((a) => a.code)).toEqual(["ALTK04", "WARK04", "ALTEF3"]);
  const electron = list.find((a) => a.code === "ALTEF3")!;
  expect(electron).toMatchObject({ issued: "2026-10-16T14:19:49Z" });
  expect(electron.headline).toMatch(/^ALERT: Electron 2MeV/);
  expect(list.find((a) => a.code === "WARK04")?.validUntil).toBe("2026-10-17T03:00:00Z");
  // The WARK04 extensions of 13 Oct were valid until 14 Oct: not current.
  expect(list.some((a) => a.issued.startsWith("2026-10-13"))).toBe(false);
  const f = normalizeSpaceWeather(liveInput())[0];
  expect(f.props?.alertCount).toBe(list.length);
  expect(String(f.props?.alerts)).toContain("ALTEF3 2026-10-16 14:19 UTC: ALERT: Electron 2MeV");
});

test("a warning stays current while its Valid To is ahead, a cancellation is never listed", () => {
  const msg = (code: string, body: string) => `Space Weather Message Code: ${code}\r\nSerial Number: 1\r\nIssue Time: 2026 Oct 10 0000 UTC\r\n\r\n${body}`;
  const rows = [
    { issue_datetime: "2026-10-10 00:00:00.000", message: msg("WARK05", "WARNING: Geomagnetic K-index of 5 expected\nValid From: 2026 Oct 10 0000 UTC\nValid To: 2026 Oct 12 0300 UTC") },
    { issue_datetime: "2026-10-11 20:00:00.000", message: msg("WATA20", "CANCEL WATCH: Geomagnetic Storm Category G2 Predicted") },
  ];
  const now = Date.parse("2026-10-12T01:00:00Z");
  expect(activeAlerts(rows, now).map((a) => a.code)).toEqual(["WARK05"]);
  expect(activeAlerts(rows, Date.parse("2026-10-12T04:00:00Z"))).toEqual([]);
});

test("solar wind is shown only while its summary row is fresh", () => {
  const sw = summarizeSolarWind(live.wind, live.mag, NOW);
  expect(sw.solarWindKms).toBe(live.wind[0].proton_speed);
  expect(sw.bzNt).toBe(live.mag[0].bz_gsm);
  expect(summarizeSolarWind(live.wind, live.mag, NOW + 3 * 3_600_000)).toEqual({});
});

test("every extra feed is optional: without them the pin is the Kp pin it was", () => {
  const f = normalizeSpaceWeather({ kp: live.kp, scales0: live.scales["0"], now: NOW })[0];
  for (const k of ["flareNow", "flareMax24h", "radioBlackout24h", "alerts", "alertCount", "solarWindKms", "bzNt"]) {
    expect(f.props?.[k]).toBeUndefined();
  }
});

// --- GFZ Potsdam: the independent Kp producer (CC BY 4.0) -------------------------

test("GFZ cross-check: newest Kp block and Hp30 interval ride beside NOAA's numbers", () => {
  const kp = latestGfz(live.gfzKp as GfzSeries, "Kp")!;
  expect(kp).toEqual({ value: 4.33, start: "2026-10-16T18:00:00Z", status: "pre" });
  const hp = latestGfz(live.gfzHp30 as GfzSeries, "Hp30")!;
  const times = (live.gfzHp30 as GfzSeries).datetime!;
  expect(hp.start).toBe(swpcIso(times[times.length - 1]));
  const f = normalizeSpaceWeather(liveInput())[0];
  expect(f.props?.gfzKp).toBe(4.33);
  expect(f.props?.gfzKpBlockStart).toBe("2026-10-16T18:00:00Z");
  expect(f.props?.gfzHp30).toBe(hp.value);
  // GFZ's nowcast was ahead of NOAA's newest 3-hour block (15:00) at capture time.
  expect(f.props?.kpBlockStart).toBe("2026-10-16T15:00:00Z");
});

test("GFZ series skips null tails and the licence credit is in the attribution", () => {
  expect(latestGfz({ datetime: ["2026-10-16T18:00:00Z", "2026-10-16T18:30:00Z"], Hp30: [3.667, null] }, "Hp30")).toEqual({
    value: 3.67,
    start: "2026-10-16T18:00:00Z",
  });
  expect(latestGfz(undefined, "Kp")).toBeUndefined();
  expect(SWPC_ATTRIBUTION).toMatch(/GFZ Potsdam, CC BY 4\.0/);
  expect(gfzUrl("Hp30", Date.parse("2026-10-16T19:47:20.123Z"))).toBe(
    "https://kp.gfz.de/app/json/?start=2026-10-15T19:47:20Z&end=2026-10-16T19:47:20Z&index=Hp30",
  );
});
