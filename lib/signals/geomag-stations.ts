import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { markCoverage } from "@/lib/signals/coverage";
import { degraded, degradedWith, observed } from "@/lib/signals/outcome";

// Geomagnetic stations: MEASURED magnetic disturbance at named observatories.
//
// WHY THIS LAYER EXISTS (source audit, 2026-10-16). The space-weather pin is one
// planetary index at an anchor, and the aurora layer is a model (OVATION). Neither
// says what a magnetometer on the ground is measuring right now, so a bad
// solar-wind input to the model had nothing to check it against. This layer is
// that check: real instruments at real places.
//
//   • FMI (Finnish Meteorological Institute), 11 stations in Finland and Estonia.
//     The R-index is FMI's auroral-activity index over the last 10 minutes, with
//     each station's own lower and higher limits and FMI's own verdict ("High
//     probability of auroras"). Updated every 5 minutes. CC BY 4.0, stated in the
//     file. The RX file adds the previous hour's activity and FMI's predicted range
//     for the next hour; it is joined onto the same station by code.
//   • USGS Geomagnetism Program, 14 observatories (Alaska, the contiguous US,
//     Hawaii, Guam, Puerto Rico). Raw horizontal field H in nT, 1-minute samples.
//     The disturbance shown is the range of H (max minus min) over the last hour.
//     US Government work, public domain.
//
// LEVELS. FMI's level is FMI's: R below the station's lower limit = low, below its
// higher limit = medium, else high. USGS publishes no thresholds, so the USGS level
// is THIS ADAPTER'S RULE, stated here and in explain.ts: at the three auroral-zone
// observatories (Barrow, Deadhorse, College; geographic latitude 60 or more) 100 nT
// in an hour is active and 300 nT strong; elsewhere 40 and 120 nT. Measured on
// 2026-10-16 ~19:50Z at Kp 4: Barrow 568, Deadhorse 379, College 137, every
// mid- and low-latitude observatory 5 to 19 nT. The number is always shown beside
// the level, so the rule can be checked.

const FMI_R_URL = "https://space.fmi.fi/MIRACLE/RWC/data/r_index_latest_en.json";
const FMI_RX_URL = "https://space.fmi.fi/MIRACLE/RWC/data/RX_latest_en.json";
const USGS_DATA = "https://geomag.usgs.gov/ws/data/";
const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

export const GEOMAG_STATIONS_ATTRIBUTION =
  "Magnetometers: Finnish Meteorological Institute (R-index, CC BY 4.0) · USGS Geomagnetism Program";

/** A reading older than this (ms) is a station that has stopped reporting: not drawn. */
export const STATION_MAX_AGE_MS = 2 * 60 * 60 * 1000;
/** A USGS hour with fewer 1-minute samples than this is too gappy to give a range. */
export const USGS_MIN_SAMPLES = 30;
/** The window the USGS disturbance is measured over. */
export const USGS_WINDOW_MS = 60 * 60 * 1000;

/**
 * The 14 USGS observatories that serve real-time data, from
 * https://geomag.usgs.gov/ws/observatories/ on 2026-10-16 (test, development and
 * the JMA-run Kakioka entries left out). Coordinates are the observatory's own.
 */
export const USGS_OBSERVATORIES: { code: string; name: string; lat: number; lon: number }[] = [
  { code: "BRW", name: "Barrow, Alaska", lat: 71.322, lon: -156.622 },
  { code: "DED", name: "Deadhorse, Alaska", lat: 70.355, lon: -148.793 },
  { code: "CMO", name: "College, Alaska", lat: 64.874, lon: -147.86 },
  { code: "SIT", name: "Sitka, Alaska", lat: 57.058, lon: -135.325 },
  { code: "SHU", name: "Shumagin, Alaska", lat: 55.348, lon: -160.462 },
  { code: "NEW", name: "Newport, Washington", lat: 48.265, lon: -117.122 },
  { code: "BOU", name: "Boulder, Colorado", lat: 40.137, lon: -105.237 },
  { code: "FRD", name: "Fredericksburg, Virginia", lat: 38.205, lon: -77.373 },
  { code: "FRN", name: "Fresno, California", lat: 37.091, lon: -119.718 },
  { code: "TUC", name: "Tucson, Arizona", lat: 32.174, lon: -110.733 },
  { code: "BSL", name: "Stennis Space Center, Mississippi", lat: 30.35, lon: -89.635 },
  { code: "HON", name: "Honolulu, Hawaii", lat: 21.316, lon: -158.0 },
  { code: "SJG", name: "San Juan, Puerto Rico", lat: 18.113, lon: -66.151 },
  { code: "GUA", name: "Guam", lat: 13.588, lon: 144.867 },
];

export type ActivityLevel = 0 | 1 | 2;
const LEVEL_COLOR: Record<ActivityLevel, string> = { 0: "#64748b", 1: "#eab308", 2: "#ea580c" };

