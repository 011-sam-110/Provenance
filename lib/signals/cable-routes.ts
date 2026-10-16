import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { degraded, degradedWith, observed } from "@/lib/signals/outcome";

// Charted cable routes — submarine cables where a hydrographic or marine authority
// publishes the SURVEYED route, not a schematic one. Keyless.
//
//   NOAA Office for Coastal Management, "Submarine Cables" (US waters, from NOAA
//   charts and NASCA records). ArcGIS REST, 2,816 features, last edited 2025-02-19.
//   US federal work; "Cite As: Office for Coastal Management". It includes cables
//   TeleGeography does not show: 94 out of service or abandoned, power and science
//   cables, and old telegraph cables.
//
//   EMODnet Human Activities, telecommunication cables, actual routes (Europe),
//   CC BY 4.0, compiled by Cogea from BSH (DE), SHOM (FR), Rijkswaterstaat (NL),
//   SIG/CICA (ES), the UK offshore cable records and IOI-MOC (MT). Data revision
//   2023-06-28. Power cables are left out: this layer is about communications.
//
// A NEW LAYER, not part of `cables`: TeleGeography's routes are schematic, drawn for
// a world map; these are charted positions for two regions. Drawing both in one layer
// would draw the same cable twice in different places with no way to tell which is
// the real one. Together they answer the 2026-08-13 complaint that dashboards have
// "the entire undersea cable maps wrong", where the data exists.
//
// NOAA publishes each cable as a thin buffered polygon that runs out and back along
// the route; its outer ring IS the route, so it is drawn as a line.

export const CABLE_ROUTES_ATTRIBUTION =
  "Office for Coastal Management, NOAA (MarineCadastre.gov); EMODnet Human Activities, Cogea (CC BY 4.0)";
const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // both datasets change on a scale of years
const REFRESH_MS = 24 * 60 * 60 * 1000;
const COLOR = "#0e7490";

const NOAA_URL = (offset: number) =>
  "https://maps2.coast.noaa.gov/arcgis/rest/services/Hosted/SubmarineCables/FeatureServer/0/query" +
  `?where=1%3D1&outFields=cablesystem,owner,status,region&returnGeometry=true&geometryPrecision=4` +
  `&maxAllowableOffset=0.005&outSR=4326&f=geojson&resultOffset=${offset}&resultRecordCount=2000`;
const NOAA_PAGE = 2000; // the service's maxRecordCount
const NOAA_MAX_PAGES = 4;

/** EMODnet's telecom cable sublayers, one WFS GetFeature each. */
export const EMODNET_LAYERS = [
  "bshcontiscables",
  "cicacables",
  "shomcables",
  "sigcables",
  "maltacables",
  "rijkscables",
  "ukfibrecables",
] as const;
const emodnetUrl = (layer: string) =>
  `https://ows.emodnet-humanactivities.eu/wfs?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=emodnet:${layer}&OUTPUTFORMAT=application/json`;
const EMODNET_PUBLISHER: Record<string, string> = {
  bshcontiscables: "BSH (Germany)",
  cicacables: "CICA (Spain)",
  shomcables: "SHOM (France)",
  sigcables: "SIG (Spain)",
  maltacables: "IOI-MOC (Malta)",
  rijkscables: "Rijkswaterstaat (Netherlands)",
  ukfibrecables: "UK offshore cable records",
};

