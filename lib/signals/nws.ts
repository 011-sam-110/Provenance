// NOAA National Weather Service — the US warnings and gauge readings that feed the
// floods and severe-storms layers. US public domain, keyless. NWS asks for a
// User-Agent with a contact, which HAZARD_UA carries.
//
//   • api.weather.gov/alerts/active — Tornado, Severe Thunderstorm, Flash Flood and
//     Flood WARNINGS (not watches, not advisories). One request feeds both layers
//     through one 2-minute cache.
//   • NWPS observed river stages (mapservices.weather.noaa.gov riv_gauges) — gauges
//     reading minor, moderate or major flood right now.
//
// Audited 2026-10-16 (sources-audit/eonet.md, candidates 7 and 8): 16 warnings with
// polygons, 15 gauges in flood. Re-probed from provenance-1 the same evening.

import type { SignalFeature, SignalGeometry } from "@/lib/signals/types";
import { getJson, ringCentroid } from "@/lib/signals/multiInput";

export const NWS_ATTRIBUTION = "NOAA National Weather Service";

/** The warning types read, and the layer each belongs to. */
export const NWS_WARNINGS: Readonly<Record<string, { signalId: "floods" | "severeStorms"; color: string }>> = {
  "Flood Warning": { signalId: "floods", color: "#0ea5e9" },
  "Flash Flood Warning": { signalId: "floods", color: "#1d4ed8" },
  "Tornado Warning": { signalId: "severeStorms", color: "#b91c1c" },
  "Severe Thunderstorm Warning": { signalId: "severeStorms", color: "#f59e0b" },
};

export const NWS_ALERTS_URL =
  "https://api.weather.gov/alerts/active?status=actual&event=" +
  encodeURIComponent(Object.keys(NWS_WARNINGS).join(","));

interface NwsAlert {
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: {
    id?: string;
    "@id"?: string;
    event?: string;
    severity?: string;
    areaDesc?: string;
    sent?: string;
    onset?: string;
    expires?: string;
    ends?: string | null;
    headline?: string;
    senderName?: string;
  } | null;
}

/**
 * Pure: active alerts → the warnings of ONE layer, drawn as their polygons.
 *
 * An alert with no polygon is skipped: it names forecast zones, and turning a zone
 * list into a point would place the warning somewhere NWS did not. Measured
 * 2026-10-16: all 16 warnings carried a polygon.
 */
export function nwsAlertsToFeatures(
  json: { features?: NwsAlert[] } | null,
  signalId: "floods" | "severeStorms",
): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const a of json?.features ?? []) {
    const p = a.properties ?? {};
    const kind = NWS_WARNINGS[(p.event ?? "").trim()];
    if (!kind || kind.signalId !== signalId) continue;
    const g = a.geometry;
    let geometry: SignalGeometry | undefined;
    let anchor: { lat: number; lon: number } | null = null;
    if (g?.type === "Polygon" && Array.isArray(g.coordinates)) {
      geometry = { type: "Polygon", coordinates: g.coordinates as [number, number][][] };
      anchor = ringCentroid((g.coordinates as unknown[])[0]);
    } else if (g?.type === "MultiPolygon" && Array.isArray(g.coordinates)) {
      geometry = { type: "MultiPolygon", coordinates: g.coordinates as [number, number][][][] };
      anchor = ringCentroid(((g.coordinates as unknown[][])[0] ?? [])[0]);
    }
    if (!geometry || !anchor) continue;
    const id = (p.id ?? "").trim();
    if (!id) continue;
    const sent = p.sent ? Date.parse(p.sent) : Number.NaN;
    out.push({
      id: `${signalId}:nws:${id}`,
      lat: anchor.lat,
      lon: anchor.lon,
      title: `${p.event} — ${(p.areaDesc ?? "").split(";").slice(0, 2).join(";").trim() || "United States"}`,
      signalId,
      precision: "area",
      geometry,
      color: kind.color,
      link: p["@id"],
      ts: Number.isFinite(sent) ? new Date(sent).toISOString() : undefined,
      props: {
        source: "NOAA NWS",
        warning: p.event,
        severity: p.severity ?? "—",
        area: p.areaDesc ?? "—",
        issuedBy: p.senderName ?? "—",
        until: p.ends ?? p.expires ?? "—",
      },
    });
  }
  return out;
}

const TTL_MS = 2 * 60 * 1000;
let cache: { json: { features?: NwsAlert[] } | null; at: number } | null = null;
let inflight: Promise<{ features?: NwsAlert[] } | null> | null = null;

/** Active NWS warnings, cached two minutes across the two layers. Throws on failure. */
export async function fetchNwsAlerts(now: number = Date.now()): Promise<{ features?: NwsAlert[] } | null> {
  if (cache && now - cache.at < TTL_MS) return cache.json;
  if (!inflight) {
    inflight = getJson<{ features?: NwsAlert[] }>(NWS_ALERTS_URL, 20_000, { Accept: "application/geo+json" })
      .then((json) => {
        cache = { json, at: Date.now() };
        return json;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

// --- observed river stages ----------------------------------------------------------

export const NWS_GAUGES_URL =
  "https://mapservices.weather.noaa.gov/eventdriven/rest/services/water/riv_gauges/MapServer/0/query?" +
  new URLSearchParams({
    where: "status IN ('minor','moderate','major')",
    outFields: "gaugelid,status,location,waterbody,state,obstime,url,units,flood,moderate,major,observed,latitude,longitude",
    returnGeometry: "false",
    f: "json",
  }).toString();

interface GaugeAttrs {
  gaugelid?: string;
  status?: string;
  location?: string;
  waterbody?: string;
  state?: string;
  obstime?: string;
  url?: string;
  units?: string;
  flood?: string;
  moderate?: string;
  major?: string;
  observed?: string;
  latitude?: number;
  longitude?: number;
}

const GAUGE_COLOR: Record<string, string> = { minor: "#38bdf8", moderate: "#0369a1", major: "#1e3a8a" };

/**
 * Pure: NWPS gauges in flood → features. The place is the gauge itself (facility).
 * `obstime` is UTC: at 19:3x UTC on 2026-10-16 the newest reading was "18:30:00".
 */
export function nwsGaugesToFeatures(json: { features?: { attributes?: GaugeAttrs }[] } | null): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const f of json?.features ?? []) {
    const a = f.attributes ?? {};
    const status = (a.status ?? "").toLowerCase();
    if (!GAUGE_COLOR[status]) continue;
    const lat = Number(a.latitude);
    const lon = Number(a.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const id = (a.gaugelid ?? "").trim();
    if (!id) continue;
    const t = a.obstime ? Date.parse(`${a.obstime.replace(" ", "T")}Z`) : Number.NaN;
    const unit = a.units ? ` ${a.units}` : "";
    out.push({
      id: `floods:gauge:${id}`,
      lat,
      lon,
      title: `${a.waterbody ?? "River"} at ${a.location ?? id} — ${status} flooding`,
      signalId: "floods",
      precision: "facility",
      color: GAUGE_COLOR[status],
      link: a.url || undefined,
      ts: Number.isFinite(t) ? new Date(t).toISOString() : undefined,
      props: {
        source: "NOAA NWS river gauges",
        floodCategory: status,
        observed: a.observed ? `${a.observed}${unit}` : "—",
        floodStage: a.flood ? `${a.flood}${unit}` : "—",
        majorStage: a.major ? `${a.major}${unit}` : "—",
        state: a.state ?? "—",
      },
    });
  }
  return out;
}
