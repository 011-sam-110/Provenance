import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { degraded, observed } from "@/lib/signals/outcome";

// Tropical cyclones — NOAA NHC active-storms feed (keyless). Named tropical
// systems (depressions → major hurricanes) with live position, intensity and
// motion. The feed is `{ activeStorms: [] }` when nothing is active (quiet
// season), so the layer renders empty and lights up automatically the moment a
// storm forms — no dead feed, no stale dot. Each storm is plotted at its current
// centre, coloured by Saffir–Simpson category and sized by max wind.
//
// NOTE: the NHC forecast CONE/track are GIS shapefiles, not in this JSON; v1
// plots the storm centre only. Dormant-safe (→ [] on any failure).

const ENDPOINT = "https://www.nhc.noaa.gov/CurrentStorms.json";
const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

export const NHC_ATTRIBUTION = "Tropical-cyclone data © NOAA NHC";

interface NhcStorm {
  id?: string;
  name?: string;
  classification?: string; // TD, TS, HU, MH, STD, STS, …
  intensity?: string | number; // max sustained wind, kt
  pressure?: string | number; // mb
  latitude?: string; // "22.5N"
  longitude?: string; // "95.3W"
  latitudeNumeric?: number;
  longitudeNumeric?: number;
  movementDir?: number | string;
  movementSpeed?: number | string;
  lastUpdate?: string;
}

function toNum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : Number.NaN;
  const s = (v ?? "").toString().trim();
  if (s === "") return Number.NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Parse "22.5N" / "95.3W" → signed decimal degrees. */
function parseCoord(s: string | undefined): number {
  if (!s) return Number.NaN;
  const m = s.trim().match(/^([\d.]+)\s*([NSEW])$/i);
  if (!m) return Number.NaN;
  const v = Number(m[1]);
  if (!Number.isFinite(v)) return Number.NaN;
  const hemi = m[2].toUpperCase();
  return hemi === "S" || hemi === "W" ? -v : v;
}

/** Classification + max-wind (kt) → {label, colour} on the Saffir–Simpson scale. */
export function cycloneCategory(classification: string, windKt: number): { label: string; color: string } {
  const c = (classification || "").toUpperCase();
  if (c.includes("HU") || c.includes("MH") || windKt >= 64) {
    if (windKt >= 137) return { label: "Cat 5 hurricane", color: "#581c87" };
    if (windKt >= 113) return { label: "Cat 4 hurricane", color: "#7f1d1d" };
    if (windKt >= 96) return { label: "Cat 3 hurricane", color: "#b91c1c" };
    if (windKt >= 83) return { label: "Cat 2 hurricane", color: "#dc2626" };
    return { label: "Cat 1 hurricane", color: "#ea580c" };
  }
  if (c.includes("TS") || windKt >= 34) return { label: "tropical storm", color: "#f59e0b" };
  return { label: "tropical depression", color: "#eab308" };
}

/** Pure: NHC active-storms payload → SignalFeature[] (one point per storm). */
export function normalizeCyclones(json: { activeStorms?: NhcStorm[] }): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const s of json.activeStorms ?? []) {
    let lat = typeof s.latitudeNumeric === "number" ? s.latitudeNumeric : parseCoord(s.latitude);
    let lon = typeof s.longitudeNumeric === "number" ? s.longitudeNumeric : parseCoord(s.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    lat = Math.round(lat * 1000) / 1000;
    lon = Math.round(lon * 1000) / 1000;
    const wind = Math.max(0, toNum(s.intensity) || 0);
    const cat = cycloneCategory(s.classification ?? "", wind);
    const name = s.name?.trim() || s.id?.trim() || "Tropical system";
    const dir = toNum(s.movementDir);
    const spd = toNum(s.movementSpeed);
    const pressure = toNum(s.pressure);
    out.push({
      id: `cyclone:${s.id?.trim() || name}`,
      lat,
      lon,
      title: `${name} — ${cat.label}`,
      signalId: "tropical-cyclones",
      color: cat.color,
      ts: s.lastUpdate ?? undefined,
      props: {
        storm: name,
        category: cat.label,
        maxWind: wind > 0 ? `${wind} kt` : "—",
        // Real scalar behind the metric bar: max sustained wind in knots.
        windKt: wind,
        pressure: Number.isFinite(pressure) ? `${pressure} mb` : "—",
        movement:
          Number.isFinite(dir) && Number.isFinite(spd) ? `${dir}° at ${spd} kt` : "—",
        updated: s.lastUpdate ?? "—",
        // Wind 137 kt (Cat 5) ≈ max radius.
        magnitude: Math.min(10, Math.max(3, wind / 15)),
      },
    });
  }
  return out;
}

export const TROPICAL_CYCLONES_SOURCE: SignalSource = {
  id: "tropical-cyclones",
  label: "Tropical cyclones (NHC)",
  group: "Natural hazards",
  color: "#dc2626",
  refreshMs: 30 * 60 * 1000,
  attribution: NHC_ATTRIBUTION,
  // Max sustained wind (kt): calm ≈ tropical-storm threshold (34 kt),
  // extreme ≈ a strong Cat 5 (≥160 kt).
  metric: { field: "windKt", domain: [34, 160], unit: " kt" },
  async fetch() {
    try {
      const res = await fetch(ENDPOINT, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return degraded(`http ${res.status}`);
      const json = (await res.json()) as { activeStorms?: NhcStorm[] };
      return observed(normalizeCyclones(json));
    } catch {
      return degraded("fetch failed");
    }
  },
};
