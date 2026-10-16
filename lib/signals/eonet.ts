import type { SignalFeature, SignalMetric, SignalPrecision } from "@/lib/signals/types";
import { degraded, degradedWith, observed } from "@/lib/signals/outcome";

// NASA EONET (Earth Observatory Natural Event Tracker) — open natural events. ONE
// upstream fetch feeds two layers' EONET inputs (severe storms, and the "continuing
// eruptions" background of volcanoes); a shared module-level cache means both ON
// layers do not double the upstream call. Keyless JSON.
//
// WHAT EONET NO LONGER FEEDS (2026-10-16, sources-audit/eonet.md). EONET is a relay,
// and three of its four layers had broken under it:
//   • floods     — new events arrive [lon, lat], old ones [lat, lon], in one feed; prod
//                  pinned "Flood in Nepal" at 84.6 N. Every EONET flood is a GDACS event,
//                  so lib/signals/floods.ts reads GDACS directly.
//   • wildfires  — its GDACS relay stopped on 2025-04-27, leaving a thin US relay, most
//                  of it prescribed burns. lib/signals/wildfires.ts reads NIFC + GDACS.
//   • volcanoes  — curation stopped on 2026-06-15. lib/signals/volcanoes.ts reads
//                  USGS, JMA and GDACS, and keeps EONET's list only as a background.
// Severe storms (JTWC/NHC tropical cyclones) stayed fresh and still come from here.
//
// Event shape (confirmed live 2026-06-27): events[].{id,title,link,categories[],
// sources[],geometry[]} where each geometry is {type:"Point"|"Polygon",
// coordinates, date, magnitudeValue?, magnitudeUnit?}. The geometry array is
// chronological, so the LAST element is the most recent position — we map that to
// a single point per event.

// NO `days` WINDOW HERE, deliberately. `days=N` filters on the newest GEOMETRY
// date, and an open volcanic event is often observed months apart — so
// `status=open&days=30` returned 32 open volcano events upstream and ZERO to us,
// for as long as the layer has existed. The staleness rule belongs per category
// (see maxAgeDays), because "last seen eight weeks ago" means something different
// for a volcano than for a storm.
const ENDPOINT = "https://eonet.gsfc.nasa.gov/api/v3/events?status=open";
const CACHE_TTL_MS = 10 * 60 * 1000;

export const EONET_ATTRIBUTION = "Natural-event data: NASA EONET";

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
  /**
   * How precise the category's places are (see SignalPrecision). A volcano and a
   * storm centre arrive as one reported coordinate; a polygon is reduced to one
   * representative point and marked an area per feature.
   */
  precision: SignalPrecision;
  /** Real per-feature scalar for the monitor bar. Only severe storms carry one
   *  (wind in kts); volcanoes have no numeric scalar → dot only. */
  metric?: SignalMetric;
  /**
   * Drop an open event whose newest observation is older than this, in days.
   * Omit to keep every open event however long ago it was last observed.
   *
   * EONET closes an event when the source says it is over, so "open" already
   * means "not declared finished". The window here is only about whether a
   * long-unobserved event is still worth a pin: a storm last seen two months
   * ago is over, whereas a volcano is still a volcano.
   */
  maxAgeDays?: number;
}

export const CATEGORIES: Record<string, EonetCategoryMeta> = {
  // No window: an open volcanic event is routinely observed months apart.
  volcanoes: { signalId: "volcanoes", category: "volcanoes", label: "Volcanoes", color: "#dc2626", precision: "exact" },
  severeStorms: {
    signalId: "severeStorms",
    category: "severeStorms",
    label: "Severe storms",
    color: "#6366f1",
    precision: "exact",
    // EONET severe-storm geometries carry sustained wind in knots. Tropical-storm
    // floor (~35 kt) → Cat-5 (~140 kt) fills the bar across the real intensity range.
    metric: { field: "windKt", domain: [35, 140], unit: " kts" },
    maxAgeDays: 14, // a storm nobody has observed in a fortnight is over
  },
};

