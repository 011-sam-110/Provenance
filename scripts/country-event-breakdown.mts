// Measure, per country, exactly which signal layers have events there RIGHT NOW.
//
// Runs every registered SignalSource.fetch() against the live upstreams, resolves
// each returned feature to a country, and writes a per-country x per-layer matrix.
//
// Country resolution, in priority order (each feature records which rule fired):
//   1. explicit ISO in props (iso2/iso3/countryCode) — the country-AGGREGATED layers
//      already know their country and must not be re-derived from a centroid.
//   2. props.country / props.countryName matched against Natural Earth + our centroids.
//   3. point-in-polygon against public/geo/countries-110m.geojson (177 polygons).
//   4. unassigned — at sea, in orbit, or a country too small for the 110m file.
//
// Honesty notes carried into the output:
//   • the 110m file has 177 polygons, so micro-states (Singapore, Malta, Monaco,
//     most island nations) have NO polygon and can only be reached by rules 1-2.
//   • every layer SignalCoverage record is carried through, so a capped layer
//     reports "N of M" rather than letting a render cap read as a measurement.
//
// usage:
//   node --env-file=.env.local --import ./scripts/ts-alias-hook.mjs \
//     scripts/country-event-breakdown.mts [--out=path.json] [--only=id,id]

import { readFileSync, writeFileSync } from "node:fs";
import { SIGNALS } from "@/lib/signals/registry";
import { readCoverage } from "@/lib/signals/coverage";
import { COUNTRY_CENTROIDS } from "@/lib/signals/country-centroids.data";
import type { SignalFeature } from "@/lib/signals/types";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  }),
) as Record<string, string>;

const OUT = args.out || "scratchpad/country-events.json";
const ONLY = args.only ? new Set(args.only.split(",")) : null;
const TIMEOUT_MS = Number(args.timeout || 90_000);
// --base=URL reads /api/signals/<id> from a deployment instead of calling the
// adapter in-process. PREFER THIS. Three layers cannot be measured from a laptop:
// GDACS needs six upstream calls inside a 15 s per-call budget (this machine takes
// 3-25 s each, so it returns a PARTIAL round), and AIS opens a WebSocket. What the
// front page shows is what the deployment fetches, not what this machine can reach.
const BASE = (args.base || "").replace(/\/$/, "");

// ── country polygons ───────────────────────────────────────────────────────────
interface NEProps {
  NAME?: string;
  ISO_A2?: string;
  ISO_A3?: string;
  CONTINENT?: string;
  SUBREGION?: string;
  REGION_UN?: string;
}
interface Poly {
  name: string;
  iso2: string;
  iso3: string;
  continent: string;
  subregion: string;
  rings: [number, number][][][];
  bbox: [number, number, number, number];
}

const geo = JSON.parse(readFileSync("public/geo/countries-110m.geojson", "utf8")) as {
  features: { properties: NEProps; geometry: { type: string; coordinates: unknown } }[];
};

const polys: Poly[] = geo.features.map((f) => {
  const p = f.properties;
  const rings: [number, number][][][] =
    f.geometry.type === "Polygon"
      ? [f.geometry.coordinates as [number, number][][]]
      : (f.geometry.coordinates as [number, number][][][]);
  let minx = 180;
  let miny = 90;
  let maxx = -180;
  let maxy = -90;
  for (const poly of rings)
    for (const ring of poly)
      for (const [x, y] of ring) {
        if (x < minx) minx = x;
        if (x > maxx) maxx = x;
        if (y < miny) miny = y;
        if (y > maxy) maxy = y;
      }
  const iso2 = p.ISO_A2 && p.ISO_A2 !== "-99" ? p.ISO_A2 : "";
  return {
    name: p.NAME || "Unknown",
    iso2,
    iso3: p.ISO_A3 && p.ISO_A3 !== "-99" ? p.ISO_A3 : "",
    continent: p.CONTINENT || "",
    subregion: p.SUBREGION || p.REGION_UN || "",
    rings,
    bbox: [minx, miny, maxx, maxy],
  };
});

