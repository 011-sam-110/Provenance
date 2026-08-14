import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { applyCap } from "@/lib/signals/coverage";
import { degraded, observed } from "@/lib/signals/outcome";

// Air quality — real station measurements (OpenAQ v3). This is the measured
// counterpart to the modelled CAMS/Open-Meteo air-quality layer: actual PM2.5
// readings from ~25k reference + low-cost monitors worldwide. We pull the global
// "latest PM2.5" snapshot (one capped page) and plot each station coloured by the
// US-EPA PM2.5 band. Key-gated on OPENAQ_API_KEY (free); dormant (→ []) until set.
//
// Real-world data hygiene: OpenAQ passes through raw sensor values, which include
// error sentinels (-1, -9999) and zeros — the normaliser rejects anything ≤ 0 or
// implausibly high so the map never shows a phantom "clean" or broken station.

const PM25_LATEST_URL = "https://api.openaq.org/v3/parameters/2/latest?limit=1000";

/** Page cap — OpenAQ reports ~25k PM2.5 stations; we plot a global sample of this many. */
export const OPENAQ_CAP = 1000;
const MAX_PLAUSIBLE_PM25 = 2000; // µg/m³ — above this is a sensor fault, not air

export const OPENAQ_ATTRIBUTION = "Air-quality measurements © OpenAQ contributors";

interface AqLatest {
  datetime?: { utc?: string };
  value?: number;
  coordinates?: { latitude?: number | null; longitude?: number | null };
  sensorsId?: number;
  locationsId?: number;
}

/** US-EPA PM2.5 band → {label, colour}. */
export function pm25Band(v: number): { label: string; color: string } {
  if (v <= 12) return { label: "good", color: "#16a34a" };
  if (v <= 35.4) return { label: "moderate", color: "#eab308" };
  if (v <= 55.4) return { label: "unhealthy (sensitive)", color: "#f59e0b" };
  if (v <= 150.4) return { label: "unhealthy", color: "#dc2626" };
  if (v <= 250.4) return { label: "very unhealthy", color: "#7e22ce" };
  return { label: "hazardous", color: "#7f1d1d" };
}

/** Pure: OpenAQ latest-PM2.5 payload → SignalFeature[], dropping invalid/error readings. */
export function normalizeAirStations(json: { results?: AqLatest[] }): SignalFeature[] {
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
        airQuality: band.label,
        station: `#${r.locationsId}`,
        measured: r.datetime?.utc ?? "—",
        // Worse air → bigger marker (PM2.5 150 ≈ max radius).
        magnitude: Math.min(10, Math.max(2, v / 15)),
      },
    });
  }
  // The truncation happens UPSTREAM: the request asks for one 1,000-row page out of
  // OpenAQ's ~25k PM2.5 stations. A full page means the real station count is
  // higher and we cannot see how much higher — so `available` is a lower bound and
  // the payload says "1,000 of 1,000+", never a bare "1,000 stations".
  return applyCap(out, OPENAQ_CAP, {
    noun: "stations",
    rule: "the first page OpenAQ returned — not a ranking",
    upstream: { limit: OPENAQ_CAP, count: results.length },
  });
}

export const AIR_QUALITY_STATIONS_SOURCE: SignalSource = {
  id: "air-quality-stations",
  label: "Air quality — stations (OpenAQ)",
  group: "Environment",
  color: "#dc2626",
  refreshMs: 30 * 60 * 1000,
  attribution: OPENAQ_ATTRIBUTION,
  async fetch() {
    const key = (process.env.OPENAQ_API_KEY ?? "").trim();
    if (!key) return degraded("no key"); // dormant until the free key is set
    try {
      const res = await fetch(PM25_LATEST_URL, {
        headers: { "X-API-Key": key, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return degraded(`http ${res.status}`);
      const json = (await res.json()) as { results?: AqLatest[] };
      return observed(normalizeAirStations(json));
    } catch {
      return degraded("fetch failed");
    }
  },
};
