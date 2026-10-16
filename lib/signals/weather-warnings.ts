import type { SignalFeature, SignalGeometry, SignalSource } from "@/lib/signals/types";
import { degraded, degradedWith, observed } from "@/lib/signals/outcome";
import { markCoverage } from "@/lib/signals/coverage";

// Official weather warnings — what national weather services tell people to do now.
//
//   NWS (US)    api.weather.gov active alerts (CAP). US federal work, public domain;
//               NWS asks for a User-Agent that identifies the caller.
//   ECCC        Environment and Climate Change Canada's weather alerts (OGC API),
//   (Canada)    each with its own polygon. ECCC Data Servers End-use Licence: free,
//               with the credit "Source: Environment and Climate Change Canada".
//
// WHY A LAYER OF ITS OWN and not more GDACS rows (source audit of 2026-10-16): GDACS
// rates the impact of a disaster at an international scale, a CAP warning is a local
// instruction (a freeze warning for three counties). Mixing the two scales in one
// colour ramp would misread both.
//
// WHERE AN NWS ALERT IS DRAWN. NWS gives a polygon only for storm-based warnings
// (tornado, severe thunderstorm, flash flood, special marine): 30 of 612 alerts on
// 2026-10-16. Every other alert names forecast zones, which the API serves one
// request per zone (1,244 distinct zones for that day's Severe and Extreme alerts
// alone), so the zones are not fetched. Instead such an alert is placed at the mean of
// the internal points of the COUNTIES it names (its SAME codes, through the Census
// Gazetteer table in us-county-centroids.data.ts) and drawn as an area disc, with its
// area text in the panel. To keep the map readable, a zone-only alert is shown when
// NWS rates it Severe or Extreme; Minor and Moderate zone-only alerts (468 that day)
// are counted in the coverage note, not drawn. A marine alert names no county and is
// counted the same way.
//
// FAILURE. Each service is read on its own. One failing keeps the other's warnings
// and the layer says which failed.
//
// Not built (named in the audit, and why): MeteoAlarm (Europe) — its feeds state
// "terms equivalent to CC BY 4.0, with additional requirements for redistributing
// outlined in our Terms and Conditions", and that page renders only in a browser
// and could not be read; its areas are EMMA_ID codes with no geometry in the feed.
// India's SACHET — its per-alert polygon file answers 403, and its areas are LGD
// district codes with no keyless geometry.

const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";
const NWS = "https://api.weather.gov/alerts/active?status=actual";
const ECCC_ALERTS = "https://api.weather.gc.ca/collections/weather-alerts/items?f=json&limit=1000";

export const WEATHER_WARNINGS_ATTRIBUTION =
  "Weather alerts: US National Weather Service (NOAA); Source: Environment and Climate Change Canada";

const SEVERITY_COLOR: Record<string, string> = {
  extreme: "#7f1d1d",
  severe: "#dc2626",
  moderate: "#f97316",
  minor: "#facc15",
};

/** Round a coordinate to 4 decimals (about 10 m), which is far finer than any warning area. */
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

function cleanRing(ring: unknown): [number, number][] | null {
  if (!Array.isArray(ring)) return null;
  const out: [number, number][] = [];
  for (const p of ring) {
    if (!Array.isArray(p)) continue;
    const lon = Number(p[0]);
    const lat = Number(p[1]);
    if (Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) out.push([r4(lon), r4(lat)]);
  }
  return out.length >= 4 ? out : null;
}

/** Pure: a GeoJSON Polygon / MultiPolygon → a clean SignalGeometry and its anchor. */
export function polygonOf(geometry: { type?: string; coordinates?: unknown } | null | undefined):
  | { geometry: SignalGeometry; lat: number; lon: number }
  | null {
  if (!geometry) return null;
  let polys: [number, number][][][] = [];
  if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
    const rings = (geometry.coordinates as unknown[]).map(cleanRing).filter((r): r is [number, number][] => r !== null);
    if (rings.length) polys = [rings];
  } else if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    for (const poly of geometry.coordinates as unknown[]) {
      if (!Array.isArray(poly)) continue;
      const rings = poly.map(cleanRing).filter((r): r is [number, number][] => r !== null);
      if (rings.length) polys.push(rings);
    }
  }
  if (polys.length === 0) return null;
  const outer = polys.map((p) => p[0]!).sort((a, b) => b.length - a.length)[0]!;
  const pts = outer.slice(0, -1);
  const lat = r4(pts.reduce((s, p) => s + p[1], 0) / pts.length);
  const lon = r4(pts.reduce((s, p) => s + p[0], 0) / pts.length);
  return {
    geometry: polys.length === 1 ? { type: "Polygon", coordinates: polys[0]! } : { type: "MultiPolygon", coordinates: polys },
    lat,
    lon,
  };
}

// --- NWS ---------------------------------------------------------------------------------