function inRing(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function polyHit(lon: number, lat: number, p: Poly): boolean {
  const [minx, miny, maxx, maxy] = p.bbox;
  if (lon < minx || lon > maxx || lat < miny || lat > maxy) return false;
  for (const poly of p.rings) {
    if (!inRing(lon, lat, poly[0])) continue;
    let hole = false;
    for (let h = 1; h < poly.length; h++)
      if (inRing(lon, lat, poly[h])) {
        hole = true;
        break;
      }
    if (!hole) return true;
  }
  return false;
}

function locate(lon: number, lat: number): Poly | undefined {
  for (const p of polys) if (polyHit(lon, lat, p)) return p;
  return undefined;
}

// ── coastal snap ───────────────────────────────────────────────────────────────
// Natural Earth 110m is a COARSE outline: Vancouver Island, the island of Hawaii,
// most of the Caribbean and every fjord and bay are simply absent. Without a snap,
// Victoria International Airport, the Pahala quake swarm and the Calvert Cliffs
// reactor all read as "at sea". So a point that misses every polygon is credited to
// the nearest one within SNAP_KM, and the rule that fired is recorded per feature —
// a snapped count is never silently mixed with a containment count.
const SNAP_KM = Number(args.snapKm || 25);
const KM_PER_DEG = 111.195;

/** Great-circle-ish distance, km, from a point to a segment (equirectangular). */
function segDistKm(lon: number, lat: number, ax: number, ay: number, bx: number, by: number): number {
  const k = Math.cos((lat * Math.PI) / 180);
  const px = (lon - ax) * k;
  const py = lat - ay;
  const vx = (bx - ax) * k;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, (px * vx + py * vy) / len2)) : 0;
  const dx = px - t * vx;
  const dy = py - t * vy;
  return Math.hypot(dx, dy) * KM_PER_DEG;
}

function nearestPoly(lon: number, lat: number, maxKm: number): { poly: Poly; km: number } | undefined {
  const padLat = maxKm / KM_PER_DEG;
  const padLon = padLat / Math.max(0.15, Math.cos((lat * Math.PI) / 180));
  let best: { poly: Poly; km: number } | undefined;
  for (const p of polys) {
    const [minx, miny, maxx, maxy] = p.bbox;
    if (lon < minx - padLon || lon > maxx + padLon || lat < miny - padLat || lat > maxy + padLat) continue;
    for (const poly of p.rings)
      for (const ring of poly)
        for (let i = 1; i < ring.length; i++) {
          const d = segDistKm(lon, lat, ring[i - 1][0], ring[i - 1][1], ring[i][0], ring[i][1]);
          if (d <= maxKm && (!best || d < best.km)) best = { poly: p, km: d };
        }
  }
  return best;
}

// ── name / iso lookup tables ───────────────────────────────────────────────────
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
type Rec = { iso2: string; iso3: string; name: string };
const byIso2 = new Map<string, Rec>();
const byIso3 = new Map<string, Rec>();
const byName = new Map<string, Rec>();
for (const c of COUNTRY_CENTROIDS) {
  const rec: Rec = { iso2: c.iso2, iso3: c.iso3, name: c.name };
  byIso2.set(c.iso2, rec);
  byIso3.set(c.iso3, rec);
  byName.set(norm(c.name), rec);
}
for (const p of polys) {
  const rec: Rec = { iso2: p.iso2, iso3: p.iso3, name: p.name };
  if (p.iso2 && !byIso2.has(p.iso2)) byIso2.set(p.iso2, rec);
  if (!byName.has(norm(p.name))) byName.set(norm(p.name), rec);
}

// A few upstream spellings the tables do not carry verbatim.
const NAME_ALIASES: Record<string, string> = {
  unitedstatesofamerica: "US",
  unitedstates: "US",
  usa: "US",
  russianfederation: "RU",
  southkorea: "KR",
  republicofkorea: "KR",
  northkorea: "KP",
  iran: "IR",
  syria: "SY",
  vietnam: "VN",
  laos: "LA",
  tanzania: "TZ",
  bolivia: "BO",
  venezuela: "VE",
  moldova: "MD",
  brunei: "BN",
  czechia: "CZ",
  czechrepublic: "CZ",
  turkey: "TR",
  turkiye: "TR",
  unitedkingdom: "GB",
  greatbritain: "GB",
  drc: "CD",
  democraticrepublicofthecongo: "CD",
  congo: "CG",
  republicofthecongo: "CG",
  ivorycoast: "CI",
  cotedivoire: "CI",
  capeverde: "CV",
  swaziland: "SZ",
  eswatini: "SZ",
  macedonia: "MK",
  northmacedonia: "MK",
  burma: "MM",
  myanmar: "MM",
  palestine: "PS",
  westbank: "PS",
  gaza: "PS",
  timorleste: "TL",
  vatican: "VA",
  holysee: "VA",
  southsudan: "SS",
  bosniaandherzegovina: "BA",
  bosniaherzegovina: "BA",
  laopeoplesdemocraticrepublic: "LA",
  boliviaplurinationalstateof: "BO",
  venezuelabolivarianrepublicof: "VE",
  republicofmoldova: "MD",
  unitedrepublicoftanzania: "TZ",
  iranislamicrepublicof: "IR",
  syrianarabrepublic: "SY",
};

