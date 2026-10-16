import type { SignalFeature } from "@/lib/signals/types";
import { magnitudeColor } from "@/lib/signals/usgs";

// The national earthquake catalogues that feed the earthquakes layer beside USGS and
// EMSC. Each one is a PURE parser of the agency's own feed into SignalFeature rows;
// lib/signals/earthquakes.ts fetches them, merges them and drops the duplicates.
//
// WHY THESE. Measured 2026-10-16 (the source audit): USGS shows only about M4 and up
// outside the US, and EMSC relays national solutions but misses most small ones. In
// the same 24 hours GeoNet listed 46 New Zealand events (EMSC 6), INGV 48 Italian ones
// (EMSC 14) and JMA 2 Japanese felt quakes (EMSC 0). Every feed here is the agency's
// own primary solution, keyless, and published under terms that allow display with
// credit:
//
//   GeoNet (GNS Science, NZ)       CC BY 3.0 NZ
//   INGV (Italy)                   CC BY 4.0
//   GFZ GEOFON (Germany, global)   CC BY 4.0
//   Geoscience Australia           CC BY 4.0
//   Japan Meteorological Agency    Public Data License 1.0 (compatible with CC BY 4.0)
//   Natural Resources Canada       Earthquakes Canada usage guidelines (credit asked)
//   BMKG (Indonesia)               must be credited as the source; 60 requests/min/IP
//   IGN (Spain)                    CC BY 4.0
//
// Two caveats are stated, not hidden. INGV's robots.txt says `Disallow: /`; its FDSN
// service is a documented API for machine clients, and we call it once a minute. JMA's
// list.json is the data file behind its own website, not a documented API.
//
// Every parser drops a row it cannot place or date. A missing magnitude becomes 0,
// which the merge (and lib/signals/quakeTwin.ts) reads as "not given".

/** What one catalogue row carries before it becomes a SignalFeature. */
export interface QuakeRowInput {
  /** Id namespace, e.g. "geonet". The feature id is `${prefix}:${eventId}`. */
  prefix: string;
  eventId: string;
  lat: number;
  lon: number;
  /** ISO time of the origin, in UTC. */
  ts?: string;
  magnitude?: number | null;
  depthKm?: number | null;
  place?: string | null;
  link: string;
  magType?: string | null;
  /**
   * The catalogue's own event type when it gives one ("earthquake", "explosion",
   * "quarry blast"). The merge drops an event that ANY catalogue types as something
   * other than an earthquake.
   */
  type?: string | null;
}

/** Pure: one catalogue row → a feature on the earthquakes layer, or null when it cannot be placed. */
export function quakeFeature(r: QuakeRowInput): SignalFeature | null {
  const { lat, lon } = r;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const eventId = r.eventId.trim();
  if (!eventId) return null;
  const mag = typeof r.magnitude === "number" && Number.isFinite(r.magnitude) ? r.magnitude : 0;
  const place = r.place?.trim() || "Unknown location";
  const depth = typeof r.depthKm === "number" && Number.isFinite(r.depthKm) ? r.depthKm : null;
  return {
    id: `${r.prefix}:${eventId}`,
    lat,
    lon,
    title: `M ${mag.toFixed(1)} — ${place}`,
    signalId: "earthquakes",
    color: magnitudeColor(mag),
    link: r.link,
    ts: r.ts,
    props: {
      magnitude: Number(mag.toFixed(1)),
      depth: depth != null ? `${depth.toFixed(1)} km` : "—",
      place,
      ...(r.magType ? { magType: r.magType } : {}),
      type: (r.type ?? "").trim() || "earthquake",
    },
  };
}

