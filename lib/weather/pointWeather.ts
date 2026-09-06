// Air weather and the local timezone at an ARBITRARY coordinate — the half of the tile
// overlay that works everywhere, as opposed to the measured road surface, which works
// for two networks.
//
// WHY THIS IS NOT A SIGNAL LAYER. `SignalSource.fetch()` takes no arguments and
// `/api/signals/[id]` forwards no query, because every signal is a global layer with a
// fixed extent (see lib/signals/registry.ts). This is the opposite shape: the caller
// supplies the points. It therefore gets its own route, modelled on /api/near and
// /api/geocode, which are the two existing per-coordinate endpoints.
//
// WHY THE ROUTE IS CALLED point-weather AND NOT conditions. The name is a guardrail.
// Nothing this module returns is a road-surface measurement, and a downstream reader
// should never be able to mistake it for one on the strength of an import path.
//
// TIMEZONE COMES FREE. `&timezone=auto` makes Open-Meteo return a real IANA zone name
// per point. That is what lets a tile show the local clock with no tz database in the
// bundle — package.json carries no tz-lookup, luxon or date-fns, and this avoids adding
// one. Verified against the live API on 2026-09-03, including non-integer offsets
// (Asia/Kathmandu +05:45, Pacific/Chatham +12:45).

import { degraded, observed } from "@/lib/signals/outcome";

const ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

/** The `current=` fields we ask for. Ordered as sent; kept in one place so the fixture
 *  and the request cannot drift apart. */
export const CURRENT_FIELDS = [
  "temperature_2m",
  "weather_code",
  "precipitation",
  "rain",
  "snowfall",
  "is_day",
] as const;

/**
 * The extra `current=` fields a DETAIL request adds, and the `daily=` fields it asks for.
 *
 * These exist for the camera page's conditions grid and for nothing else. They are opt-in
 * rather than always-on because of who the two callers are: the console camera wall asks
 * for up to MAX_POINTS coordinates at a time and renders none of this, while the camera
 * page asks for exactly one and renders all of it. Open-Meteo prices a request by how many
 * variables it carries, so making the wall pay for wind and sunset on 60 points to serve a
 * page that asks for 1 is the wrong way round on a keyless free tier.
 *
 * The cost of the split is that `PointWeather`'s detail fields are all optional and every
 * reader has to cope with their absence — which it would have had to anyway, because
 * Open-Meteo omits a field it cannot compute.
 */
export const DETAIL_CURRENT_FIELDS = [
  "apparent_temperature",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
] as const;

export const DETAIL_DAILY_FIELDS = ["sunrise", "sunset"] as const;

/**
 * How many points one upstream request may carry.
 *
 * Matches MAX_STREAMS in camslot.model.ts: a single wall cannot hold more streams than
 * that, so one full wall is always one request.
 */
export const MAX_POINTS = 60;

/**
 * Coordinate rounding, in decimal places.
 *
 * 2 dp is ~1.1 km, comfortably inside Open-Meteo's ~11 km model grid, so rounding costs
 * no accuracy that the upstream itself offers. It buys two things: two cameras on the
 * same street share one cache entry and one upstream point, and the cache key space
 * stays small enough to bound.
 */
export const COORD_DP = 2;

export interface PointWeather {
  /** `coordKey` of the point this describes. */
  key: string;
  tempC: number;
  /** WMO 4677 code. Rendered through `weatherCodeLabel` in lib/signals/weather.ts. */
  code: number;
  isDay: boolean;
  /** Millimetres in the PRECEDING HOUR, not an instantaneous rate. Open-Meteo's
   *  `current` block reports these as sums over the last hour, which is why every
   *  string derived from them says "1h" and never "now". */
  precipMm: number;
  rainMm: number;
  snowMm: number;
  /** IANA zone name, e.g. "Europe/Madrid". */
  timeZone: string;
  /** Seconds east of UTC at capture. Kept ONLY as a fallback for a runtime whose Intl
   *  does not know the zone — it is a snapshot and goes wrong across a DST boundary,
   *  so the zone name is always preferred. */
  utcOffsetSeconds: number;

