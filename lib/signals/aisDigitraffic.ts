import type { AisVessel } from "@/lib/signals/ais";
import { cleanCallSign, draughtFromTenths, etaFromPacked, sizeFrom, validImo } from "@/lib/signals/aisStatic";

// Vessel positions from Fintraffic's Digitraffic Marine AIS — keyless, CC BY 4.0,
// straight from the Finnish state traffic agency's own receivers. Covers the Baltic
// Proper, the Gulf of Finland and the Gulf of Bothnia (lat 56.6 to 65.8, lon 17 to
// 32.5 on 2026-10-16), which gives the AIS layer a chokepoint AISStream barely
// reaches: the Gulf of Finland approaches to Primorsk, Ust-Luga and St Petersburg,
// where shadow-fleet tankers run and the Baltic cable incidents happened.
//
// Two REST calls: /locations (positions, refreshed about once a minute; asked only
// for the last VESSEL_WINDOW_MS) and /vessels (names, types, destinations), which
// changes slowly and is held for METADATA_TTL_MS on globalThis. Digitraffic asks
// every caller to send a Digitraffic-User header naming itself. The register also
// carries each ship's call sign, IMO number, size, draught and ETA; they are read
// through lib/signals/aisStatic.ts, which says what each is.

export const DIGITRAFFIC_LOCATIONS = "https://meri.digitraffic.fi/api/ais/v1/locations";
export const DIGITRAFFIC_VESSELS = "https://meri.digitraffic.fi/api/ais/v1/vessels";
export const DIGITRAFFIC_CREDIT = "Source: Fintraffic / digitraffic.fi, license CC 4.0 BY";
const USER = "provenance-online.com";
const METADATA_TTL_MS = 6 * 3600_000;

export interface DigitrafficLocations {
  features?: {
    mmsi?: number;
    geometry?: { coordinates?: number[] };
    properties?: { mmsi?: number; sog?: number; cog?: number; navStat?: number; heading?: number; timestampExternal?: number };
  }[];
}

export interface DigitrafficVessel {
  mmsi?: number;
  name?: string;
  shipType?: number;
  destination?: string;
  callSign?: string;
  imo?: number;
  /** Tenths of a metre; 0 is "not available" and 255 is "25.5 m or more". */
  draught?: number;
  /** Month, day, hour and minute packed in one number (see etaFromPacked). */
  eta?: number;
  /** Distances from the position reference point to bow, stern, port and starboard, metres. */
  referencePointA?: number;
  referencePointB?: number;
  referencePointC?: number;
  referencePointD?: number;
}

/** AIS ship-type code (ITU-R M.1371) → a short label. */
export function shipTypeLabel(code: number | null | undefined): string | undefined {
  if (typeof code !== "number" || code <= 0) return undefined;
  if (code === 30) return "fishing";
  if (code === 31 || code === 32) return "towing";
  if (code === 33) return "dredging";
  if (code === 35) return "military";
  if (code === 36) return "sailing";
  if (code === 37) return "pleasure craft";
  if (code >= 40 && code <= 49) return "high-speed craft";
  if (code === 50) return "pilot";
  if (code === 51) return "search and rescue";
  if (code === 52) return "tug";
  if (code === 55) return "law enforcement";
  if (code >= 60 && code <= 69) return "passenger";
  if (code >= 70 && code <= 79) return "cargo";
  if (code >= 80 && code <= 89) return "tanker";
  return undefined;
}

/**
 * Pure: Digitraffic positions joined to their names → vessels reported within
 * `windowMs` of `now`. A position with no name keeps its MMSI as its label.
 */
export function normalizeDigitraffic(
  locations: DigitrafficLocations,
  vessels: DigitrafficVessel[],
  now: number,
  windowMs: number,
): AisVessel[] {
  const meta = new Map<number, DigitrafficVessel>();
  for (const v of vessels ?? []) if (typeof v.mmsi === "number") meta.set(v.mmsi, v);
  const out: AisVessel[] = [];
  for (const f of locations?.features ?? []) {
    const p = f.properties ?? {};
    const mmsi = p.mmsi ?? f.mmsi;
    const [lon, lat] = f.geometry?.coordinates ?? [];
    const t = p.timestampExternal;
    if (!mmsi || typeof lat !== "number" || typeof lon !== "number" || typeof t !== "number") continue;
    if (now - t > windowMs) continue;
    const m = meta.get(mmsi);
    const callSign = cleanCallSign(m?.callSign);
    const imo = validImo(m?.imo);
    const { lengthM, beamM } = sizeFrom(m?.referencePointA, m?.referencePointB, m?.referencePointC, m?.referencePointD);
    const draughtM = draughtFromTenths(m?.draught);
    const eta = etaFromPacked(m?.eta);
    out.push({
      MMSI: mmsi,
      ShipName: m?.name?.trim() || undefined,
      latitude: lat,
      longitude: lon,
      // AIS sends 102.3 kt for "speed not available" (Digitraffic stores 102.2) and
      // 360° for "course not available"; neither is a reading.
      Sog: typeof p.sog === "number" && p.sog < 102.2 ? p.sog : null,
      Cog: typeof p.cog === "number" && p.cog < 360 ? p.cog : null,
      TrueHeading: typeof p.heading === "number" ? p.heading : null,
      NavigationalStatus: typeof p.navStat === "number" ? p.navStat : null,
      time_utc: new Date(t).toISOString(),
      source: "Digitraffic",
      shipType: shipTypeLabel(m?.shipType),
      destination: m?.destination?.trim() || undefined,
      ...(callSign ? { callSign } : {}),
      ...(imo ? { imo } : {}),
      ...(lengthM ? { lengthM } : {}),
      ...(beamM ? { beamM } : {}),
      ...(draughtM ? { draughtM } : {}),
      ...(eta ? { eta } : {}),
    });
  }
  return out;
}

const CACHE = Symbol.for("provenance.ais.digitraffic.vessels");
type Holder = { [CACHE]?: { at: number; rows: DigitrafficVessel[] } };

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "Accept-Encoding": "gzip", "Digitraffic-User": USER },
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** The ship register, held 6 h. A failed refresh keeps the old one: names do not expire. */
async function vesselRegister(): Promise<DigitrafficVessel[]> {
  const holder = globalThis as Holder;
  const cached = holder[CACHE];
  if (cached && Date.now() - cached.at < METADATA_TTL_MS) return cached.rows;
  const rows = await getJson<DigitrafficVessel[]>(DIGITRAFFIC_VESSELS);
  if (Array.isArray(rows)) {
    holder[CACHE] = { at: Date.now(), rows };
    return rows;
  }
  return cached?.rows ?? [];
}

/** Recent Digitraffic vessels, or null when the positions endpoint did not answer. */
export async function fetchDigitraffic(windowMs: number): Promise<AisVessel[] | null> {
  const now = Date.now();
  const [locations, register] = await Promise.all([
    getJson<DigitrafficLocations>(`${DIGITRAFFIC_LOCATIONS}?from=${now - windowMs}`),
    vesselRegister(),
  ]);
  if (!locations) return null;
  return normalizeDigitraffic(locations, register, now, windowMs);
}