/** Pure: an ISO-like time with no zone is UTC; more than 3 fraction digits are cut. */
export function utcIso(raw: string | null | undefined): string | undefined {
  const s = (raw ?? "").trim();
  if (!s) return undefined;
  const cut = s.replace(/(\.\d{3})\d+/, "$1");
  const zoned = /[zZ]$|[+-]\d\d:?\d\d$/.test(cut) ? cut : `${cut}Z`;
  const t = Date.parse(zoned);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

const num = (v: unknown): number => {
  if (v == null || v === "") return Number.NaN;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : Number.NaN;
};

// --- GeoNet (New Zealand) ---------------------------------------------------

interface GeonetFeature {
  geometry?: { coordinates?: (number | null)[] } | null;
  properties?: {
    publicID?: string;
    time?: string;
    depth?: number | null;
    magnitude?: number | null;
    locality?: string | null;
    quality?: string | null;
  } | null;
}

/** Pure: GeoNet `/quake` GeoJSON → rows. A `deleted` event is skipped. */
export function normalizeGeonet(geojson: { features?: GeonetFeature[] }): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const f of geojson.features ?? []) {
    const p = f.properties ?? {};
    if ((p.quality ?? "").toLowerCase() === "deleted") continue;
    const c = f.geometry?.coordinates ?? [];
    const id = (p.publicID ?? "").trim();
    const row = quakeFeature({
      prefix: "geonet",
      eventId: id,
      lat: num(c[1]),
      lon: num(c[0]),
      ts: utcIso(p.time),
      magnitude: p.magnitude,
      depthKm: p.depth,
      place: p.locality,
      link: `https://www.geonet.org.nz/earthquake/${encodeURIComponent(id)}`,
    });
    if (row) out.push(row);
  }
  return out;
}

// --- FDSN event text (INGV, GEOFON, Natural Resources Canada) -----------------

/** How one FDSN catalogue names and links its events. */
export interface FdsnTextConfig {
  prefix: string;
  link: (eventId: string, isoTime: string | undefined) => string;
}

/**
 * Pure: an FDSN `format=text` answer → rows.
 *
 * Columns are read by their header names, because the services differ: INGV and
 * GEOFON give 14 columns ending in `EventType`, Natural Resources Canada gives 8 with
 * no type. NRCan names a blast in its place text ("Blast, 5 km S of Chicoutimi"), so
 * that becomes the type "explosion". Its "Suspected industry-related event" rows are
 * induced earthquakes and stay, with that text as the place.
 */
