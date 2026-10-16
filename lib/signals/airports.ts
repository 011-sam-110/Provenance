import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { degraded, degradedWith, observed } from "@/lib/signals/outcome";

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

export const AIRPORTS_ATTRIBUTION = "Airport data © OurAirports (public domain)";

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

let cache: { features: SignalFeature[]; at: number } | null = null;

export const AIRPORTS_SOURCE: SignalSource = {
  id: "airports",
  // A named airport.
  precision: "facility",
  label: "Major airports",
  group: "Infrastructure",
  color: "#2563eb",
  refreshMs: CACHE_TTL_MS,
  attribution: AIRPORTS_ATTRIBUTION,
  kind: "asset", // permanent infrastructure → asset-directory focus view (no magnitude)
  // No throughput scalar, so the directory browses by IATA + country + continent.
  directory: { codeKey: "iata", codeLabel: "IATA", detailKey: "city", detailLabel: "City" },
  async fetch() {
    // A cache hit is a real upstream read — stamped when it happened, not now.
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) return observed(cache.features, cache.at);
    try {
      const res = await fetch(ENDPOINT, {
        headers: { "User-Agent": "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)" },
        signal: AbortSignal.timeout(30_000),
      });
      // Keep the last-good rows rather than emptying the layer over one blip, but
      // declare the failure and stamp the age of the data we are actually serving.
      // `degraded()` would have dropped the cache; marking it observed would have
      // claimed a read that did not happen.
      if (!res.ok) {
        return cache
          ? degradedWith(cache.features, `http ${res.status}`, cache.at)
          : degraded(`http ${res.status}`);
      }
      const text = await res.text();
      const features = parseAirportsCsv(text);
      cache = { features, at: Date.now() };
      return observed(features, cache.at);
    } catch {
      // Same last-good rule as the non-2xx path above.
      return cache
        ? degradedWith(cache.features, "fetch failed", cache.at)
        : degraded("fetch failed"); // dormant-safe
    }
  },
};
