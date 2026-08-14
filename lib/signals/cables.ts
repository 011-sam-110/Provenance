import type { SignalFeature, SignalGeometry, SignalSource } from "@/lib/signals/types";
import { classifyLandingRegion } from "@/lib/signals/cable-regions";
import { degraded, degradedWith, observed } from "@/lib/signals/outcome";

// ── Submarine cables — an ASSET layer, not an event feed ────────────────────
//
// Source: TeleGeography's open Submarine Cable Map API v3 (keyless JSON CDN).
// Three keyless endpoints, confirmed live 2026-07-09:
//   • cable/cable-geo.json          — route geometry (Multi/LineString per segment)
//   • cable/all.json                — the id→name index (authoritative cable set)
//   • cable/<id>.json               — per-cable metadata: length, owners, suppliers,
//                                     rfs / rfs_year, is_planned, landing_points[]
//   • landing-point/landing-point-geo.json — landing-station point coordinates
//
// A cable is permanent infrastructure: it has NO magnitude, NO severity and NO
// "when". So we emit rich asset attributes (RFS year, owners, length, landing
// points, status, derived landing region) instead of event fields, and mark the
// source `kind: "asset"` so the focus view renders an asset schema.
//
// Dormant-safe by construction: geometry is the one required call and always
// yields renderable cables; per-cable metadata enrichment is best-effort and
// merges whatever completes within a time budget — cables missing metadata still
// render (name + route), attributes shown as "—". Capacity / fibre-pair counts
// are NOT published by this source, so they are honestly left blank, never faked.

const GEO_ENDPOINT = "https://www.submarinecablemap.com/api/v3/cable/cable-geo.json";
const ALL_ENDPOINT = "https://www.submarinecablemap.com/api/v3/cable/all.json";
const LANDING_GEO_ENDPOINT = "https://www.submarinecablemap.com/api/v3/landing-point/landing-point-geo.json";
const cableDetailEndpoint = (id: string) => `https://www.submarinecablemap.com/api/v3/cable/${encodeURIComponent(id)}.json`;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // geometry/metadata change on the scale of months
const REFRESH_MS = 6 * 60 * 60 * 1000; // client re-poll + route cache: infra is stable
const ENRICH_CONCURRENCY = 40; // ~700 tiny JSONs finish in ~11s at this width
const ENRICH_BUDGET_MS = 45_000; // hard soft-deadline; partial merge past it (dormant-safe)
const FETCH_TIMEOUT_MS = 15_000;

export const CABLES_ATTRIBUTION = "Submarine cable data © TeleGeography (submarinecablemap.com)";

// Calm LIGHT identity: one teal for cable routes, a slightly deeper node for landings.
export const CABLES_COLOR = "#0d9488";
export const LANDING_COLOR = "#0f766e";

const UA = { "User-Agent": "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)" } as const;

// ── Raw upstream shapes ─────────────────────────────────────────────────────

interface GeoFeature {
  type?: string;
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: {
    id?: string;
    name?: string;
    feature_id?: string;
    coordinates?: [number, number]; // precomputed representative point [lon, lat]
  } | null;
}

interface LandingGeoFeature {
  geometry?: { type?: string; coordinates?: [number, number] } | null;
  properties?: { id?: string; name?: string; is_tbd?: boolean | null } | null;
}

/** Per-cable detail JSON (cable/<id>.json). Every field is optional / may be null. */
export interface RawCableDetail {
  id?: string;
  name?: string;
  length?: string | null; // e.g. "6,605 km"
  owners?: string | null; // comma-separated consortium
  suppliers?: string | null; // e.g. "SubCom"
  rfs?: string | null; // e.g. "2018 May"
  rfs_year?: number | null;
  is_planned?: boolean | null;
  url?: string | null;
  notes?: string | null;
  landing_points?: { id?: string; name?: string; country?: string | null; is_tbd?: boolean | null }[] | null;
}

// ── Pure helpers (unit-tested) ──────────────────────────────────────────────

/**
 * Repair the double-encoded UTF-8 mojibake in the upstream feed (e.g. the bytes
 * of "Côte d'Ivoire" arrive as "CÃ´te d'Ivoire"). Classic latin1→utf8 re-decode,
 * applied only to strings that carry the tell-tale marker so clean text is
 * untouched. Pure + environment-agnostic (no Buffer).
 */
