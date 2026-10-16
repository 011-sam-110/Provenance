import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { applyCap, markCoverage, readCoverage } from "@/lib/signals/coverage";
import { degraded, observed } from "@/lib/signals/outcome";
import { dropRelayed, fetchMeasuredReadings, measuredToFeature, pm25Band } from "@/lib/signals/aq-measured";

// Air quality — real station measurements (OpenAQ v3). This is the measured
// counterpart to the modelled CAMS/Open-Meteo air-quality layer: actual PM2.5
// readings from ~25k reference + low-cost monitors worldwide. We pull the global
// "latest PM2.5" list for readings of the last 3 hours (`datetime_min`, paged) and
// plot each station coloured by the US-EPA PM2.5 band. Key-gated on OPENAQ_API_KEY
// (free); dormant (→ []) until set.
//
// STALENESS (fixed 2026-10-16). The adapter used to read ONE unfiltered 1,000-row
// page. That page is OpenAQ's list order, weighted to old low-id locations, and
// nothing filtered on the reading's own time: on prod 621 of 910 pins showed air
// older than 3 hours as current, 328 of them more than a year old (the oldest from
// 2016). Now the request asks for the last 3 hours only, and the normaliser drops any
// reading older than that again, in case the upstream filter ever stops working.
//
// Real-world data hygiene: OpenAQ passes through raw sensor values, which include
// error sentinels (-1, -9999) and zeros — the normaliser rejects anything ≤ 0 or
// implausibly high so the map never shows a phantom "clean" or broken station.

const PM25_LATEST_URL = "https://api.openaq.org/v3/parameters/2/latest";

/** Rows per OpenAQ page (the API's maximum). */
export const OPENAQ_PAGE = 1000;
/** Pages read per refresh. The refresh is 30 min and the free key is rate-limited per
 *  minute and per hour, so this stays small. */
export const OPENAQ_MAX_PAGES = 4;
/** Most rows one refresh can return: OPENAQ_PAGE x OPENAQ_MAX_PAGES. */
export const OPENAQ_CAP = OPENAQ_PAGE * OPENAQ_MAX_PAGES;
/** A reading older than this is not "current air" and is dropped. */
export const OPENAQ_MAX_AGE_MS = 3 * 60 * 60 * 1000;
const MAX_PLAUSIBLE_PM25 = 2000; // µg/m³ — above this is a sensor fault, not air

export const OPENAQ_ATTRIBUTION = "Air-quality measurements © OpenAQ contributors";
export const AQ_STATIONS_ATTRIBUTION =
  "US EPA AirNow and its partner agencies (preliminary data) · DEFRA UK-AIR (OGL v3) · NEA Singapore (Singapore Open Data Licence) · Sensor.Community low-cost sensors (DbCL 1.0) · OpenAQ contributors";

interface AqLatest {
  datetime?: { utc?: string };
  value?: number;
  coordinates?: { latitude?: number | null; longitude?: number | null };
  sensorsId?: number;
  locationsId?: number;
}

/** US-EPA PM2.5 band (2024 breakpoints). Lives in aq-measured.ts, shared by both layers. */
export { pm25Band };

/**
 * Pure: OpenAQ latest-PM2.5 rows → SignalFeature[], dropping invalid/error readings and
 * any reading older than OPENAQ_MAX_AGE_MS before `now`. `upstreamLimit` is how many rows
 * the pages asked for could hold: a result that fills it means more exist.
 */
