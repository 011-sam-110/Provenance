// Airframe enrichment from adsbdb.com — a free, keyless aircraft database.
//
// ONE lookup, called SERVER-side only (so the client never hits adsbdb and there's
// no CORS): hex → airframe (type/registration/owner).
//
// THE ROUTE LOOKUP LEFT on 2026-10-16. adsbdb's README says its flight-route data
// "may not be copied, published, or incorporated into other databases without the
// explicit permission of David J Taylor", and a route per dossier click is
// publishing it. Routes now come from Virtual Radar Server's CC0 standing data
// (lib/sources/vrsRoutes.ts). The FlightRoute / FlightAirport shapes stay here
// because the dossier and /api/flight are typed on them.
//
// adsbdb answers an unknown id with HTTP 404 and a `{"response":"unknown aircraft"}`
// string body, so the parser below treats the string `response` as "no data" and
// returns null. The dossier degrades gracefully on null — it never blocks on
// enrichment.
//
// Contract confirmed live 2026-06-27 against:
//   GET https://api.adsbdb.com/v0/aircraft/{hex}

const BASE = "https://api.adsbdb.com/v0";
const TIMEOUT_MS = 7_000;
const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

// --- Normalized shapes the dossier consumes --------------------------------

export interface FlightAirport {
  iata: string;
  icao: string;
  name: string;
  municipality: string;
  countryIso: string;
  lat: number;
  lon: number;
}

export interface FlightRoute {
  callsign: string;
  airline: string | null;
  origin: FlightAirport | null;
  destination: FlightAirport | null;
}

export interface AircraftInfo {
  type: string | null;
  icaoType: string | null;
  manufacturer: string | null;
  registration: string | null;
  owner: string | null;
  ownerCountry: string | null;
}

export interface FlightEnrichment {
  route: FlightRoute | null;
  aircraft: AircraftInfo | null;
}

// --- Raw adsbdb response shapes (only the fields we read) -------------------

interface RawAircraft {
  type?: string;
  icao_type?: string;
  manufacturer?: string;
  registration?: string;
  registered_owner?: string;
  registered_owner_country_name?: string;
  mode_s?: string;
}

// `response` is the data object on success, or a plain string on a miss.
type RawResponse<K extends string, V> = { response?: (Record<K, V> & object) | string };

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Parse an adsbdb aircraft response into {@link AircraftInfo}, or null on a miss. */
export function parseAircraft(json: RawResponse<"aircraft", RawAircraft>): AircraftInfo | null {
  const r = json?.response;
  if (!r || typeof r === "string") return null; // "unknown aircraft"
  const a = r.aircraft;
  if (!a) return null;
  const info: AircraftInfo = {
    type: str(a.type),
    icaoType: str(a.icao_type),
    manufacturer: str(a.manufacturer),
    registration: str(a.registration),
    owner: str(a.registered_owner),
    ownerCountry: str(a.registered_owner_country_name),
  };
  // If every field is empty there's nothing to enrich with.
  return Object.values(info).some((v) => v !== null) ? info : null;
}

async function getJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": UA },
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // 404 = unknown id; adsbdb still returns JSON, so parse and let the parser
    // return null. Any other non-OK (5xx/429) → treat as "no data".
    if (!res.ok && res.status !== 404) return null;
    return (await res.json()) as unknown;
  } catch {
    return null; // network/timeout/redirect → dormant-safe
  }
}

// A short server-side cache so rapid dossier opens don't hammer adsbdb. Airframes
// effectively never change. null results are cached too (so a genuine miss isn't
// re-fetched every click).
const AIRFRAME_TTL_MS = 60 * 60_000;
const aircraftCache = new Map<string, { at: number; value: AircraftInfo | null }>();

/** hex (mode-S) → airframe, server-cached ~60 min. null on miss. */
export async function fetchAircraftInfo(hex: string, now = Date.now()): Promise<AircraftInfo | null> {
  const key = hex.trim().toUpperCase();
  if (!key || key === "UNKNOWN") return null;
  const hit = aircraftCache.get(key);
  if (hit && now - hit.at < AIRFRAME_TTL_MS) return hit.value;
  const json = await getJson(`${BASE}/aircraft/${encodeURIComponent(key)}`);
  const value = json ? parseAircraft(json as RawResponse<"aircraft", RawAircraft>) : null;
  aircraftCache.set(key, { at: now, value });
  return value;
}
