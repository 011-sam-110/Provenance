import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { magnitudeColor } from "@/lib/signals/usgs";
import { markCoverage } from "@/lib/signals/coverage";
import { degraded, observed } from "@/lib/signals/outcome";

// Earthquakes — EMSC (European-Mediterranean Seismological Centre) real-time feed.
// A keyless FDSN GeoJSON service that aggregates many national networks, often
// reporting Euro-Med events faster than USGS's 5-minute summary. Runs ALONGSIDE the
// USGS layer (distinct catalogues / ids), giving independent corroboration. Each
// event carries magnitude, depth and a Flynn region name. Confirmed keyless 2026-06-27.

const ENDPOINT = "https://www.seismicportal.eu/fdsnws/event/1/query";
const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

/**
 * The window the FDSN query asks for, in hours. It matches the USGS layer's 24 h.
 *
 * Until 2026-10-16 the query had no `starttime` and asked for the newest 500 events
 * of the whole catalogue. Measured that day: those 500 reached back about 36 hours,
 * while the last 24 hours held 328 events (`/count` agreed). So the layer showed a
 * ragged window of no fixed length. Asking for a fixed window makes the answer
 * complete.
 */
export const EMSC_WINDOW_HOURS = 24;

/**
 * The `limit=` the FDSN query asks for. There is no local render cap here — the
 * truncation is entirely upstream, so a response holding exactly this many events
 * means the window had at least this many and we cannot see past the page. A 24 h
 * window held 328 events on 2026-10-16 and 48 h held 700, so 2000 is far above a
 * normal day.
 */
export const EMSC_REQUEST_LIMIT = 2000;

/** Pure: the FDSN query for the window that ends at `now`. */
export function emscEndpoint(now: number): string {
  const start = new Date(now - EMSC_WINDOW_HOURS * 3_600_000).toISOString().slice(0, 19);
  return `${ENDPOINT}?starttime=${start}&limit=${EMSC_REQUEST_LIMIT}&orderby=time&format=json`;
}

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
    rule: `every EMSC event in the past ${EMSC_WINDOW_HOURS} hours`,
    upstream: { limit, count: raw.length },
  });
}

export const EMSC_SOURCE: SignalSource = {
  id: "emsc-quakes",
  // An instrument-located epicentre.
  precision: "exact",
  label: "Earthquakes (EMSC)",
  group: "Natural hazards",
  color: "#f59e0b",
  refreshMs: 60_000,
  attribution: EMSC_ATTRIBUTION,
  metric: { field: "magnitude", domain: [2, 8] }, // Richter → magnitude bar
  async fetch() {
    try {
      const res = await fetch(emscEndpoint(Date.now()), {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      // FDSN answers a window with no events as 204 and no body. That is a quiet
      // window, not a failure, and res.json() would throw on it.
      if (res.status === 204) return observed(normalizeEmsc({ features: [] }));
      if (!res.ok) return degraded(`http ${res.status}`);
      const json = (await res.json()) as { features?: EmscFeature[] };
      return observed(normalizeEmsc(json));
    } catch {
      return degraded("fetch failed");
    }
  },
};