type How = "iso" | "name" | "polygon" | "snap" | "geometry" | "title";
type Resolved = Rec & { how: How };

/**
 * EONET publishes the FLOODS category with Polygon rings in [lat, lon] order while
 * every other category is Point in GeoJSON [lon, lat]. Measured 2026-09-08 against
 * eonet.gsfc.nasa.gov/api/v3/categories/floods: 122 of 400 open events are Polygons,
 * and of the 36 whose ordering is provable (second value outside +-90) all 36 prove
 * [lat, lon] and none prove [lon, lat]. lib/signals/eonet.ts averages the ring as
 * [lon, lat], so those pins ship transposed — "Flood in Austria" lands in the Gulf
 * of Aden. This correction exists so the country breakdown is not wrong too; it does
 * NOT fix the shipped layer.
 */
function unswapEonetFlood(f: SignalFeature): SignalFeature {
  if (f.signalId !== "floods") return f;
  const inLand = locate(f.lon, f.lat);
  const swapped = locate(f.lat, f.lon);
  // Only swap when the transposed reading lands in a country and the shipped one
  // does not — never "correct" a pin that is already somewhere real.
  if (!inLand && swapped && Math.abs(f.lon) <= 90) return { ...f, lat: f.lon, lon: f.lat };
  return f;
}

/** Every country a line/area geometry touches (containment, then a coastal snap). */
function countriesForGeometry(f: SignalFeature): Resolved[] {
  const g = f.geometry;
  if (!g) return [];
  const pts: [number, number][] = [];
  const walk = (c: unknown, depth: number) => {
    if (!Array.isArray(c)) return;
    if (depth === 0) {
      if (typeof c[0] === "number" && typeof c[1] === "number") pts.push([c[0] as number, c[1] as number]);
      return;
    }
    for (const x of c) walk(x, depth - 1);
  };
  const depth = g.type === "LineString" ? 1 : g.type === "MultiLineString" || g.type === "Polygon" ? 2 : 3;
  walk(g.coordinates, depth);
  const seen = new Map<string, Resolved>();
  for (const [lon, lat] of pts) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const hit = locate(lon, lat);
    if (hit) {
      const key = hit.iso2 || hit.name;
      if (!seen.has(key)) seen.set(key, { iso2: key, iso3: hit.iso3, name: hit.name, how: "geometry" });
      continue;
    }
    const near = nearestPoly(lon, lat, SNAP_KM);
    if (near) {
      const key = near.poly.iso2 || near.poly.name;
      if (!seen.has(key)) seen.set(key, { iso2: key, iso3: near.poly.iso3, name: near.poly.name, how: "geometry" });
    }
  }
  return [...seen.values()];
}