interface FmiRStation {
  Time?: string;
  "R-index"?: number;
  "Geographic latitude"?: number;
  "Geographic longitude"?: number;
  "Limit value lower"?: number;
  "Limit value higher"?: number;
  "Probability of auroras"?: string;
  Station?: string;
}
export interface FmiRFile {
  info?: Record<string, unknown>;
  data?: Record<string, FmiRStation>;
}
interface FmiRxValue {
  value?: number;
  "activity level"?: string;
}
export interface FmiRxFile {
  info?: Record<string, unknown>;
  data?: Record<string, { time?: string; RX?: FmiRxValue; RXmin?: FmiRxValue; RXmax?: FmiRxValue; station?: string }>;
}
export interface UsgsSeries {
  times?: string[];
  values?: { id?: string; values?: (number | null)[] }[];
}
export interface GeomagInput {
  fmiR?: FmiRFile;
  fmiRX?: FmiRxFile;
  /** USGS series keyed by IAGA code. */
  usgs?: Record<string, UsgsSeries | undefined>;
  /** Clock for the staleness checks. */
  now: number;
}

/** FMI times read "2026-10-16 19:50:00+00:00" or "2026-10-16T19:30:08+0000". → ISO Z. */
export function fmiIso(t: string | undefined): string | undefined {
  if (!t) return undefined;
  const norm = t.trim().replace(" ", "T").replace(/([+-]\d\d)(\d\d)$/, "$1:$2");
  const ms = Date.parse(norm);
  return Number.isFinite(ms) ? new Date(ms).toISOString().replace(".000Z", "Z") : undefined;
}

/** FMI's own rule: R below the lower limit = 0, below the higher limit = 1, else 2. */
export function fmiLevel(r: number, lower: number, higher: number): ActivityLevel {
  if (r < lower) return 0;
  if (r < higher) return 1;
  return 2;
}

/** This adapter's USGS rule (see the header): auroral zone 100/300 nT, elsewhere 40/120 nT per hour. */
export function usgsLevel(rangeNt: number, lat: number): ActivityLevel {
  const [active, strong] = Math.abs(lat) >= 60 ? [100, 300] : [40, 120];
  if (rangeNt >= strong) return 2;
  if (rangeNt >= active) return 1;
  return 0;
}

const USGS_WORD: Record<ActivityLevel, string> = { 0: "quiet", 1: "active", 2: "strong disturbance" };

/** Pure: FMI R-index (+ optional RX) → one feature per station. */
export function normalizeFmiStations(r: FmiRFile | undefined, rx: FmiRxFile | undefined, now: number): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const [code, st] of Object.entries(r?.data ?? {})) {
    const lat = Number(st?.["Geographic latitude"]);
    const lon = Number(st?.["Geographic longitude"]);
    const value = Number(st?.["R-index"]);
    const lower = Number(st?.["Limit value lower"]);
    const higher = Number(st?.["Limit value higher"]);
    const ts = fmiIso(st?.Time);
    if (![lat, lon, value, lower, higher].every(Number.isFinite) || !ts) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    if (now - Date.parse(ts) > STATION_MAX_AGE_MS) continue;
    const name = (st.Station ?? code).trim();
    const verdict = (st["Probability of auroras"] ?? "").trim();
    const level = fmiLevel(value, lower, higher);
    const x = rx?.data?.[code];
    const rxNow = typeof x?.RX?.value === "number" ? x.RX.value : undefined;
    const rxMax = typeof x?.RXmax?.value === "number" ? x.RXmax.value : undefined;
    out.push({
      id: `fmi:${code}`,
      lat,
      lon,
      title: verdict ? `${name}: ${verdict}` : `${name}: R-index ${value}`,
      signalId: "geomag-stations",
      color: LEVEL_COLOR[level],
      ts,
      link: "https://space.fmi.fi/MIRACLE/RWC/r-index/en/",
      props: {
        operator: "Finnish Meteorological Institute",
        station: name,
        stationCode: code,
        measure: "R-index (auroral activity, last 10 min)",
        rIndex: value,
        limitLower: lower,
        limitHigher: higher,
        ...(verdict ? { probability: verdict } : {}),
        activityLevel: level,
        ...(rxNow != null ? { rxPreviousHour: rxNow } : {}),
        ...(x?.RX?.["activity level"] ? { rxPreviousHourLevel: x.RX["activity level"] } : {}),
        ...(rxMax != null ? { rxNextHourMax: rxMax } : {}),
        ...(x?.RXmax?.["activity level"] ? { rxNextHourMaxLevel: x.RXmax["activity level"] } : {}),
        magnitude: 3 + 2 * level,
      },
    });
  }
  return out;
}

/** Pure: one USGS hour of H → its range (nT), sample count and newest sample time. */
export function usgsDisturbance(
  series: UsgsSeries | undefined,
  now: number,
): { rangeNt: number; samples: number; newest: string } | undefined {
  const times = series?.times ?? [];
  const h = (series?.values ?? []).find((v) => v?.id === "H")?.values ?? [];
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let samples = 0;
  let newest = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < Math.min(times.length, h.length); i += 1) {
    const v = h[i];
    const t = Date.parse(times[i]);
    if (typeof v !== "number" || !Number.isFinite(v) || !Number.isFinite(t)) continue;
    if (now - t > USGS_WINDOW_MS || t > now + 60_000) continue;
    samples += 1;
    if (v < min) min = v;
    if (v > max) max = v;
    if (t > newest) newest = t;
  }
  if (samples < USGS_MIN_SAMPLES) return undefined;
  return { rangeNt: Math.round((max - min) * 10) / 10, samples, newest: new Date(newest).toISOString().replace(".000Z", "Z") };
}