type Pos = [number, number];
interface GeoJsonFeature {
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: Record<string, unknown> | null;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** Simplification tolerance in degrees (~200 m): far below what a globe or a coastal
 *  map shows. With it, and with unnamed cables grouped, the layer's payload went from
 *  1.76 MB to 0.74 MB (467 features) on 2026-10-16. */
export const SIMPLIFY_DEG = 0.002;

/** Douglas-Peucker on [lon, lat] pairs, in degrees (fine at this tolerance). */
export function simplify(pts: Pos[], tol = SIMPLIFY_DEG): Pos[] {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let far = -1;
    let farD = tol;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > farD) {
        farD = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Clean one line: finite, rounded, no repeated vertices, simplified; null when under 2 points. */
function cleanLine(raw: unknown): Pos[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Pos[] = [];
  for (const p of raw) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    const q: Pos = [round4(p[0]), round4(p[1])];
    const last = out[out.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  }
  const line = simplify(out);
  return line.length >= 2 ? line : null;
}

/**
 * A NOAA cable is a thin polygon whose ring runs out along the route and back. Its
 * first half, from the start to the vertex farthest from it, is the route once.
 */
export function outboundLeg(ring: Pos[]): Pos[] {
  if (ring.length < 4) return ring;
  const [sx, sy] = ring[0];
  let far = 0;
  let farD = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - sx, ring[i][1] - sy);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  return ring.slice(0, far + 1);
}

/** Any GeoJSON line or polygon geometry → its lines. A polygon contributes the
 *  outbound leg of its outer ring (see outboundLeg). */
export function geometryLines(g: GeoJsonFeature["geometry"]): Pos[][] {
  if (!g || !Array.isArray(g.coordinates)) return [];
  const c = g.coordinates as unknown[];
  const leg = (ring: unknown) => (Array.isArray(ring) ? outboundLeg(ring as Pos[]) : null);
  const raw: unknown[] =
    g.type === "LineString" ? [c]
    : g.type === "MultiLineString" ? c
    : g.type === "Polygon" ? [leg(c[0])]
    : g.type === "MultiPolygon" ? (c as unknown[][]).map((p) => (Array.isArray(p) ? leg(p[0]) : null))
    : [];
  return raw.map(cleanLine).filter((l): l is Pos[] => l !== null);
}

/** The vertex halfway along the first line: a click and label anchor ON the route. */
function anchorOf(lines: Pos[][]): Pos {
  const l = lines[0];
  return l[Math.floor(l.length / 2)];
}

function routeFeature(id: string, title: string, lines: Pos[][], props: Record<string, unknown>, link: string): SignalFeature {
  const [lon, lat] = anchorOf(lines);
  return {
    id,
    lat,
    lon,
    title,
    signalId: "cable-routes",
    color: COLOR,
    geometry: lines.length === 1 ? { type: "LineString", coordinates: lines[0] } : { type: "MultiLineString", coordinates: lines },
    link,
    props: { assetKind: "cable", routeAccuracy: "charted", ...props },
  };
}

/** NOAA's status words, kept; a blank stays "—". */
function noaaStatus(s: string): string {
  return s || "—";
}

/**
 * Pure: NOAA's features → one route feature per named cable system (and status), and
 * one per region for the charted cables NOAA does not name (about 2 in 3 of them).
 */
export function normalizeNoaaCables(features: GeoJsonFeature[]): SignalFeature[] {
  const groups = new Map<string, { title: string; lines: Pos[][]; props: Record<string, unknown> }>();
  for (const f of features ?? []) {
    const p = f.properties ?? {};
    const lines = geometryLines(f.geometry);
    if (!lines.length) continue;
    const name = str(p.cablesystem);
    const status = noaaStatus(str(p.status));
    const region = str(p.region);
    const key = name ? `n|${name}|${status}` : `u|${region}|${status}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        title: name || `Unnamed charted cables${region ? `, ${region}` : ""}`,
        lines: [],
        props: {
          status,
          owners: str(p.owner) || "—",
          ...(region ? { region } : {}),
          publisher: "NOAA Office for Coastal Management",
        },
      };
      groups.set(key, g);
    }
    g.lines.push(...lines);
  }
  return [...groups.entries()].map(([key, g]) =>
    routeFeature(
      `cable-route:noaa:${slug(key)}`,
      g.title,
      g.lines,
      g.props,
      "https://marinecadastre.gov/",
    ),
  );
}

/** A readable, stable id part: a slug plus a short hash of the full key, so two keys
 *  that slug alike ("u||—" and "u||") stay distinct. */
function slug(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  const readable = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${readable}-${(h >>> 0).toString(36)}`;
}

/** Each publisher's status words → one vocabulary. A word not listed shows "—". */
const EMODNET_STATUS: Record<string, string> = {
  // BSH (Germany)
  inuse: "In service",
  outofuse: "Out of service",
  approved: "Planned",
  // Rijkswaterstaat (Netherlands)
  ingebruik: "In service",
  verlaten: "Abandoned",
  toekomstig: "Planned",
  // UK offshore records
  active: "In service",
  precommission: "Not yet in service",
  abandoned: "Abandoned",
};

/** Pure: one EMODnet feature's attributes → name, status, owner, as each publisher spells them. */
export function emodnetAttributes(layer: string, p: Record<string, unknown>): { name: string; status: string; owners: string } {
  const name = str(p.name_) || str(p.naam) || str(p.pipe_name) || str(p.name);
  // SHOM's and SIG's status fields are bare codes with no published key: not read.
  let status = layer === "shomcables" || layer === "sigcables" ? "—" : EMODNET_STATUS[str(p.status).toLowerCase()] ?? "—";
  const dism = str(p.dism_year);
  if (layer === "sigcables" && dism) status = `Dismantled ${dism.slice(-4)}`;
  if (/abandon/i.test(name)) status = "Abandoned";
  return { name, status, owners: str(p.eigenaar) || str(p.operator) || "—" };
}

/** Pure: one EMODnet sublayer's features → one route feature per named cable, and one
 *  per status for the cables the publisher does not name (SHOM names none of its 603). */
export function normalizeEmodnetCables(layer: string, features: GeoJsonFeature[]): SignalFeature[] {
  const publisher = EMODNET_PUBLISHER[layer] ?? layer;
  const out: SignalFeature[] = [];
  const unnamed = new Map<string, { lines: Pos[][]; owners: string }>();
  (features ?? []).forEach((f, i) => {
    const lines = geometryLines(f.geometry);
    if (!lines.length) return;
    const a = emodnetAttributes(layer, f.properties ?? {});
    if (!a.name) {
      const g = unnamed.get(a.status) ?? { lines: [], owners: a.owners };
      g.lines.push(...lines);
      unnamed.set(a.status, g);
      return;
    }
    out.push(
      routeFeature(
        `cable-route:emodnet:${layer}:${i}`,
        a.name,
        lines,
        { status: a.status, owners: a.owners, publisher: `EMODnet / ${publisher}` },
        "https://emodnet.ec.europa.eu/en/human-activities",
      ),
    );
  });
  for (const [status, g] of unnamed) {
    out.push(
      routeFeature(
        `cable-route:emodnet:${layer}:unnamed-${slug(status)}`,
        `Unnamed charted cables (${publisher})`,
        g.lines,
        { status, owners: g.owners, publisher: `EMODnet / ${publisher}` },
        "https://emodnet.ec.europa.eu/en/human-activities",
      ),
    );
  }
  return out;
}

// --- network (dormant-safe) -----------------------------------------------------------

async function getJson(url: string): Promise<{ features?: GeoJsonFeature[] }> {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`http ${res.status}`);
  return (await res.json()) as { features?: GeoJsonFeature[] };
}

async function readNoaa(): Promise<SignalFeature[]> {
  const all: GeoJsonFeature[] = [];
  for (let page = 0; page < NOAA_MAX_PAGES; page++) {
    const json = await getJson(NOAA_URL(page * NOAA_PAGE));
    const rows = json.features ?? [];
    all.push(...rows);
    if (rows.length < NOAA_PAGE) break;
  }
  if (!all.length) throw new Error("no features");
  return normalizeNoaaCables(all);
}

async function readEmodnet(): Promise<SignalFeature[]> {
  const answers = await Promise.allSettled(
    EMODNET_LAYERS.map(async (layer) => normalizeEmodnetCables(layer, (await getJson(emodnetUrl(layer))).features ?? [])),
  );
  const ok = answers.filter((a): a is PromiseFulfilledResult<SignalFeature[]> => a.status === "fulfilled");
  if (!ok.length) throw new Error("no EMODnet layer answered");
  return ok.flatMap((a) => a.value);
}

type Slot = { features: SignalFeature[]; at: number };
const slots: { noaa?: Slot; emodnet?: Slot } = {};

async function viaSlot(key: "noaa" | "emodnet", read: () => Promise<SignalFeature[]>): Promise<{ slot?: Slot; failed: boolean }> {
  const s = slots[key];
  if (s && Date.now() - s.at < CACHE_TTL_MS) return { slot: s, failed: false };
  try {
    slots[key] = { features: await read(), at: Date.now() };
    return { slot: slots[key], failed: false };
  } catch {
    return { slot: s, failed: true }; // last good copy, if any
  }
}

/** Test-only. */
export function __resetCableRoutes(): void {
  delete slots.noaa;
  delete slots.emodnet;
}

export const CABLE_ROUTES_SOURCE: SignalSource = {
  id: "cable-routes",
  // A named cable on its charted route.
  precision: "facility",
  kind: "asset",
  label: "Charted cable routes",
  group: "Infrastructure",
  color: COLOR,
  refreshMs: REFRESH_MS,
  attribution: CABLE_ROUTES_ATTRIBUTION,
  sourceUrl: "https://marinecadastre.gov/",
  directory: { detailKey: "status", detailLabel: "Status" },
  async fetch() {
    const [noaa, emodnet] = await Promise.all([viaSlot("noaa", readNoaa), viaSlot("emodnet", readEmodnet)]);
    const features = [...(noaa.slot?.features ?? []), ...(emodnet.slot?.features ?? [])];
    const reads = [noaa.slot?.at, emodnet.slot?.at].filter((t): t is number => typeof t === "number");
    if (!features.length) return degraded("fetch failed");
    const oldest = Math.min(...reads);
    const failed = [noaa.failed && "NOAA", emodnet.failed && "EMODnet"].filter(Boolean);
    if (failed.length) return degradedWith(features, `${failed.join(" and ")} fetch failed`, oldest);
    return observed(features, oldest);
  },
};
