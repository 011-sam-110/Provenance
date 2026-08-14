import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { applyCap, carryCoverage } from "@/lib/signals/coverage";
import { countMagnitude } from "@/lib/signals/aggregate";

// GDELT — geolocated conflict and protest events, from the raw 15-minute EVENT
// EXPORT rather than an API endpoint.
//
// WHY NOT THE API. This adapter used to call GDELT GEO 2.0
// (api.gdeltproject.org/api/v2/geo/geo). That path is GONE — it answers 404 for
// every query, including a bare hit with no parameters at all, over both http and
// https, so it is the endpoint that is dead and not our query shape:
//   $ curl -sI https://api.gdeltproject.org/api/v2/geo/geo   → HTTP 404 (text/html)
// The obvious substitute, DOC 2.0 (api.gdeltproject.org/api/v2/doc/doc), is NOT
// usable here for two independent reasons, both measured on 2026-08-10:
//   1. It returns NO coordinates. DOC yields article lists (url/title/domain/
//      sourcecountry) — the country of the PUBLISHER, not of the event. That
//      cannot honestly drive a map.
//   2. Every machine-readable format is rate-limited to the point of being
//      unusable: `&format=json`, `&format=JSON` and `&format=rss` each returned
//      HTTP 429 on repeated tries 30s apart, while the identical query with the
//      `format` param OMITTED returned HTTP 200 — as an HTML page.
//
// WHAT WE USE INSTEAD. GDELT publishes its Event database as a plain zipped TSV
// every 15 minutes, keyless and uncapped, and every row carries the CAMEO event
// code plus ActionGeo lat/lon — which is exactly what a map layer needs:
//   https://storage.googleapis.com/data.gdeltproject.org/gdeltv2/lastupdate.txt
//   https://storage.googleapis.com/data.gdeltproject.org/gdeltv2/<stamp>.export.CSV.zip
// The `data.gdeltproject.org` vanity host is a CNAME onto Google Cloud Storage and
// presents a *.storage.googleapis.com certificate, so hitting it over https fails
// TLS hostname validation (ERR_TLS_CERT_ALTNAME_INVALID). Addressing the bucket by
// its canonical GCS path — as above — is the same bytes over a valid certificate.
//
// Column order is the documented GDELT 2.0 Event table (61 tab-separated fields).
// Both layers share ONE cached window fetch, filtered two ways, so enabling both
// costs a single set of downloads.
//
// Dormant-safe: any failure (manifest, a missing 15-minute file, a bad zip)
// resolves to last-good or [], never a throw and never a fabricated point.

const BASE = "https://storage.googleapis.com/data.gdeltproject.org/gdeltv2";

/** 16 files x 15 min = a 4-hour trailing window (~320 conflict / ~70 protest places). */
const WINDOW_FILES = 16;
/** Parallel zip downloads. The bucket is a CDN, but stay a polite client. */
const FETCH_CONCURRENCY = 8;
/**
 * Minimum source documents before an event may reach the map.
 *
 * NOTE what this is NOT. It is a VOLUME floor, not a corroboration floor:
 * NumArticles counts documents, and five documents from one syndicating publisher
 * is one story told five times. GDELT's actual independence count is NumSources,
 * and requiring NumSources >= 2 was measured against a live 4-hour window on
 * 2026-08-14: it cut the layer from 391 places to 22 and took Gaza, Ukraine and
 * Syria to ZERO while leaving the junk untouched. So it is deliberately not used.
 * Corroboration and truth are different axes here — see MIN_TYPED_ACTOR below.
 */
const MIN_ARTICLES = 2;

/**
 * Require GDELT to have TYPED at least one actor on the row.
 *
 * This is the guard that catches the coder's own worst failure mode, and it is
 * GDELT telling on itself rather than a heuristic we invented. When CAMEO cannot
 * find a real actor it will promote a bare PLACE NAME to a national actor —
 * Actor1Name "CHRISTCHURCH" → Actor1Code "NZL" — and in exactly those cases it
 * attaches NO Actor*Type*Code, because there was no organisation or role to type.
 * The action then gets geocoded to whatever other place the text mentioned.
 *
 * That is precisely how an article about a TikTok livestream moderation failure
 * (which referenced the Christchurch attack) became "Use of military force" at a
 * city-precision pin in Bristol, UK on 2026-08-13, and it is not a rare shape:
 * measured on that window, 388 of the 1,037 rows the layer shipped — 37% — were
 * untyped-actor rows. Requiring a type drops them for ~30% of all places.
 *
 * It is NOT sufficient on its own, and nothing available in this feed is. A court
 * report about a shooting carries real police and judicial actors and real
 * violence vocabulary, so it survives every structured filter GDELT exposes. That
 * residue is handled by no longer ASSERTING an incident — see toCoverageProps().
 */
