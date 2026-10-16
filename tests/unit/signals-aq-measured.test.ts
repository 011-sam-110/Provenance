import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  airNowObsUrl,
  parseAirNowObs,
  parseDefraTimeseries,
  parseNeaPm25,
  parseSensorCommunity,
  measuredToFeature,
  measuredNear,
  dropRelayed,
  pm25Band,
  type MeasuredReading,
} from "@/lib/signals/aq-measured";
import { normalizeAirQuality, attachMeasured } from "@/lib/signals/airquality";
import { resolvePrecision } from "@/lib/signals/precision";
import { AIR_QUALITY_STATIONS_SOURCE } from "@/lib/signals/airquality-stations";

// Captured 2026-10-16 between 21:13 and 21:19 UTC:
//   airnow-hourlyaqobs-2026101619.dat  HourlyAQObs for 19:00 GMT: every non-US/CA PM2.5
//                                     row (the State Department monitors), 30 US, 10 CA,
//                                     and 10 rows with no PM2.5
//   defra-ukair-pm25-timeseries.json  the first 25 PM2.5 series of the SOS API
//   nea-sg-pm25.json                  data.gov.sg PM2.5, 05:00 SGT (21:00 UTC)
//   sensor-community-1h.json          40 entries in each of three 0.5° cells (Stuttgart,
//                                     Amsterdam, Moscow) and 5 indoor sensors
const text = (n: string) => readFileSync(join(process.cwd(), "tests/fixtures", n), "utf8");
const AT = Date.parse("2026-10-16T21:20:00Z");

test("AirNow: the file name is the GMT hour", () => {
  expect(airNowObsUrl(Date.parse("2026-10-16T21:13:00Z"), 2)).toBe(
    "https://files.airnowtech.org/airnow/2026/20261016/HourlyAQObs_2026101619.dat",
  );
  expect(airNowObsUrl(Date.parse("2026-01-01T00:30:00Z"), 1)).toBe(
    "https://files.airnowtech.org/airnow/2025/20251231/HourlyAQObs_2025123123.dat",
  );
});

test("AirNow: PM2.5 rows only, the agency credited, the embassy monitors included", () => {
  const out = parseAirNowObs(text("airnow-hourlyaqobs-2026101619.dat"), AT);
  expect(out).toHaveLength(46); // 56 rows, 10 without PM2.5
  const delhi = out.find((r) => r.id === "airnow:DS1010001")!;
  expect(delhi.station).toBe("New Delhi");
  expect(delhi.pm25).toBe(70);
  expect(delhi.operator).toBe("U.S. Department of State India - New Delhi");
  expect(delhi.ts).toBe("2026-10-16T19:00:00.000Z");
  expect(out.find((r) => r.id === "airnow:DS1010004")!.pm25).toBe(119); // Mumbai
  expect(out.every((r) => r.provider === "AirNow" && r.tier === "reference")).toBe(true);
  // Three hours later the same file is stale and contributes nothing.
  expect(parseAirNowObs(text("airnow-hourlyaqobs-2026101619.dat"), Date.parse("2026-10-16T22:30:00Z"))).toHaveLength(0);
  expect(parseAirNowObs("not,a,file", AT)).toEqual([]);
});

test("DEFRA: coordinates are [lat, lon], names are the station's, stale series drop", () => {
  const json = JSON.parse(text("defra-ukair-pm25-timeseries.json"));
  const out = parseDefraTimeseries(json, AT);
  expect(out.length).toBeGreaterThan(15);
  for (const r of out) {
    // Great Britain and Northern Ireland: a lat/lon swap would put these in Somalia.
    expect(r.lat).toBeGreaterThan(49);
    expect(r.lat).toBeLessThan(61);
    expect(r.lon).toBeGreaterThan(-9);
    expect(r.lon).toBeLessThan(2);
    expect(r.station).not.toMatch(/Particulate/);
  }
  const toft = out.find((r) => r.station === "Toft Newton");
  expect(toft?.operator).toBe("DEFRA (AURN)");
  expect(parseDefraTimeseries(json, Date.parse("2026-10-17T06:00:00Z"))).toHaveLength(0);
  expect(parseDefraTimeseries({ not: "a list" }, AT)).toEqual([]);
});

test("NEA: five regional readings, placed as areas at NEA's own label points", () => {
  const out = parseNeaPm25(JSON.parse(text("nea-sg-pm25.json")), AT);
  expect(out.map((r) => r.id).sort()).toEqual(["nea:central", "nea:east", "nea:north", "nea:south", "nea:west"]);
  expect(out.find((r) => r.id === "nea:east")!.pm25).toBe(114);
  expect(out.every((r) => r.precision === "area")).toBe(true);
});