  // ---- DETAIL fields. Present only on a detail request, and only when the upstream
  // returned a usable number. Absent means "not asked for, or not answered" — never zero.

  /** Open-Meteo's `apparent_temperature`: what the air is supposed to feel like. */
  feelsC?: number;
  /** Sustained wind at 10 m, km/h (Open-Meteo's default unit for this field). */
  windKmh?: number;
  /** Meteorological wind direction: the compass bearing the wind blows FROM. */
  windFromDeg?: number;
  /** Gust speed at 10 m, km/h. */
  gustKmh?: number;
  /**
   * Today's sunrise and sunset as the upstream sent them: LOCAL wall-clock ISO with no
   * offset, e.g. "2026-09-06T06:21", because the request carries `timezone=auto`.
   *
   * Kept as the upstream's own strings rather than parsed to epoch. `new Date()` on an
   * offset-less string reads it in the RUNTIME's zone, which would put a London sunset
   * into a Vercel container's UTC and a reader's browser zone into a third — three
   * answers to one question. The only thing anything needs from these is the clock face
   * at the camera, and that is already the substring.
   */
  sunrise?: string;
  sunset?: string;
}

/** A coordinate rounded and rendered as its own cache key. Stable and canonical, so
 *  the same place always produces the same string. */
export function coordKey(lat: number, lon: number): string {
  return `${lat.toFixed(COORD_DP)},${lon.toFixed(COORD_DP)}`;
}

export interface Coord {
  lat: number;
  lon: number;
}

/**
 * Parse the `points=` query into coordinates.
 *
 * This is an UNTRUSTED boundary. A `?c=` share link can carry any JSON into a widget's
 * config (see the note atop camslot.model.ts), and the client turns that config into
 * this query string — so a stranger's link decides what coordinates we ask an upstream
 * about. Hence: strict numeric parsing, real range checks, deduplication, and a hard
 * cap. Anything malformed is dropped rather than rejecting the whole request, so one
 * bad stream in a wall of sixty does not blank the other fifty-nine.
 */
export function parsePointsParam(raw: string | null): Coord[] {
  if (!raw) return [];
  const out: Coord[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(";")) {
    const [a, b] = part.split(",");
    const lat = Number(a);
    const lon = Number(b);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    const key = coordKey(lat, lon);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ lat: Number(lat.toFixed(COORD_DP)), lon: Number(lon.toFixed(COORD_DP)) });
    if (out.length >= MAX_POINTS) break;
  }
  return out;
}

/** Render coordinates back into a canonical `points=` value. Sorted, so two walls
 *  holding the same places in a different order produce one identical URL and share a
 *  cache entry instead of each paying for its own. */
export function pointsParam(coords: Coord[]): string {
  return coords
    .map((c) => coordKey(c.lat, c.lon))
    .sort()
    .join(";");
}

