// lib/signals/war-zones.ts
// War zones: who holds the ground, as DeepState maps the war in Ukraine.
//
// Relay feed `war-zones` (lib/relay/schemas/war-zones.ts), sent by NewsScraper
// `sources/deepstate.py` on provenance-1 every 30 minutes. That sender keeps DeepState's
// front-line shapes only and drops its political shapes ("occupied East Prussia", Karelia,
// Abkhazia and the rest), so this file draws what arrives and nothing else.
//
// ONE FEATURE PER AREA. Each area is its own polygon, in the colour of its kind: held by
// Russia, contested (DeepState's "status unknown", hatched, never a flat tint) and
// retaken by Ukraine. The precision is `area` and every feature carries its polygon, so
// the map draws the shape and never a pin (lib/map/precisionMarks.ts). The anchor
// (lat/lon) is a point INSIDE the polygon, for the click, the label and the dossier.
//
// THE ATTACK DIRECTIONS ARE NOT DRAWN. DeepState draws each one as an arrow, and the
// direction lives only in an icon number ("{icon=arrow_12}") that it does not document.
// A point without its arrow would say "an attack here", which DeepState did not say. The
// relay carries them and the summary counts them; nothing on the map shows them.
//
// THE SUMMARY (lib/signals/summary.ts) carries what is not a place: per zone, the map's
// date, the held and contested km², the change over 7, 30 and 90 days, and the daily
// series that provenance-1 measured from DeepState's own past maps. A change is computed
// only from a row that exists for that exact day; a missing day gives null, never an
// estimate. The widget (lib/console/widgets/war/war-zones.tsx) reads it through
// readWarZonesSummary.
import type { SignalFeature, SignalGeometry, SignalSource } from "@/lib/signals/types";
import { degraded, observed } from "@/lib/signals/outcome";
import { markSummary } from "@/lib/signals/summary";
import { readRelay } from "@/lib/relay/store";
import { usable } from "@/lib/relay/read";
import type { RelayData } from "@/lib/relay/feeds";

export type WarZoneAreaKind = "occupied" | "contested" | "liberated";

/** The plan's colours: Russian-held red, contested warm grey (hatched), retaken blue. */
export const WAR_ZONE_COLORS: Readonly<Record<WarZoneAreaKind, string>> = {
  occupied: "#c0392b",
  contested: "#8a8178",
  liberated: "#2b6cb0",
};

/** What each kind means, in the words the map and the widget use. */
export const WAR_ZONE_KIND_LABEL: Readonly<Record<WarZoneAreaKind, string>> = {
  occupied: "Russian-held",
  contested: "Contested (status unknown)",
  liberated: "Retaken by Ukraine",
};

/** DeepState's own names that only repeat the kind; anything else is worth showing. */
const GENERIC_NAMES = new Set(["occupied", "unknown status", "liberated"]);

export interface WarZoneSeriesRow {
  day: string;
  heldKm2: number;
  contestedKm2: number;
}

export interface WarZoneSummaryZone {
  id: string;
  name: string;
  source: string;
  sourceUrl: string;
  mapId: number;
  /** When DeepState published the map these areas come from. */
  mapAt: string;
  /** The newest row of the series, or null when the series is empty. */
  heldKm2: number | null;
  contestedKm2: number | null;
  /** Held now minus held N days before the newest row. Null when that day has no row. */
  change7: number | null;
  change30: number | null;
  change90: number | null;
  /** Oldest first, one row per UTC day. */
  series: WarZoneSeriesRow[];
  areas: Record<WarZoneAreaKind, number>;
  /** Attack directions DeepState marks. Counted, not drawn (see the header). */
  attacks: number;
}

export interface WarZonesSummary {
  zones: WarZoneSummaryZone[];
}

// --- geometry helpers (pure) ---------------------------------------------------------

type Ring = [number, number][];

function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}

function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(x: number, y: number, rings: Ring[]): boolean {
  return inRing(x, y, rings[0]) && !rings.slice(1).some((hole) => inRing(x, y, hole));
}

