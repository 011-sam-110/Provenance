import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { applyCap, carryCoverage } from "@/lib/signals/coverage";

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
 * Minimum distinct source documents before an event may reach the map. CAMEO is
 * machine-coded and its single-document codings are where nearly all the nonsense
 * lives (a stadium "clash", a "blitz" of publicity). Two independent documents is
 * a defensible floor and it is GDELT's own count, not a score we invented.
 */
const MIN_ARTICLES = 2;
/** Round coordinates to this many dp to bucket one place. 2dp ~ 1.1 km. */
const PLACE_DP = 2;
const MAX_POINTS = 300;
const CACHE_TTL_MS = 15 * 60 * 1000; // matches GDELT's own publish cadence

export const GDELT_ATTRIBUTION = "Event coding © The GDELT Project";

// --- GDELT 2.0 Event table column indices (0-based, 61 columns) -------------
const C_ID = 0;
const C_EVENT_CODE = 26;
const C_ROOT_CODE = 28;
const C_QUAD_CLASS = 29;
const C_NUM_MENTIONS = 31;
const C_NUM_ARTICLES = 33;
const C_AVG_TONE = 34;
const C_GEO_TYPE = 51;
const C_GEO_NAME = 52;
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
  numArticles: number;
  avgTone: number;
  geoType: string;
  place: string;
  lat: number;
  lon: number;
  sourceUrl: string;
  /** ISO timestamp GDELT added the event, from DATEADDED. */
  ts?: string;
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
  conflict: {
    signalId: "conflict",
    label: "Conflict",
    color: "#b91c1c",
    rootCodes: ["18", "19", "20"],
    quadClass: "4",
  },
  // CAMEO root 14 PROTEST. QuadClass is 3 (verbal conflict) for most of the tree,
  // so it is deliberately NOT constrained here.
  protests: {
    signalId: "protests",
    label: "Protests",
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
    const avgTone = num(c[C_AVG_TONE]);

    out.push({
      id: (c[C_ID] ?? "").trim(),
      eventCode: (c[C_EVENT_CODE] ?? "").trim(),
      rootCode: (c[C_ROOT_CODE] ?? "").trim(),
      quadClass: (c[C_QUAD_CLASS] ?? "").trim(),
      numMentions: Number.isFinite(numMentions) ? numMentions : 0,
      numArticles: Number.isFinite(numArticles) ? numArticles : 0,
      avgTone: Number.isFinite(avgTone) ? avgTone : 0,
      geoType,
      place: (c[C_GEO_NAME] ?? "").trim(),
      lat,
      lon,
      sourceUrl: (c[C_SOURCE_URL] ?? "").trim(),
      ts: isoFromStamp(c[C_DATE_ADDED] ?? ""),
    });
  }
  return out;
}

interface PlaceBucket {
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
export function normalizeGdeltEvents(
  events: GdeltEvent[],
  meta: GdeltLayerMeta,
  cap = MAX_POINTS,
  minArticles = MIN_ARTICLES,
): SignalFeature[] {
  const roots = new Set(meta.rootCodes);

  // 1. filter to the layer, then collapse actor-pair duplicates
  const deduped = new Map<string, GdeltEvent>();
  for (const e of events) {
    if (!roots.has(e.rootCode)) continue;
    if (meta.quadClass && e.quadClass !== meta.quadClass) continue;
    if (e.numArticles < minArticles) continue;
    if (!e.place) continue;
    const key = `${e.rootCode}|${e.lat.toFixed(3)}|${e.lon.toFixed(3)}|${e.sourceUrl}`;
    const prev = deduped.get(key);
    if (!prev || e.numArticles > prev.numArticles) deduped.set(key, e);
  }

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
    props: {
      place: b.place,
      // `articles` is GDELT's NumArticles summed over the place — source-document
      // volume, NOT a 0–10 magnitude, so it stays off `magnitude` and never
      // distorts the marker radius (see types.ts).
      articles: b.articles,
      events: b.events,
      topEvent: cameoLabel(b.top.eventCode),
      cameoCode: b.top.eventCode,
      precision: geoPrecision(b.top.geoType),
      tone: Math.round(b.top.avgTone * 10) / 10,
      window: `last ${(WINDOW_FILES * 15) / 60}h`,
    },
  })));
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

async function unzipSingleEntry(buf: ArrayBuffer): Promise<string> {
  const view = new DataView(buf);
  if (view.getUint32(0, true) !== 0x04034b50) throw new Error("not a zip");
  const nameLen = view.getUint16(26, true);
  const extraLen = view.getUint16(28, true);
  const start = 30 + nameLen + extraLen;
  const stream = new Blob([new Uint8Array(buf, start)])
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
    // Real scalar: NumArticles summed over the place — how many distinct source
    // documents covered events there in the trailing window. A quiet place is a
    // couple of documents; a heavily-covered flashpoint runs to ~100+.
    metric: { field: "articles", domain: [1, 100], unit: " articles" },
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
        return normalizeGdeltEvents(events, meta);
      } catch (e) {
        return [dormantNotice(meta, `The GDELT export could not be read: ${(e as Error)?.message ?? "unknown error"}.`)];
      }
    },
  };
}

export const CONFLICT_SOURCE = makeSource(GDELT_LAYERS.conflict);
export const PROTESTS_SOURCE = makeSource(GDELT_LAYERS.protests);