export function repairEncoding(s: string): string {
  if (!/[ÃÂ]/.test(s)) return s;
  try {
    // escape() → percent-encode each code unit as a latin1 byte, decodeURIComponent
    // → re-read those bytes as UTF-8. Reverses the mis-decode without any table.
    return decodeURIComponent(escape(s));
  } catch {
    return s;
  }
}

/** "6,605 km" / "6605" / "~7,191 km" → 6605 (integer km), or null when absent. */
export function parseLengthKm(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const digits = raw.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!digits) return null;
  const n = Math.round(Number(digits[0]));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Grouped base cable: all segments merged into one MultiLineString + an anchor. */
export interface CableBase {
  id: string;
  name: string;
  /** MultiLineString of every segment for this cable id. */
  geometry: SignalGeometry;
  /** Representative anchor [lon, lat] for the click / label / dossier. */
  anchor: [number, number];
}

/**
 * Pure: cable-geo FeatureCollection → base cables keyed by CABLE id (not segment).
 * The upstream ships one feature per route SEGMENT (≈714 for ≈695 cables); an
 * asset table wants ONE row per cable, so segments sharing an `id` are merged
 * into a single MultiLineString. Non-line geometry is skipped.
 */
export function mergeCableSegments(geojson: { features?: GeoFeature[] }): Map<string, CableBase> {
  const acc = new Map<string, { name: string; lines: number[][][]; anchor: [number, number] | null }>();
  for (const f of geojson.features ?? []) {
    const gType = f.geometry?.type;
    if (gType !== "LineString" && gType !== "MultiLineString") continue;
    const coords = f.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length === 0) continue;
    const p = f.properties ?? {};
    const id = (p.id ?? p.feature_id ?? "").toString().trim();
    if (!id) continue;

    // Normalise this segment's geometry to an array of line-strings.
    const segLines: number[][][] =
      gType === "MultiLineString" ? (coords as number[][][]) : [coords as number[][]];

    let entry = acc.get(id);
    if (!entry) {
      entry = { name: repairEncoding(p.name?.trim() || "Submarine cable"), lines: [], anchor: null };
      acc.set(id, entry);
    }
    for (const line of segLines) {
      if (Array.isArray(line) && line.length >= 2) entry.lines.push(line);
    }
    // Anchor at the FIRST segment's precomputed representative point when present.
    if (!entry.anchor) {
      const rep = p.coordinates;
      if (Array.isArray(rep) && Number.isFinite(rep[0]) && Number.isFinite(rep[1])) {
        entry.anchor = [rep[0], rep[1]];
      }
    }
  }

  const out = new Map<string, CableBase>();
  for (const [id, e] of acc) {
    if (e.lines.length === 0) continue;
    // Anchor fallback: midpoint vertex of the longest segment.
    let anchor = e.anchor;
    if (!anchor) {
      const longest = e.lines.reduce((a, b) => (b.length > a.length ? b : a), e.lines[0]);
      const mid = longest[Math.floor(longest.length / 2)];
      if (Array.isArray(mid) && Number.isFinite(mid[0]) && Number.isFinite(mid[1])) {
        anchor = [mid[0], mid[1]];
      }
    }
    if (!anchor) continue;
    out.set(id, {
      id,
      name: e.name,
      geometry: { type: "MultiLineString", coordinates: e.lines as [number, number][][] },
      anchor,
    });
  }
  return out;
}

/** Normalised per-cable metadata (mojibake-repaired, typed). */
export interface CableMeta {
  id: string;
  name: string;
  lengthKm: number | null;
  lengthLabel: string; // "6,605 km" or "—"
  owners: string; // "Meta, Microsoft, Telxius" or "—"
  suppliers: string; // "SubCom" or "—"
  rfs: string; // "2018 May" or "—"
  rfsYear: number | null;
  status: "Operational" | "Planned";
  landingNames: string[]; // repaired display names, e.g. "Bilbao, Spain"
  landingCountries: string[]; // repaired, de-duped, in landing order
  landingIds: string[]; // slugs, for the landing→cable index
  region: string; // derived corridor, e.g. "Transatlantic"
  url: string | null;
}

