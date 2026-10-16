import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { degraded, observed } from "@/lib/signals/outcome";

// GDACS — the Global Disaster Alert & Coordination System (UN/EC). One keyless feed
// of the CURRENT global disaster picture: earthquakes, tropical cyclones, floods,
// volcanoes, droughts and wildfires, each with a Green/Orange/Red alert level.
// Complements the per-hazard feeds (USGS quakes, EONET fires/floods) with a single
// multi-hazard, severity-scored, alert-coloured overlay. The marker is GDACS's
// representative point.

/**
 * ONE REQUEST: the RSS feed, since 2026-10-16.
 *
 * History, because the request shape is what has broken this layer every time. The
 * event-list API (`gdacsapi/api/events/geteventlist/MAP`) first began to demand an
 * `eventtype` (HTTP 400, fixed 2026-08-13), then only ONE type per request (fixed
 * 2026-08-28 with six parallel requests), and then answered a type with nothing
 * current as HTTP 404 (the volcano list did that all day on 2026-10-16, so every poll
 * read "partial: VO failed"). The six requests every 10 minutes were also above the
 * `Request-rate: 1/60` in gdacs.org/robots.txt.
 *
 * The RSS carries every type in one document with the same `gdacs:` fields (event
 * and episode ids, alert level and score, iscurrent, dates, point), so one request
 * replaces six and there is no partial state. It also carries every current
 * wildfire: measured 2026-10-16, the MAP list gave 3 wildfire events and the RSS 169,
 * all Green alerts.
 *
 * TS (tsunami) is mapped by `gdacsEventLabel` because GDACS documents the code; the
 * tsunami warning centres themselves are their own layer (lib/signals/tsunami.ts).
 */
export const GDACS_RSS = "https://www.gdacs.org/xml/rss.xml";
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

