// Measured PM2.5 from operator-primary networks, keyless. Shared by the two air-quality
// layers: `air-quality-stations` plots every reading, and the modelled `airquality`
// layer puts the median of the reference monitors near each city beside its model value.
//
// Added 2026-10-16. OpenAQ is a relay for most of these; the operators publish their
// own feeds, fresher and with their own licences:
//
//   AirNow     US EPA + state/local/tribal agencies, Environment Canada and provinces,
//              and the US State Department monitors (Delhi, Mumbai, Baku, Sarajevo...).
//              Hourly file HourlyAQObs_<GMT YYYYMMDDHH>.dat. AirNow's data-use guidelines:
//              credit the agencies and EPA AirNow, do not alter values, mark preliminary.
//   DEFRA      UK-AIR AURN through its SOS timeseries API. Open Government Licence v3.
//              Its station coordinates come back as [lat, lon], not GeoJSON order.
//   NEA        Singapore's five regional PM2.5 readings (data.gov.sg, Singapore Open
//              Data Licence). Regions, not stations: placed as areas.
//   Sensor.Community  citizen low-cost sensors (Open Data Commons DbCL 1.0). Dense in
//              Europe, uncalibrated, humidity-biased, locations rounded by the network.
//              Shown as a separate low-cost tier: one mark per 0.5° cell carrying the
//              median of the outdoor sensors in it, never as a reference monitor.

import { parseCsv } from "@/lib/signals/airports";
import type { SignalFeature, SignalPrecision } from "@/lib/signals/types";

const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

/**
 * US-EPA PM2.5 band → {label, colour}, on the breakpoints EPA set in its 2024 revision
 * of the PM2.5 AQI (Good 0 to 9.0, Unhealthy 55.5 to 125.4, Very Unhealthy 125.5 to
 * 225.4). The pre-2024 table (Good up to 12) called air "good" that EPA no longer does.
 * Both air-quality layers colour measured readings with this one scale.
 */
export function pm25Band(v: number): { label: string; color: string } {
  if (v <= 9) return { label: "good", color: "#16a34a" };
  if (v <= 35.4) return { label: "moderate", color: "#eab308" };
  if (v <= 55.4) return { label: "unhealthy (sensitive)", color: "#f59e0b" };
  if (v <= 125.4) return { label: "unhealthy", color: "#dc2626" };
  if (v <= 225.4) return { label: "very unhealthy", color: "#7e22ce" };
  return { label: "hazardous", color: "#7f1d1d" };
}

/** A reading older than this is not current air. */
export const MEASURED_MAX_AGE_MS = 3 * 60 * 60 * 1000;
const MAX_PLAUSIBLE_PM25 = 1000; // µg/m³; above this is a fault, not air

export type MeasuredProvider = "AirNow" | "DEFRA" | "NEA" | "Sensor.Community";

export interface MeasuredReading {
  id: string;
  lat: number;
  lon: number;
  /** PM2.5 in µg/m³, one-hour value. */
  pm25: number;
  /** ISO time of the reading. */
  ts: string;
  /** Station, region or cell name. */
  station: string;
  /** Who operates the instrument (the agency, not the feed). */
  operator: string;
  provider: MeasuredProvider;
  tier: "reference" | "low-cost";
  precision: SignalPrecision;
  /** How many sensors a low-cost cell summarises. */
  sensors?: number;
}

const plausible = (v: number) => Number.isFinite(v) && v >= 0 && v <= MAX_PLAUSIBLE_PM25;
const fresh = (t: number, now: number) => Number.isFinite(t) && now - t <= MEASURED_MAX_AGE_MS && t - now <= 15 * 60 * 1000;
const inWorld = (lat: number, lon: number) =>
  Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 && !(lat === 0 && lon === 0);

// --- AirNow --------------------------------------------------------------------

