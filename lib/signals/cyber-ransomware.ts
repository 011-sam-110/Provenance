import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { centroidByIso2 } from "@/lib/signals/country-centroids.data";
import { countMagnitude, groupByCountry } from "@/lib/signals/aggregate";
import { degraded, observed } from "@/lib/signals/outcome";

// Recent ransomware victims — keyless Ransomware.live. Aggregates the public
// leak-site claims of the last days by victim COUNTRY (ISO-2), so the map shows
// where organisations are being hit right now, with the active gangs and sectors.
// Country-coded only (no street address), so one marker per country at its centroid,
// sized by victim count. Confirmed keyless 2026-06-27 (v2 API).

const ENDPOINT = "https://api.ransomware.live/v2/recentvictims";
const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

export const RANSOMWARE_LIVE_ATTRIBUTION = "Ransomware victim data © Ransomware.live";

interface RwRow {
  victim?: string;
  group?: string; // ransomware gang / leak-site name
  activity?: string | null; // victim sector
  attackdate?: string; // ISO timestamp
  country?: string; // ISO-3166 alpha-2 ("" when unknown)
}

/** Magenta/purple ramp by the number of victims in a country. */
export function ransomwareColor(n: number): string {
  if (n >= 15) return "#581c87";
  if (n >= 6) return "#7e22ce";
  if (n >= 2) return "#9333ea";
  return "#a855f7";
}

function latestDate(rows: RwRow[]): string | undefined {
  let best = 0;
  for (const r of rows) {
    const t = r.attackdate ? Date.parse(r.attackdate) : NaN;
    if (Number.isFinite(t) && t > best) best = t;
  }
  return best ? new Date(best).toISOString().slice(0, 10) : undefined;
}

/** Pure: Ransomware.live rows → one aggregated SignalFeature per country (with a centroid). */
export function normalizeRansomware(rows: RwRow[]): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const [cc, list] of groupByCountry(rows, (r) => r.country)) {
    const ctr = centroidByIso2(cc);
    if (!ctr) continue;
    const groups = [...new Set(list.map((r) => r.group).filter(Boolean))] as string[];
    const sectors = [...new Set(list.map((r) => r.activity).filter(Boolean))] as string[];
    out.push({
      id: `cyber-ransomware:${cc}`,
      lat: ctr.lat,
      lon: ctr.lon,
      title: `${ctr.name} — ${list.length} ransomware victim${list.length === 1 ? "" : "s"}`,
      signalId: "cyber-ransomware",
      color: ransomwareColor(list.length),
      props: {
        country: ctr.name,
        victims: list.length,
        gangs: groups.length ? groups.join(", ") : "—",
        sectors: sectors.length ? sectors.slice(0, 6).join(", ") : "—",
        latestClaim: latestDate(list) ?? "—",
        magnitude: countMagnitude(list.length),
      },
    });
  }
  return out;
}

export const CYBER_RANSOMWARE_SOURCE: SignalSource = {
  id: "cyber-ransomware",
  label: "Ransomware victims",
  group: "Cyber threat",
  color: "#9333ea",
  refreshMs: 1_800_000, // leak-site claims trickle in; 30 min is plenty
  attribution: RANSOMWARE_LIVE_ATTRIBUTION,
  sourceUrl: "https://www.ransomware.live/", // provider dataset for the dossier's clickable source

  // Real scalar: recent ransomware victims claimed in that country (not the radius proxy).
  // Calm ≈ a single victim; extreme ≈ the ramp's top bucket (a country under a wave).
  metric: { field: "victims", domain: [1, 15] },
  async fetch() {
    try {
      const res = await fetch(ENDPOINT, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return degraded(`http ${res.status}`);
      const json = (await res.json()) as RwRow[];
      if (!Array.isArray(json)) return degraded("bad json");
      return observed(normalizeRansomware(json));
    } catch {
      return degraded("fetch failed");
    }
  },
};