export interface GdacsFeature {
  geometry?: { coordinates?: (number | null)[] } | null;
  properties?: {
    iso3?: string;
    source?: string;
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

/**
 * GDACS hazard codes whose point is the place of the thing itself: an epicentre, a
 * volcano, a storm centre. Every other code (flood, drought, wildfire) is one
 * centroid that stands for an affected area, which is the layer's default.
 */
const GDACS_EXACT_TYPES: ReadonlySet<string> = new Set(["EQ", "VO", "TC"]);

/** Maps GDACS alert level to a 0–10 normalized magnitude for the severity ramp. */
const GDACS_MAG: Record<string, number> = { Green: 3, Orange: 6, Red: 8 };

/** GDACS marks a closed event `iscurrent` false; a missing flag is read as current. */
export function isClosedGdacsEvent(iscurrent: string | undefined): boolean {
  return (iscurrent ?? "").trim().toLowerCase() === "false";
}

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();

/** The text of `<name …>…</name>` inside one item, decoded; undefined when absent or empty. */
function field(item: string, name: string): string | undefined {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(item);
  const v = m ? decode(m[1]!) : "";
  return v === "" ? undefined : v;
}

/** An RFC 1123 date ("Fri, 16 Oct 2026 06:00:00 GMT") → ISO; undefined when unreadable. */
function rfcToIso(s: string | undefined): string | undefined {
  const t = s ? Date.parse(s) : Number.NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

/**
 * Pure: the GDACS RSS → SignalFeature[].
 *
 * Splits on `<item>` boundaries rather than matching items with one regex (a
 * lazy item regex has swallowed the first story of a feed before). Skips an item
 * with no point or no event id, a closed event (`iscurrent` false: measured
 * 2026-10-16, 10 of the 12 drought rows were closed, one opened in 2022), and a
 * repeat of the same event+episode.
 *
 * THE SCORE. The RSS's `alertscore` for an earthquake is 0 where the alert is Green
 * (the MAP list gave 1), while `episodealertscore` is 1; for a cyclone whose event is
 * Orange and latest episode Green, `alertscore` is the 2 and the episode the 1. So the
 * score on the 0–3 bar is the larger of the two, which matches the alert level shown.
 */
export function normalizeGdacsRss(xml: string): SignalFeature[] {
  const out: SignalFeature[] = [];
  const seen = new Set<string>();
  for (const chunk of xml.split(/<item>/).slice(1)) {
    const item = chunk.split("</item>")[0] ?? "";
    if (isClosedGdacsEvent(field(item, "gdacs:iscurrent"))) continue;
    const lat = Number(field(item, "geo:lat"));
    const lon = Number(field(item, "geo:long"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    const eventId = field(item, "gdacs:eventid");
    if (!eventId) continue;
    const id = `gdacs:${eventId}:${field(item, "gdacs:episodeid") ?? ""}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const type = (field(item, "gdacs:eventtype") ?? "").toUpperCase();
    const typeLabel = gdacsEventLabel(type);
    const level = field(item, "gdacs:alertlevel") ?? "Unknown";
    const scores = [Number(field(item, "gdacs:alertscore")), Number(field(item, "gdacs:episodealertscore"))].filter(
      Number.isFinite,
    );
    const country = field(item, "gdacs:country");
    const name = field(item, "gdacs:eventname");
    const from = rfcToIso(field(item, "gdacs:fromdate"));
    const to = rfcToIso(field(item, "gdacs:todate"));
    out.push({
      id,
      lat,
      lon,
      title: name ? `${typeLabel} ${name}` : `${typeLabel}${country ? ` in ${country}` : ""}`,
      signalId: "gdacs",
      ...(GDACS_EXACT_TYPES.has(type) ? { precision: "exact" as const } : {}),
      color: gdacsAlertColor(level),
      link: field(item, "link"),
      ts: from,
      props: {
        hazard: typeLabel,
        alertLevel: level,
        magnitude: GDACS_MAG[level] ?? 5,
        // GDACS's own continuous alert score (0–3: green <1, orange 1–2, red 2–3).
        // The REAL per-event severity scalar (metric bar), distinct from the 0–10 ramp.
        alertScore: scores.length ? Math.max(...scores) : undefined,
        severity: field(item, "gdacs:severity") ?? "—",
        country: country ?? "—",
        from: from?.slice(0, 10) ?? "—",
        to: to?.slice(0, 10) ?? "—",
      },
    });
  }
  return out;
}

/**
 * Pure: GDACS SEARCH FeatureCollection -> SignalFeature[]. Skips features without coords/id.
 * The gdacs layer itself reads the RSS (normalizeGdacsRss); this is for the per-hazard layers.
 */
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
      ...(GDACS_EXACT_TYPES.has((p.eventtype ?? "").trim().toUpperCase()) ? { precision: "exact" as const } : {}),
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

// --- SEARCH: one hazard type over a date range, for the per-hazard layers ----------
//
// The MAP endpoint above answers "what is current" (8 floods on 2026-10-16). The
// floods, wildfires and volcanoes layers want "what happened in the last N days",
// which is SEARCH: 81 floods in 30 days, 200+ wildfires, 9 volcano alerts in 90 days
// (audited 2026-10-16). SEARCH pages by 100 and answers 204 past the last page.

/** One page of GDACS SEARCH for one hazard type, `days` back from `now`. */
export function gdacsSearchUrl(eventType: string, days: number, now: number, page = 1): string {
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  const params = new URLSearchParams({
    eventlist: eventType,
    fromDate: day(now - days * 86_400_000),
    toDate: day(now),
    alertlevel: "green;orange;red",
    pagenumber: String(page),
  });
  return `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?${params.toString()}`;
}

/** Pages read at most per hazard type: 10 × 100 events, far past any measured month. */
export const GDACS_SEARCH_MAX_PAGES = 10;

/**
 * Every GDACS SEARCH feature for one hazard type in the window. Throws on the first
 * failed page (the caller keeps its last good copy), so a half-read list is never
 * published as the whole one.
 */
export async function fetchGdacsSearch(
  eventType: string,
  days: number,
  now: number,
  getJsonFn: (url: string) => Promise<{ features?: GdacsFeature[] } | null>,
): Promise<GdacsFeature[]> {
  const all: GdacsFeature[] = [];
  for (let page = 1; page <= GDACS_SEARCH_MAX_PAGES; page++) {
    const json = await getJsonFn(gdacsSearchUrl(eventType, days, now, page));
    const features = json?.features ?? [];
    all.push(...features);
    if (features.length < 100) break;
  }
  return all;
}

/** Where GDACS events go on a per-hazard layer, and how they are named there. */
export interface GdacsLayerOptions {
  signalId: string;
  /** Prefix for the feature id, e.g. "floods:gdacs", so it cannot collide with the gdacs layer. */
  idPrefix: string;
  /** Drop events whose ISO3 is in this set (a better primary covers them). */
  excludeIso3?: ReadonlySet<string>;
  /** Credit line for the `source` prop, e.g. "GDACS (GloFAS)". */
  sourceLabel: string;
}

/**
 * Pure: GDACS SEARCH features → features for ONE per-hazard layer.
 *
 * SEARCH lists an event once per episode it matched; the latest episode stands for
 * the event. Precision follows the hazard: a volcano point is the volcano, a flood or
 * fire point is the centroid of an affected area.
 */
export function gdacsToLayerFeatures(
  features: GdacsFeature[],
  opts: GdacsLayerOptions,
): SignalFeature[] {
  const latest = new Map<string, GdacsFeature>();
  for (const f of features) {
    const id = (f.properties?.eventid ?? "").toString().trim();
    if (!id) continue;
    const prev = latest.get(id);
    if (!prev || Number(f.properties?.episodeid ?? 0) > Number(prev.properties?.episodeid ?? 0)) latest.set(id, f);
  }
  const kept = [...latest.values()].filter(
    (f) => !opts.excludeIso3?.has((f.properties?.iso3 ?? "").trim().toUpperCase()),
  );
  const out: SignalFeature[] = [];
  for (const f of normalizeGdacs({ features: kept })) {
    const [, eventId] = f.id.split(":");
    out.push({
      ...f,
      id: `${opts.idPrefix}:${eventId}`,
      signalId: opts.signalId,
      precision: f.precision ?? "area",
      props: { ...f.props, source: opts.sourceLabel, gdacsEventId: eventId },
    });
  }
  return out;
}

export const GDACS_SOURCE: SignalSource = {
  id: "gdacs",
  // Default for floods, droughts and wildfires: one centroid for an affected area. Quakes, volcanoes and cyclones set "exact" per feature.
  precision: "area",
  label: "Disaster alerts",
  group: "Natural hazards",
  color: "#e11d48",
  refreshMs: 600_000, // GDACS regenerates the feed every few minutes; one request per 10 min
  attribution: GDACS_ATTRIBUTION,
  metric: { field: "alertScore", domain: [0, 3] },
  async fetch() {
    try {
      const res = await fetch(GDACS_RSS, {
        headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return degraded(`http ${res.status}`);
      return observed(normalizeGdacsRss(await res.text()));
    } catch (e) {
      return degraded((e as Error)?.name === "TimeoutError" ? "timeout" : "upstream read failed");
    }
  },
};
