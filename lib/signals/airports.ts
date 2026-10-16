import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { degraded, degradedWith, observed } from "@/lib/signals/outcome";
import {
  applyAirportLive,
  AVINOR_AIRPORTS,
  hongKongDate,
  parseAvinorXml,
  parseFaaStatus,
  parseHkiaBoard,
  parseMetarRows,
  parseTafXml,
  type AirportLive,
  type FlightBoard,
  type HkiaDay,
} from "@/lib/signals/airports.live";

// Major airports — OurAirports open data (public domain). Keyless CSV. The full
// file is ~85k rows / ~12 MB, so we FILTER to `type=large_airport` (~1,180,
// confirmed live 2026-06-27) server-side and cache HARD (24h). We surface the
// airport name, IATA code and country. Columns confirmed live 2026-06-27:
// id,ident,type,name,latitude_deg,longitude_deg,…,iso_country,…,iata_code,…
//
// A row must ALSO have `scheduled_service=yes`. OurAirports' `large_airport` is a
// size class, not a statement that airliners fly there: on 2026-10-16 it held 22
// rows without scheduled service, which this layer labelled "Major airport" —
// Kadena Air Base, King Abdulaziz Air Base, Paris-Le Bourget, Istanbul Atatürk
// (closed to passengers), Long Thanh "(Under Construction)", Western Sydney (not
// open yet), and Boryspil, Lviv, Odesa and Simferopol (no civil flights since 2022).

const ENDPOINT = "https://davidmegginson.github.io/ourairports-data/airports.csv";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

export const AIRPORTS_ATTRIBUTION =
  "Airport data © OurAirports (public domain); weather: NOAA Aviation Weather Center; status: FAA ATCSCC; " +
  "flight data: Avinor; flight information: Airport Authority Hong Kong (DATA.GOV.HK)";

/** OurAirports `continent` code → readable region. Empty string when unknown, so
 *  the directory view simply omits the region rather than inventing one. */
export function continentName(code: string | undefined): string {
  const M: Record<string, string> = {
    AF: "Africa", AN: "Antarctica", AS: "Asia", EU: "Europe",
    NA: "North America", OC: "Oceania", SA: "South America",
  };
  return M[(code ?? "").trim().toUpperCase()] ?? "";
}

/** Minimal RFC-4180-ish CSV parser: handles quoted fields, "" escapes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\r") {
      // swallow — handled by the \n branch
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Pure: OurAirports CSV → SignalFeature[] for large airports only. */
export function parseAirportsCsv(text: string): SignalFeature[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0];
  const col = (name: string) => header.indexOf(name);
  const iType = col("type");
  const iName = col("name");
  const iLat = col("latitude_deg");
  const iLon = col("longitude_deg");
  const iIso = col("iso_country");
  const iIata = col("iata_code");
  const iMuni = col("municipality");
  const iIdent = col("ident");
  const iCont = col("continent");
  const iSched = col("scheduled_service");
  const iIcao = col("icao_code");
  const iGps = col("gps_code");
  if (iType < 0 || iLat < 0 || iLon < 0) return [];
  const out: SignalFeature[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row[iType] !== "large_airport") continue;
    // An air base, a closed airport or one not yet open is not a "major airport".
    if (iSched >= 0 && (row[iSched] ?? "").trim() !== "yes") continue;
    const lat = Number(row[iLat]);
    const lon = Number(row[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    const ident = (row[iIdent] ?? "").trim();
    if (!ident) continue;
    const iata = (row[iIata] ?? "").trim();
    const country = (row[iIso] ?? "").trim();
    const city = (row[iMuni] ?? "").trim();
    const region = iCont >= 0 ? continentName(row[iCont]) : "";
    // The ICAO code is the join key for the live weather and status feeds.
    const icao = ((iIcao >= 0 ? row[iIcao] : "") || (iGps >= 0 ? row[iGps] : "") || "").trim().toUpperCase();
    out.push({
      id: `airport:${ident}`,
      lat,
      lon,
      title: (row[iName] ?? "").trim() || ident,
      signalId: "airports",
      color: "#2563eb",
      props: {
        type: "Major airport",
        ...(iata ? { iata } : {}),
        ...(icao ? { icao } : {}),
        ...(country ? { country } : {}),
        ...(region ? { region } : {}),
        ...(city ? { city } : {}),
      },
    });
  }
  return out;
}

// --- the directory (24 h) -------------------------------------------------------

let cache: { features: SignalFeature[]; at: number } | null = null;

type DirectoryRead = { features: SignalFeature[]; at: number; ok: boolean; reason?: string };

async function readDirectory(): Promise<DirectoryRead> {
  // A cache hit is a real upstream read — stamped when it happened, not now.
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return { ...cache, ok: true };
  try {
    const res = await fetch(ENDPOINT, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(30_000),
    });
    // Keep the last-good rows rather than emptying the layer over one blip, but
    // declare the failure and stamp the age of the data we are actually serving.
    if (!res.ok) return { features: cache?.features ?? [], at: cache?.at ?? Date.now(), ok: false, reason: `http ${res.status}` };
    const features = parseAirportsCsv(await res.text());
    cache = { features, at: Date.now() };
    return { ...cache, ok: true };
  } catch {
    return { features: cache?.features ?? [], at: cache?.at ?? Date.now(), ok: false, reason: "fetch failed" };
  }
}

// --- the live feeds (minutes) --------------------------------------------------------
//
// Each feed keeps its own last-good copy and its own clock. A feed that fails serves
// its last good answer while it is younger than LIVE_STALE_MS, and nothing after that:
// a six-hour-old ground stop shown as current would be worse than no badge.