const MIN_TYPED_ACTOR = true;
/** Round coordinates to this many dp to bucket one place. 2dp ~ 1.1 km. */
const PLACE_DP = 2;
const MAX_POINTS = 300;
const CACHE_TTL_MS = 15 * 60 * 1000; // matches GDELT's own publish cadence

export const GDELT_ATTRIBUTION = "Event coding © The GDELT Project";

// --- GDELT 2.0 Event table column indices (0-based, 61 columns) -------------
const C_ID = 0;
const C_SQLDATE = 1;
/** Actor1Type1–3Code and Actor2Type1–3Code — the CAMEO role codes (MIL, COP, GOV…). */
const C_ACTOR_TYPES = [12, 13, 14, 22, 23, 24];
const C_EVENT_CODE = 26;
const C_ROOT_CODE = 28;
const C_QUAD_CLASS = 29;
const C_NUM_MENTIONS = 31;
const C_NUM_SOURCES = 32;
const C_NUM_ARTICLES = 33;
const C_AVG_TONE = 34;
const C_GEO_TYPE = 51;
const C_GEO_NAME = 52;
/** ActionGeo_CountryCode — GDELT uses FIPS 10-4 here ("UK", not ISO "GB"). */
const C_GEO_COUNTRY = 53;
const C_GEO_LAT = 56;
const C_GEO_LON = 57;
const C_DATE_ADDED = 59;
const C_SOURCE_URL = 60;
const COLUMN_COUNT = 61;

/** One parsed row of the GDELT Event export that has a usable action location. */
export interface GdeltEvent {
  id: string;
  eventCode: string;
  rootCode: string;
  quadClass: string;
  numMentions: number;
  /** Distinct INFORMATION SOURCES, from NumSources. Independence, unlike numArticles. */
  numSources: number;
  numArticles: number;
  avgTone: number;
  geoType: string;
  place: string;
  /** ActionGeo_CountryCode, FIPS 10-4. Only used to GROUP rows, never displayed. */
  countryCode: string;
  lat: number;
  lon: number;
  sourceUrl: string;
  /**
   * CAMEO role codes present on either actor (MIL, COP, GOV, REB, MED…). EMPTY is
   * the meaningful case: it marks a row where GDELT inferred an actor from a bare
   * place name rather than reading one. See MIN_TYPED_ACTOR.
   */
  actorTypes: string[];
  /** ISO timestamp GDELT ADDED the event, from DATEADDED. NOT when it happened. */
  ts?: string;
  /**
   * Date the event is asserted to have OCCURRED (SQLDATE), day resolution only.
   * Routinely differs from `ts`: on the 2026-08-14 window 22 rows were backdated,
   * eleven by a year and one by a decade, and every one of them was being stamped
   * onto the map as if it were inside the trailing four hours.
   */
  eventDate?: string;
}

/** Per-layer config: registry id, rail colour, and which CAMEO codes it accepts. */
export interface GdeltLayerMeta {
  signalId: string;
  label: string;
  color: string;
  /** CAMEO EventRootCode values this layer accepts. */
  rootCodes: string[];
  /** When set, the row's QuadClass must match (4 = material conflict). */
  quadClass?: string;
}

export const GDELT_LAYERS: Record<string, GdeltLayerMeta> = {
  // CAMEO roots 18 ASSAULT / 19 FIGHT / 20 UNCONVENTIONAL MASS VIOLENCE, further
  // narrowed to QuadClass 4 (material conflict) so verbal threats stay out.
  // The label says COVERAGE, deliberately. This layer maps where conflict-coded
  // reporting is clustering; it does not map confirmed incidents, and calling it
  // "Conflict" invited exactly the reading that a Bristol pin reading "Use of
  // military force" was a report of military force in Bristol. ACLED is the
  // layer that maps adjudicated incidents.
  conflict: {
    signalId: "conflict",
    label: "Conflict coverage",
    color: "#b91c1c",
    rootCodes: ["18", "19", "20"],
    quadClass: "4",
  },
  // CAMEO root 14 PROTEST. QuadClass is 3 (verbal conflict) for most of the tree,
  // so it is deliberately NOT constrained here.
  protests: {
    signalId: "protests",
    label: "Protest coverage",
    color: "#7c3aed",
    rootCodes: ["14"],
  },
};

