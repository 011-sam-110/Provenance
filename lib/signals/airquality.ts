import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { WORLD_CITIES, cityCoordParams, type City } from "@/lib/signals/cities.data";
import { degraded, observed } from "@/lib/signals/outcome";
import { fetchMeasuredReadings, measuredNear, pm25Band, type MeasuredReading } from "@/lib/signals/aq-measured";

// Live air quality at major world cities — keyless Open-Meteo Air-Quality API.
// Same one-request-covers-all-cities pattern as the weather layer (multi-coordinate
// request → index-ordered array → markers at the city's own coordinate). Colour and
// the dossier band come from the US AQI (EPA categories). Confirmed live 2026-06-27.

const ENDPOINT = "https://air-quality-api.open-meteo.com/v1/air-quality";
const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

export const OPEN_METEO_AQ_ATTRIBUTION =
  "Air-quality data by Open-Meteo.com (CAMS / GEMS), CC BY 4.0 · measured PM2.5: US EPA AirNow and partner agencies (preliminary), DEFRA UK-AIR (OGL v3), NEA Singapore (Singapore Open Data Licence)";

interface AqPoint {
  latitude?: number;
  longitude?: number;
  current?: {
    time?: string;
    pm2_5?: number | null;
    pm10?: number | null;
    us_aqi?: number | null;
    us_aqi_pm2_5?: number | null;
    us_aqi_pm10?: number | null;
    us_aqi_ozone?: number | null;
    european_aqi?: number | null;
    nitrogen_dioxide?: number | null;
    ozone?: number | null;
  } | null;
}

/** US AQI band → (category label, colour). The standard EPA six-tier scale. */
export function usAqiBand(aqi: number): { category: string; color: string } {
  if (aqi <= 50) return { category: "Good", color: "#16a34a" };
  if (aqi <= 100) return { category: "Moderate", color: "#eab308" };
  if (aqi <= 150) return { category: "Unhealthy (sensitive)", color: "#f97316" };
  if (aqi <= 200) return { category: "Unhealthy", color: "#dc2626" };
  if (aqi <= 300) return { category: "Very unhealthy", color: "#9333ea" };
  return { category: "Hazardous", color: "#7f1d1d" };
}

/** The US AQI scale ends at 500. CAMS dust can drive Open-Meteo's value far past it
 *  (Riyadh read 1015 on 2026-10-16, 949 an hour later), which is not an index reading. */
export const US_AQI_MAX = 500;

/** Which pollutant sets the US AQI: the largest of the per-pollutant sub-indices. */
export function dominantPollutant(cur: NonNullable<AqPoint["current"]>): string | undefined {
  const parts: [string, number | null | undefined][] = [
    ["PM2.5", cur.us_aqi_pm2_5],
    ["PM10", cur.us_aqi_pm10],
    ["O₃", cur.us_aqi_ozone],
  ];
  let best: [string, number] | undefined;
  for (const [name, v] of parts) {
    if (typeof v === "number" && Number.isFinite(v) && (!best || v > best[1])) best = [name, v];
  }
  return best?.[0];
}

function meteoTimeToIso(time: string | undefined): string | undefined {
  if (!time) return undefined;
  const norm = time.length === 16 ? `${time}:00Z` : time;
  const t = Date.parse(norm);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

/**
 * Pure: Open-Meteo air-quality array + the SAME city list (same order) → one feature
 * per city with a usable US-AQI reading. Cities with no AQI value are skipped.
 */
export function normalizeAirQuality(points: AqPoint[], cities: City[] = WORLD_CITIES): SignalFeature[] {
  const out: SignalFeature[] = [];
  points.forEach((pt, i) => {
    const city = cities[i];
    const cur = pt?.current;
    if (!city || !cur) return;
    const raw = typeof cur.us_aqi === "number" && Number.isFinite(cur.us_aqi) ? Math.round(cur.us_aqi) : null;
    if (raw === null) return;
    // Capped at the top of the scale. Above it the label says "500+", never a number
    // the index does not have.
    const aqi = Math.min(raw, US_AQI_MAX);
    const beyond = raw > US_AQI_MAX;
    const aqiText = beyond ? `${US_AQI_MAX}+` : String(aqi);
    const { category, color } = usAqiBand(aqi);
    const dominant = dominantPollutant(cur);
    const num = (v: number | null | undefined, unit: string) =>
      typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(1)} ${unit}` : "—";
    out.push({
      id: `airquality:${city.name}`,
      lat: city.lat,
      lon: city.lon,
      // Open-Meteo's US AQI is EPA's: a 24 h mean for PM and 8 h for ozone. It sits
      // beside the CURRENT hour's concentrations, so the title says which window it is,
      // or Singapore reads "AQI 161" next to "PM2.5 14.7" with nothing to explain why.
      title: `${city.name} — AQI ${aqiText} (24 h, ${category})`,
      signalId: "airquality",
      color,
      ts: meteoTimeToIso(cur.time),
      props: {
        usAqi: aqi,
        aqiWindow: "24 h mean (PM), 8 h (ozone); the concentrations below are the current hour",
        ...(beyond ? { aqiBeyondIndex: `${US_AQI_MAX}+ (beyond the index; the model's value is ${raw})` } : {}),
        ...(dominant ? { dominantPollutant: dominant } : {}),
        category,
        europeanAqi: typeof cur.european_aqi === "number" ? Math.round(cur.european_aqi) : "—",
        "PM2.5": num(cur.pm2_5, "µg/m³"),
        PM10: num(cur.pm10, "µg/m³"),
        "NO₂": num(cur.nitrogen_dioxide, "µg/m³"),
        "O₃": num(cur.ozone, "µg/m³"),
        city: `${city.name}, ${city.country}`,
      },
    });
  });
  return out;
}

