import type { SignalFeature } from "@/lib/signals/types";
import { OSM_LANDING_STATIONS, type OsmLandingStation } from "@/lib/signals/cable-landings.osm.data";

// Two enrichments of the TeleGeography cable layers, both from committed tables:
//
// 1. LANDING STATIONS (OpenStreetMap, ODbL). TeleGeography places a landing at its
//    town ("Bude, United Kingdom"), not at the station building. OSM maps 58
//    telecom=cable_landing_station buildings (harvested by
//    scripts/harvest-cable-landings.mjs). Where exactly one of them belongs to a
//    landing, the pin moves onto it and says so; the town point stays in the props.
//
// 2. CAPACITY (US FCC, public domain). Every cable said "capacity: —" because
//    TeleGeography does not publish it. The FCC's 2024 Circuit Capacity Data
//    (DA 25-1072, Table 3, released 2025-12-17) states it for US-international
//    cables, but the operators of 53 of its 63 cables asked for confidential
//    treatment. Of the 10 that are public, 9 are on TeleGeography's map (the tenth,
//    Neutral Networks Laredo, is a river crossing). Refresh once a year (next release
//    about December 2026).

/** A station belongs to a landing only within this distance of the town point. */
export const STATION_RADIUS_KM = 30;

function km(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = Math.PI / 180;
  const x = Math.sin(aLat * r) * Math.sin(bLat * r) + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.cos((aLon - bLon) * r);
  return 6371 * Math.acos(Math.min(1, Math.max(-1, x)));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Does a station's name name this landing's town, or one of the cables landing there? */
function nameMatches(station: OsmLandingStation, landing: SignalFeature): boolean {
  const name = norm(station.name ?? "");
  if (!name) return false;
  const town = norm(landing.title.split(",")[0] ?? "");
  if (town.length >= 4 && name.includes(town)) return true;
  const cables = String(landing.props?.cables ?? "").split(" · ").map(norm).filter((c) => c.length >= 4);
  return cables.some((c) => name.includes(c) || (name.replace(/ cls$/, "").length >= 4 && c.includes(name.replace(/ cls$/, ""))));
}

/**
 * Pure: TeleGeography landing features + OSM stations → landings moved onto their
 * station where the match is unambiguous. A landing takes a station when the station
 * is within STATION_RADIUS_KM and is either the only station there or the only one
 * whose name names the town or a cable landing there, AND no other landing is nearer
 * to that station. Anything less certain keeps the town pin and lists the stations
 * nearby. Never adds or drops a landing.
 */
export function applyLandingStations(
  landings: SignalFeature[],
  stations: OsmLandingStation[] = OSM_LANDING_STATIONS,
): SignalFeature[] {
  // Each station's nearest landing, so one building is never claimed by two towns.
  const nearestLanding = new Map<string, string>();
  for (const s of stations) {
    let best: { id: string; d: number } | null = null;
    for (const l of landings) {
      const d = km(s.lat, s.lon, l.lat, l.lon);
      if (d <= STATION_RADIUS_KM && (!best || d < best.d)) best = { id: l.id, d };
    }
    if (best) nearestLanding.set(s.osm, best.id);
  }
  return landings.map((l) => {
    const near = stations.filter((s) => km(s.lat, s.lon, l.lat, l.lon) <= STATION_RADIUS_KM);
    if (!near.length) return l;
    const named = near.filter((s) => nameMatches(s, l));
    const chosen = named.length === 1 ? named[0] : named.length === 0 && near.length === 1 ? near[0] : null;
    if (chosen && nearestLanding.get(chosen.osm) === l.id) {
      return {
        ...l,
        lat: chosen.lat,
        lon: chosen.lon,
        props: {
          ...(l.props ?? {}),
          station: chosen.name ?? "Unnamed landing station",
          ...(chosen.operator ? { stationOperator: chosen.operator } : {}),
          stationSource: `OpenStreetMap ${chosen.osm}`,
          townPoint: `${l.lat.toFixed(4)}, ${l.lon.toFixed(4)} (TeleGeography)`,
        },
      };
    }
    return {
      ...l,
      props: { ...(l.props ?? {}), stationsNearby: near.map((s) => s.name ?? `OSM ${s.osm}`).join(" · ") },
    };
  });
}

/** FCC Table 3 (2024 data): Gbps available at 2024-12-31 and planned for 2026-12-31,
 *  keyed by TeleGeography cable id. Only the cables whose operators did not ask for
 *  confidentiality. */
export const FCC_CAPACITY_GBPS: Readonly<Record<string, { available: number; planned: number; fccName: string }>> = {
  "america-movil-submarine-cable-system-1-amx-1": { available: 90_000, planned: 112_000, fccName: "América Móvil Submarine Cable System (AMX1)" },
  "bahamas-internet-cable-system-bics": { available: 698, planned: 948, fccName: "Bahamas Internet Cable System (BICS)" },
  brusa: { available: 144_000, planned: 144_000, fccName: "BRUSA" },
  "carnival-submarine-network-1-csn-1": { available: 0, planned: 20_000, fccName: "Carnival Submarine Networks-1 (CSN-1)" },
  "global-caribbean-network-gcn": { available: 340, planned: 600, fccName: "Global Caribbean Network (GCN)" },
  "pacific-caribbean-cable-system-pccs": { available: 144_000, planned: 144_000, fccName: "Pacific Caribbean Cable System (PCCS)" },
  "south-america-1-sam-1": { available: 48_000, planned: 48_000, fccName: "South America-1 (SAm-1)" },
  marea: { available: 178_000, planned: 178_000, fccName: "MAREA" },
  "trans-pacific-express-tpe-cable-system": { available: 7_010, planned: 7_010, fccName: "Trans-Pacific Express (TPE) Cable Network" },
};

const gbps = (n: number) => `${n.toLocaleString("en-US")} Gbps`;

/** Pure: the capacity line for a cable id, or undefined when the FCC does not publish one. */
export function fccCapacity(cableId: string): string | undefined {
  const c = FCC_CAPACITY_GBPS[cableId];
  if (!c) return undefined;
  const planned = c.planned !== c.available ? `; ${gbps(c.planned)} planned by end 2026` : "";
  return `${gbps(c.available)} available at end 2024 (US FCC)${planned}`;
}