/** CAMEO base-code → human label, for the codes the two layers can surface. */
const CAMEO_LABELS: Record<string, string> = {
  // 14 PROTEST
  "140": "Political dissent",
  "141": "Demonstration or rally",
  "142": "Hunger strike",
  "143": "Strike or boycott",
  "144": "Obstruction or blockade",
  "145": "Violent protest or riot",
  // 18 ASSAULT
  "180": "Assault",
  "181": "Abduction or hostage-taking",
  "182": "Physical assault",
  "183": "Bombing",
  "184": "Use of human shields",
  "185": "Attempted assassination",
  "186": "Assassination",
  // 19 FIGHT
  "190": "Use of military force",
  "191": "Blockade or movement restriction",
  "192": "Occupation of territory",
  "193": "Fighting with small arms",
  "194": "Fighting with artillery or tanks",
  "195": "Aerial weapons employed",
  "196": "Ceasefire violation",
  // 20 UNCONVENTIONAL MASS VIOLENCE
  "200": "Mass violence",
  "201": "Mass expulsion",
  "202": "Mass killings",
  "203": "Ethnic cleansing",
  "204": "Weapons of mass destruction",
};

const ROOT_LABELS: Record<string, string> = {
  "14": "Protest",
  "18": "Assault",
  "19": "Armed clash",
  "20": "Mass violence",
};

/** Human label for a CAMEO event code, falling back to its root then to the raw code. */
export function cameoLabel(eventCode: string): string {
  const code = (eventCode ?? "").trim();
  if (CAMEO_LABELS[code]) return CAMEO_LABELS[code];
  // 4-digit leaf codes (e.g. 1821) roll up to their 3-digit base.
  if (code.length === 4 && CAMEO_LABELS[code.slice(0, 3)]) return CAMEO_LABELS[code.slice(0, 3)];
  if (ROOT_LABELS[code.slice(0, 2)]) return ROOT_LABELS[code.slice(0, 2)];
  return code ? `CAMEO ${code}` : "Unclassified";
}

/** ActionGeo_Type → how precise the point is. GDELT's own 1–5 scale. */
export function geoPrecision(geoType: string): string {
  switch ((geoType ?? "").trim()) {
    case "1": return "country";
    case "2": return "state";
    case "3": return "city";
    case "4": return "city";
    case "5": return "state";
    default: return "unknown";
  }
}