/**
 * Pure: raw cable/<id>.json → normalised CableMeta. Status is derived HONESTLY
 * from the only signal the source publishes — `is_planned` / a future `rfs_year`
 * → "Planned", else "Operational". (Upgrading / Retired are not published, so we
 * never invent them.) Region is derived from the set of landing countries.
 */
export function parseCableDetail(raw: RawCableDetail): CableMeta {
  const id = (raw.id ?? "").toString().trim();
  const name = repairEncoding((raw.name ?? "").toString().trim()) || "Submarine cable";
  const lengthKm = parseLengthKm(raw.length);
  const owners = raw.owners ? repairEncoding(raw.owners.trim()) : "";
  const suppliers = raw.suppliers ? repairEncoding(raw.suppliers.trim()) : "";
  const rfs = raw.rfs ? raw.rfs.trim() : "";
  const rfsYear = typeof raw.rfs_year === "number" && Number.isFinite(raw.rfs_year) ? raw.rfs_year : null;

  const nowYear = new Date().getUTCFullYear();
  const planned = raw.is_planned === true || (rfsYear != null && rfsYear > nowYear);
  const status: CableMeta["status"] = planned ? "Planned" : "Operational";

  const landingNames: string[] = [];
  const landingIds: string[] = [];
  const countrySet = new Set<string>();
  const countries: string[] = [];
  for (const lp of raw.landing_points ?? []) {
    if (!lp) continue;
    const lid = (lp.id ?? "").toString().trim();
    if (lid) landingIds.push(lid);
    if (lp.name) landingNames.push(repairEncoding(lp.name.trim()));
    if (lp.country) {
      const c = repairEncoding(lp.country.trim());
      if (c && !countrySet.has(c)) {
        countrySet.add(c);
        countries.push(c);
      }
    }
  }

  return {
    id,
    name,
    lengthKm,
    lengthLabel: raw.length ? raw.length.trim() : "—",
    owners: owners || "—",
    suppliers: suppliers || "—",
    rfs: rfs || "—",
    rfsYear,
    status,
    landingNames,
    landingCountries: countries,
    landingIds,
    region: classifyLandingRegion(countries),
    url: raw.url ? raw.url.trim() : null,
  };
}

/**
 * Pure: a base cable (+ optional metadata) → an asset SignalFeature carrying the
 * merged route geometry and a display-friendly asset prop set. When metadata is
 * missing (enrichment incomplete / upstream gap) the cable still renders with a
 * name + route and honest "—" attributes.
 */
export function buildCableFeature(base: CableBase, meta: CableMeta | undefined): SignalFeature {
  const props: Record<string, unknown> = { assetKind: "cable" };
  if (meta) {
    props.status = meta.status;
    if (meta.rfsYear != null) props.rfsYear = meta.rfsYear;
    props.rfs = meta.rfs;
    props.length = meta.lengthLabel;
    if (meta.lengthKm != null) props.lengthKm = meta.lengthKm;
    props.capacity = "—"; // not published by this source — never fabricated
    props.owners = meta.owners;
    props.suppliers = meta.suppliers;
    props.region = meta.region;
    props.landingPoints = meta.landingNames.length;
    props.landings = meta.landingNames.length ? meta.landingNames.join(" · ") : "—";
    props.countries = meta.landingCountries.length ? meta.landingCountries.join(", ") : "—";
  } else {
    props.status = "—";
    props.length = "—";
    props.capacity = "—";
    props.owners = "—";
    props.region = "—";
  }
  return {
    id: `cable:${base.id}`,
    lat: base.anchor[1],
    lon: base.anchor[0],
    title: meta?.name || base.name,
    signalId: "cables",
    color: CABLES_COLOR,
    geometry: base.geometry,
    link: meta?.url || `https://www.submarinecablemap.com/submarine-cable/${base.id}`,
    props,
  };
}

