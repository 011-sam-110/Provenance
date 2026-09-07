// WMO weather-code vocabulary + the Open-Meteo credit. NOT a map layer.
//
// This file used to carry the "City weather" signal layer — one Open-Meteo
// multi-coordinate request painting a temperature dot on each WORLD_CITIES entry.
// That layer was removed on 2026-09-05; what stayed is the part other features
// were already borrowing from it.
//
// `weatherCodeLabel` is the shared WMO 4677 → words mapping and `OPEN_METEO_ATTRIBUTION`
// is the credit Open-Meteo's CC BY 4.0 terms require. Both are used by the camera-tile
// conditions overlay (lib/console/widgets/camslot.conditions.ts and
// camslot.provenance.ts), which reads Open-Meteo through /api/point-weather — a
// per-coordinate route that could never be a signal layer anyway, because
// SignalSource.fetch() takes no arguments. So the credit obligation outlives the layer,
// and deleting this module would take the camera tiles' condition words with it.

export const OPEN_METEO_ATTRIBUTION = "Weather data by Open-Meteo.com (CC BY 4.0)";

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