/** The hourly file for the GMT hour `hoursBack` before `now`. */
export function airNowObsUrl(now: number, hoursBack: number): string {
  const d = new Date(now - hoursBack * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  const ymd = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
  return `https://files.airnowtech.org/airnow/${d.getUTCFullYear()}/${ymd}/HourlyAQObs_${ymd}${p(d.getUTCHours())}.dat`;
}

/** Pure: an AirNow HourlyAQObs CSV → PM2.5 readings (rows with a PM2.5 value only). */
export function parseAirNowObs(text: string, now = Date.now()): MeasuredReading[] {
  const rows = parseCsv(text);
  const h = rows[0] ?? [];
  const col = (n: string) => h.indexOf(n);
  const [ai, ni, lai, loi, di, ti, pi, ui, si, ci] = [
    "AQSID", "SiteName", "Latitude", "Longitude", "ValidDate", "ValidTime", "PM25", "PM25_Unit", "DataSource", "CountryCode",
  ].map(col);
  if ([ai, lai, loi, pi].some((i) => i < 0)) return [];
  const out: MeasuredReading[] = [];
  for (const r of rows.slice(1)) {
    const raw = (r[pi] ?? "").trim();
    if (raw === "") continue;
    const v = Number(raw);
    const lat = Number(r[lai]);
    const lon = Number(r[loi]);
    if (!plausible(v) || !inWorld(lat, lon)) continue;
    if (ui >= 0 && r[ui] && !/^UG\/M3$/i.test(r[ui].trim())) continue;
    // ValidDate MM/DD/YYYY and ValidTime HH:MM are GMT, like the file name.
    const [mm, dd, yyyy] = String(r[di] ?? "").split("/");
    const t = Date.parse(`${yyyy}-${mm}-${dd}T${String(r[ti] ?? "").trim() || "00:00"}:00Z`);
    if (!fresh(t, now)) continue;
    const id = (r[ai] ?? "").trim();
    if (!id) continue;
    out.push({
      id: `airnow:${id}`,
      lat,
      lon,
      pm25: v,
      ts: new Date(t).toISOString(),
      station: (r[ni] ?? "").trim() || id,
      operator: (si >= 0 && r[si]?.trim()) || (ci >= 0 && r[ci] === "CA" ? "Environment Canada" : "US EPA AirNow partner agency"),
      provider: "AirNow",
      tier: "reference",
      precision: "facility",
    });
  }
  return out;
}

// --- DEFRA UK-AIR --------------------------------------------------------------

export const DEFRA_PM25_URL = "https://uk-air.defra.gov.uk/sos-ukair/api/v1/timeseries?expanded=true&phenomenon=6001";

interface DefraSeries {
  id?: string;
  uom?: string;
  station?: { properties?: { id?: number; label?: string }; geometry?: { coordinates?: (number | string)[] } };
  lastValue?: { timestamp?: number; value?: number };
}

/** Pure: DEFRA SOS timeseries (expanded) → PM2.5 readings from the last 3 hours. */
export function parseDefraTimeseries(json: unknown, now = Date.now()): MeasuredReading[] {
  if (!Array.isArray(json)) return [];
  const out: MeasuredReading[] = [];
  for (const s of json as DefraSeries[]) {
    // GOTCHA: DEFRA returns [lat, lon], not GeoJSON's [lon, lat].
    const [lat, lon] = (s.station?.geometry?.coordinates ?? []).map(Number);
    const v = Number(s.lastValue?.value);
    const t = Number(s.lastValue?.timestamp);
    if (!inWorld(lat, lon) || !plausible(v) || !fresh(t, now)) continue;
    if (s.uom && !/ug\.m-3/i.test(s.uom)) continue;
    const label = String(s.station?.properties?.label ?? "");
    const name = label.split("-Particulate")[0].trim() || label;
    out.push({
      id: `defra:${s.id ?? s.station?.properties?.id}`,
      lat,
      lon,
      pm25: v,
      ts: new Date(t).toISOString(),
      station: name,
      operator: "DEFRA (AURN)",
      provider: "DEFRA",
      tier: "reference",
      precision: "facility",
    });
  }
  return out;
}

// --- Singapore NEA -------------------------------------------------------------

export const NEA_PM25_URL = "https://api-open.data.gov.sg/v2/real-time/api/pm25";

/** Pure: data.gov.sg PM2.5 → one AREA reading per region at NEA's own label point. */
export function parseNeaPm25(json: unknown, now = Date.now()): MeasuredReading[] {
  const d = (json as {
    data?: {
      regionMetadata?: { name?: string; labelLocation?: { latitude?: number; longitude?: number } }[];
      items?: { timestamp?: string; readings?: { pm25_one_hourly?: Record<string, number> } }[];
    };
  })?.data;
  const item = d?.items?.[0];
  const t = Date.parse(item?.timestamp ?? "");
  if (!item || !fresh(t, now)) return [];
  const out: MeasuredReading[] = [];
  for (const m of d?.regionMetadata ?? []) {
    const name = String(m.name ?? "");
    const v = Number(item.readings?.pm25_one_hourly?.[name]);
    const lat = Number(m.labelLocation?.latitude);
    const lon = Number(m.labelLocation?.longitude);
    if (!name || !plausible(v) || !inWorld(lat, lon)) continue;
    out.push({
      id: `nea:${name}`,
      lat,
      lon,
      pm25: v,
      ts: new Date(t).toISOString(),
      station: `Singapore ${name} region`,
      operator: "National Environment Agency, Singapore",
      provider: "NEA",
      tier: "reference",
      precision: "area",
    });
  }
  return out;
}

// --- Sensor.Community ----------------------------------------------------------

export const SENSOR_COMMUNITY_URL = "https://data.sensor.community/static/v2/data.1h.json";
/** Cell size of the low-cost tier, degrees. ~1,200 cells worldwide on 2026-10-16. */
export const LOW_COST_CELL_DEG = 0.5;

interface ScEntry {
  timestamp?: string;
  location?: { latitude?: string; longitude?: string; country?: string; indoor?: number };
  sensordatavalues?: { value?: string; value_type?: string }[];
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Pure: Sensor.Community 1-hour means → one low-cost reading per LOW_COST_CELL_DEG cell:
 * the median PM2.5 ("P2") of the outdoor sensors in it, anchored at their mean position.
 * Indoor sensors are dropped.
 */
export function parseSensorCommunity(json: unknown, now = Date.now()): MeasuredReading[] {
  if (!Array.isArray(json)) return [];
  const cells = new Map<string, { vals: number[]; lats: number[]; lons: number[]; t: number; country: string }>();
  for (const e of json as ScEntry[]) {
    if (e.location?.indoor !== 0) continue;
    const p2 = e.sensordatavalues?.find((v) => v.value_type === "P2");
    const v = Number(p2?.value);
    const lat = Number(e.location?.latitude);
    const lon = Number(e.location?.longitude);
    const t = Date.parse(`${String(e.timestamp ?? "").replace(" ", "T")}Z`);
    if (!p2 || !plausible(v) || !inWorld(lat, lon) || !fresh(t, now)) continue;
    const key = `${Math.floor(lat / LOW_COST_CELL_DEG)}:${Math.floor(lon / LOW_COST_CELL_DEG)}`;
    let c = cells.get(key);
    if (!c) cells.set(key, (c = { vals: [], lats: [], lons: [], t, country: e.location?.country ?? "" }));
    c.vals.push(v);
    c.lats.push(lat);
    c.lons.push(lon);
    c.t = Math.max(c.t, t);
  }
  const out: MeasuredReading[] = [];
  for (const [key, c] of cells) {
    const lat = c.lats.reduce((a, b) => a + b, 0) / c.lats.length;
    const lon = c.lons.reduce((a, b) => a + b, 0) / c.lons.length;
    out.push({
      id: `sensorcommunity:${key}`,
      lat: Math.round(lat * 100) / 100,
      lon: Math.round(lon * 100) / 100,
      pm25: Math.round(median(c.vals) * 10) / 10,
      ts: new Date(c.t).toISOString(),
      station: `${c.vals.length} low-cost sensor${c.vals.length === 1 ? "" : "s"}${c.country ? ` (${c.country})` : ""}`,
      operator: "Sensor.Community volunteers",
      provider: "Sensor.Community",
      tier: "low-cost",
      precision: "area",
      sensors: c.vals.length,
    });
  }
  return out;
}

// --- one shared fetch ------------------------------------------------------------

async function get(url: string, ms: number): Promise<Response | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(ms), cache: "no-store" });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