test("Sensor.Community: one low-cost cell per 0.5°, the median of its outdoor P2 sensors", () => {
  const out = parseSensorCommunity(JSON.parse(text("sensor-community-1h.json")), AT);
  expect(out).toHaveLength(3); // the 5 indoor sensors make no cell of their own
  const stuttgart = out.find((r) => r.id === "sensorcommunity:97:18")!;
  expect(stuttgart.pm25).toBe(6.5); // median of 23 sensors: 6.49
  expect(stuttgart.sensors).toBe(23);
  expect(stuttgart.tier).toBe("low-cost");
  expect(stuttgart.precision).toBe("area");
  expect(out.find((r) => r.id === "sensorcommunity:111:75")!.pm25).toBe(17.8); // Moscow
});

test("a low-cost cell never reads like a reference monitor", () => {
  const sc = parseSensorCommunity(JSON.parse(text("sensor-community-1h.json")), AT)[0];
  const f = measuredToFeature(sc);
  expect(f.title).toMatch(/^Low-cost sensors: /);
  expect(f.props?.tier).toBe("low-cost sensor (uncalibrated)");
  expect(resolvePrecision(f, AIR_QUALITY_STATIONS_SOURCE)).toBe("area");
  const delhi = parseAirNowObs(text("airnow-hourlyaqobs-2026101619.dat"), AT).find((r) => r.id === "airnow:DS1010001")!;
  const d = measuredToFeature(delhi);
  expect(d.props?.tier).toBe("reference monitor");
  expect(d.props?.status).toBe("preliminary data, not verified"); // AirNow's guidelines
  expect(d.color).toBe(pm25Band(70).color);
  expect(resolvePrecision(d, AIR_QUALITY_STATIONS_SOURCE)).toBe("facility");
});

test("OpenAQ's relayed copy of an operator's station is dropped; other OpenAQ stations stay", () => {
  const primary: MeasuredReading = {
    id: "airnow:X", lat: 28.63576, lon: 77.22445, pm25: 70, ts: "2026-10-16T19:00:00Z",
    station: "New Delhi", operator: "US State Dept", provider: "AirNow", tier: "reference", precision: "facility",
  };
  const base = { title: "t", signalId: "air-quality-stations" };
  const out = dropRelayed(
    [
      { ...base, id: "openaq:1:1", lat: 28.6358, lon: 77.2245 }, // ~5 m away: the same monitor
      { ...base, id: "openaq:2:2", lat: 28.7, lon: 77.1 }, // another Delhi station
    ],
    [primary],
  );
  expect(out.map((f) => f.id)).toEqual(["openaq:2:2"]);
});

test("model layer: a city with reference monitors nearby is coloured by the measurement", () => {
  // Singapore on 2026-10-16: the model said 14.7, NEA measured 73 to 116.
  const city = { name: "Singapore", country: "Singapore", lat: 1.3521, lon: 103.8198 };
  const [sg] = normalizeAirQuality([{ current: { time: "2026-10-16T21:00", us_aqi: 157, pm2_5: 14.1 } }], [city]);
  const readings = parseNeaPm25(JSON.parse(text("nea-sg-pm25.json")), AT);
  const lowCost: MeasuredReading = { ...readings[0], id: "sc", tier: "low-cost", pm25: 1 };
  attachMeasured([sg], [...readings, lowCost]);
  expect(String(sg.props?.measuredPm25)).toMatch(/^101\.0 µg\/m³ \(1 h, median of 5 monitors within 20 km\)/);
  expect(sg.props?.measuredBy).toBe("National Environment Agency, Singapore");
  expect(sg.color).toBe(pm25Band(101).color);
  expect(sg.title).toContain("measured PM2.5 101.0 (unhealthy)");
  // The model value stays on the feature.
  expect(sg.props?.["PM2.5"]).toBe("14.1 µg/m³");
});

test("model layer: no monitor within 20 km leaves the model value alone", () => {
  const city = { name: "Lagos", country: "Nigeria", lat: 6.5244, lon: 3.3792 };
  const [lagos] = normalizeAirQuality([{ current: { time: "2026-10-16T21:00", us_aqi: 80 } }], [city]);
  const before = { ...lagos, props: { ...lagos.props } };
  attachMeasured([lagos], parseNeaPm25(JSON.parse(text("nea-sg-pm25.json")), AT));
  expect(lagos).toEqual(before);
  expect(measuredNear(0, 0, [])).toBeNull();
});
