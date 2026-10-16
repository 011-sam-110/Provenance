// Flight routes from Virtual Radar Server's standing data (CC0), for the plane dossier.
//
// WHY NOT adsbdb ANY MORE (2026-10-16). adsbdb's README says its flight-route data
// "may not be copied, published, or incorporated into other databases without the
// explicit permission of David J Taylor". Showing a route per click is publishing it.
// adsbdb's AIRFRAME lookup carries no such clause and stays (lib/sources/adsbdb.ts).
//
// THE DATA. https://github.com/vradarserver/standing-data, licence CC0-1.0, updated
// daily (last commit 2026-10-16T03:49Z when checked). Three files are read, all over
// raw.githubusercontent.com, keyless, and only on a dossier click:
//   routes/schema-01/{A}/{ABC}-all.csv   Callsign,Code,Number,AirlineCode,AirportCodes
//   airports/schema-01/{E}/{EG}.csv      Code,Name,ICAO,IATA,Location,CountryISO2,Latitude,Longitude,AltitudeFeet
//   airlines/schema-01/airlines.csv      Code,Name,ICAO,IATA,PositioningFlightPattern,CharterFlightPattern
// Each file is held for a day, a missing one included, so a busy airline costs one
// 130 KB read a day, not one per click.
//
// CALLSIGNS. The repo stores routes against a normalised callsign (routes/schema-01/
// README.md): the code, then the number with its leading zeros removed. Only ICAO
// three-letter codes are looked up. A two-character IATA code would first need the
// airline table to swap it for the ICAO one, and ADS-B callsigns are ICAO in practice;
// a registration callsign has no route by design.

import type { FlightAirport, FlightRoute } from "@/lib/sources/adsbdb";

const RAW = "https://raw.githubusercontent.com/vradarserver/standing-data/main";
const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";
const TIMEOUT_MS = 7_000;
export const VRS_TTL_MS = 24 * 60 * 60 * 1000;
export const VRS_CREDIT = "routes © Virtual Radar Server standing data (CC0)";

/** Pure: a broadcast callsign → the repo's normalised form, or null if it cannot have a route. */
export function normaliseCallsign(raw: string): { code: string; number: string; callsign: string } | null {
  const cs = raw.trim().toUpperCase();
  const m = /^([A-Z]{3})(\d[A-Z0-9]*)$/.exec(cs);
  if (!m) return null;
  const code = m[1];
  let number = m[2].replace(/^0+/, "");
  if (!number || /^[A-Z]+$/.test(number)) number = `0${number}`;
  // At most four characters, digits first, the last one or two may be letters.
  if (number.length > 4 || !/^\d{1,4}$|^\d{1,3}[A-Z]$|^\d{1,2}[A-Z]{2}$/.test(number)) return null;
  return { code, number, callsign: `${code}${number}` };
}

/** Pure: one CSV line → fields. Double quotes delimit; "" inside quotes is a quote. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Pure: a CSV file → rows keyed by its own header, BOM and blank lines dropped. */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const head = splitCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((l) => {
    const f = splitCsvLine(l);
    const row: Record<string, string> = {};
    head.forEach((h, i) => (row[h] = (f[i] ?? "").trim()));
    return row;
  });
}

/** Pure: an airline's routes file → normalised callsign → airport codes in flight order. */
export function parseRoutes(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of parseCsv(text)) {
    const codes = (r.AirportCodes ?? "").split("-").map((c) => c.trim()).filter(Boolean);
    if (r.Callsign && codes.length >= 2) out.set(r.Callsign.toUpperCase(), codes);
  }
  return out;
}

/** Pure: an airports file → code → airport, for both its ICAO and its own code. */
export function parseAirports(text: string): Map<string, FlightAirport> {
  const out = new Map<string, FlightAirport>();
  for (const r of parseCsv(text)) {
    const lat = Number(r.Latitude);
    const lon = Number(r.Longitude);
    if (!r.Code || !r.Latitude || !r.Longitude || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const a: FlightAirport = {
      iata: r.IATA ?? "",
      icao: r.ICAO ?? "",
      name: r.Name ?? "",
      municipality: r.Location ?? "",
      countryIso: r.CountryISO2 ?? "",
      lat,
      lon,
    };
    out.set(r.Code.toUpperCase(), a);
    if (a.icao) out.set(a.icao.toUpperCase(), a);
  }
  return out;
}

/** Pure: the airlines file → ICAO code → airline name. */
export function parseAirlines(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of parseCsv(text)) if (r.ICAO && r.Name) out.set(r.ICAO.toUpperCase(), r.Name);
  return out;
}

/** The seam the tests drive; production passes nothing. */
export interface VrsDeps {
  fetchText?: (url: string) => Promise<string | null>;
  now?: () => number;
}

async function realFetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) return ""; // no file = no routes for that airline: a real answer
    if (!res.ok) return null; // 5xx/429: unknown, not cached as empty
    return await res.text();
  } catch {
    return null; // network/timeout → dormant-safe
  }
}

// One cache for the three file kinds, on globalThis so a second route bundle that
// reads routes would share it. A failed read (null) is not cached.
const CACHE_KEY = Symbol.for("provenance.vrsRoutes.files.v1");
function files(): Map<string, { at: number; value: unknown }> {
  const g = globalThis as unknown as Record<symbol, Map<string, { at: number; value: unknown }> | undefined>;
  return (g[CACHE_KEY] ??= new Map());
}

async function cachedFile<T>(url: string, parse: (text: string) => T, deps: VrsDeps): Promise<T | null> {
  const now = (deps.now ?? Date.now)();
  const hit = files().get(url);
  if (hit && now - hit.at < VRS_TTL_MS) return hit.value as T;
  const text = await (deps.fetchText ?? realFetchText)(url);
  if (text == null) return null;
  const value = parse(text);
  files().set(url, { at: now, value });
  return value;
}

async function airport(code: string, deps: VrsDeps): Promise<FlightAirport | null> {
  const c = code.toUpperCase();
  if (c.length < 2) return null;
  const table = await cachedFile(`${RAW}/airports/schema-01/${c[0]}/${c.slice(0, 2)}.csv`, parseAirports, deps);
  return table?.get(c) ?? null;
}

/** callsign → route (origin = first airport, destination = last), from VRS standing data. null on a miss. */
export async function fetchVrsRoute(callsign: string, deps: VrsDeps = {}): Promise<FlightRoute | null> {
  const n = normaliseCallsign(callsign);
  if (!n) return null;
  const routes = await cachedFile(`${RAW}/routes/schema-01/${n.code[0]}/${n.code}-all.csv`, parseRoutes, deps);
  const codes = routes?.get(n.callsign);
  if (!codes) return null;
  const [origin, destination, airlines] = await Promise.all([
    airport(codes[0], deps),
    airport(codes[codes.length - 1], deps),
    cachedFile(`${RAW}/airlines/schema-01/airlines.csv`, parseAirlines, deps),
  ]);
  if (!origin && !destination) return null;
  return { callsign: n.callsign, airline: airlines?.get(n.code) ?? null, origin, destination };
}

/** Test seam. */
export function resetVrsCache(): void {
  files().clear();
}