/**
 * A point INSIDE the area: the centroid of its largest polygon when that falls inside,
 * else the middle of the widest stretch of that polygon along the centroid's latitude.
 * A crescent's centroid can sit outside it, and a label or a click target there would be
 * in the wrong place.
 */
export function areaAnchor(geometry: SignalGeometry): { lat: number; lon: number } {
  const polygons: Ring[][] =
    geometry.type === "Polygon"
      ? [geometry.coordinates as Ring[]]
      : geometry.type === "MultiPolygon"
        ? (geometry.coordinates as Ring[][])
        : [];
  let best: Ring[] | null = null;
  let bestArea = -1;
  for (const p of polygons) {
    const a = p[0] ? Math.abs(ringArea(p[0])) : 0;
    if (a > bestArea) {
      best = p;
      bestArea = a;
    }
  }
  if (!best || !best[0]?.length) return { lat: 0, lon: 0 };
  const outer = best[0];
  let cx = 0;
  let cy = 0;
  const a = ringArea(outer);
  if (Math.abs(a) > 1e-12) {
    for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
      const f = outer[j][0] * outer[i][1] - outer[i][0] * outer[j][1];
      cx += (outer[j][0] + outer[i][0]) * f;
      cy += (outer[j][1] + outer[i][1]) * f;
    }
    cx /= 6 * a;
    cy /= 6 * a;
  } else {
    for (const [x, y] of outer) {
      cx += x / outer.length;
      cy += y / outer.length;
    }
  }
  if (inPolygon(cx, cy, best)) return { lat: round6(cy), lon: round6(cx) };
  // Scanline at the centroid's latitude: the crossings pair up into inside stretches.
  const xs: number[] = [];
  for (const ring of best) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > cy !== yj > cy) xs.push(((xj - xi) * (cy - yi)) / (yj - yi) + xi);
    }
  }
  xs.sort((p, q) => p - q);
  let mid: number | null = null;
  let widest = -1;
  for (let k = 0; k + 1 < xs.length; k += 2) {
    if (xs[k + 1] - xs[k] > widest) {
      widest = xs[k + 1] - xs[k];
      mid = (xs[k] + xs[k + 1]) / 2;
    }
  }
  return mid == null ? { lat: outer[0][1], lon: outer[0][0] } : { lat: round6(cy), lon: round6(mid) };
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

// --- the summary (pure) --------------------------------------------------------------

