// Per-coordinate air quality, for the camera page's conditions grid.
//
// WHY A SEPARATE MODULE FROM pointWeather.ts, and a separate route from
// /api/point-weather: this is a DIFFERENT UPSTREAM. Open-Meteo serves air quality from
// air-quality-api.open-meteo.com, a distinct host with its own availability, on the
// Copernicus CAMS model rather than the forecast model. Folding it into the weather
// response would let one host's outage take the other's data down with it, and would
// make the camera wall's 60-point request carry a second upstream call it never renders.
//
// WHAT THIS IS NOT, and the reason it is worth saying: these numbers are MODELLED, not
// measured. CAMS is an atmospheric model with a ~11 km grid, so a value here is the
// model's estimate for the grid cell the camera sits in — it is not a reading from an
// instrument near the camera, and nothing built on it may be worded as if a station
// measured the air at the roadside. That is the same distinction `camslot.conditions.ts`
// draws between `measured` and `modelled`, and it is why `AirQuality.tier` is a constant
// rather than something derived: there is no input that could make this measured.
//
// Keyless and dormant-safe like every upstream in this house: any failure resolves to
// `degraded(reason)` with no rows, never a throw and never a guessed number.

import { degraded, observed } from "@/lib/signals/outcome";
import { COORD_DP, MAX_POINTS, coordKey, type Coord } from "@/lib/weather/pointWeather";

const ENDPOINT = "https://air-quality-api.open-meteo.com/v1/air-quality";
const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

/**
 * The `current=` fields asked for.
 *
 * BOTH indices are requested even though a given page renders only one, because they
 * arrive in the same response for the same cost and choosing between them is a
 * presentation decision made later, per country — see `aqiScaleFor`.
 */
export const AIR_FIELDS = ["european_aqi", "us_aqi", "pm2_5", "pm10"] as const;

/** Attribution string for anything that renders these numbers. */
export const AIR_ATTRIBUTION = "Open-Meteo, Copernicus CAMS";

/**
 * Which of the two indices to show at a given place.
 *
 * The two scales are NOT interchangeable and are not a rounding apart: 40 is the top of
 * "Fair" on the European index and the middle of "Good" on the US one. Showing a US
 * reader an EAQI number under the bare label "AQI" invites them to read it against the
 * scale they know, which is a different claim about the same air. So the index follows
 * the country, and every rendering names the scale it used.
 *
 * US and its territories get the US index; everywhere else gets the European one, which
 * is the scale with global CAMS coverage and the one this project's other surfaces use.
 */
export function aqiScaleFor(iso2: string): "us" | "european" {
  const c = iso2.trim().toUpperCase();
  return c === "US" || c === "PR" || c === "GU" || c === "VI" || c === "AS" || c === "MP"
    ? "us"
    : "european";
}

export interface AirQuality {
  /** `coordKey` of the point this describes — the SAME key space as PointWeather. */
  key: string;
  /** European AQI (EAQI). Absent when the upstream did not answer with one. */
  europeanAqi?: number;
  /** US AQI. Absent when the upstream did not answer with one. */
  usAqi?: number;
  /** PM2.5 in µg/m³. */
  pm25?: number;
  /** PM10 in µg/m³. */
  pm10?: number;
}

/** The band a value falls in, with the wording that scale's publisher uses. */
export interface AqiBand {
  /** The index actually read, so a caller never has to re-derive which one it used. */
  scale: "us" | "european";
  /** Short scale name for display, e.g. "EAQI". */
  scaleLabel: string;
  value: number;
  /** The publisher's own band wording, e.g. "Fair" (EAQI) or "Moderate" (US AQI). */
  label: string;
}

/**
 * European AQI bands, from the EEA's published scale.
 *
 * Note "Fair" rather than "Moderate" for 20-40: those are the EEA's words, and the US
 * scale uses "Moderate" for a band that means something else. Keeping each publisher's
 * own vocabulary is what stops the two being read as one scale.
 */
function europeanBand(v: number): string {
  if (v <= 20) return "Good";
  if (v <= 40) return "Fair";
  if (v <= 60) return "Moderate";
  if (v <= 80) return "Poor";
  if (v <= 100) return "Very poor";
  return "Extremely poor";
}