/** Extract a representative [lon, lat] from a Point or (defensively) a Polygon. */
export function representativePoint(geom: EonetGeometry | undefined): [number, number] | null {
  const c = geom?.coordinates;
  if (!Array.isArray(c)) return null;
  // Point
  if (typeof c[0] === "number" && typeof c[1] === "number") return [c[0], c[1]];
  // Polygon: [[[lon, lat], …]] — average the outer ring so an areal event still pins.
  const ring = (c as unknown[])[0];
  if (Array.isArray(ring) && ring.length) {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const pt of ring as unknown[]) {
      if (Array.isArray(pt) && typeof pt[0] === "number" && typeof pt[1] === "number") {
        sx += pt[0] as number;
        sy += pt[1] as number;
        n++;
      }
    }
    if (n) return [sx / n, sy / n];
  }
  return null;
}

/** True when the geometry is a single coordinate pair, false for a polygon ring. */
function isPointGeometry(geom: EonetGeometry | undefined): boolean {
  const c = geom?.coordinates;
  return Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number";
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
    // A polygon was averaged into this point, so the place is an area whatever the
    // category's default says.
    const fromPolygon = !isPointGeometry(last);
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
      ...(fromPolygon && meta.precision !== "area" ? { precision: "area" as const } : {}),
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

// Why the last COMPLETED read failed, or undefined when it succeeded. Recorded here,
// DECLARED by readEonetLayer below: one read feeds several layers, and an outcome
// attached to this shared event array would be lost the moment each layer re-maps it.
let sharedFailure: string | undefined;

/**
 * Short, operator-facing reason for a refresh that threw. Only the status our own
 * refresher puts in the message is passed through (`EONET: 503` → "http 503");
 * anything else — network, timeout, an unreadable body — is reported generically, so
 * no upstream text can reach the API envelope.
 */
function failureReason(err: unknown): string {
  const m = err instanceof Error ? /^EONET(?: \S+)?: (\d{3})$/.exec(err.message) : null;
  return m ? `http ${m[1]}` : "fetch failed";
}

/**
 * 30 s, not 15 s. The shared open feed measured 4.9 MB on 2026-08-13 and its
 * fetch time is genuinely variable: 7.7 s on one call and 18.3 s on another,
 * minutes apart. Against a 15 s timeout that is a coin flip, and losing it takes
 * every EONET input to zero at once. The route allows 60 s (app/api/signals/[id]
 * sets maxDuration = 60), and the result is cached for CACHE_TTL_MS.
 */
const FETCH_TIMEOUT_MS = 30_000;

async function refresh(): Promise<EonetEvent[]> {
  const res = await fetch(ENDPOINT, {
    headers: { "User-Agent": "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`EONET: ${res.status}`);
  const json = (await res.json()) as { events?: EonetEvent[] };
  cache = { events: json.events ?? [], at: Date.now() };
  sharedFailure = undefined;
  return cache.events;
}

/** Fresh-or-stale-while-revalidate, shared by every EONET input. Never throws. */
export async function fetchEonet(): Promise<EonetEvent[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.events;
  if (!inflight) {
    inflight = refresh()
      .catch((err) => {
        sharedFailure = failureReason(err);
        return cache?.events ?? [];
      })
      .finally(() => {
        inflight = null;
      });
  }
  return cache ? cache.events : inflight;
}

/**
 * One category's features from the shared read, outcome-tagged. When the feed refuses
 * we keep the rows we still hold and stamp the age of THAT read — `degraded()` would
 * empty every EONET input over one blip, and `observed()` would claim a read that did
 * not happen.
 */
export async function readEonetLayer(meta: EonetCategoryMeta): Promise<SignalFeature[]> {
  const events = await fetchEonet();
  const features = eonetToFeatures(events, meta);
  const at = cache?.at ?? null;
  const failure = sharedFailure;
  if (failure) return at != null ? degradedWith(features, failure, at) : degraded(failure);
  return observed(features, at ?? Date.now());
}