/** Pure: USGS series by code → one feature per observatory that reported a usable hour. */
export function normalizeUsgsStations(usgs: Record<string, UsgsSeries | undefined> | undefined, now: number): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const obs of USGS_OBSERVATORIES) {
    const d = usgsDisturbance(usgs?.[obs.code], now);
    if (!d) continue;
    const level = usgsLevel(d.rangeNt, obs.lat);
    out.push({
      id: `usgs-geomag:${obs.code}`,
      lat: obs.lat,
      lon: obs.lon,
      title: `${obs.name}: ${USGS_WORD[level]} (H moved ${d.rangeNt} nT in the last hour)`,
      signalId: "geomag-stations",
      color: LEVEL_COLOR[level],
      ts: d.newest,
      link: `https://geomag.usgs.gov/plots/?obs=${obs.code}`,
      props: {
        operator: "USGS Geomagnetism Program",
        station: obs.name,
        stationCode: obs.code,
        measure: "Range of the horizontal field H over the last hour",
        deltaHNt: d.rangeNt,
        samples: d.samples,
        activityLevel: level,
        levelRule: Math.abs(obs.lat) >= 60 ? "auroral zone: 100 nT active, 300 nT strong" : "40 nT active, 120 nT strong",
        magnitude: 3 + 2 * level,
      },
    });
  }
  return out;
}

/** Pure: every upstream → the layer, FMI first then USGS, with an honest coverage record. */
export function normalizeGeomagStations(input: GeomagInput): SignalFeature[] {
  const out = [...normalizeFmiStations(input.fmiR, input.fmiRX, input.now), ...normalizeUsgsStations(input.usgs, input.now)];
  return markCoverage(out, { noun: "magnetometer stations reporting", rule: "every FMI and USGS station with a current reading" });
}

/** The USGS request for one observatory's last hour. */
export function usgsUrl(code: string, now: number): string {
  const iso = (t: number) => new Date(t).toISOString().slice(0, 16) + ":00Z";
  return `${USGS_DATA}?id=${code}&elements=H&sampling_period=60&format=json&starttime=${iso(now - USGS_WINDOW_MS)}&endtime=${iso(now)}`;
}

/** GET JSON; undefined on any failure. `failed` counts what did not answer. */
async function getJson<T>(url: string, tally: { failed: number }): Promise<T | undefined> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      tally.failed += 1;
      return undefined;
    }
    return (await res.json()) as T;
  } catch {
    tally.failed += 1;
    return undefined;
  }
}

/** Run `fn` over `items`, `limit` at a time, keeping order. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

let lastGood: { features: SignalFeature[]; at: number } | null = null;

export const GEOMAG_STATIONS_SOURCE: SignalSource = {
  id: "geomag-stations",
  // A named magnetometer station: the mark is on the instrument.
  precision: "facility",
  label: "Magnetometer stations",
  group: "Space weather",
  color: "#ea580c",
  refreshMs: 5 * 60 * 1000, // FMI updates every 5 min; USGS samples every minute
  attribution: GEOMAG_STATIONS_ATTRIBUTION,
  sourceUrl: "https://space.fmi.fi/MIRACLE/RWC/r-index/en/",
  async fetch() {
    const now = Date.now();
    const fmi = { failed: 0 };
    const usgs = { failed: 0 };
    const [fmiR, fmiRX, series] = await Promise.all([
      getJson<FmiRFile>(FMI_R_URL, fmi),
      getJson<FmiRxFile>(FMI_RX_URL, { failed: 0 }), // RX only adds props: its failure is not the layer's
      pool(USGS_OBSERVATORIES, 4, (o) => getJson<UsgsSeries>(usgsUrl(o.code, now), usgs)),
    ]);
    const byCode: Record<string, UsgsSeries | undefined> = {};
    USGS_OBSERVATORIES.forEach((o, i) => {
      byCode[o.code] = series[i];
    });
    const features = normalizeGeomagStations({ fmiR, fmiRX, usgs: byCode, now });
    const usgsDown = usgs.failed === USGS_OBSERVATORIES.length;
    const fmiDown = fmi.failed > 0;
    if (fmiDown && usgsDown) {
      // Nothing answered: keep the last good rows, stamped when they were read.
      return lastGood ? degradedWith(lastGood.features, "http error (FMI and USGS)", lastGood.at) : degraded("http error (FMI and USGS)");
    }
    if (fmiDown || usgsDown) {
      // One operator answered: its rows are real, and the gap is declared.
      return degradedWith(features, fmiDown ? "partial: FMI failed" : "partial: USGS failed", now);
    }
    lastGood = { features, at: now };
    return observed(features, now);
  },
};