export function normalizeAirStations(
  json: { results?: AqLatest[] },
  now: number = Date.now(),
  upstreamLimit: number = OPENAQ_CAP,
): SignalFeature[] {
  const results = json.results ?? [];
  const out: SignalFeature[] = [];
  for (const r of results) {
    const lat = r.coordinates?.latitude;
    const lon = r.coordinates?.longitude;
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    const v = r.value;
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > MAX_PLAUSIBLE_PM25) continue; // error sentinels
    if (!r.locationsId) continue;
    const t = Date.parse(r.datetime?.utc ?? "");
    // Stale, undated or more than 15 minutes in the future: not current air.
    if (!Number.isFinite(t) || now - t > OPENAQ_MAX_AGE_MS || t - now > 15 * 60 * 1000) continue;
    const band = pm25Band(v);
    out.push({
      id: `openaq:${r.locationsId}:${r.sensorsId ?? "x"}`,
      lat,
      lon,
      title: `PM2.5 ${v.toFixed(1)} µg/m³ — ${band.label}`,
      signalId: "air-quality-stations",
      color: band.color,
      ts: r.datetime?.utc,
      props: {
        pm25: `${v.toFixed(1)} µg/m³`,
        pm25Ugm3: Math.round(v * 10) / 10,
        airQuality: band.label,
        station: `#${r.locationsId}`,
        measured: r.datetime?.utc ?? "—",
        // Worse air → bigger marker (PM2.5 150 ≈ max radius).
        magnitude: Math.min(10, Math.max(2, v / 15)),
      },
    });
  }
  // The truncation happens UPSTREAM: a refresh reads at most OPENAQ_MAX_PAGES pages. If
  // every page came back full there are more recent readings than we read, `available`
  // is a lower bound, and the payload says "4,000 of 4,000+", never "4,000 stations".
  return applyCap(out, OPENAQ_CAP, {
    noun: "stations",
    rule: "stations reporting in the last 3 h, in OpenAQ's list order",
    upstream: { limit: upstreamLimit, count: results.length },
  });
}

/** OpenAQ's last-3-hours PM2.5, paged. Null when the key is missing or page 1 fails. */
async function fetchOpenAq(key: string): Promise<{ feats: SignalFeature[]; reason?: string }> {
  try {
    const now = Date.now();
    const since = new Date(now - OPENAQ_MAX_AGE_MS).toISOString();
    const rows: AqLatest[] = [];
    let pages = 0;
    for (let page = 1; page <= OPENAQ_MAX_PAGES; page++) {
      const url = `${PM25_LATEST_URL}?limit=${OPENAQ_PAGE}&page=${page}&datetime_min=${encodeURIComponent(since)}`;
      const res = await fetch(url, {
        headers: { "X-API-Key": key, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        if (page === 1) return { feats: [], reason: `openaq http ${res.status}` };
        break; // keep the pages already read
      }
      const json = (await res.json()) as { results?: AqLatest[] };
      const got = json.results ?? [];
      rows.push(...got);
      pages = page;
      if (got.length < OPENAQ_PAGE) break; // a short page is the last one
    }
    // Saturated only when every page read came back full.
    const limit = rows.length >= pages * OPENAQ_PAGE ? pages * OPENAQ_PAGE : Number.MAX_SAFE_INTEGER;
    return { feats: normalizeAirStations({ results: rows }, now, limit) };
  } catch {
    return { feats: [], reason: "openaq fetch failed" };
  }
}

export const AIR_QUALITY_STATIONS_SOURCE: SignalSource = {
  id: "air-quality-stations",
  // A named monitoring station. The NEA regions and the low-cost cells set "area".
  precision: "facility",
  label: "Air quality — stations",
  group: "Environment",
  color: "#dc2626",
  refreshMs: 30 * 60 * 1000,
  attribution: AQ_STATIONS_ATTRIBUTION,
  // Measured PM2.5 in µg/m³; 125 is the top of EPA's "unhealthy" band.
  metric: { field: "pm25Ugm3", domain: [0, 125], unit: " µg/m³" },
  async fetch() {
    // Keyless operator feeds first (AirNow, DEFRA, NEA, Sensor.Community); OpenAQ adds
    // the rest of the world when its key is set, minus its relayed copies of the
    // operators' own stations.
    const key = (process.env.OPENAQ_API_KEY ?? "").trim();
    const [measured, openaq] = await Promise.all([
      fetchMeasuredReadings(),
      key ? fetchOpenAq(key) : Promise.resolve({ feats: [] as SignalFeature[], reason: "no key" }),
    ]);
    const primaries = measured.readings.map(measuredToFeature);
    const relayed = dropRelayed(openaq.feats, measured.readings);
    const all = [...primaries, ...relayed];
    if (all.length === 0) return degraded(measured.answered.length ? "no current readings" : (openaq.reason ?? "all upstreams failed"));
    const c = readCoverage(openaq.feats);
    const saturated = !!c && c.capped && !c.availableExact;
    return observed(
      markCoverage(all, {
        noun: "stations",
        rule: "readings from the last 3 h; OpenAQ is read in its own list order",
        ...(saturated ? { upstream: { limit: all.length, count: all.length } } : {}),
      }),
    );
  },
};