/** Pure: landing-point-geo.json → id → {name, lon, lat} lookup (repaired names). */
export function indexLandingGeo(
  geojson: { features?: LandingGeoFeature[] },
): Map<string, { name: string; lon: number; lat: number }> {
  const out = new Map<string, { name: string; lon: number; lat: number }>();
  for (const f of geojson.features ?? []) {
    const id = (f.properties?.id ?? "").toString().trim();
    const c = f.geometry?.coordinates;
    if (!id || !Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    out.set(id, { name: repairEncoding((f.properties?.name ?? id).toString()), lon: c[0], lat: c[1] });
  }
  return out;
}

/**
 * Pure: landing coordinates + a landing→cables index → landing-node SignalFeatures
 * (points). Each node lists the cables that intersect it, so a click reveals the
 * cables landing there. Only landings referenced by ≥1 cable are emitted.
 */
export function buildLandingFeatures(
  landingGeo: Map<string, { name: string; lon: number; lat: number }>,
  landingToCables: Map<string, string[]>, // landingId → cable display names
): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const [lid, cables] of landingToCables) {
    if (!cables.length) continue;
    const geo = landingGeo.get(lid);
    if (!geo) continue;
    const sorted = [...cables].sort((a, b) => a.localeCompare(b));
    out.push({
      id: `landing:${lid}`,
      lat: geo.lat,
      lon: geo.lon,
      title: geo.name,
      signalId: "cable-landings",
      color: LANDING_COLOR,
      link: `https://www.submarinecablemap.com/landing-point/${lid}`,
      props: {
        assetKind: "landing",
        cableCount: sorted.length,
        cables: sorted.join(" · "),
      },
    });
  }
  return out;
}