/** Split a set of points into upstream-sized requests. */
export function planBatches<T>(items: T[], size = MAX_POINTS): T[][] {
  if (size < 1) return items.length ? [items] : [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** One element of Open-Meteo's multi-coordinate response. */
interface MeteoPoint {
  timezone?: string;
  utc_offset_seconds?: number;
  current?: {
    temperature_2m?: number | null;
    weather_code?: number | null;
    precipitation?: number | null;
    rain?: number | null;
    snowfall?: number | null;
    is_day?: number | null;
    // Detail request only.
    apparent_temperature?: number | null;
    wind_speed_10m?: number | null;
    wind_direction_10m?: number | null;
    wind_gusts_10m?: number | null;
  } | null;
  /** Detail request only. Parallel arrays, one entry per forecast day; we ask for one. */
  daily?: {
    time?: unknown[] | null;
    sunrise?: unknown[] | null;
    sunset?: unknown[] | null;
  } | null;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** First entry of one of `daily`'s parallel arrays, when it is a non-empty string. */
function firstDaily(arr: unknown[] | null | undefined): string | undefined {
  const v = Array.isArray(arr) ? arr[0] : undefined;
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/**
 * Pure: the upstream array plus the coordinates we asked for, in the SAME order, to one
 * `PointWeather` per usable point.
 *
 * Index alignment is the contract — Open-Meteo returns results positionally, and
 * `lib/signals/cities.data.ts` relies on the same property. A point whose `current`
 * block is missing, or whose temperature is not a number, is SKIPPED rather than
 * defaulted, so a garbled entry cannot become a confident 0 °C.
 */
export function normalizePointWeather(points: MeteoPoint[], coords: Coord[]): PointWeather[] {
  const out: PointWeather[] = [];
  points.forEach((pt, i) => {
    const c = coords[i];
    if (!c) return;
    const cur = pt?.current;
    if (!cur) return;
    const tempC = num(cur.temperature_2m);
    if (tempC === undefined) return;
    const zone = typeof pt.timezone === "string" ? pt.timezone.trim() : "";
    if (!zone) return; // without a zone there is no local clock, and we will not guess one
    out.push({
      key: coordKey(c.lat, c.lon),
      tempC,
      code: num(cur.weather_code) ?? -1,
      isDay: num(cur.is_day) === 1,
      // Absent precipitation is NOT zero. Zero means the upstream measured none; absent
      // means it told us nothing, and the derived rule has to be able to tell them
      // apart, so these stay NaN rather than defaulting.
      precipMm: num(cur.precipitation) ?? NaN,
      rainMm: num(cur.rain) ?? NaN,
      snowMm: num(cur.snowfall) ?? NaN,
      timeZone: zone,
      utcOffsetSeconds: num(pt.utc_offset_seconds) ?? 0,
      // Detail fields. Spread conditionally so a base request produces the exact object
      // it always did — `feelsC: undefined` and no `feelsC` at all serialise differently,
      // and the route caches these by value.
      ...(num(cur.apparent_temperature) !== undefined && { feelsC: num(cur.apparent_temperature) }),
      ...(num(cur.wind_speed_10m) !== undefined && { windKmh: num(cur.wind_speed_10m) }),
      ...(num(cur.wind_direction_10m) !== undefined && { windFromDeg: num(cur.wind_direction_10m) }),
      ...(num(cur.wind_gusts_10m) !== undefined && { gustKmh: num(cur.wind_gusts_10m) }),
      ...(firstDaily(pt.daily?.sunrise) && { sunrise: firstDaily(pt.daily?.sunrise) }),
      ...(firstDaily(pt.daily?.sunset) && { sunset: firstDaily(pt.daily?.sunset) }),
    });
  });
  return out;
}

/** Build the upstream URL for a batch. Exported so a test can assert the shape without
 *  a network call. `detail` adds the camera-page fields; see DETAIL_CURRENT_FIELDS. */
export function pointWeatherUrl(coords: Coord[], detail = false): string {
  const latitude = coords.map((c) => c.lat).join(",");
  const longitude = coords.map((c) => c.lon).join(",");
  const current = detail ? [...CURRENT_FIELDS, ...DETAIL_CURRENT_FIELDS] : CURRENT_FIELDS;
  // `forecast_days=1` because the only daily values asked for are today's sunrise and
  // sunset; the default of 7 would return six days nothing reads.
  const daily = detail ? `&daily=${DETAIL_DAILY_FIELDS.join(",")}&forecast_days=1` : "";
  return (
    `${ENDPOINT}?latitude=${latitude}&longitude=${longitude}` +
    `&current=${current.join(",")}${daily}&timezone=auto`
  );
}

/**
 * Fetch one batch. Dormant-safe: every failure path resolves to `degraded(reason)` with
 * an empty feature list, never a throw and never a partial guess.
 */
export async function fetchPointWeather(coords: Coord[], detail = false) {
  if (coords.length === 0) return observed([] as PointWeather[]);
  try {
    const res = await fetch(pointWeatherUrl(coords, detail), {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return degraded(`http ${res.status}`);
    const json = (await res.json()) as MeteoPoint | MeteoPoint[];
    // A single-coordinate request returns an object; a multi-coordinate one returns an
    // array. Same asymmetry lib/signals/weather.ts handles.
    const points = Array.isArray(json) ? json : [json];
    return observed(normalizePointWeather(points, coords));
  } catch {
    return degraded("fetch failed");
  }
}