function num(v: string | undefined): number {
  const s = (v ?? "").trim();
  if (s === "") return Number.NaN; // Number("") is 0 — guard first
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** DATEADDED (YYYYMMDDHHMMSS, UTC) → ISO string, or undefined if unparseable. */
function isoFromStamp(stamp: string): string | undefined {
  const s = (stamp ?? "").trim();
  if (!/^\d{14}$/.test(s)) return undefined;
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`;
  return Number.isNaN(Date.parse(iso)) ? undefined : iso;
}

/** SQLDATE (YYYYMMDD) → ISO date, or undefined. Day resolution is all GDELT has. */
export function dateFromSqlDate(sqlDate: string): string | undefined {
  const s = (sqlDate ?? "").trim();
  if (!/^\d{8}$/.test(s)) return undefined;
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) ? undefined : iso;
}

/**
 * Pure: how to describe a row's timing WITHOUT claiming we know when it happened.
 *
 * The layer used to stamp every marker `last 4h`. That window is when GDELT
 * INGESTED the record; the event date is a separate field, at day resolution, and
 * it is frequently older. Saying "reported in the last 4h" is true of every row;
 * saying the event occurred then is true of almost none.
 */
export function describeTiming(ingestedIso?: string, eventDate?: string): string {
  if (!ingestedIso) return eventDate ? `Event dated ${eventDate}` : "Timing unknown";
  const ingestDay = ingestedIso.slice(0, 10);
  if (!eventDate) return "Reported in the last 4h";
  if (eventDate === ingestDay) return "Reported in the last 4h · event dated today";
  return `Reported in the last 4h · event dated ${eventDate}`;
}

/**
 * Pure: one raw GDELT Event export (tab-separated, one event per line) → typed
 * rows. Drops anything without a usable action location: GDELT writes
 * ActionGeo_Type 0 with empty coordinates when it could not geocode the event,
 * and 0,0 is the null-island artefact of the same failure.
 */
export function parseGdeltExport(tsv: string): GdeltEvent[] {
  const out: GdeltEvent[] = [];
  for (const rawLine of (tsv ?? "").split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line) continue;
    const c = line.split("\t");
    if (c.length < COLUMN_COUNT) continue;

    const geoType = (c[C_GEO_TYPE] ?? "").trim();
    if (!geoType || geoType === "0") continue; // no geographic match

    const lat = num(c[C_GEO_LAT]);
    const lon = num(c[C_GEO_LON]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    if (lat === 0 && lon === 0) continue; // null island

    const numArticles = num(c[C_NUM_ARTICLES]);
    const numMentions = num(c[C_NUM_MENTIONS]);
    const numSources = num(c[C_NUM_SOURCES]);
    const avgTone = num(c[C_AVG_TONE]);

    out.push({
      id: (c[C_ID] ?? "").trim(),
      eventCode: (c[C_EVENT_CODE] ?? "").trim(),
      rootCode: (c[C_ROOT_CODE] ?? "").trim(),
      quadClass: (c[C_QUAD_CLASS] ?? "").trim(),
      numMentions: Number.isFinite(numMentions) ? numMentions : 0,
      numSources: Number.isFinite(numSources) ? numSources : 0,
      numArticles: Number.isFinite(numArticles) ? numArticles : 0,
      avgTone: Number.isFinite(avgTone) ? avgTone : 0,
      geoType,
      place: (c[C_GEO_NAME] ?? "").trim(),
      countryCode: (c[C_GEO_COUNTRY] ?? "").trim(),
      lat,
      lon,
      sourceUrl: (c[C_SOURCE_URL] ?? "").trim(),
      actorTypes: C_ACTOR_TYPES.map((i) => (c[i] ?? "").trim()).filter(Boolean),
      ts: isoFromStamp(c[C_DATE_ADDED] ?? ""),
      eventDate: dateFromSqlDate(c[C_SQLDATE] ?? ""),
    });
  }
  return out;
}

export interface PlaceBucket {
  lat: number;
  lon: number;
  place: string;
  articles: number;
  events: number;
  top: GdeltEvent;
}

/**
 * Pure: parsed events → SignalFeature[] for one layer.
 *
 * GDELT emits one row per ACTOR PAIR, so a single story routinely appears three or
 * four times with the same root code, coordinates and source URL. Those are
 * collapsed first (keeping the best-covered row) or a busy story would out-rank a
 * real flashpoint purely by being duplicated. Surviving events are then bucketed by
 * rounded coordinate into one marker per place — matching how this layer has always
 * rendered — sorted by total article volume and hard-capped.
 */
export function selectLayerEvents(
  events: GdeltEvent[],
  meta: GdeltLayerMeta,
  minArticles = MIN_ARTICLES,
  requireTypedActor = MIN_TYPED_ACTOR,
): GdeltEvent[] {
  const roots = new Set(meta.rootCodes);
  const deduped = new Map<string, GdeltEvent>();
  for (const e of events) {
    if (!roots.has(e.rootCode)) continue;
    if (meta.quadClass && e.quadClass !== meta.quadClass) continue;
    if (e.numArticles < minArticles) continue;
    if (requireTypedActor && e.actorTypes.length === 0) continue;
    if (!e.place) continue;
    const key = `${e.rootCode}|${e.lat.toFixed(3)}|${e.lon.toFixed(3)}|${e.sourceUrl}`;
    const prev = deduped.get(key);
    if (!prev || e.numArticles > prev.numArticles) deduped.set(key, e);
  }
  return [...deduped.values()];
}

export function normalizeGdeltEvents(
  events: GdeltEvent[],
  meta: GdeltLayerMeta,
  cap = MAX_POINTS,
  minArticles = MIN_ARTICLES,
  requireTypedActor = MIN_TYPED_ACTOR,
): SignalFeature[] {
  const deduped = new Map<string, GdeltEvent>(
    selectLayerEvents(events, meta, minArticles, requireTypedActor).map((e) => [e.id, e]),
  );

  // 2. bucket by place
  const places = new Map<string, PlaceBucket>();
  for (const e of deduped.values()) {
    const key = `${e.lat.toFixed(PLACE_DP)}|${e.lon.toFixed(PLACE_DP)}`;
    const b = places.get(key);
    if (!b) {
      places.set(key, { lat: e.lat, lon: e.lon, place: e.place, articles: e.numArticles, events: 1, top: e });
      continue;
    }
    b.articles += e.numArticles;
    b.events += 1;
    if (e.numArticles > b.top.numArticles) {
      b.top = e;
      b.place = e.place;
    }
  }

  // 3. rank by coverage volume and cap. `available` is the number of distinct
  // PLACES this layer found in the window — a busy 4-hour window runs well past
  // 300, so the cap must ride along in the payload or the map silently drops
  // flashpoints that simply got less coverage than the 300th.
  const ranked = applyCap(
    [...places.values()].sort((a, b) => b.articles - a.articles || a.place.localeCompare(b.place)),
    cap,
    { noun: "places", rule: "the most covered by article volume" },
  );

  return carryCoverage(ranked, ranked.map((b) => ({
    id: `gdelt:${meta.signalId}:${b.lat.toFixed(3)}:${b.lon.toFixed(3)}`,
    lat: b.lat,
    lon: b.lon,
    title: b.place,
    signalId: meta.signalId,
    color: meta.color,
    link: /^https?:\/\//i.test(b.top.sourceUrl) ? b.top.sourceUrl : undefined,
    ts: b.top.ts,
    props: toCoverageProps(b),
  })));
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Pure: one place bucket → the dossier's definition list.
 *
 * THIS IS THE HONESTY SEAM, and it is the half of the fix that no filter can do.
 * The layer used to publish `topEvent: "Use of military force"` — a bare finding,
 * beside a precise pin, in conflict red. A reader had every right to take that as
 * "military force was used here". It was never that. It is one machine coding of
 * one article's text, and on 2026-08-13 that exact field read "Use of military
 * force" at Bristol for a story about a TikTok livestream.
 *
 * So the assertion is attributed instead of stated. `codedAs` says whose coding
 * it is, `codedFrom` shows the evidence behind it (five articles from ONE
 * publisher is visibly thin), `coding` states plainly that it is unverified, and
 * `timing` separates when GDELT filed the record from when the event is dated.
 * Same data, same pin, no claim we cannot support.
 *
 * The caveats already existed — in the explainer panel, which a reader has to go
 * and open. The defect was that the hedge lived there and the assertion lived
 * here. This moves the hedge to where the claim is.
 */
export function toCoverageProps(b: PlaceBucket): Record<string, unknown> {
  return {
    place: b.place,
    // `articles` is GDELT's NumArticles summed over the place — source-document
    // volume, NOT a 0–10 magnitude, so it stays off `magnitude` and never
    // distorts the marker radius (see types.ts).
    articles: b.articles,
    events: b.events,
    codedAs: `${cameoLabel(b.top.eventCode)} (CAMEO ${b.top.eventCode})`,
    codedFrom: `${plural(b.top.numArticles, "article")} · ${plural(b.top.numSources, "publisher")}`,
    coding: "Machine-coded from article text by GDELT — not a verified incident",
    timing: describeTiming(b.top.ts, b.top.eventDate),
    pinPrecision: geoPrecision(b.top.geoType),
    tone: Math.round(b.top.avgTone * 10) / 10,
  };
}

// --- country aggregation (what the layers actually render) ------------------

/**
 * Country name out of an ActionGeo_FullName. GDELT writes the country last:
 * "Bristol, Bristol, City of, United Kingdom" -> "United Kingdom", and a
 * country-level row is just "Denmark".
 */
export function countryFromPlace(place: string): string {
  const parts = (place ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

/**
 * Circular mean of longitudes, in degrees. A plain arithmetic mean puts a
 * country that straddles the antimeridian (Russia, Fiji) in the middle of the
 * Atlantic, which is the kind of confidently-wrong pin this whole layer is
 * being rebuilt to stop producing.
 */
export function meanLon(lons: number[]): number {
  if (lons.length === 0) return 0;
  let x = 0;
  let y = 0;
  for (const d of lons) {
    const r = (d * Math.PI) / 180;
    x += Math.cos(r);
    y += Math.sin(r);
  }
  if (Math.abs(x) < 1e-12 && Math.abs(y) < 1e-12) return 0;
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/**
 * Pure: layer events -> ONE feature per country.
 *
 * WHY THIS REPLACED PER-PLACE PINS. GDELT's per-row accuracy was never its
 * design target: it is a machine coder run over every article on earth, and it
 * is used in research by aggregating millions of events, where uncorrelated
 * miscodings average out. At n=1 they do not average out — the miscoding IS the
 * marker. Auditing the top 30 city pins against their source articles on
 * 2026-08-14 found roughly a fifth were current, violent and correctly placed;
 * the rest were court reporting about past events, metaphor ("Reform Tories vow
 * legal war"), or unrelated news (a judge dismissing a lawsuit, pinned to
 * Israel as "use of military force").
 *
 * Aggregating to the country restores the only scale at which this feed is
 * sound, and it changes the CLAIM from "this happened here" to "this much
 * conflict-coded reporting mentions this country" — which is true, and is
 * measurable, and is all GDELT ever knew.
 */
export function aggregateGdeltByCountry(
  events: GdeltEvent[],
  meta: GdeltLayerMeta,
  cap = MAX_POINTS,
  minArticles = MIN_ARTICLES,
  requireTypedActor = MIN_TYPED_ACTOR,
): SignalFeature[] {
  const selected = selectLayerEvents(events, meta, minArticles, requireTypedActor);

  interface CountryBucket {
    key: string;
    name: string;
    articles: number;
    events: number;
    places: Set<string>;
    lats: number[];
    lons: number[];
    /** GDELT's own country-level point, when any member row carried one. */
    anchor?: GdeltEvent;
    top: GdeltEvent;
  }

  const byCountry = new Map<string, CountryBucket>();
  for (const e of selected) {
    // Group by FIPS country code where GDELT gave one; fall back to the name so
    // a missing code cannot silently merge unrelated countries into one bucket.
    const name = countryFromPlace(e.place);
    const key = e.countryCode || name.toUpperCase();
    if (!key) continue;
    let b = byCountry.get(key);
    if (!b) {
      b = { key, name, articles: 0, events: 0, places: new Set(), lats: [], lons: [], top: e };
      byCountry.set(key, b);
    }
    b.articles += e.numArticles;
    b.events += 1;
    b.places.add(`${e.lat.toFixed(2)}|${e.lon.toFixed(2)}`);
    b.lats.push(e.lat);
    b.lons.push(e.lon);
    if (e.geoType === "1" && !b.anchor) b.anchor = e; // GDELT's national centroid
    if (e.numArticles > b.top.numArticles) {
      b.top = e;
      if (name) b.name = name;
    }
  }

  const ranked = applyCap(
    [...byCountry.values()].sort((a, b) => b.articles - a.articles || a.name.localeCompare(b.name)),
    cap,
    { noun: "countries", rule: "the most covered by article volume" },
  );

  return carryCoverage(ranked, ranked.map((b) => {
    const lat = b.anchor ? b.anchor.lat : b.lats.reduce((s, v) => s + v, 0) / b.lats.length;
    const lon = b.anchor ? b.anchor.lon : meanLon(b.lons);
    return {
      id: `gdelt:${meta.signalId}:country:${b.key}`,
      lat,
      lon,
      title: b.name || b.key,
      signalId: meta.signalId,
      color: meta.color,
      link: /^https?:\/\//i.test(b.top.sourceUrl) ? b.top.sourceUrl : undefined,
      ts: b.top.ts,
      props: {
        country: b.name || b.key,
        articles: b.articles,
        // Radius driver. Log-scaled like every other country-aggregated layer.
        magnitude: countMagnitude(b.articles),
        events: b.events,
        locationsRolledUp: b.places.size,
        topCoding: `${cameoLabel(b.top.eventCode)} (CAMEO ${b.top.eventCode})`,
        codedFrom: `${plural(b.top.numArticles, "article")} · ${plural(b.top.numSources, "publisher")}`,
        coding:
          "Country total of conflict-coded news articles, machine-coded by GDELT. " +
          "This measures REPORTING VOLUME, not confirmed incidents, and the marker sits on a national centroid.",
        timing: describeTiming(b.top.ts, b.top.eventDate),
        topArticle: b.top.place ? `Best-covered mention: ${b.top.place}` : undefined,
      },
    };
  }));
}

// --- upstream window fetch (shared by both layers) --------------------------

const p2 = (n: number) => String(n).padStart(2, "0");

/** Step a YYYYMMDDHHMMSS stamp back by `steps` 15-minute slots. */
export function shiftStamp(stamp: string, steps: number): string {
  const d = new Date(Date.UTC(
    Number(stamp.slice(0, 4)), Number(stamp.slice(4, 6)) - 1, Number(stamp.slice(6, 8)),
    Number(stamp.slice(8, 10)), Number(stamp.slice(10, 12)), 0,
  ));
  d.setUTCMinutes(d.getUTCMinutes() - 15 * steps);
  return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}00`;
}

/** Pure: pull the newest `.export.CSV.zip` stamp out of a lastupdate.txt body. */
export function parseLastUpdate(body: string): string | undefined {
  return body.match(/(\d{14})\.export\.CSV\.zip/)?.[1];
}

/** Newest stamp implied by the clock, floored to a 15-min slot and lagged one slot. */
function stampFromClock(now = Date.now()): string {
  const d = new Date(now);
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 15) * 15);
  d.setUTCMinutes(d.getUTCMinutes() - 15); // the current slot is not published yet
  return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}00`;
}

/**
 * Inflate a single-entry ZIP using the Web DecompressionStream. Deliberately NOT
 * node:zlib — client components import the signals registry, which imports this
 * module, so a `node:` builtin here would break the browser bundle.
 */
/**
 * `deflate-raw` is the correct format for a ZIP member, and it only reached
 * DecompressionStream in Node 20.18. On an older runtime the constructor throws
 * `TypeError: Unsupported compression format` — and because fetchSlot catches
 * everything, every slot yields nothing and the layer reports an empty world.
 * That is what happened: 300 conflict points on a local Node 24 and ZERO in
 * production, silently.
 *
 * A zlib-wrapped `deflate` fallback was tried and REJECTED: measured against a
 * real export it returned 475,136 bytes where deflate-raw returns 476,658, and
 * the shortfall persisted with a correct Adler-32 trailer. Losing 1.5 KB off the
 * end of a CSV drops rows, which is a worse failure than not decoding at all.
 *
 * So there is one decode path, and the CAPABILITY is checked up front and
 * reported. A layer that cannot run must say why — never return [] and let it
 * read as "nothing is happening in the world".
 */
export function rawDeflateSupported(): boolean {
  try {
    new DecompressionStream("deflate-raw");
    return true;
  } catch {
    return false;
  }
}

/** Why the window produced nothing, when it produced nothing. Null = fine. */
export function windowBlocker(): string | null {
  if (!rawDeflateSupported()) {
    return "This runtime's DecompressionStream has no 'deflate-raw' support (added in Node 20.18), so GDELT's zipped export cannot be read here.";
  }
  return null;
}

/**
 * The compressed extent of a ZIP's first member.
 *
 * The local file header carries `compressedSize` at offset 18. When an archive is
 * written in streaming mode that field is 0 and the real size lives in a data
 * descriptor AFTER the payload, introduced by the signature PK - so in
 * that case we scan for it.
 *
 * This is not pedantry. Slicing from the payload start to END OF FILE hands the
 * decoder the payload plus the data descriptor plus the central directory plus
 * the end-of-central-directory record. Node 24 tolerates that; Vercel's runtime
 * does not, and rejected all sixteen files with
 * "TypeError: Trailing junk found after the end of the compressed stream" - which
 * is how this layer served 300 conflict points locally and an empty world in
 * production. Production told us, because the previous deploy taught it to.
 */
export function zipMemberExtent(buf: ArrayBuffer): { start: number; end: number } {
  const view = new DataView(buf);
  if (view.getUint32(0, true) !== 0x04034b50) throw new Error("not a zip");
  const compressedSize = view.getUint32(18, true);
  const nameLen = view.getUint16(26, true);
  const extraLen = view.getUint16(28, true);
  const start = 30 + nameLen + extraLen;
  if (compressedSize > 0) return { start, end: start + compressedSize };

  // Streaming archive: find the data descriptor that follows the payload.
  const bytes = new Uint8Array(buf);
  for (let i = start; i + 3 < bytes.length; i++) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x07 && bytes[i + 3] === 0x08) {
      return { start, end: i };
    }
  }
  // No descriptor either: fall back to the central directory, then to the whole
  // remainder. Both are worse than the header, which is why they are last.
  for (let i = bytes.length - 4; i > start; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x01 && bytes[i + 3] === 0x02) {
      return { start, end: i };
    }
  }
  return { start, end: bytes.length };
}

async function unzipSingleEntry(buf: ArrayBuffer): Promise<string> {
  const { start, end } = zipMemberExtent(buf);
  const stream = new Blob([new Uint8Array(buf, start, end - start)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

/** Run `jobs` with bounded concurrency, preserving nothing but the merged output. */
async function pooled<T>(jobs: (() => Promise<T[]>)[], limit: number): Promise<T[]> {
  const out: T[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= jobs.length) return;
      // Appended one at a time: `push(...arr)` spreads thousands of rows onto the
      // call stack and blows it on a busy 15-minute slot.
      for (const item of await jobs[i]()) out.push(item);
    }
  });
  await Promise.all(workers);
  return out;
}

interface WindowCache {
  events: GdeltEvent[];
  at: number;
}
let cache: WindowCache | null = null;
let inflight: Promise<GdeltEvent[]> | null = null;

/**
 * What the last window attempt actually did, so production can be asked instead
 * of guessed at. My first diagnosis of the empty-in-prod case was wrong precisely
 * because the notice asserted "the bucket answered" when nothing had checked that.
 * A diagnostic that states more than it measured is worse than none.
 */
export interface WindowDiag {
  lastUpdateStatus: number | null;
  lastUpdateError: string | null;
  stampSource: "lastupdate" | "clock";
  slotsRequested: number;
  slotsOk: number;
  slotsHttpError: number;
  slotsThrew: number;
  firstSlotError: string | null;
  bytesRead: number;
  rowsParsed: number;
}

let diag: WindowDiag | null = null;

/** The last window attempt's diagnostics, or null before the first attempt. */
export function windowDiag(): WindowDiag | null {
  return diag;
}

/** One line naming where the pipeline stopped. Safe to show a user. */
export function describeDiag(d: WindowDiag | null): string {
  if (!d) return "The window has not been attempted yet in this process.";
  const parts = [
    d.lastUpdateError
      ? `lastupdate.txt failed (${d.lastUpdateError})`
      : `lastupdate.txt HTTP ${d.lastUpdateStatus}`,
    `stamp from ${d.stampSource}`,
    `${d.slotsOk}/${d.slotsRequested} slots decoded`,
    `${d.slotsHttpError} HTTP errors`,
    `${d.slotsThrew} threw`,
    `${d.bytesRead} bytes`,
    `${d.rowsParsed} rows parsed`,
  ];
  if (d.firstSlotError) parts.push(`first slot error: ${d.firstSlotError}`);
  return parts.join(", ") + ".";
}

async function refresh(): Promise<GdeltEvent[]> {
  const d: WindowDiag = {
    lastUpdateStatus: null,
    lastUpdateError: null,
    stampSource: "clock",
    slotsRequested: 0,
    slotsOk: 0,
    slotsHttpError: 0,
    slotsThrew: 0,
    firstSlotError: null,
    bytesRead: 0,
    rowsParsed: 0,
  };
  let newest: string | undefined;
  try {
    const res = await fetch(`${BASE}/lastupdate.txt`, { signal: AbortSignal.timeout(15_000) });
    d.lastUpdateStatus = res.status;
    if (res.ok) {
      newest = parseLastUpdate(await res.text());
      if (newest) d.stampSource = "lastupdate";
    }
  } catch (e) {
    d.lastUpdateError = (e as Error)?.name ?? "error";
  }
  const stamp = newest ?? stampFromClock();
  const stamps = Array.from({ length: WINDOW_FILES }, (_, i) => shiftStamp(stamp, i));
  d.slotsRequested = stamps.length;

  const events = await pooled(
    stamps.map((st) => async () => {
      try {
        const res = await fetch(`${BASE}/${st}.export.CSV.zip`, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) {
          d.slotsHttpError++;
          d.firstSlotError ??= `HTTP ${res.status}`;
          return [];
        }
        const buf = await res.arrayBuffer();
        d.bytesRead += buf.byteLength;
        const text = await unzipSingleEntry(buf);
        const rows = parseGdeltExport(text);
        d.rowsParsed += rows.length;
        d.slotsOk++;
        return rows;
      } catch (e) {
        d.slotsThrew++;
        d.firstSlotError ??= `${(e as Error)?.name ?? "Error"}: ${((e as Error)?.message ?? "").slice(0, 90)}`;
        return [];
      }
    }),
    FETCH_CONCURRENCY,
  );
  diag = d;

  // An empty result means every slot failed - GDELT always has events. Serve
  // last-good and DON'T cache the emptiness, or one bad minute blinds the layer
  // for the whole TTL.
  if (events.length === 0) return cache?.events ?? [];
  cache = { events, at: Date.now() };
  return events;
}

/** Fresh-or-stale-while-revalidate over the shared window. Never throws. */
export async function fetchGdeltWindow(): Promise<GdeltEvent[]> {
  const hit = cache;
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.events;
  if (!inflight) {
    inflight = refresh()
      .catch(() => cache?.events ?? [])
      .finally(() => { inflight = null; });
  }
  return hit ? hit.events : inflight;
}

/**
 * One labelled feature explaining why the layer is empty, placed at 0,0.
 *
 * Deliberately visible: the whole point is that a reader must be able to tell
 * "we cannot fetch this" from "the world is quiet". It carries no magnitude, so
 * it cannot draw a severity bar and cannot be mistaken for an event.
 */
export function dormantNotice(meta: { signalId: string; label: string }, reason: string) {
  return {
    id: `${meta.signalId}:unavailable`,
    lat: 0,
    lon: 0,
    title: `${meta.label} — no data: this layer is unavailable`,
    signalId: meta.signalId,
    color: "#94a3b8",
    props: { status: "unavailable", reason },
  };
}

function makeSource(meta: GdeltLayerMeta): SignalSource {
  return {
    id: meta.signalId,
    label: meta.label,
    group: "Intel",
    color: meta.color,
    refreshMs: 15 * 60 * 1000, // GDELT publishes a new export every 15 minutes
    attribution: GDELT_ATTRIBUTION,
    // Real scalar: NumArticles summed over the COUNTRY — how many source documents
    // carried conflict-coded reporting mentioning it in the trailing window. It is
    // reporting volume and is labelled as such; it is not a severity score.
    metric: { field: "articles", domain: [1, 400], unit: " articles" },
    async fetch() {
      // A capability the runtime lacks is not "nothing is happening in the world".
      // This layer returned 300 points locally and 0 in production, silently,
      // because the catch below treated an unsupported decoder exactly like a
      // quiet news day. Say so instead — one labelled feature, never a bare [].
      const blocked = windowBlocker();
      if (blocked) return [dormantNotice(meta, blocked)];
      try {
        const events = await fetchGdeltWindow();
        if (events.length === 0) {
          return [
            dormantNotice(
              meta,
              `No event rows came back for the last four hours, which GDELT does not normally do. ${describeDiag(windowDiag())}`,
            ),
          ];
        }
        return aggregateGdeltByCountry(events, meta);
      } catch (e) {
        return [dormantNotice(meta, `The GDELT export could not be read: ${(e as Error)?.message ?? "unknown error"}.`)];
      }
    },
  };
}

export const CONFLICT_SOURCE = makeSource(GDELT_LAYERS.conflict);
export const PROTESTS_SOURCE = makeSource(GDELT_LAYERS.protests);
