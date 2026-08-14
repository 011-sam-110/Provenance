import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { WORLD_CITIES, cityCoordParams, type City } from "@/lib/signals/cities.data";
import { degraded, observed } from "@/lib/signals/outcome";

// Live weather at major world cities — keyless Open-Meteo "current" forecast.
// One multi-coordinate request covers the whole WORLD_CITIES list; the response is
// an array in the same order, so we place each marker at the city's own coordinate
// (not Open-Meteo's snapped grid point) by index. Colour ramps by temperature;
// the WMO weather code becomes a human condition + glyph. Confirmed live 2026-06-27.

const ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

export const OPEN_METEO_ATTRIBUTION = "Weather data by Open-Meteo.com (CC BY 4.0)";

/** One element of Open-Meteo's multi-coordinate response. */
interface MeteoPoint {
  latitude?: number;
  longitude?: number;
  current?: {
    time?: string;
    temperature_2m?: number | null;
    weather_code?: number | null;
    wind_speed_10m?: number | null;
    relative_humidity_2m?: number | null;
  } | null;
}

/** WMO 4677 weather-code → short condition + glyph (the codes Open-Meteo emits). */
export function weatherCodeLabel(code: number): { label: string; glyph: string } {
  if (code === 0) return { label: "Clear", glyph: "☀" };
  if (code === 1) return { label: "Mainly clear", glyph: "🌤" };
  if (code === 2) return { label: "Partly cloudy", glyph: "⛅" };
  if (code === 3) return { label: "Overcast", glyph: "☁" };
  if (code === 45 || code === 48) return { label: "Fog", glyph: "🌫" };
  if (code >= 51 && code <= 57) return { label: "Drizzle", glyph: "🌦" };
  if (code >= 61 && code <= 67) return { label: "Rain", glyph: "🌧" };
  if (code >= 71 && code <= 77) return { label: "Snow", glyph: "🌨" };
  if (code >= 80 && code <= 82) return { label: "Rain showers", glyph: "🌦" };
  if (code === 85 || code === 86) return { label: "Snow showers", glyph: "🌨" };
  if (code >= 95) return { label: "Thunderstorm", glyph: "⛈" };
  return { label: "Unknown", glyph: "•" };
}

/** Cool→warm temperature ramp (°C). Blue when freezing, deep red in the heat. */
export function temperatureColor(c: number): string {
  if (c <= 0) return "#3b82f6";
  if (c <= 10) return "#38bdf8";
  if (c <= 18) return "#22c55e";
  if (c <= 26) return "#eab308";
  if (c <= 34) return "#f97316";
  return "#dc2626";
}

/** Open-Meteo's naive GMT "time" (YYYY-MM-DDTHH:MM) → an ISO-UTC instant, or undefined. */
function meteoTimeToIso(time: string | undefined): string | undefined {
  if (!time) return undefined;
  const norm = time.length === 16 ? `${time}:00Z` : time;
  const t = Date.parse(norm);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

/**
 * Pure: Open-Meteo array + the SAME city list (same order) → one feature per city
 * with a valid `current` reading. Cities whose entry is missing/garbled are skipped.
 */
export function normalizeWeather(points: MeteoPoint[], cities: City[] = WORLD_CITIES): SignalFeature[] {
  const out: SignalFeature[] = [];
  points.forEach((pt, i) => {
    const city = cities[i];
    const cur = pt?.current;
    if (!city || !cur) return;
    const temp = typeof cur.temperature_2m === "number" && Number.isFinite(cur.temperature_2m) ? cur.temperature_2m : null;
    if (temp === null) return;
    const code = typeof cur.weather_code === "number" ? cur.weather_code : -1;
    const { label, glyph } = weatherCodeLabel(code);
    const wind = typeof cur.wind_speed_10m === "number" ? cur.wind_speed_10m : null;
    const humidity = typeof cur.relative_humidity_2m === "number" ? cur.relative_humidity_2m : null;
    out.push({
      id: `weather:${city.name}`,
      lat: city.lat,
      lon: city.lon,
      title: `${city.name} — ${Math.round(temp)}°C ${glyph} ${label}`,
      signalId: "weather",
      color: temperatureColor(temp),
      ts: meteoTimeToIso(cur.time),
      props: {
        tempC: temp,
        temperature: `${temp.toFixed(1)} °C`,
        conditions: label,
        wind: wind != null ? `${wind.toFixed(0)} km/h` : "—",
        humidity: humidity != null ? `${humidity}%` : "—",
        city: `${city.name}, ${city.country}`,
      },
    });
  });
  return out;
}

export const WEATHER_SOURCE: SignalSource = {
  id: "weather",
  label: "City weather",
  group: "Weather",
  color: "#0284c7",
  refreshMs: 600_000, // Open-Meteo "current" advances ~every 15 min; 10 min is plenty
  attribution: OPEN_METEO_ATTRIBUTION,
  // Real per-city scalar: air temperature °C. Domain spans a cold winter reading to a
  // dangerous heat-wave value so the bar fills meaningfully across the habitable range.
  metric: { field: "tempC", domain: [-10, 40], unit: " °C" },
  async fetch() {
    try {
      const { latitude, longitude } = cityCoordParams();
      const url =
        `${ENDPOINT}?latitude=${latitude}&longitude=${longitude}` +
        `&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m&timezone=GMT`;
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return degraded(`http ${res.status}`);
      const json = await res.json();
      // A single-coordinate request returns an object; our multi-city one returns an array.
      const points = Array.isArray(json) ? (json as MeteoPoint[]) : [json as MeteoPoint];
      return observed(normalizeWeather(points));
    } catch {
      return degraded("fetch failed");
    }
  },
};
