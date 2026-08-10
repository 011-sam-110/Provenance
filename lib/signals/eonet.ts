import type { SignalFeature, SignalMetric, SignalSource } from "@/lib/signals/types";

// NASA EONET (Earth Observatory Natural Event Tracker) — open natural events of
// the last 30 days. ONE upstream fetch feeds FOUR registry layers (wildfires /
// volcanoes / severe storms / floods); a shared module-level cache means four ON
// layers do not quadruple the upstream call. Keyless JSON.
//
// Event shape (confirmed live 2026-06-27): events[].{id,title,link,categories[],
// sources[],geometry[]} where each geometry is {type:"Point"|"Polygon",
// coordinates, date, magnitudeValue?, magnitudeUnit?}. The geometry array is
// chronological, so the LAST element is the most recent position — we map that to
// a single point per event. Category ids: wildfires, volcanoes, severeStorms,
// floods (verified against /api/v3/categories).

// NO `days` WINDOW HERE, deliberately. `days=N` filters on the newest GEOMETRY
// date, and an open volcanic event is often observed months apart — so
// `status=open&days=30` returned 32 open volcano events upstream and ZERO to us,
// for as long as the layer has existed. The staleness rule belongs per category
// (see maxAgeDays), because "last seen eight weeks ago" means something different
// for a volcano than for a wildfire.
const ENDPOINT = "https://eonet.gsfc.nasa.gov/api/v3/events?status=open";
const CACHE_TTL_MS = 10 * 60 * 1000;

export const EONET_ATTRIBUTION = "Natural-event data © NASA EONET";

export interface EonetGeometry {
  type?: string;
  coordinates?: unknown;
  date?: string;
  magnitudeValue?: number | null;
  magnitudeUnit?: string | null;
}
export interface EonetEvent {
  id?: string;
  title?: string;
  link?: string;
  categories?: { id?: string; title?: string }[];
  sources?: { id?: string; url?: string }[];
  geometry?: EonetGeometry[];
}

export interface EonetCategoryMeta {
  signalId: string;
  category: string; // EONET category id to filter on
  label: string;
  color: string;
  /** Real per-feature scalar for the monitor bar. Only severe storms carry one
   *  (wind in kts); wildfires/volcanoes/floods have no numeric scalar → dot only. */
  metric?: SignalMetric;
  /**
   * Drop an open event whose newest observation is older than this, in days.
   * Omit to keep every open event however long ago it was last observed.
   *
   * EONET closes an event when the source says it is over, so "open" already
   * means "not declared finished". The window here is only about whether a
   * long-unobserved event is still worth a pin: a wildfire last seen two months
   * ago is almost certainly out, whereas a volcano is still a volcano.
   */
  maxAgeDays?: number;
}

export const CATEGORIES: Record<string, EonetCategoryMeta> = {
  wildfires: { signalId: "wildfires", category: "wildfires", label: "Wildfires", color: "#f97316", maxAgeDays: 30 },
  // No window: an open volcanic event is routinely observed months apart.
  volcanoes: { signalId: "volcanoes", category: "volcanoes", label: "Volcanoes", color: "#dc2626" },
  severeStorms: {
    signalId: "severeStorms",
    category: "severeStorms",
    label: "Severe storms",
    color: "#6366f1",
    // EONET severe-storm geometries carry sustained wind in knots. Tropical-storm
    // floor (~35 kt) → Cat-5 (~140 kt) fills the bar across the real intensity range.
    metric: { field: "windKt", domain: [35, 140], unit: " kts" },
    maxAgeDays: 14, // a storm nobody has observed in a fortnight is over
  },
  floods: { signalId: "floods", category: "floods", label: "Floods", color: "#0ea5e9", maxAgeDays: 60 },
};

/** Extract a representative [lon, lat] from a Point or (defensively) a Polygon. */
export function representativePoint(geom: EonetGeometry | undefined): [number, number] | null {
  const c = geom?.coordinates;
  if (!Array.isArray(c)) return null;
  // Point: [lon, lat]
  if (typeof c[0] === "number" && typeof c[1] === "number") {
    return [c[0], c[1]];
  }
  // Polygon: [[[lon,lat], …]] — average the outer ring so an areal event still pins.
  const ring = (c as unknown[])[0];
  if (Array.isArray(ring) && ring.length) {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const pt of ring as unknown[]) {
      if (Array.isArray(pt) && typeof pt[0] === "number" && typeof pt[1] === "number") {
        sx += pt[0];
        sy += pt[1];
        n++;
      }
    }
    if (n) return [sx / n, sy / n];
  }
  return null;
}