const METAR_URL = "https://aviationweather.gov/data/cache/metars.cache.csv.gz";
const TAF_URL = "https://aviationweather.gov/data/cache/tafs.cache.xml.gz";
const FAA_URL = "https://nasstatus.faa.gov/api/airport-status-information";
const avinorUrl = (iata: string) => `https://asrv.avinor.no/XmlFeed/v1.0?airport=${iata}&TimeFrom=1&TimeTo=7`;
const hkiaUrl = (date: string, arrival: boolean) =>
  `https://www.hongkongairport.com/flightinfo-rest/rest/flights/past?date=${date}&lang=en&cargo=false&arrival=${arrival}`;

const LIVE_TTL_MS = {
  metar: 10 * 60_000, // the AWC cache is rebuilt every minute; it asks for bulk reads, not polling
  taf: 30 * 60_000,
  faa: 5 * 60_000,
  avinor: 5 * 60_000, // Avinor asks for no more than one poll per 3 minutes
  hkia: 20 * 60_000,
} as const;
const LIVE_STALE_MS = 2 * 60 * 60_000;
const LIVE_TIMEOUT_MS = 12_000;

type Slot<T> = { value: T; at: number };
const slots: { -readonly [K in keyof typeof LIVE_TTL_MS]?: Slot<unknown> } = {};

/** Read through a slot: fresh copy, else a new read, else the last good copy while
 *  it is not stale, else undefined. Never throws. */
async function viaSlot<T>(key: keyof typeof LIVE_TTL_MS, read: () => Promise<T>): Promise<Slot<T> | undefined> {
  const s = slots[key] as Slot<T> | undefined;
  if (s && Date.now() - s.at < LIVE_TTL_MS[key]) return s;
  try {
    const fresh = { value: await read(), at: Date.now() };
    slots[key] = fresh;
    return fresh;
  } catch {
    return s && Date.now() - s.at < LIVE_STALE_MS ? s : undefined;
  }
}

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(LIVE_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`http ${res.status}`);
  return res;
}

/**
 * The AWC caches are .gz FILES served as application/octet-stream, so fetch does not
 * decode them. DecompressionStream is a web standard (Node 18+ and browsers), which
 * keeps node:zlib out of a module the client bundle also imports.
 */
async function gunzipText(res: Response): Promise<string> {
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf[0] !== 0x1f || buf[1] !== 0x8b) return new TextDecoder().decode(buf); // already decoded
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

async function readAvinor(): Promise<Map<string, FlightBoard>> {
  const boards = new Map<string, FlightBoard>();
  const answers = await Promise.allSettled(
    AVINOR_AIRPORTS.map(async (iata) => [iata, parseAvinorXml(await (await get(avinorUrl(iata))).text())] as const),
  );
  for (const r of answers) if (r.status === "fulfilled") boards.set(r.value[0], r.value[1]);
  if (!boards.size) throw new Error("no Avinor airport answered");
  return boards;
}

async function readHkia(): Promise<FlightBoard> {
  const date = hongKongDate(Date.now());
  const answers = await Promise.allSettled(
    [false, true].map(async (arrival) => (await (await get(hkiaUrl(date, arrival))).json()) as HkiaDay[]),
  );
  const days = answers.flatMap((r) => (r.status === "fulfilled" && Array.isArray(r.value) ? r.value : []));
  if (!days.length) throw new Error("HKIA did not answer");
  return parseHkiaBoard(days);
}

async function readLive(): Promise<{ live: AirportLive; newestAt: number }> {
  const [metar, taf, faa, avinor, hkia] = await Promise.all([
    viaSlot("metar", async () => parseMetarRows(parseCsv(await gunzipText(await get(METAR_URL))))),
    viaSlot("taf", async () => parseTafXml(await gunzipText(await get(TAF_URL)))),
    viaSlot("faa", async () => parseFaaStatus(await (await get(FAA_URL)).text())),
    viaSlot("avinor", readAvinor),
    viaSlot("hkia", readHkia),
  ]);
  const boards = new Map<string, FlightBoard>(avinor?.value ?? []);
  if (hkia) boards.set("HKG", hkia.value);
  const live: AirportLive = {
    ...(metar ? { metar: metar.value } : {}),
    ...(taf ? { taf: taf.value } : {}),
    ...(faa ? { faa: faa.value } : {}),
    ...(boards.size ? { boards } : {}),
  };
  const newestAt = Math.max(0, ...[metar, taf, faa, avinor, hkia].map((s) => s?.at ?? 0));
  return { live, newestAt };
}

/** Test-only: forget every cached read. */
export function __resetAirportsCache(): void {
  cache = null;
  for (const k of Object.keys(slots) as (keyof typeof slots)[]) delete slots[k];
}

export const AIRPORTS_SOURCE: SignalSource = {
  id: "airports",
  // A named airport.
  precision: "facility",
  label: "Major airports",
  group: "Infrastructure",
  color: "#2563eb",
  // The directory is re-read daily; the live badges (weather, FAA status, flight
  // boards) are what this cadence is for.
  refreshMs: 10 * 60_000,
  attribution: AIRPORTS_ATTRIBUTION,
  kind: "asset", // permanent infrastructure → asset-directory focus view (no magnitude)
  // No throughput scalar, so the directory browses by IATA + country + continent.
  directory: { codeKey: "iata", codeLabel: "IATA", detailKey: "city", detailLabel: "City" },
  async fetch() {
    const dir = await readDirectory();
    if (!dir.features.length) return degraded(dir.reason ?? "no airports");
    const { live, newestAt } = await readLive();
    const features = applyAirportLive(dir.features, live);
    // The directory's own read time, or a live feed's when one landed later: either
    // way an upstream read that really happened.
    if (!dir.ok) return degradedWith(features, dir.reason ?? "fetch failed", dir.at);
    return observed(features, Math.max(dir.at, newestAt));
  },
};