interface NwsAlert {
  id?: string;
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: {
    id?: string;
    event?: string;
    severity?: string;
    certainty?: string;
    urgency?: string;
    headline?: string | null;
    areaDesc?: string;
    sent?: string;
    effective?: string;
    expires?: string;
    ends?: string | null;
    senderName?: string;
    messageType?: string;
    status?: string;
    geocode?: { SAME?: string[]; UGC?: string[] };
  } | null;
}

export type CountyTable = Readonly<Record<string, readonly [number, number]>>;

/** Pure: the counties an alert's SAME codes name → their mean internal point, or null. */
export function countyAnchor(same: readonly string[] | undefined, counties: CountyTable): { lat: number; lon: number; n: number } | null {
  let lat = 0;
  let lon = 0;
  let n = 0;
  for (const code of same ?? []) {
    // A SAME code is "0" + the 5-digit county FIPS; a marine zone's is not a county.
    const c = counties[code.length === 6 ? code.slice(1) : code];
    if (!c) continue;
    lat += c[0];
    lon += c[1];
    n += 1;
  }
  return n ? { lat: r4(lat / n), lon: r4(lon / n), n } : null;
}

const iso = (s: string | null | undefined) => {
  const t = s ? Date.parse(s) : Number.NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
};

/** Pure: NWS active alerts → features. Returns the rows and how many were not drawn, and why. */
export function normalizeNws(
  fc: { features?: NwsAlert[] },
  counties: CountyTable,
  now: number,
): { rows: SignalFeature[]; total: number; skipped: number } {
  const rows: SignalFeature[] = [];
  const all = fc.features ?? [];
  let skipped = 0;
  for (const a of all) {
    const p = a.properties ?? {};
    const id = (p.id ?? a.id ?? "").trim();
    if (!id || (p.status ?? "Actual") !== "Actual" || p.messageType === "Cancel") {
      skipped++;
      continue;
    }
    const end = Date.parse(p.ends ?? p.expires ?? "");
    if (Number.isFinite(end) && end < now) {
      skipped++;
      continue;
    }
    const severity = (p.severity ?? "Unknown").trim();
    const poly = polygonOf(a.geometry);
    let place: { lat: number; lon: number; geometry?: SignalGeometry } | null = poly;
    let placedBy = "NWS polygon";
    if (!poly) {
      const anchor = /^(severe|extreme)$/i.test(severity) ? countyAnchor(p.geocode?.SAME, counties) : null;
      if (!anchor) {
        skipped++;
        continue;
      }
      place = { lat: anchor.lat, lon: anchor.lon };
      placedBy = `centre of ${anchor.n} ${anchor.n === 1 ? "county" : "counties"} named`;
    }
    const event = (p.event ?? "Weather alert").trim();
    rows.push({
      id: `wx:nws:${id.replace(/^.*?urn:oid:/, "")}`,
      lat: place!.lat,
      lon: place!.lon,
      ...(place!.geometry ? { geometry: place!.geometry } : {}),
      title: `${event}: ${(p.areaDesc ?? "").split(";").slice(0, 3).join(";").trim()}${(p.areaDesc ?? "").split(";").length > 3 ? "…" : ""}`,
      signalId: "weather-warnings",
      color: SEVERITY_COLOR[severity.toLowerCase()] ?? "#64748b",
      link: /^https:\/\/api\.weather\.gov\/alerts\//.test(a.id ?? "") ? a.id : "https://www.weather.gov/",
      ts: iso(p.effective ?? p.sent),
      props: {
        event,
        severity,
        certainty: p.certainty ?? "—",
        urgency: p.urgency ?? "—",
        area: p.areaDesc ?? "—",
        until: iso(p.ends ?? p.expires)?.slice(0, 16).replace("T", " ") ?? "—",
        issuer: p.senderName ?? "NWS",
        placed: placedBy,
        agency: "NWS",
      },
    });
  }
  return { rows, total: all.length, skipped };
}

// --- ECCC --------------------------------------------------------------------------------

interface EcccAlert {
  id?: string;
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: {
    alert_code?: string;
    alert_type?: string;
    alert_name_en?: string;
    alert_text_en?: string | null;
    publication_datetime?: string;
    expiration_datetime?: string;
    event_end_datetime?: string | null;
    risk_colour_en?: string | null;
    feature_name_en?: string;
    province?: string;
    status_en?: string;
    feature_id?: string;
  } | null;
}

const ECCC_COLOR: Record<string, string> = { yellow: "#facc15", orange: "#f97316", red: "#dc2626" };
const ECCC_TYPE_COLOR: Record<string, string> = { warning: "#dc2626", watch: "#f97316", advisory: "#facc15", statement: "#94a3b8" };