/**
 * Pure: put the MEASURED PM2.5 beside the model at each city that has reference
 * monitors within 20 km (the median of them), and colour the city by the measurement.
 *
 * Why: the model is close in North America, the UK, Germany and Hong Kong, and off by 2x
 * to 7x in Asian haze, dust and burning episodes, which is when people look. Measured on
 * 2026-10-16: Singapore model 14.7 against NEA's 73 to 116; Delhi model 175 against the
 * US Embassy's 67; Mumbai model 74 against 114. The model value stays as a second line.
 */
export function attachMeasured(feats: SignalFeature[], readings: MeasuredReading[]): SignalFeature[] {
  for (const f of feats) {
    const m = measuredNear(f.lat, f.lon, readings);
    if (!m) continue;
    const band = pm25Band(m.pm25);
    f.color = band.color;
    f.title = `${f.title} · measured PM2.5 ${m.pm25.toFixed(1)} (${band.label})`;
    f.props = {
      ...f.props,
      measuredPm25: `${m.pm25.toFixed(1)} µg/m³ (1 h, median of ${m.stations} monitor${m.stations === 1 ? "" : "s"} within 20 km)`,
      measuredAt: m.at,
      measuredBy: m.by,
      colourFrom: "measured PM2.5 (EPA 2024 bands)",
    };
  }
  return feats;
}

export const AIR_QUALITY_SOURCE: SignalSource = {
  id: "airquality",
  // A city-scale model value from Open-Meteo, not a measurement at a point.
  precision: "area",
  label: "Air quality",
  group: "Environment",
  color: "#65a30d",
  refreshMs: 1_800_000, // CAMS air-quality fields update ~hourly; 30 min is comfortable
  attribution: OPEN_METEO_AQ_ATTRIBUTION,
  // Real US-AQI scalar (already a numeric prop) → the detail Value column / sort /
  // slider / Peak KPI, instead of the log-radius proxy. 0 = Good, 300 = Hazardous.
  metric: { field: "usAqi", domain: [0, 300], unit: " AQI" },
  async fetch() {
    try {
      const { latitude, longitude } = cityCoordParams();
      const url =
        `${ENDPOINT}?latitude=${latitude}&longitude=${longitude}` +
        `&current=pm2_5,pm10,us_aqi,us_aqi_pm2_5,us_aqi_pm10,us_aqi_ozone,european_aqi,nitrogen_dioxide,ozone&timezone=GMT`;
      const [res, measured] = await Promise.all([
        fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) }),
        // The model answers in well under a second; the measured feeds (8 MB from
        // Sensor.Community among them) can take longer on a cold read. Wait at most 8 s,
        // then show the model alone; the shared read finishes in the background and the
        // next refresh has it.
        Promise.race([
          fetchMeasuredReadings(),
          new Promise<{ readings: MeasuredReading[] }>((r) => setTimeout(() => r({ readings: [] }), 8_000)),
        ]),
      ]);
      if (!res.ok) return degraded(`http ${res.status}`);
      const json = await res.json();
      const points = Array.isArray(json) ? (json as AqPoint[]) : [json as AqPoint];
      return observed(attachMeasured(normalizeAirQuality(points), measured.readings));
    } catch {
      return degraded("fetch failed");
    }
  },
};