export function normalizeFdsnText(text: string, cfg: FdsnTextConfig): SignalFeature[] {
  const lines = text.split(/\r?\n/);
  const header = lines.find((l) => l.startsWith("#"));
  if (!header) return [];
  const cols = header
    .replace(/^#/, "")
    .split("|")
    .map((c) => c.trim().toLowerCase());
  const at = (name: string) => cols.indexOf(name);
  const iId = at("eventid");
  const iTime = at("time");
  const iLat = at("latitude");
  const iLon = at("longitude");
  const iDepth = at("depth/km");
  const iMagType = at("magtype");
  const iMag = at("magnitude");
  const iName = at("eventlocationname");
  const iType = at("eventtype");
  if ([iId, iTime, iLat, iLon].some((i) => i < 0)) return [];

  const out: SignalFeature[] = [];
  for (const line of lines) {
    if (!line.trim() || line.startsWith("#")) continue;
    const f = line.split("|");
    const name = iName >= 0 ? (f[iName] ?? "").trim() : "";
    // NRCan writes "English/French" in one field; the English half comes first.
    const place = name.includes("/") && /, [A-Z]{2}(, felt)?\//.test(name) ? name.split("/")[0]! : name;
    let type = iType >= 0 ? (f[iType] ?? "").trim() : "";
    if (!type && /^blast\b/i.test(place)) type = "explosion";
    const ts = utcIso(f[iTime]);
    const id = (f[iId] ?? "").trim();
    const row = quakeFeature({
      prefix: cfg.prefix,
      eventId: id,
      lat: num(f[iLat]),
      lon: num(f[iLon]),
      ts,
      magnitude: iMag >= 0 ? num(f[iMag]) : null,
      depthKm: iDepth >= 0 ? num(f[iDepth]) : null,
      place,
      magType: iMagType >= 0 ? (f[iMagType] ?? "").trim() || null : null,
      type: type || null,
      link: cfg.link(id, ts),
    });
    if (row) out.push(row);
  }
  return out;
}

export const INGV_FDSN: FdsnTextConfig = {
  prefix: "ingv",
  link: (id) => `https://terremoti.ingv.it/en/event/${encodeURIComponent(id)}`,
};

export const GEOFON_FDSN: FdsnTextConfig = {
  prefix: "geofon",
  link: (id) => `https://geofon.gfz.de/eqinfo/event.php?id=${encodeURIComponent(id)}`,
};

/** NRCan's event page is keyed by the origin time to the minute, in UTC. */
export const NRCAN_FDSN: FdsnTextConfig = {
  prefix: "nrcan",
  link: (_id, iso) => {
    if (!iso) return "https://www.earthquakescanada.nrcan.gc.ca/index-en.php";
    const d = iso.replace(/[-:]/g, "");
    return `https://www.earthquakescanada.nrcan.gc.ca/recent/${iso.slice(0, 4)}/${d.slice(0, 8)}.${d.slice(9, 13)}/index-en.php`;
  },
};

// --- Geoscience Australia ----------------------------------------------------

interface GaFeature {
  properties?: {
    event_id?: string | null;
    origin_time?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    depth?: number | null;
    preferred_magnitude?: number | null;
    preferred_magnitude_type?: string | null;
    description?: string | null;
    display_flag?: string | null;
  } | null;
}

/**
 * Pure: the Geoscience Australia WFS `earthquakes_seven_days` layer → rows.
 *
 * Two traps measured on 2026-10-16. `epicentral_time` is the LOCAL time at the
 * epicentre labelled `Z`, so the time comes from `origin_time`. And the layer holds
 * placeholder rows (`origin_time` 2100-01-01, no event id) and rows GA does not show
 * (`display_flag` N); both are skipped.
 */
export function normalizeGa(geojson: { features?: GaFeature[] }): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const f of geojson.features ?? []) {
    const p = f.properties ?? {};
    if ((p.display_flag ?? "").toUpperCase() !== "Y") continue;
    const ts = utcIso(p.origin_time);
    if (!ts || Date.parse(ts) >= Date.parse("2100-01-01T00:00:00Z")) continue;
    const id = (p.event_id ?? "").trim();
    const row = quakeFeature({
      prefix: "ga",
      eventId: id,
      lat: num(p.latitude),
      lon: num(p.longitude),
      ts,
      magnitude: p.preferred_magnitude,
      depthKm: p.depth,
      place: p.description,
      magType: p.preferred_magnitude_type ?? null,
      link: `https://earthquakes.ga.gov.au/event/${encodeURIComponent(id)}`,
    });
    if (row) out.push(row);
  }
  return out;
}

// --- Japan Meteorological Agency ---------------------------------------------

interface JmaBulletin {
  eid?: string;
  rdt?: string;
  at?: string;
  cod?: string;
  mag?: string;
  anm?: string;
  en_anm?: string;
}

/**
 * Pure: JMA's ISO 6709 string → lat, lon and depth in km. "+32.3+130.4-10000/" is
 * 32.3 N, 130.4 E, 10 km deep; a far-away quake may carry no depth ("+07.5-080.8/").
 */
export function parseJmaCoordinate(cod: string | undefined): { lat: number; lon: number; depthKm: number | null } | null {
  const m = /^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)([+-]\d+)?\/?$/.exec((cod ?? "").trim());
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const depthM = m[3] != null ? Number(m[3]) : Number.NaN;
  return { lat, lon, depthKm: Number.isFinite(depthM) ? Math.abs(depthM) / 1000 : null };
}

/**
 * Pure: JMA `bosai/quake/data/list.json` → rows.
 *
 * The file lists BULLETINS, not events: one quake gets a seismic-intensity flash
 * (no hypocentre), then a hypocentre report, then revisions, all under one `eid`. So
 * rows are grouped by `eid` and the newest bulletin that carries a hypocentre wins.
 * The origin time is `at`, in Japan time (+09:00).
 */