/** Pure: ECCC's weather-alerts collection → features. An ended or expired alert is dropped. */
export function normalizeEccc(fc: { features?: EcccAlert[] }, now: number): SignalFeature[] {
  const out: SignalFeature[] = [];
  const seen = new Set<string>();
  for (const a of fc.features ?? []) {
    const p = a.properties ?? {};
    if (/ended|terminé|cancel/i.test(p.status_en ?? "")) continue;
    const exp = Date.parse(p.expiration_datetime ?? "");
    if (Number.isFinite(exp) && exp < now) continue;
    const poly = polygonOf(a.geometry);
    if (!poly) continue;
    const id = `wx:eccc:${p.feature_id ?? a.id}:${p.alert_code ?? ""}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const name = (p.alert_name_en ?? "weather alert").trim();
    const where = [p.feature_name_en, p.province].filter(Boolean).join(", ");
    const text = (p.alert_text_en ?? "").replace(/\s+/g, " ").trim();
    out.push({
      id,
      lat: poly.lat,
      lon: poly.lon,
      geometry: poly.geometry,
      title: `${name.charAt(0).toUpperCase()}${name.slice(1)}: ${where || "Canada"}`,
      signalId: "weather-warnings",
      color: ECCC_COLOR[(p.risk_colour_en ?? "").toLowerCase()] ?? ECCC_TYPE_COLOR[(p.alert_type ?? "").toLowerCase()] ?? "#64748b",
      link: "https://weather.gc.ca/warnings/index_e.html",
      ts: iso(p.publication_datetime),
      props: {
        event: name,
        type: p.alert_type ?? "—",
        ...(p.risk_colour_en ? { "risk colour": p.risk_colour_en } : {}),
        area: where || "—",
        until: iso(p.event_end_datetime ?? p.expiration_datetime)?.slice(0, 16).replace("T", " ") ?? "—",
        ...(text ? { text: text.length > 300 ? `${text.slice(0, 297)}...` : text } : {}),
        agency: "ECCC",
      },
    });
  }
  return out;
}

// --- the layer ---------------------------------------------------------------------------

export interface WarningRead {
  service: string;
  ok: boolean;
  rows: SignalFeature[];
  reason?: string;
  /** Alerts the service listed that this layer did not draw (no place, or not severe enough to place by county). */
  skipped?: number;
}

/** Pure: the services' reads → the outcome-tagged layer with a coverage note. */
export function weatherLayerFrom(reads: WarningRead[], at: number): SignalFeature[] {
  const failed = reads.filter((r) => !r.ok);
  if (failed.length === reads.length) return degraded(failed[0]?.reason ?? "upstream read failed", at);
  const rows = reads.flatMap((r) => r.rows);
  const skipped = reads.reduce((s, r) => s + (r.skipped ?? 0), 0);
  const marked = markCoverage(rows, {
    noun: "alerts",
    rule:
      "every NWS alert with its own polygon, NWS Severe and Extreme alerts placed at the counties they name, and every current ECCC alert" +
      (skipped ? `; ${skipped.toLocaleString("en-GB")} other NWS alerts (Minor or Moderate with no polygon, marine, or ended) are not drawn` : ""),
  });
  if (failed.length) {
    return degradedWith(marked, `partial: ${failed.map((f) => `${f.service} (${f.reason})`).join(", ")} failed`, at);
  }
  return observed(marked, at);
}

const why = (e: unknown) => ((e as Error)?.name === "TimeoutError" ? "timeout" : "fetch failed");

async function readNws(now: number): Promise<WarningRead> {
  try {
    const res = await fetch(NWS, {
      headers: { "User-Agent": UA, Accept: "application/geo+json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { service: "NWS", ok: false, rows: [], reason: `http ${res.status}` };
    const fc = (await res.json()) as { features?: NwsAlert[] };
    // Loaded on the server only, when this layer is fetched: an 85 KB table has no
    // business in the client bundle the registry is part of.
    const { US_COUNTY_CENTROIDS } = await import("@/lib/signals/us-county-centroids.data");
    const { rows, skipped } = normalizeNws(fc, US_COUNTY_CENTROIDS, now);
    return { service: "NWS", ok: true, rows, skipped };
  } catch (e) {
    return { service: "NWS", ok: false, rows: [], reason: why(e) };
  }
}

async function readEccc(now: number): Promise<WarningRead> {
  try {
    const res = await fetch(ECCC_ALERTS, {
      headers: { "User-Agent": UA, Accept: "application/geo+json, application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { service: "ECCC", ok: false, rows: [], reason: `http ${res.status}` };
    return { service: "ECCC", ok: true, rows: normalizeEccc((await res.json()) as { features?: EcccAlert[] }, now) };
  } catch (e) {
    return { service: "ECCC", ok: false, rows: [], reason: why(e) };
  }
}

export const WEATHER_WARNINGS_SOURCE: SignalSource = {
  id: "weather-warnings",
  // A warning area: its own polygon, or the centre of the counties it names.
  precision: "area",
  label: "Weather warnings (NWS, ECCC)",
  group: "Weather",
  color: "#dc2626",
  refreshMs: 10 * 60 * 1000,
  attribution: WEATHER_WARNINGS_ATTRIBUTION,
  async fetch() {
    const at = Date.now();
    const reads = await Promise.all([readNws(at), readEccc(at)]);
    return weatherLayerFrom(reads, at);
  },
};
