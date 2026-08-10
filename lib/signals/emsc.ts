import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { magnitudeColor } from "@/lib/signals/usgs";
import { markCoverage } from "@/lib/signals/coverage";

// Earthquakes — EMSC (European-Mediterranean Seismological Centre) real-time feed.
// A keyless FDSN GeoJSON service that aggregates many national networks, often
// reporting Euro-Med events faster than USGS's 5-minute summary. Runs ALONGSIDE the
// USGS layer (distinct catalogues / ids), giving independent corroboration. Each
// event carries magnitude, depth and a Flynn region name. Confirmed keyless 2026-06-27.

const ENDPOINT = "https://www.seismicportal.eu/fdsnws/event/1/query";
const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

/**
 * The `limit=` the FDSN query asks for. There is no local render cap here — the
 * truncation is entirely upstream, so a response holding exactly this many events
 * means the catalogue had at least this many and we cannot see past the page.
 */
export const EMSC_REQUEST_LIMIT = 500;

export const EMSC_ATTRIBUTION = "Earthquake data © EMSC-CSEM (seismicportal.eu)";

interface EmscFeature {
  id?: string;
  geometry?: { coordinates?: (number | null)[] } | null;
  properties?: {
    mag?: number | null;
    magtype?: string | null;
    depth?: number | null;
    time?: string | null;
    lastupdate?: string | null;
    flynn_region?: string | null;
    auth?: string | null;
    unid?: string | null;
    lat?: number | null;
    lon?: number | null;
  } | null;
}

/**
 * Pure: EMSC FeatureCollection → SignalFeature[]. Skips null-geometry / bad-coord
 * events. Records upstream coverage: the query is paged at `limit`, so a full page
 * means "at least this many", never "this many".
 */
export function normalizeEmsc(
  geojson: { features?: EmscFeature[] },
  limit = EMSC_REQUEST_LIMIT,
): SignalFeature[] {
  const raw = geojson.features ?? [];
  const out: SignalFeature[] = [];
  for (const f of raw) {
    const p = f.properties ?? {};
    const c = f.geometry?.coordinates;
    // EMSC carries lat/lon in properties too; prefer geometry, fall back to props.
    const lon = c?.[0] != null ? Number(c[0]) : p.lon != null ? Number(p.lon) : Number.NaN;
    const lat = c?.[1] != null ? Number(c[1]) : p.lat != null ? Number(p.lat) : Number.NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    const unid = (p.unid ?? f.id ?? "").toString().trim();
    if (!unid) continue;
    const mag = typeof p.mag === "number" && Number.isFinite(p.mag) ? p.mag : 0;
    const depth = typeof p.depth === "number" ? p.depth : null;
    const region = p.flynn_region?.trim() || "Unknown region";
    out.push({
      id: `emsc:${unid}`,
      lat,
      lon,
      title: `M ${mag.toFixed(1)} — ${region}`,
      signalId: "emsc-quakes",
      color: magnitudeColor(mag),
      link: `https://www.seismicportal.eu/eventdetails.html?unid=${unid}`,
      ts: p.time ?? undefined,
      props: {
        magnitude: Number(mag.toFixed(1)), // radius driver
        depth: depth != null ? `${depth.toFixed(1)} km` : "—",
        region,
        magType: p.magtype ?? "—",
        agency: p.auth ?? "—",
      },
    });
  }
  return markCoverage(out, {
    noun: "events",
    rule: "the first page the EMSC FDSN service returned",
    upstream: { limit, count: raw.length },
  });
}

export const EMSC_SOURCE: SignalSource = {
  id: "emsc-quakes",
  label: "Earthquakes (EMSC)",
  group: "Natural hazards",
  color: "#f59e0b",
  refreshMs: 60_000,
  attribution: EMSC_ATTRIBUTION,
  metric: { field: "magnitude", domain: [2, 8] }, // Richter → magnitude bar
  async fetch() {
    try {
      const res = await fetch(`${ENDPOINT}?limit=${EMSC_REQUEST_LIMIT}&format=json`, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return [];
      const json = (await res.json()) as { features?: EmscFeature[] };
      return normalizeEmsc(json);
    } catch {
      return [];
    }
  },
};