function resolveCountry(f: SignalFeature): Resolved | undefined {
  const p = (f.props ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string).trim() : "");

  // 1. explicit ISO codes
  for (const k of ["iso2", "iso_a2", "countryCode", "country_code", "cc"]) {
    const v = s(k).toUpperCase();
    if (v.length === 2 && byIso2.has(v)) return { ...byIso2.get(v)!, how: "iso" };
  }
  for (const k of ["iso3", "iso_a3", "coa_iso", "coo_iso"]) {
    const v = s(k).toUpperCase();
    if (v.length === 3 && byIso3.has(v)) return { ...byIso3.get(v)!, how: "iso" };
  }
  // an id like "cyber-c2:RU" / "displacement:SYR"
  const idTail = f.id.split(":").pop() ?? "";
  if (/^[A-Z]{2}$/.test(idTail) && byIso2.has(idTail)) return { ...byIso2.get(idTail)!, how: "iso" };
  if (/^[A-Z]{3}$/.test(idTail) && byIso3.has(idTail)) return { ...byIso3.get(idTail)!, how: "iso" };

  // 2. country NAME in props
  for (const k of ["country", "countryName", "country_name", "nation", "state"]) {
    const raw = s(k);
    if (!raw) continue;
    const n = norm(raw);
    const alias = NAME_ALIASES[n];
    if (alias && byIso2.has(alias)) return { ...byIso2.get(alias)!, how: "name" };
    if (byName.has(n)) return { ...byName.get(n)!, how: "name" };
  }

  // 3. point in polygon, then 4. a coastal snap within SNAP_KM
  if (Number.isFinite(f.lat) && Number.isFinite(f.lon)) {
    const hit = locate(f.lon, f.lat);
    if (hit) return { iso2: hit.iso2 || hit.name, iso3: hit.iso3, name: hit.name, how: "polygon" };
    const near = nearestPoly(f.lon, f.lat, SNAP_KM);
    if (near) return { iso2: near.poly.iso2 || near.poly.name, iso3: near.poly.iso3, name: near.poly.name, how: "snap" };
  }

  // 5. LAST resort: the trailing segment of a "Place, Country" title. Reached only
  // after geometry has failed, which is exactly the island and micro-state case —
  // Natural Earth 110m has no polygon for Bahrain, Malta, Singapore or the Comoros,
  // so their cable landings are otherwise invisible. An exact name match only.
  const tail = f.title.split(",").pop()?.trim() ?? "";
  if (tail) {
    const n = norm(tail);
    const alias = NAME_ALIASES[n];
    if (alias && byIso2.has(alias)) return { ...byIso2.get(alias)!, how: "title" };
    if (byName.has(n)) return { ...byName.get(n)!, how: "title" };
  }
  return undefined;
}

// ── run ────────────────────────────────────────────────────────────────────────
interface LayerReport {
  id: string;
  label: string;
  group: string;
  kind: string;
  dataOnly: boolean;
  ok: boolean;
  error?: string;
  ms: number;
  returned: number;
  located: number;
  unassigned: number;
  coverage?: ReturnType<typeof readCoverage>;
  how: Record<string, number>;
  countries: Record<string, number>;
  sampleUnassigned: { id: string; title: string; lat: number; lon: number }[];
  /** From --base mode: the deployment own honesty channel for this read. */
  upstreamOk?: boolean;
  degradedReason?: string;
  observedAt?: string;
  /** Features carrying a line/area geometry — these are counted in every country they touch. */
  geometryFeatures: number;
  spansCountries?: boolean;
  /** EONET flood pins this run had to un-transpose before it could place them. */
  transposedFixed?: number;
}

/** GET /api/signals/<id> from a deployment. Throws on anything but a JSON body. */
async function fetchFromBase(id: string): Promise<{
  features: SignalFeature[];
  coverage?: ReturnType<typeof readCoverage>;
  ok?: boolean;
  degradedReason?: string;
  observedAt?: string;
}> {
  const res = await fetch(`${BASE}/api/signals/${id}`, {
    redirect: "follow",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`HTTP ${res.status}, non-JSON body (${text.length} bytes): ${text.slice(0, 80)}`);
  }
  if (!Array.isArray(body.features)) throw new Error(`HTTP ${res.status}, no features array`);
  return {
    features: body.features as SignalFeature[],
    coverage: body.coverage as ReturnType<typeof readCoverage>,
    ok: body.ok as boolean | undefined,
    degradedReason: body.degradedReason as string | undefined,
    observedAt: body.observedAt as string | undefined,
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => {
      const t = setTimeout(() => rej(new Error(`timeout after ${ms}ms`)), ms);
      if (typeof t.unref === "function") t.unref();
    }),
  ]);
}

const layers: LayerReport[] = [];
const matrix = new Map<string, Map<string, number>>(); // iso2 -> layerId -> count
const meta = new Map<string, { name: string; continent: string; subregion: string; iso3: string }>();

