import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { degraded, degradedWith, observed } from "@/lib/signals/outcome";

// GDACS — the Global Disaster Alert & Coordination System (UN/EC). One keyless
// GeoJSON feed of the CURRENT global disaster picture: earthquakes, tropical
// cyclones, floods, volcanoes, droughts and wildfires, each with a Green/Orange/Red
// alert level. Complements the per-hazard feeds (USGS quakes, EONET fires/floods)
// with a single multi-hazard, severity-scored, alert-coloured overlay. The marker
// is GDACS's representative centroid. Confirmed live 2026-06-27; re-verified
// 2026-08-13 after upstream began requiring `eventtype` — see below.

/**
 * EVENTTYPE IS MANDATORY, AND SINCE SOME POINT AFTER 2026-08-13, SINGULAR.
 *
 * Round one (fixed 2026-08-13): calling the event-list endpoint bare answered
 * HTTP 400 `{"message":"Eventtype is required."}`. The fix then was one query
 * parameter, semicolon-joining all six hazard codes into one request — measured
 * that day at 289 events (TC 203, WF 32, DR 24, FL 15, EQ 10, VO 5).
 *
 * Round two (fixed 2026-08-28): that same semicolon-joined request now answers
 * HTTP 400 `{"message":"Please specify only 1 eventtype."}`. GDACS tightened the
 * parameter again, some time in the 15 days between. Because `fetch()` returned
 * `[]` on any non-ok response, the layer went back to publishing a clean, quiet
 * zero — indistinguishable from "no disasters today" — on every poll in between.
 * The parser was never wrong either time; the request shape was.
 *
 * The fix this time is structural, not one parameter: `gdacsEndpointFor()` below
 * builds one single-type URL, `fetch()` issues six requests in parallel (one per
 * `GDACS_EVENT_TYPES` code) and `mergeGdacsResults()` — a PURE function, unit
 * tested independently of the network — folds them into one outcome. A hazard
 * type that fails does not empty the other five: see `mergeGdacsResults` for how
 * a partial round is reported.
 *
 * TS (tsunami) is deliberately absent: `gdacsEventLabel` maps it because GDACS
 * documents the code, but the event list does not accept it as a filter value.
 */
export const GDACS_EVENT_TYPES = ["EQ", "TC", "FL", "VO", "DR", "WF"] as const;
/** One hazard type per request — GDACS rejects more than one as of 2026-08-28. */
export function gdacsEndpointFor(eventType: string): string {
  return `https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventtype=${eventType}`;
}
const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

export const GDACS_ATTRIBUTION = "Disaster alerts © GDACS (UN OCHA / European Commission JRC)";

/** GDACS event-type code → human label. */
export function gdacsEventLabel(code: string): string {
  switch (code) {
    case "EQ": return "Earthquake";
    case "TC": return "Tropical cyclone";
    case "FL": return "Flood";
    case "VO": return "Volcano";
    case "DR": return "Drought";
    case "WF": return "Wildfire";
    case "TS": return "Tsunami";
    default: return "Disaster";
  }
}

/** GDACS alert level → colour (its own Green/Orange/Red triage). */
export function gdacsAlertColor(level: string): string {
  switch ((level || "").toLowerCase()) {
    case "red": return "#dc2626";
    case "orange": return "#f59e0b";
    case "green": return "#16a34a";
    default: return "#64748b";
  }
}

interface GdacsFeature {
  geometry?: { coordinates?: (number | null)[] } | null;
  properties?: {
    eventtype?: string;
    eventid?: number | string;
    episodeid?: number | string;
    name?: string;
    country?: string;
    alertlevel?: string;
    alertscore?: number;
    fromdate?: string;
    todate?: string;
    iscurrent?: string;
    url?: { report?: string; details?: string } | null;
    severitydata?: { severitytext?: string } | null;
  } | null;
}