function addDays(day: string, n: number): string {
  const t = Date.parse(`${day}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Held now minus held `days` before the newest row; null when that exact day has no row. */
export function heldChange(series: readonly WarZoneSeriesRow[], days: number): number | null {
  const last = series[series.length - 1];
  if (!last) return null;
  const then = series.find((r) => r.day === addDays(last.day, -days));
  return then ? Math.round((last.heldKm2 - then.heldKm2) * 10) / 10 : null;
}

function areaTitle(kind: WarZoneAreaKind, name: string): string {
  const label = WAR_ZONE_KIND_LABEL[kind];
  const own = name.trim();
  return own && !GENERIC_NAMES.has(own.toLowerCase()) ? `${label}: ${own}` : label;
}

/**
 * The relay payload -> one area feature per area, and the layer summary. PURE: no store,
 * no clock. `fetchedAt` is only passed through for the caller.
 */
export function warZonesFrom(data: RelayData<"war-zones">): { features: SignalFeature[]; summary: WarZonesSummary } {
  const features: SignalFeature[] = [];
  const zones: WarZoneSummaryZone[] = [];
  for (const zone of data.zones) {
    const counts: Record<WarZoneAreaKind, number> = { occupied: 0, contested: 0, liberated: 0 };
    zone.areas.forEach((area, index) => {
      counts[area.kind] += 1;
      const geometry = area.geometry as SignalGeometry;
      const anchor = areaAnchor(geometry);
      features.push({
        id: `war-zones:${zone.id}:${zone.mapId}:${index}`,
        signalId: "war-zones",
        lat: anchor.lat,
        lon: anchor.lon,
        title: areaTitle(area.kind, area.name),
        geometry,
        color: WAR_ZONE_COLORS[area.kind],
        ...(area.kind === "contested" ? { fill: "hatch" as const } : {}),
        precision: "area",
        props: {
          status: WAR_ZONE_KIND_LABEL[area.kind],
          deepStateLabel: area.name || "(none)",
          warZone: zone.name,
          mapDrawn: zone.mapAt,
          drawnBy: `${zone.source}, an open-source map from Ukraine. A reading of open sources, not an official line.`,
        },
        // DeepState's own map, centred on this area.
        link: `https://deepstatemap.live/en#9/${anchor.lat}/${anchor.lon}`,
        // No `ts`: an area is the state of the ground on the map's date, not an event. With a
        // ts, a "last 24 hours" filter would wipe the front off the map a day after DeepState's
        // last update. The map's date is in the props and in the widget.
      });
    });
    const series = zone.series.map((r) => ({ day: r.day, heldKm2: r.heldKm2, contestedKm2: r.contestedKm2 }));
    const last = series[series.length - 1];
    zones.push({
      id: zone.id,
      name: zone.name,
      source: zone.source,
      sourceUrl: zone.sourceUrl,
      mapId: zone.mapId,
      mapAt: zone.mapAt,
      heldKm2: last ? last.heldKm2 : null,
      contestedKm2: last ? last.contestedKm2 : null,
      change7: heldChange(series, 7),
      change30: heldChange(series, 30),
      change90: heldChange(series, 90),
      series,
      areas: counts,
      attacks: zone.attacks.length,
    });
  }
  return { features, summary: { zones } };
}

// --- the reader the widget uses -------------------------------------------------------

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isNumOrNull = (v: unknown): v is number | null => v === null || isNum(v);
const isStr = (v: unknown): v is string => typeof v === "string";

/** The summary as /api/signals/war-zones sent it, or null when its shape is not this one. */
export function readWarZonesSummary(value: unknown): WarZonesSummary | null {
  if (!value || typeof value !== "object") return null;
  const zones = (value as { zones?: unknown }).zones;
  if (!Array.isArray(zones)) return null;
  for (const z of zones) {
    if (!z || typeof z !== "object") return null;
    const r = z as Record<string, unknown>;
    if (![r.id, r.name, r.source, r.sourceUrl, r.mapAt].every(isStr) || !isNum(r.mapId)) return null;
    if (![r.heldKm2, r.contestedKm2, r.change7, r.change30, r.change90].every(isNumOrNull) || !isNum(r.attacks)) return null;
    if (!Array.isArray(r.series) || !r.series.every((s) => s && isStr(s.day) && isNum(s.heldKm2) && isNum(s.contestedKm2))) return null;
    const a = r.areas as Record<string, unknown> | undefined;
    if (!a || ![a.occupied, a.contested, a.liberated].every(isNum)) return null;
  }
  return value as WarZonesSummary;
}

// --- the source -------------------------------------------------------------------------

export const WAR_ZONES_SOURCE: SignalSource = {
  id: "war-zones",
  kind: "event",
  label: "War zones",
  group: "Conflict",
  color: "#b23a2b",
  precision: "area",
  refreshMs: 30 * 60_000,
  attribution: "Front line: DeepState (deepstatemap.live)",
  sourceUrl: "https://deepstatemap.live/en",
  async fetch() {
    const now = Date.now();
    const snap = usable("war-zones", readRelay("war-zones"), now);
    if (!snap) return degraded<SignalFeature>("no snapshot from provenance-1 yet");
    const { features, summary } = warZonesFrom(snap.data);
    const newestMap = Math.max(...snap.data.zones.map((z) => Date.parse(z.mapAt)).filter(Number.isFinite));
    return markSummary(observed(features, snap.fetchedAt, Number.isFinite(newestMap) ? newestMap : undefined), summary);
  },
};