for (const src of SIGNALS) {
  if (ONLY && !ONLY.has(src.id)) continue;
  const t0 = Date.now();
  const rep: LayerReport = {
    id: src.id,
    label: src.label,
    group: src.group,
    kind: src.kind ?? "event",
    dataOnly: !!src.dataOnly,
    ok: false,
    ms: 0,
    returned: 0,
    located: 0,
    unassigned: 0,
    how: {},
    countries: {},
    sampleUnassigned: [],
    geometryFeatures: 0,
  };
  try {
    let feats: SignalFeature[];
    if (BASE) {
      const r = await fetchFromBase(src.id);
      feats = r.features;
      rep.coverage = r.coverage;
      rep.upstreamOk = r.ok;
      rep.degradedReason = r.degradedReason;
      rep.observedAt = r.observedAt;
    } else {
      feats = await withTimeout(src.fetch(), TIMEOUT_MS);
      rep.coverage = readCoverage(feats);
    }
    rep.ok = true;
    rep.returned = feats.length;
    rep.geometryFeatures = feats.filter((f) => f.geometry).length;
    for (const raw of feats) {
      const f = unswapEonetFlood(raw);
      if (f !== raw) rep.transposedFixed = (rep.transposedFixed ?? 0) + 1;
      // A line/area feature belongs to EVERY country it crosses — a cable landing in
      // eight countries is a fact about all eight. Those layers are counted as
      // "features touching this country", flagged by `spansCountries` in the output.
      const hits = f.geometry ? countriesForGeometry(f) : [];
      const resolved = hits.length ? hits : ([resolveCountry(f)].filter(Boolean) as Resolved[]);
      if (!resolved.length) {
        rep.unassigned++;
        if (rep.sampleUnassigned.length < 5)
          rep.sampleUnassigned.push({ id: f.id, title: f.title, lat: f.lat, lon: f.lon });
        continue;
      }
      rep.located++;
      for (const r of resolved) {
        rep.how[r.how] = (rep.how[r.how] ?? 0) + 1;
        const key = r.iso2 || r.name;
        rep.countries[key] = (rep.countries[key] ?? 0) + 1;
        if (!matrix.has(key)) matrix.set(key, new Map());
        const m = matrix.get(key)!;
        m.set(src.id, (m.get(src.id) ?? 0) + 1);
        if (!meta.has(key)) {
          const poly = polys.find((p) => p.iso2 === key) ?? polys.find((p) => p.name === r.name);
          meta.set(key, {
            name: r.name,
            continent: poly?.continent ?? "",
            subregion: poly?.subregion ?? "",
            iso3: r.iso3,
          });
        }
      }
    }
    rep.spansCountries = rep.geometryFeatures > 0;
  } catch (e) {
    rep.error = e instanceof Error ? e.message : String(e);
  }
  rep.ms = Date.now() - t0;
  layers.push(rep);
  const cov = rep.coverage;
  console.error(
    `${rep.ok ? "ok " : "ERR"} ${src.id.padEnd(22)} ${String(rep.returned).padStart(6)} feats` +
      `  ${String(rep.located).padStart(6)} located  ${String(rep.unassigned).padStart(5)} unassigned` +
      `  ${String(Object.keys(rep.countries).length).padStart(4)} countries  ${rep.ms}ms` +
      (cov?.capped ? `  [capped ${cov.returned} of ${cov.available}${cov.availableExact ? "" : "+"}]` : "") +
      (rep.upstreamOk === false ? `  [DEGRADED: ${rep.degradedReason ?? "unstated"}]` : "") +
      (rep.error ? `  ${rep.error}` : ""),
  );
}

const countries = [...matrix.entries()]
  .map(([iso2, m]) => {
    const md = meta.get(iso2)!;
    const byLayer = Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
    return {
      iso2,
      iso3: md.iso3,
      name: md.name,
      continent: md.continent,
      subregion: md.subregion,
      layerCount: m.size,
      eventCount: [...m.values()].reduce((a, b) => a + b, 0),
      byLayer,
    };
  })
  .sort((a, b) => b.layerCount - a.layerCount || b.eventCount - a.eventCount);

const out = {
  measuredAt: new Date().toISOString(),
  measuredFrom: BASE || "in-process adapters on this machine",
  node: process.version,
  polygonSource: "Natural Earth 110m (public/geo/countries-110m.geojson), 177 polygons",
  registeredSignals: SIGNALS.length,
  layers,
  countries,
};
writeFileSync(OUT, JSON.stringify(out, null, 2));
console.error(
  `\nwrote ${OUT} — ${countries.length} countries, ${layers.filter((l) => l.ok).length}/${layers.length} layers fetched ok`,
);
