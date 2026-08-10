import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { countMagnitude } from "@/lib/signals/aggregate";
import { applyCap } from "@/lib/signals/coverage";

// Active fire detections — NASA FIRMS (VIIRS S-NPP near-real-time). Satellite
// thermal anomalies for the last 24h worldwide, each with a fire radiative power
// (FRP, MW) and detection confidence. Complements the EONET wildfire EVENTS layer
// with raw per-pixel detections. Key-gated: set FIRMS_MAP_KEY (free) to enable;
// dormant (→ []) until then. A whole-world day can be tens of thousands of pixels,
// so we keep the most intense CAP detections by FRP. Confirmed live 2026-06-27.

const BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv";
const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

/** Most intense detections kept (by FRP), to keep the layer legible. */
export const FIRMS_CAP = 1500;

export const FIRMS_ATTRIBUTION = "Active fire data © NASA FIRMS (VIIRS S-NPP NRT)";

/** VIIRS confidence flag → label. (MODIS would be numeric; handled if it ever is.) */
function confidenceLabel(c: string): string {
  const v = c.trim().toLowerCase();
  if (v === "h" || v === "high") return "high";
  if (v === "n" || v === "nominal") return "nominal";
  if (v === "l" || v === "low") return "low";
  const n = Number(v);
  if (Number.isFinite(n)) return n >= 80 ? "high" : n >= 30 ? "nominal" : "low";
  return "—";
}

/** Red ramp by fire radiative power (MW). */
export function fireColor(frp: number): string {
  if (frp >= 100) return "#7f1d1d";
  if (frp >= 50) return "#b91c1c";
  if (frp >= 20) return "#dc2626";
  if (frp >= 5) return "#ea580c";
  return "#f97316";
}

/** FIRMS naive-UTC acq_date (YYYY-MM-DD) + acq_time (HHMM, no leading zeros) → ISO. */
function acqIso(date: string, time: string): string | undefined {
  if (!date) return undefined;
  const hhmm = (time || "0").padStart(4, "0");
  const t = Date.parse(`${date}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

/**
 * Pure: FIRMS CSV → SignalFeature[], keeping the top `cap` by FRP.
 *
 * A whole-world VIIRS day runs to tens of thousands of pixels, so the returned
 * array carries a coverage record (lib/signals/coverage.ts) saying how many
 * detections the CSV actually held — otherwise "1,500 fires" reads as the number
 * of fires burning rather than the number we chose to draw.
 */
export function normalizeFirms(csv: string, cap = FIRMS_CAP): SignalFeature[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const cols = lines[0].split(",").map((c) => c.trim());
  const idx = (name: string) => cols.indexOf(name);
  const iLat = idx("latitude"), iLon = idx("longitude"), iFrp = idx("frp");
  const iConf = idx("confidence"), iDate = idx("acq_date"), iTime = idx("acq_time");
  const iBright = idx("bright_ti4"), iSat = idx("satellite"), iDN = idx("daynight");

  const rows: SignalFeature[] = [];
  for (let r = 1; r < lines.length; r++) {
    const p = lines[r].split(",");
    const latRaw = (p[iLat] ?? "").trim();
    const lonRaw = (p[iLon] ?? "").trim();
    if (!latRaw || !lonRaw) continue; // empty cell — Number("") is 0, so guard first
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    const frp = Number(p[iFrp]);
    const frpVal = Number.isFinite(frp) ? frp : 0;
    const conf = confidenceLabel(p[iConf] ?? "");
    const date = (p[iDate] ?? "").trim();
    const time = (p[iTime] ?? "").trim();
    rows.push({
      id: `fire:${lat.toFixed(4)},${lon.toFixed(4)}@${date}${time}`,
      lat,
      lon,
      title: `Active fire — ${frpVal.toFixed(0)} MW (${conf})`,
      signalId: "fire-active",
      color: fireColor(frpVal),
      ts: acqIso(date, time),
      props: {
        frp: `${frpVal.toFixed(1)} MW`,
        confidence: conf,
        brightness: iBright >= 0 ? `${Number(p[iBright]).toFixed(0)} K` : "—",
        satellite: iSat >= 0 ? p[iSat] : "—",
        daynight: iDN >= 0 ? (p[iDN] === "D" ? "day" : p[iDN] === "N" ? "night" : "—") : "—",
        detected: acqIso(date, time) ?? "—",
        magnitude: countMagnitude(frpVal),
      },
    });
  }
  rows.sort((a, b) => (Number(b.props?.magnitude) || 0) - (Number(a.props?.magnitude) || 0));
  return applyCap(rows, cap, {
    noun: "fire detections",
    rule: "the most intense by fire radiative power",
  });
}

export const FIRE_FIRMS_SOURCE: SignalSource = {
  id: "fire-active",
  label: "Active fires (FIRMS)",
  group: "Natural hazards",
  color: "#dc2626",
  refreshMs: 30 * 60 * 1000, // FIRMS NRT updates a few times a day
  attribution: FIRMS_ATTRIBUTION,
  async fetch() {
    const key = (process.env.FIRMS_MAP_KEY ?? "").trim();
    if (!key) return []; // dormant until the free MAP_KEY is set
    try {
      const res = await fetch(`${BASE}/${key}/VIIRS_SNPP_NRT/world/1`, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return [];
      return normalizeFirms(await res.text());
    } catch {
      return [];
    }
  },
};