/** US AQI bands, from the EPA's published scale. */
function usBand(v: number): string {
  if (v <= 50) return "Good";
  if (v <= 100) return "Moderate";
  if (v <= 150) return "Unhealthy for sensitive groups";
  if (v <= 200) return "Unhealthy";
  if (v <= 300) return "Very unhealthy";
  return "Hazardous";
}

/**
 * Read one reading on the scale appropriate to `iso2`, falling back to the other index
 * when the preferred one is absent.
 *
 * The fallback is deliberate and safe BECAUSE the result names its own scale: a US
 * camera whose us_aqi is missing shows an EAQI number labelled EAQI, which is a true
 * statement, rather than nothing. Returns null when neither index came back — there is
 * no default air quality.
 */
export function readAqi(aq: AirQuality | undefined, iso2: string): AqiBand | null {
  if (!aq) return null;
  const preferred = aqiScaleFor(iso2);
  const order: ("us" | "european")[] = preferred === "us" ? ["us", "european"] : ["european", "us"];
  for (const scale of order) {
    const value = scale === "us" ? aq.usAqi : aq.europeanAqi;
    if (value === undefined) continue;
    return {
      scale,
      scaleLabel: scale === "us" ? "US AQI" : "EAQI",
      value: Math.round(value),
      label: scale === "us" ? usBand(value) : europeanBand(value),
    };
  }
  return null;
}

/** One element of the upstream's multi-coordinate response. */
interface AirPoint {
  current?: {
    european_aqi?: number | null;
    us_aqi?: number | null;
    pm2_5?: number | null;
    pm10?: number | null;
  } | null;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Pure: the upstream array plus the coordinates asked for, in the SAME order, to one
 * `AirQuality` per usable point.
 *
 * Index alignment is the contract, exactly as in `normalizePointWeather`. A point that
 * carries no `current` block, or none of the four values, is SKIPPED rather than emitted
 * empty — a row of undefineds would render as a card with nothing in it, which reads as
 * "the air is fine" rather than "we were not told".
 */
export function normalizeAirQuality(points: AirPoint[], coords: Coord[]): AirQuality[] {
  const out: AirQuality[] = [];
  points.forEach((pt, i) => {
    const c = coords[i];
    if (!c) return;
    const cur = pt?.current;
    if (!cur) return;
    const europeanAqi = num(cur.european_aqi);
    const usAqi = num(cur.us_aqi);
    const pm25 = num(cur.pm2_5);
    const pm10 = num(cur.pm10);
    if (europeanAqi === undefined && usAqi === undefined && pm25 === undefined && pm10 === undefined) {
      return;
    }
    out.push({
      key: coordKey(c.lat, c.lon),
      ...(europeanAqi !== undefined && { europeanAqi }),
      ...(usAqi !== undefined && { usAqi }),
      ...(pm25 !== undefined && { pm25 }),
      ...(pm10 !== undefined && { pm10 }),
    });
  });
  return out;
}

/** Build the upstream URL for a batch. Exported so a test can assert it without a fetch. */
export function airQualityUrl(coords: Coord[]): string {
  const latitude = coords.map((c) => c.lat.toFixed(COORD_DP)).join(",");
  const longitude = coords.map((c) => c.lon.toFixed(COORD_DP)).join(",");
  return `${ENDPOINT}?latitude=${latitude}&longitude=${longitude}&current=${AIR_FIELDS.join(",")}&timezone=auto`;
}

/**
 * Fetch one batch. Dormant-safe: every failure path resolves to `degraded(reason)` with
 * an empty list, never a throw.
 */
export async function fetchAirQuality(coords: Coord[]) {
  if (coords.length === 0) return observed([] as AirQuality[]);
  try {
    const res = await fetch(airQualityUrl(coords.slice(0, MAX_POINTS)), {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return degraded(`http ${res.status}`);
    const json = (await res.json()) as AirPoint | AirPoint[];
    // Single-coordinate requests return an object, multi-coordinate ones an array — the
    // same asymmetry pointWeather.ts and lib/signals/weather.ts both handle.
    const points = Array.isArray(json) ? json : [json];
    return observed(normalizeAirQuality(points, coords.slice(0, MAX_POINTS)));
  } catch {
    return degraded("fetch failed");
  }
}