/** Treat GDACS's naive UTC timestamps (no zone suffix) as UTC. */
function gdacsTimeToIso(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const norm = /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`;
  const t = Date.parse(norm);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

/** Maps GDACS alert level to a 0–10 normalized magnitude for the severity ramp. */
const GDACS_MAG: Record<string, number> = { Green: 3, Orange: 6, Red: 8 };

/** Pure: GDACS FeatureCollection → SignalFeature[]. Skips features without coords/id. */
export function normalizeGdacs(geojson: { features?: GdacsFeature[] }): SignalFeature[] {
  const out: SignalFeature[] = [];
  const seen = new Set<string>(); // GDACS repeats the same event+episode across entries — dedupe by id
  for (const f of geojson.features ?? []) {
    const p = f.properties ?? {};
    const c = f.geometry?.coordinates;
    if (!c) continue;
    const lon = c[0] == null ? Number.NaN : Number(c[0]);
    const lat = c[1] == null ? Number.NaN : Number(c[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    const eventId = (p.eventid ?? "").toString().trim();
    if (!eventId) continue;
    const episodeId = (p.episodeid ?? "").toString().trim();
    const id = `gdacs:${eventId}:${episodeId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const typeLabel = gdacsEventLabel(p.eventtype ?? "");
    const level = p.alertlevel ?? "Unknown";
    out.push({
      id,
      lat,
      lon,
      title: p.name?.trim() || `${typeLabel}${p.country ? ` in ${p.country}` : ""}`,
      signalId: "gdacs",
      color: gdacsAlertColor(level),
      link: p.url?.report ?? undefined,
      ts: gdacsTimeToIso(p.fromdate),
      props: {
        hazard: typeLabel,
        alertLevel: level,
        magnitude: GDACS_MAG[level] ?? 5,
        // GDACS's own continuous alert score (0–3: green <1, orange 1–2, red 2–3).
        // The REAL per-event severity scalar (metric bar), distinct from the 0–10 ramp.
        alertScore: typeof p.alertscore === "number" && Number.isFinite(p.alertscore) ? p.alertscore : undefined,
        severity: p.severitydata?.severitytext?.trim() || "—",
        country: p.country?.trim() || "—",
        from: p.fromdate?.slice(0, 10) ?? "—",
        to: p.todate?.slice(0, 10) ?? "—",
        ongoing: (p.iscurrent ?? "").toLowerCase() === "true" ? "yes" : "no",
      },
    });
  }
  return out;
}

/** One hazard type's fetch, resolved — never thrown, so `Promise.all` cannot short-circuit. */
export interface GdacsTypeResult {
  type: string;
  ok: boolean;
  features?: GdacsFeature[];
  reason?: string;
}

/**
 * Fold six per-hazard-type results into one outcome-tagged `SignalFeature[]`. PURE —
 * no network, no Date.now() default, so it is exercised directly by unit tests.
 *
 * A hazard type failing does not empty the layer: the other five still merge into a
 * real result. All six failing is the only path that reports nothing. A PARTIAL round
 * uses `degradedWith` (ok: false, but real rows attached) rather than `observed`,
 * because asserting `ok: true` when a third of the requests failed would be the exact
 * comfortable lie lib/signals/outcome.ts exists to rule out — even though, unlike that
 * helper's usual last-good-cache case, every row here really was read this instant.
 */
export function mergeGdacsResults(results: GdacsTypeResult[], at: number): SignalFeature[] {
  const succeeded = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  if (succeeded.length === 0) {
    return degraded(failed[0]?.reason ?? "upstream read failed", at);
  }

  const merged = normalizeGdacs({ features: succeeded.flatMap((r) => r.features ?? []) });

  if (failed.length > 0) {
    const types = failed.map((f) => f.type).join(",");
    return degradedWith(merged, `partial: ${types} failed (${failed[0]!.reason})`, at);
  }

  return observed(merged, at);
}

export const GDACS_SOURCE: SignalSource = {
  id: "gdacs",
  label: "Disaster alerts",
  group: "Natural hazards",
  color: "#e11d48",
  refreshMs: 600_000, // GDACS regenerates the map feed ~every few minutes
  attribution: GDACS_ATTRIBUTION,
  metric: { field: "alertScore", domain: [0, 3] },
  async fetch() {
    const at = Date.now();
    const results = await Promise.all(
      GDACS_EVENT_TYPES.map(async (type): Promise<GdacsTypeResult> => {
        try {
          const res = await fetch(gdacsEndpointFor(type), {
            headers: { "User-Agent": UA, Accept: "application/json" },
            signal: AbortSignal.timeout(15_000),
          });
          if (!res.ok) return { type, ok: false, reason: `http ${res.status}` };
          const json = (await res.json()) as { features?: GdacsFeature[] };
          return { type, ok: true, features: json.features ?? [] };
        } catch (e) {
          return {
            type,
            ok: false,
            reason: (e as Error)?.name === "TimeoutError" ? "timeout" : "upstream read failed",
          };
        }
      }),
    );
    return mergeGdacsResults(results, at);
  },
};