export function normalizeJmaQuakes(list: JmaBulletin[]): SignalFeature[] {
  const best = new Map<string, { b: JmaBulletin; c: { lat: number; lon: number; depthKm: number | null }; rdt: number }>();
  for (const b of Array.isArray(list) ? list : []) {
    const eid = (b.eid ?? "").trim();
    const c = parseJmaCoordinate(b.cod);
    if (!eid || !c) continue;
    const rdt = Date.parse(b.rdt ?? "");
    const prev = best.get(eid);
    if (!prev || (Number.isFinite(rdt) && rdt > prev.rdt)) best.set(eid, { b, c, rdt: Number.isFinite(rdt) ? rdt : 0 });
  }
  const out: SignalFeature[] = [];
  for (const [eid, { b, c }] of best) {
    const row = quakeFeature({
      prefix: "jma",
      eventId: eid,
      lat: c.lat,
      lon: c.lon,
      ts: utcIso(b.at),
      magnitude: num(b.mag),
      depthKm: c.depthKm,
      place: (b.en_anm ?? "").replace(/\s+/g, " ") || b.anm,
      link: `https://www.data.jma.go.jp/multi/quake/quake_detail.html?eventID=${encodeURIComponent(eid)}&lang=en`,
    });
    if (row) out.push(row);
  }
  return out;
}

// --- BMKG (Indonesia) ----------------------------------------------------------

interface BmkgQuake {
  DateTime?: string;
  Coordinates?: string;
  Magnitude?: string;
  Kedalaman?: string;
  Wilayah?: string;
}

/**
 * Pure: BMKG's TEWS lists (felt quakes and M5+, 15 rows each) → rows. `DateTime` is
 * UTC with an offset; `Coordinates` is "lat,lon". BMKG gives no event id, so the id
 * is the origin time and place, which is what makes the two lists deduplicate.
 */
export function normalizeBmkg(...lists: { Infogempa?: { gempa?: BmkgQuake[] | BmkgQuake } }[]): SignalFeature[] {
  const out = new Map<string, SignalFeature>();
  for (const list of lists) {
    const g = list?.Infogempa?.gempa;
    for (const q of Array.isArray(g) ? g : g ? [g] : []) {
      const [la, lo] = (q.Coordinates ?? "").split(",");
      const ts = utcIso(q.DateTime);
      const lat = num(la);
      const lon = num(lo);
      if (!ts) continue;
      const id = `${ts.slice(0, 19).replace(/[-:]/g, "")}_${lat}_${lon}`;
      const row = quakeFeature({
        prefix: "bmkg",
        eventId: id,
        lat,
        lon,
        ts,
        magnitude: num(q.Magnitude),
        depthKm: num((q.Kedalaman ?? "").replace(/[^\d.]/g, "")),
        place: q.Wilayah,
        link: "https://www.bmkg.go.id/gempabumi/gempabumi-dirasakan",
      });
      if (row && !out.has(row.id)) out.set(row.id, row);
    }
  }
  return [...out.values()];
}

// --- IGN (Spain) -----------------------------------------------------------------

const tag = (item: string, name: string): string | undefined => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(item);
  return m ? m[1]!.trim() : undefined;
};

/**
 * Pure: IGN's seismology RSS → rows. The feed covers ten days and its times are UTC
 * (measured 2026-10-16: IGN 15:03:49 for the event EMSC lists at 15:03:46Z). The
 * magnitude and place are only in the Spanish description sentence.
 */
export function normalizeIgn(xml: string): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const chunk of xml.split(/<item>/).slice(1)) {
    const item = chunk.split("</item>")[0] ?? "";
    const link = (tag(item, "link") ?? "").replace(/&amp;/g, "&");
    const desc = tag(item, "description") ?? "";
    const id = /evid=([\w-]+)/.exec(link)?.[1] ?? "";
    const when = /(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2})/.exec(tag(item, "title") ?? desc);
    const ts = when
      ? utcIso(
          `${when[3]}-${when[2]!.padStart(2, "0")}-${when[1]!.padStart(2, "0")}T${when[4]!.padStart(2, "0")}:${when[5]}:${when[6]}`,
        )
      : undefined;
    const mag = /magnitud ([\d.]+)/.exec(desc)?.[1];
    const place = /magnitud [\d.]+ en (.+?) en la fecha/.exec(desc)?.[1];
    const row = quakeFeature({
      prefix: "ign",
      eventId: id,
      lat: num(tag(item, "geo:lat")),
      lon: num(tag(item, "geo:long")),
      ts,
      magnitude: num(mag),
      place,
      link: link.replace(/^http:/, "https:"),
    });
    if (row) out.push(row);
  }
  return out;
}
