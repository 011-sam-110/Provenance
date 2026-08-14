import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { degraded, observed } from "@/lib/signals/outcome";

// Space weather — NOAA SWPC. A global "status" signal: the planetary K-index
// (geomagnetic activity, 0–9) plus the current NOAA storm scales — G (geomagnetic),
// R (radio blackout) and S (solar radiation). High activity degrades GPS, HF radio
// and power grids and pushes the aurora to lower latitudes, so it belongs in the
// intel picture. Rendered as a single status pin at the north geomagnetic pole,
// sized by Kp and coloured by the G-scale. Keyless; dormant-safe (→ [] on failure).

const KP_URL = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json";
const SCALES_URL = "https://services.swpc.noaa.gov/products/noaa-scales.json";

// North geomagnetic pole (≈2025) — the natural anchor for a geomagnetic-status pin.
const GEOMAG_NORTH: [number, number] = [80.7, -72.7];

export const SWPC_ATTRIBUTION = "Space-weather data © NOAA SWPC";

interface KpRow {
  time_tag?: string;
  Kp?: number;
  a_running?: number;
  station_count?: number;
}
interface ScaleBlock {
  DateStamp?: string;
  TimeStamp?: string;
  R?: { Scale?: string | null; Text?: string | null };
  S?: { Scale?: string | null; Text?: string | null };
  G?: { Scale?: string | null; Text?: string | null };
}
export interface SpaceWeatherInput {
  kp: KpRow[];
  scales0: ScaleBlock | undefined;
}

/** NOAA G-scale (0–5) → colour (quiet green → severe red). */
export function gScaleColor(scale: number): string {
  switch (scale) {
    case 0: return "#16a34a"; // quiet
    case 1: return "#eab308"; // minor
    case 2: return "#f59e0b"; // moderate
    case 3: return "#ea580c"; // strong
    case 4: return "#dc2626"; // severe
    default: return "#7f1d1d"; // 5+ extreme
  }
}

function scaleNum(s: string | null | undefined): number {
  const n = Number((s ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

/** Pure: latest Kp + current NOAA scales → a single space-weather status feature. */
export function normalizeSpaceWeather(input: SpaceWeatherInput): SignalFeature[] {
  const rows = input.kp ?? [];
  const latest = rows.length ? rows[rows.length - 1] : undefined;
  const kp = typeof latest?.Kp === "number" ? latest.Kp : Number.NaN;
  if (!Number.isFinite(kp)) return [];

  const sc = input.scales0;
  const g = scaleNum(sc?.G?.Scale);
  const r = scaleNum(sc?.R?.Scale);
  const s = scaleNum(sc?.S?.Scale);
  const kpLabel = kp >= 7 ? "severe storm" : kp >= 5 ? "storm" : kp >= 4 ? "unsettled" : "quiet";

  return [
    {
      id: "swpc:status",
      lat: GEOMAG_NORTH[0],
      lon: GEOMAG_NORTH[1],
      title: `Space weather — Kp ${kp.toFixed(1)} (${kpLabel})`,
      signalId: "space-weather",
      color: gScaleColor(g),
      props: {
        kp: Number(kp.toFixed(2)),
        condition: kpLabel,
        geomagneticStorm: g > 0 ? `G${g}` : "none",
        radioBlackout: r > 0 ? `R${r}` : "none",
        solarRadiation: s > 0 ? `S${s}` : "none",
        updated: sc?.DateStamp && sc?.TimeStamp ? `${sc.DateStamp} ${sc.TimeStamp} UTC` : "—",
        // Kp (0–9) maps almost directly onto our 0–10 marker scale.
        magnitude: Math.min(10, Math.max(2, kp)),
      },
    },
  ];
}

export const SPACE_WEATHER_SOURCE: SignalSource = {
  id: "space-weather",
  label: "Space weather (NOAA Kp/storms)",
  group: "Space weather",
  color: "#16a34a",
  refreshMs: 15 * 60 * 1000,
  attribution: SWPC_ATTRIBUTION,
  kind: "forecast", // a single geomagnetic INDEX → the forecast focus view (gauge + scales)
  // Real scalar: the planetary K-index (geomagnetic activity), 0 (quiet) → 9 (max
  // storm) — not the rescaled `magnitude` radius proxy.
  metric: { field: "kp", domain: [0, 9] },
  forecast: {
    quietBelow: 4, // Kp < 4 = quiet → compact all-clear
    quietNote: "Quiet — no geomagnetic storm. GPS, HF radio and power grids nominal; no aurora at mid-latitudes.",
    scaleKeys: ["geomagneticStorm", "radioBlackout", "solarRadiation"],
    bands: [
      { min: 0, label: "Quiet", color: "#16a34a" },
      { min: 4, label: "Unsettled", color: "#eab308" },
      { min: 5, label: "Minor storm (G1)", color: "#f59e0b" },
      { min: 6, label: "Moderate storm (G2)", color: "#ea580c" },
      { min: 7, label: "Strong storm (G3+)", color: "#dc2626" },
    ],
  },
  async fetch() {
    try {
      const [kpRes, scRes] = await Promise.all([
        fetch(KP_URL, { signal: AbortSignal.timeout(15_000) }),
        fetch(SCALES_URL, { signal: AbortSignal.timeout(15_000) }),
      ]);
      if (!kpRes.ok) return degraded(`http ${kpRes.status}`);
      const kp = (await kpRes.json()) as KpRow[];
      const scales = scRes.ok ? ((await scRes.json()) as Record<string, ScaleBlock>) : {};
      return observed(normalizeSpaceWeather({ kp: Array.isArray(kp) ? kp : [], scales0: scales["0"] }));
    } catch {
      return degraded("fetch failed");
    }
  },
};
