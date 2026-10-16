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
const KP_1M_URL = "https://services.swpc.noaa.gov/json/planetary_k_index_1m.json";

// THE HEADLINE IS THE 1-MINUTE ESTIMATE (2026-10-16). The pin used to show the last
// 3-hour Kp block, which is up to ~3.5 h old when read: at 18:35 UTC that day it said
// "Kp 3.3" (the 15:00-18:00 block) while SWPC's own 1-minute estimate was 1.33. Its
// `updated` line printed the noaa-scales time (18:32), so the stale value also read as
// current. Now the headline is the 1-minute estimated Kp with ITS time, the last
// official block rides beside it with its own block time, and `updated` is the time
// of the Kp actually shown. The 1-minute feed is skipped when its newest row is over
// an hour old, so a frozen file cannot pose as now.
/** The newest 1-minute Kp row older than this (ms) is not used as the headline. */
export const KP_1M_MAX_AGE_MS = 60 * 60 * 1000;

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
interface Kp1mRow {
  time_tag?: string;
  kp_index?: number;
  estimated_kp?: number;
  kp?: string;
}
export interface SpaceWeatherInput {
  /** NOAA's official 3-hour Kp blocks, oldest first. */
  kp: KpRow[];
  scales0: ScaleBlock | undefined;
  /** SWPC 1-minute estimated Kp, oldest first. Optional: absent falls back to the block. */
  kp1m?: Kp1mRow[];
  /** Clock for the staleness checks (default: no check). Tests pin it. */
  now?: number;
}

/** SWPC time tags carry no zone ("2026-10-16T19:33:00") but are UTC. → ISO with Z. */
export function swpcIso(tag: string | undefined | null): string | undefined {
  if (!tag) return undefined;
  const t = tag.trim().replace(" ", "T");
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`;
  return Number.isFinite(Date.parse(iso)) ? new Date(Date.parse(iso)).toISOString().replace(".000Z", "Z") : undefined;
}

/** "2026-10-16T19:33:00Z" → "2026-10-16 19:33 UTC". */
function utcLine(iso: string | undefined): string {
  return iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : "—";
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
  const block = [...rows].reverse().find((r) => typeof r?.Kp === "number" && Number.isFinite(r.Kp));
  const blockKp = block?.Kp ?? Number.NaN;
  const blockTime = swpcIso(block?.time_tag);

  const minute = [...(input.kp1m ?? [])]
    .reverse()
    .find((r) => typeof r?.estimated_kp === "number" && Number.isFinite(r.estimated_kp) && swpcIso(r.time_tag));
  const minuteTime = swpcIso(minute?.time_tag);
  const minuteFresh =
    minute != null && minuteTime != null && (input.now == null || input.now - Date.parse(minuteTime) <= KP_1M_MAX_AGE_MS);

  const kp = minuteFresh ? (minute!.estimated_kp as number) : blockKp;
  const kpTime = minuteFresh ? minuteTime : blockTime;
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
      ...(kpTime ? { ts: kpTime } : {}),
      props: {
        kp: Number(kp.toFixed(2)),
        kpSource: minuteFresh ? "SWPC 1-minute estimate" : "SWPC 3-hour block",
        ...(Number.isFinite(blockKp) ? { kpBlock: Number(blockKp.toFixed(2)) } : {}),
        ...(blockTime ? { kpBlockStart: blockTime } : {}),
        condition: kpLabel,
        geomagneticStorm: g > 0 ? `G${g}` : "none",
        radioBlackout: r > 0 ? `R${r}` : "none",
        solarRadiation: s > 0 ? `S${s}` : "none",
        // The time of the Kp shown above, not the scales file's time.
        updated: utcLine(kpTime),
        scalesUpdated: sc?.DateStamp && sc?.TimeStamp ? `${sc.DateStamp} ${sc.TimeStamp} UTC` : "—",
        // Kp (0–9) maps almost directly onto our 0–10 marker scale.
        magnitude: Math.min(10, Math.max(2, kp)),
      },
    },
  ];
}

/** GET a JSON file; any failure (status, network, parse) resolves to undefined. */
async function optionalJson<T>(url: string): Promise<T | undefined> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return undefined;
    return (await res.json()) as T;
  } catch {
    return undefined;
  }
}

export const SPACE_WEATHER_SOURCE: SignalSource = {
  id: "space-weather",
  // A planet-wide index. The mark is an anchor at the geomagnetic pole, not a place.
  precision: "area",
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
      const [kpRes, scRes, kp1m] = await Promise.all([
        fetch(KP_URL, { signal: AbortSignal.timeout(15_000) }),
        fetch(SCALES_URL, { signal: AbortSignal.timeout(15_000) }),
        // An extra feed falls back to "not there" on any failure: the 3-hour block
        // is still the official Kp, so it alone decides degraded.
        optionalJson<Kp1mRow[]>(KP_1M_URL),
      ]);
      if (!kpRes.ok) return degraded(`http ${kpRes.status}`);
      const kp = (await kpRes.json()) as KpRow[];
      const scales = scRes.ok ? ((await scRes.json()) as Record<string, ScaleBlock>) : {};
      return observed(
        normalizeSpaceWeather({
          kp: Array.isArray(kp) ? kp : [],
          scales0: scales["0"],
          kp1m: Array.isArray(kp1m) ? kp1m : undefined,
          now: Date.now(),
        }),
      );
    } catch {
      return degraded("fetch failed");
    }
  },
};