/**
 * Pure: EONET events → SignalFeature[] for ONE category. Takes the latest
 * geometry of each matching event, skips events with no usable point.
 */
export function eonetToFeatures(
  events: EonetEvent[],
  meta: EonetCategoryMeta,
  now: number = Date.now(),
): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const e of events ?? []) {
    if (!(e.categories ?? []).some((c) => c.id === meta.category)) continue;
    const geoms = e.geometry ?? [];
    const last = geoms[geoms.length - 1];
    // Per-category staleness, applied here rather than in the upstream query — see
    // ENDPOINT. An unparsable date is KEPT: dropping an event because we could not
    // read its timestamp would hide it for a reason that has nothing to do with it.
    if (meta.maxAgeDays != null && last?.date) {
      const t = Date.parse(last.date);
      if (Number.isFinite(t) && now - t > meta.maxAgeDays * 86_400_000) continue;
    }
    const pt = representativePoint(last);
    if (!pt) continue;
    const [lon, lat] = pt;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    const id = (e.id ?? "").toString().trim();
    if (!id) continue;
    const source = e.sources?.[0]?.id;
    // NB: magnitude here (e.g. storm wind in kts) is NOT the radius driver — it is
    // on a different scale, so it goes under `intensity`, not `magnitude`.
    const intensity =
      last?.magnitudeValue != null
        ? `${last.magnitudeValue}${last.magnitudeUnit ? ` ${last.magnitudeUnit}` : ""}`
        : undefined;
    // Sibling NUMERIC scalar for the monitor MetricBar (severe storms declare a
    // metric on `windKt`). Only when the unit is genuinely knots — never invented.
    const windKt =
      typeof last?.magnitudeValue === "number" &&
      Number.isFinite(last.magnitudeValue) &&
      typeof last?.magnitudeUnit === "string" &&
      /kt/i.test(last.magnitudeUnit)
        ? last.magnitudeValue
        : undefined;
    out.push({
      id: `eonet:${id}`,
      lat,
      lon,
      title: e.title?.trim() || meta.label,
      signalId: meta.signalId,
      color: meta.color,
      link: e.link ?? e.sources?.[0]?.url,
      ts: last?.date,
      props: {
        category: meta.label,
        observed: last?.date ?? "—",
        ...(intensity ? { intensity } : {}),
        ...(windKt != null ? { windKt } : {}),
        ...(source ? { source } : {}),
      },
    });
  }
  return out;
}

// --- Shared cached upstream fetch ------------------------------------------
let cache: { events: EonetEvent[]; at: number } | null = null;
let inflight: Promise<EonetEvent[]> | null = null;

async function refresh(): Promise<EonetEvent[]> {
  const res = await fetch(ENDPOINT, {
    headers: { "User-Agent": "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`EONET: ${res.status}`);
  const json = (await res.json()) as { events?: EonetEvent[] };
  cache = { events: json.events ?? [], at: Date.now() };
  return cache.events;
}

/** Fresh-or-stale-while-revalidate, shared by all four EONET layers. Never throws. */
export async function fetchEonet(): Promise<EonetEvent[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.events;
  if (!inflight) {
    inflight = refresh()
      .catch(() => cache?.events ?? [])
      .finally(() => {
        inflight = null;
      });
  }
  return cache ? cache.events : inflight;
}

function makeSource(meta: EonetCategoryMeta): SignalSource {
  return {
    id: meta.signalId,
    label: meta.label,
    group: "Natural hazards",
    color: meta.color,
    refreshMs: 10 * 60 * 1000, // EONET events move slowly; matches the shared cache
    attribution: EONET_ATTRIBUTION,
    ...(meta.metric ? { metric: meta.metric } : {}),
    async fetch() {
      const events = await fetchEonet();
      return eonetToFeatures(events, meta);
    },
  };
}

export const WILDFIRES_SOURCE = makeSource(CATEGORIES.wildfires);
export const VOLCANOES_SOURCE = makeSource(CATEGORIES.volcanoes);
export const SEVERE_STORMS_SOURCE = makeSource(CATEGORIES.severeStorms);
export const FLOODS_SOURCE = makeSource(CATEGORIES.floods);