// ── Orchestration (network; dormant-safe) ───────────────────────────────────

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Bounded-concurrency map with a wall-clock budget; unfinished items resolve to null. */
async function mapPool<T, R>(
  items: T[],
  worker: (item: T) => Promise<R | null>,
  concurrency: number,
  deadline: number,
): Promise<(R | null)[]> {
  const out: (R | null)[] = new Array(items.length).fill(null);
  let next = 0;
  async function run() {
    while (next < items.length && Date.now() < deadline) {
      const i = next++;
      out[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return out;
}

export interface CableDataset {
  cables: SignalFeature[];
  landings: SignalFeature[];
}

// Persistent module state so metadata enrichment CONVERGES across passes even when
// a single request only has a small time budget: geometry + landing coords are
// cached whole; per-cable metadata accumulates into `metaById` (only the still-
// missing cables are re-fetched each pass). Complete datasets are memoised for the
// full TTL; incomplete ones expire fast so the next request keeps enriching.
const INCOMPLETE_TTL_MS = 5 * 60 * 1000;
interface State {
  bases: Map<string, CableBase>;
  landingGeo: Map<string, { name: string; lon: number; lat: number }>;
  ids: string[];
  metaById: Map<string, CableMeta>;
  geoAt: number; // when geometry/landing/id list were last loaded
}
let state: State | null = null;
let built: { data: CableDataset; at: number; complete: boolean } | null = null;
let inflight: Promise<CableDataset> | null = null;

// How the last COMPLETED load ended. Recorded where each failure is DETECTED and
// declared by the two registered fetches below, never in here: one dataset feeds two
// sources, and each of them has to be able to say it for itself.
/** Set when the required geometry call refused; cleared by a load that succeeds. */
let loadFailure: string | undefined;
/** Landings only: their coordinates refused, so that layer builds nothing. */
let landingFailure: string | undefined;

/** Build the two feature lists from the current bases + accumulated metadata. */
function assemble(s: State): CableDataset {
  const landingToCables = new Map<string, string[]>();
  for (const meta of s.metaById.values()) {
    for (const lid of meta.landingIds) {
      const arr = landingToCables.get(lid) ?? [];
      arr.push(meta.name);
      landingToCables.set(lid, arr);
    }
  }
  const cables: SignalFeature[] = [];
  for (const [id, base] of s.bases) cables.push(buildCableFeature(base, s.metaById.get(id)));
  return { cables, landings: buildLandingFeatures(s.landingGeo, landingToCables) };
}

async function loadDataset(): Promise<CableDataset> {
  // (Re)load geometry + landing coords + id list when stale. These are the cheap,
  // required calls; run them in parallel. Geometry is the ONLY hard requirement.
  if (!state || Date.now() - state.geoAt > CACHE_TTL_MS) {
    const [geo, landingGeoRaw, all] = await Promise.all([
      fetchJson<{ features?: GeoFeature[] }>(GEO_ENDPOINT),
      fetchJson<{ features?: LandingGeoFeature[] }>(LANDING_GEO_ENDPOINT),
      fetchJson<{ id?: string; name?: string }[]>(ALL_ENDPOINT),
    ]);
    if (!geo) {
      loadFailure = "geometry fetch failed";
      return built?.data ?? { cables: [], landings: [] }; // dormant-safe
    }
    const bases = mergeCableSegments(geo);
    const ids = all?.length
      ? all.map((c) => (c.id ?? "").toString().trim()).filter(Boolean)
      : [...bases.keys()];
    state = {
      bases,
      landingGeo: landingGeoRaw ? indexLandingGeo(landingGeoRaw) : new Map(),
      ids,
      metaById: state?.metaById ?? new Map(), // keep any metadata we already have
      geoAt: Date.now(),
    };
    // Landing coordinates are optional for cables but REQUIRED for landing nodes:
    // without them that layer builds nothing, which would read as a quiet layer
    // rather than a refused call.
    landingFailure = landingGeoRaw ? undefined : "landing coords fetch failed";
  }
  const s = state;

  // Enrich only the cables we DON'T yet have metadata for, bounded + budgeted.
  const missing = s.ids.filter((id) => !s.metaById.has(id));
  if (missing.length) {
    const deadline = Date.now() + ENRICH_BUDGET_MS;
    const details = await mapPool(missing, (id) => fetchJson<RawCableDetail>(cableDetailEndpoint(id)), ENRICH_CONCURRENCY, deadline);
    for (const raw of details) {
      if (!raw?.id) continue;
      const meta = parseCableDetail(raw);
      s.metaById.set(meta.id, meta);
    }
  }

  const data = assemble(s);
  const complete = s.ids.every((id) => s.metaById.has(id)) || s.metaById.size >= s.bases.size;
  built = { data, at: Date.now(), complete };
  loadFailure = undefined; // geometry answered; partial enrichment is not a failure
  return data;
}

/** Memoised dataset shared by both cable sources — one network cost per TTL. */
export function getCableDataset(): Promise<CableDataset> {
  const ttl = built?.complete ? CACHE_TTL_MS : INCOMPLETE_TTL_MS;
  if (built && Date.now() - built.at < ttl) return Promise.resolve(built.data);
  if (inflight) return inflight;
  inflight = loadDataset()
    .catch(() => {
      loadFailure = "fetch failed";
      return built?.data ?? { cables: [], landings: [] };
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Test-only: reset the module memo so unit tests are order-independent. */
export function __resetCableCache(): void {
  state = null;
  built = null;
  inflight = null;
  loadFailure = undefined;
  landingFailure = undefined;
}

/**
 * Test/back-compat shim: pure cable-geo → renderable base features (no metadata).
 * Mirrors the old normaliser's contract but now merges by cable id, so the same
 * geometry pipeline is exercised without any network.
 */
export function normalizeCables(geojson: { features?: GeoFeature[] }): SignalFeature[] {
  return [...mergeCableSegments(geojson).values()].map((b) => buildCableFeature(b, undefined));
}

/**
 * Declare the outcome of the load that produced these rows. Both sources go through
 * here so they say the same thing about the one shared read: on a refusal the
 * last-good rows are KEPT and stamped with when they were really read — `degraded()`
 * would empty a layer that still has perfectly serviceable infrastructure in it, and
 * `observed()` would claim a read that did not happen.
 */
function declareOutcome(rows: SignalFeature[], layerFailure?: string): SignalFeature[] {
  const failure = loadFailure ?? layerFailure;
  if (failure) return built ? degradedWith(rows, failure, built.at) : degraded(failure);
  return observed(rows, built?.at ?? Date.now());
}

export const CABLES_SOURCE: SignalSource = {
  id: "cables",
  kind: "asset",
  label: "Submarine cables",
  group: "Infrastructure",
  color: CABLES_COLOR,
  refreshMs: REFRESH_MS,
  attribution: CABLES_ATTRIBUTION,
  async fetch() {
    const { cables } = await getCableDataset();
    return declareOutcome(cables);
  },
};

export const CABLE_LANDINGS_SOURCE: SignalSource = {
  id: "cable-landings",
  kind: "asset",
  label: "Cable landing stations",
  group: "Infrastructure",
  color: LANDING_COLOR,
  refreshMs: REFRESH_MS,
  attribution: CABLES_ATTRIBUTION,
  async fetch() {
    const { landings } = await getCableDataset();
    return declareOutcome(landings, landingFailure);
  },
};
