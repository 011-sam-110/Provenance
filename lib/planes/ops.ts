// Pure aviation helpers for the airspace-console focus view. All read the plane
// WorldObject (its meta carries the classified category/onGround/velocity), so no
// re-classification or fetch is needed. Unit-tested; the .tsx is a dumb shell.
import type { WorldObject } from "@/lib/world";
import type { PlaneCategory } from "@/lib/planes/classify";
import { isBizjet } from "@/lib/planes/bizjet";

const CATEGORY_LABEL: Record<PlaneCategory, string> = {
  airliner: "Airliner", regional: "Regional", light: "Light", helicopter: "Helicopter", ground: "Ground",
};
const CATEGORY_ORDER: PlaneCategory[] = ["airliner", "regional", "light", "helicopter", "ground"];

function meta(o: WorldObject): Record<string, unknown> { return (o.meta ?? {}) as Record<string, unknown>; }
function categoryOf(o: WorldObject): PlaneCategory {
  const c = meta(o).category;
  return (typeof c === "string" && c in CATEGORY_LABEL ? c : "light") as PlaneCategory;
}
function velocityOf(o: WorldObject): number | null {
  const v = meta(o).velocityMs;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
/** The ICAO type designator from a plane WorldObject's meta, upper-cased. */
export function typeCodeOf(o: WorldObject): string {
  const t = meta(o).typeCode;
  return typeof t === "string" ? t.trim().toUpperCase() : "";
}
/** True when this plane is a business/private jet (by ICAO type designator). */
export function isBizjetObject(o: WorldObject): boolean {
  return isBizjet(typeCodeOf(o));
}

export interface OpsSummary {
  total: number; airborne: number; ground: number;
  /** Business/private jets in view (any state) and the airborne subset. */
  bizjets: number; bizjetsAirborne: number;
  byCategory: { category: PlaneCategory; label: string; count: number }[];
  maxAltKm: number; maxSpeedMs: number;
}

export function opsSummary(objects: WorldObject[]): OpsSummary {
  let airborne = 0, ground = 0, maxAltKm = 0, maxSpeedMs = 0, bizjets = 0, bizjetsAirborne = 0;
  const counts: Partial<Record<PlaneCategory, number>> = {};
  for (const o of objects) {
    const onGround = !!meta(o).onGround;
    if (onGround) ground++; else airborne++;
    const c = categoryOf(o);
    counts[c] = (counts[c] ?? 0) + 1;
    if (isBizjetObject(o)) { bizjets++; if (!onGround) bizjetsAirborne++; }
    if (typeof o.altKm === "number" && o.altKm > maxAltKm) maxAltKm = o.altKm;
    const v = velocityOf(o);
    if (v != null && v > maxSpeedMs) maxSpeedMs = v;
  }
  const byCategory = CATEGORY_ORDER.filter((c) => counts[c]).map((c) => ({ category: c, label: CATEGORY_LABEL[c], count: counts[c]! }));
  return { total: objects.length, airborne, ground, bizjets, bizjetsAirborne, byCategory, maxAltKm, maxSpeedMs };
}

export type AltBand = "ground" | "0–1 km" | "1–3 km" | "3–7 km" | "7–11 km" | "11+ km";
export const ALT_BANDS: AltBand[] = ["11+ km", "7–11 km", "3–7 km", "1–3 km", "0–1 km", "ground"];
export function altitudeBand(o: WorldObject): AltBand {
  if (meta(o).onGround) return "ground";
  const a = typeof o.altKm === "number" ? o.altKm : 0;
  if (a < 1) return "0–1 km";
  if (a < 3) return "1–3 km";
  if (a < 7) return "3–7 km";
  if (a < 11) return "7–11 km";
  return "11+ km";
}

// Coarse continent buckets for the region filter/column. Derived purely from
// lat/lon — the aircraft pull is worldwide, so "region" means the continent a
// flight is over, independent of which type batch fetched it.
export const REGION_LABELS = [
  "North America", "South America", "Europe", "Middle East", "Africa", "Asia", "Oceania",
];
// Ordered bounding boxes; the first box that contains the point wins, so overlaps
// (Europe/Middle East/Africa around the Mediterranean) resolve by this priority.
const CONTINENT_BOXES: { label: string; latMin: number; latMax: number; lonMin: number; lonMax: number }[] = [
  { label: "North America", latMin: 7, latMax: 84, lonMin: -170, lonMax: -50 },
  { label: "South America", latMin: -56, latMax: 13, lonMin: -82, lonMax: -34 },
  { label: "Europe", latMin: 36, latMax: 72, lonMin: -25, lonMax: 40 },
  { label: "Middle East", latMin: 12, latMax: 42, lonMin: 34, lonMax: 63 },
  { label: "Africa", latMin: -35, latMax: 37, lonMin: -18, lonMax: 52 },
  { label: "Asia", latMin: 5, latMax: 78, lonMin: 40, lonMax: 180 },
  { label: "Oceania", latMin: -50, latMax: 0, lonMin: 110, lonMax: 180 },
];
/** Coarse continent for a coordinate (first matching box), or "—" if unclassified. */
export function regionOf(lat: number, lon: number): string {
  for (const b of CONTINENT_BOXES) {
    if (lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax) return b.label;
  }
  return "—";
}

/** The ICAO 24-bit hex, recovered from the "plane:<hex>" WorldObject id. */
export function planeHex(o: WorldObject): string {
  return o.id.startsWith("plane:") ? o.id.slice(6) : o.id;
}

/** Case-insensitive match of a free-text query against callsign / registration /
 *  type code / hex. Empty query matches everything. Pure + tested. */
export function matchesFlightQuery(o: WorldObject, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const reg = (meta(o).registration as string) || "";
  const type = typeCodeOf(o);
  return (
    o.label.toLowerCase().includes(q) ||
    reg.toLowerCase().includes(q) ||
    type.toLowerCase().includes(q) ||
    planeHex(o).toLowerCase().includes(q)
  );
}

export interface FlightFilter {
  region: string | null;
  band: AltBand | null;
  query: string;
  bizjetOnly: boolean;
}
export const EMPTY_FLIGHT_FILTER: FlightFilter = { region: null, band: null, query: "", bizjetOnly: false };

/** Apply the region + altitude + text + business-jet filters together. Pure. */
export function filterFlights(objects: WorldObject[], f: FlightFilter): WorldObject[] {
  return objects.filter((o) =>
    (!f.region || regionOf(o.lat, o.lon) === f.region) &&
    (!f.band || altitudeBand(o) === f.band) &&
    (!f.bizjetOnly || isBizjetObject(o)) &&
    matchesFlightQuery(o, f.query));
}

export type FlightSortKey = "altitude" | "speed" | "callsign" | "region";
export function sortFlights(objects: WorldObject[], key: FlightSortKey, dir: 1 | -1): WorldObject[] {
  const cmp = (a: WorldObject, b: WorldObject): number => {
    if (key === "callsign") return a.label.localeCompare(b.label);
    if (key === "region") return regionOf(a.lat, a.lon).localeCompare(regionOf(b.lat, b.lon));
    if (key === "speed") return (velocityOf(a) ?? -Infinity) - (velocityOf(b) ?? -Infinity);
    return (a.altKm ?? -Infinity) - (b.altKm ?? -Infinity);
  };
  return [...objects].sort((a, b) => dir * cmp(a, b));
}