async function fetchAirNow(now: number): Promise<MeasuredReading[] | null> {
  // The file for an hour appears about an hour after it; walk back up to 3 hours.
  for (let back = 1; back <= 3; back++) {
    const res = await get(airNowObsUrl(now, back), 30_000);
    if (res) return parseAirNowObs(await res.text(), now);
  }
  return null;
}

async function json(url: string, ms: number): Promise<unknown | null> {
  const res = await get(url, ms);
  if (!res) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export interface MeasuredSet {
  readings: MeasuredReading[];
  /** Providers that answered on this read. */
  answered: MeasuredProvider[];
  at: number;
}

const MEMO_MS = 20 * 60 * 1000;
let memo: MeasuredSet | null = null;
let inflight: Promise<MeasuredSet> | null = null;

/** Every keyless measured feed, read once per 20 minutes and shared by both layers. Never throws. */
export async function fetchMeasuredReadings(): Promise<MeasuredSet> {
  if (memo && Date.now() - memo.at < MEMO_MS) return memo;
  if (inflight) return inflight;
  inflight = (async () => {
    const now = Date.now();
    const [airnow, defra, nea, sc] = await Promise.all([
      fetchAirNow(now).catch(() => null),
      json(DEFRA_PM25_URL, 30_000).then((j) => (j ? parseDefraTimeseries(j, now) : null)).catch(() => null),
      json(NEA_PM25_URL, 20_000).then((j) => (j ? parseNeaPm25(j, now) : null)).catch(() => null),
      json(SENSOR_COMMUNITY_URL, 45_000).then((j) => (j ? parseSensorCommunity(j, now) : null)).catch(() => null),
    ]);
    const parts: [MeasuredProvider, MeasuredReading[] | null][] = [
      ["AirNow", airnow],
      ["DEFRA", defra],
      ["NEA", nea],
      ["Sensor.Community", sc],
    ];
    const set: MeasuredSet = {
      readings: parts.flatMap(([, r]) => r ?? []),
      answered: parts.filter(([, r]) => r !== null).map(([p]) => p),
      at: now,
    };
    // Keep the last set that had readings when every feed fails at once.
    if (set.readings.length > 0 || !memo) memo = set;
    return memo;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

// --- features and joins --------------------------------------------------------

/** Each operator's own public page, so the dossier source names who measured it. */
const PROVIDER_PAGE: Record<MeasuredProvider, string> = {
  AirNow: "https://www.airnow.gov/",
  DEFRA: "https://uk-air.defra.gov.uk/",
  NEA: "https://www.haze.gov.sg/",
  "Sensor.Community": "https://sensor.community/",
};

/** Pure: a measured reading → a stations-layer feature. */
export function measuredToFeature(r: MeasuredReading): SignalFeature {
  const band = pm25Band(r.pm25);
  const lowCost = r.tier === "low-cost";
  return {
    id: r.id,
    lat: r.lat,
    lon: r.lon,
    title: lowCost
      ? `Low-cost sensors: PM2.5 ${r.pm25.toFixed(1)} µg/m³ — ${band.label} (median of ${r.sensors ?? 1})`
      : `PM2.5 ${r.pm25.toFixed(1)} µg/m³ — ${band.label}`,
    signalId: "air-quality-stations",
    ...(r.precision !== "facility" ? { precision: r.precision } : {}),
    color: band.color,
    ts: r.ts,
    link: PROVIDER_PAGE[r.provider],
    props: {
      pm25: `${r.pm25.toFixed(1)} µg/m³`,
      pm25Ugm3: Math.round(r.pm25 * 10) / 10,
      airQuality: band.label,
      station: r.station,
      operator: r.operator,
      provider: r.provider,
      tier: lowCost ? "low-cost sensor (uncalibrated)" : "reference monitor",
      ...(r.provider === "AirNow" ? { status: "preliminary data, not verified" } : {}),
      measured: r.ts,
      magnitude: Math.min(10, Math.max(2, r.pm25 / 15)),
    },
  };
}

/** Great-circle distance in km. */
export function km(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Pure: drop relayed copies. OpenAQ republishes AirNow and DEFRA stations; a relayed
 * feature within `withinKm` of a reference reading from its operator's own feed is the
 * same instrument, and the operator's copy wins.
 */
export function dropRelayed(relayed: SignalFeature[], primaries: MeasuredReading[], withinKm = 0.15): SignalFeature[] {
  const grid = new Map<string, MeasuredReading[]>();
  const cell = (lat: number, lon: number) => `${Math.floor(lat * 50)}:${Math.floor(lon * 50)}`; // ~2 km
  for (const p of primaries) {
    if (p.tier !== "reference" || p.precision !== "facility") continue;
    const k = cell(p.lat, p.lon);
    grid.set(k, [...(grid.get(k) ?? []), p]);
  }
  return relayed.filter((f) => {
    const cy = Math.floor(f.lat * 50);
    const cx = Math.floor(f.lon * 50);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const p of grid.get(`${cy + dy}:${cx + dx}`) ?? []) if (km(f.lat, f.lon, p.lat, p.lon) <= withinKm) return false;
      }
    }
    return true;
  });
}

export interface CityMeasurement {
  pm25: number;
  at: string;
  by: string;
  stations: number;
}

/**
 * Pure: the median PM2.5 of the REFERENCE readings within `radiusKm` of a point, or null.
 * Low-cost sensors never stand in for a reference value.
 */
export function measuredNear(lat: number, lon: number, readings: MeasuredReading[], radiusKm = 20): CityMeasurement | null {
  const near = readings.filter((r) => r.tier === "reference" && km(lat, lon, r.lat, r.lon) <= radiusKm);
  if (near.length === 0) return null;
  const by = [...new Set(near.map((r) => r.operator))].join("; ");
  const times = near.map((r) => r.ts).sort();
  const at = times[times.length - 1];
  return { pm25: Math.round(median(near.map((r) => r.pm25)) * 10) / 10, at, by, stations: near.length };
}
