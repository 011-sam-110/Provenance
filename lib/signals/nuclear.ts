import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { NUCLEAR_SNAPSHOT, NUCLEAR_SNAPSHOT_DATE } from "@/lib/signals/nuclear.data";
import { isDenylistedNuclear } from "@/lib/signals/nuclear-denylist";
import { compiled, observed } from "@/lib/signals/outcome";

// Nuclear power plants — OpenStreetMap `power=plant` + `plant:source=nuclear`, with
// each plant's state of use from Wikidata. Keyless. ~217 named sites worldwide.
//
// THE TRANSPORT IS QLEVER, NOT OVERPASS (2026-10-16). The live Overpass refresh never
// once succeeded on prod: `/api/status` showed `lastUpstreamOkAt: null`, and the
// source audit got 406 (overpass-api.de, any non-app UA), 502 "at capacity" (with the
// app UA), and 500 from overpass.kumi.systems and overpass.private.coffee. So the
// layer was frozen on its 2026-08-10 snapshot. QLever's OSM-planet index answers the
// same question (planet 2026-09-21) in 14-21 s, so it runs in the BACKGROUND, never in
// the request path.
//
// SNAPSHOT-FIRST, unchanged: a dated, real extract (lib/signals/nuclear.data.ts,
// written by scripts/harvest-nuclear.mjs) answers at once, and a background read
// replaces the in-memory copy for later requests. The upstream being slow or down can
// make this layer slightly less fresh; it cannot make it empty or slow, and every
// feature says which copy it is via `props.dataset`.
//
// STATUS. About 20% of the rows were not running power plants (retired, cancelled,
// research, military, one vandalised row), all labelled "Nuclear power plant" with a
// capacity bar. Now: a non-power site is dropped (nuclear-denylist.ts, with reasons),
// a duplicate of the same Wikidata item is merged, and every other row says its
// Wikidata "state of use". A shut-down, cancelled or unbuilt plant keeps its pin, in
// grey, and loses its capacity bar, so it no longer ranks with running plants.

const QLEVER_ENDPOINT = "https://qlever.dev/api/osm-planet";
const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";
const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

/** The OSM read. Mirrors QUERY in scripts/harvest-nuclear.mjs; change them together. */
export const QLEVER_QUERY = `PREFIX osmkey: <https://www.openstreetmap.org/wiki/Key:>
PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX geof: <http://www.opengis.net/def/function/geosparql/>
SELECT ?osm ?name ?nameEn ?output ?operator ?start ?wikidata ?centroid WHERE {
  ?osm osmkey:power "plant" .
  ?osm osmkey:plant:source "nuclear" .
  ?osm geo:hasGeometry/geo:asWKT ?g .
  BIND (geof:centroid(?g) AS ?centroid)
  OPTIONAL { ?osm osmkey:name ?name }
  OPTIONAL { ?osm osmkey:name:en ?nameEn }
  OPTIONAL { ?osm osmkey:plant:output:electricity ?output }
  OPTIONAL { ?osm osmkey:operator ?operator }
  OPTIONAL { ?osm osmkey:start_date ?start }
  OPTIONAL { ?osm osmkey:wikidata ?wikidata }
}`;

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
/** The background read gets this long. No request ever waits on it. Measured 14-21 s. */
const LIVE_TIMEOUT_MS = 45_000;
/** Floor for accepting a live answer as "the world". Guards against a truncated or
 *  partial answer silently replacing ~200 plants with a handful. */
const PLAUSIBLE_MIN = 100;

export const NUCLEAR_ATTRIBUTION =
  "Nuclear plant data © OpenStreetMap contributors (ODbL, via QLever); status: Wikidata (CC0)";

/** One OSM element (node / way / relation) as this layer consumes it. The committed
 *  snapshot uses the SAME shape, so one pure mapper serves both paths. `status` is the
 *  plant's Wikidata state of use (P5817 labels, and "closed <date>" from P576). */
export interface OsmNuclearElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
  status?: string;
}

/** One SPARQL JSON result row: variable → { value }. */
export interface SparqlBinding {
  [name: string]: { value?: string } | undefined;
}

/**
 * Parse an OSM `plant:output:electricity` string (e.g. "1180 MW", "57 MW",
 * "1.18 GW") into net electrical capacity in MW. Returns undefined when the tag
 * is missing or unparseable — so we never fabricate a scalar.
 */
export function parseOutputMw(output: string | undefined): number | undefined {
  if (!output) return undefined;
  const m = output.match(/([\d.]+)\s*(GW|MW|kW|W)?/i);
  if (!m) return undefined;
  const val = parseFloat(m[1]);
  if (!Number.isFinite(val)) return undefined;
  const unit = (m[2] ?? "MW").toUpperCase();
  const factor = unit === "GW" ? 1000 : unit === "KW" ? 0.001 : unit === "W" ? 1e-6 : 1;
  return Math.round(val * factor);
}

/** Pure: QLever SPARQL bindings → OSM elements. Skips a row without an OSM IRI or a
 *  centroid. The centroid is a WKT `POINT(lon lat)`. */
export function qleverToElements(bindings: SparqlBinding[]): OsmNuclearElement[] {
  const out: OsmNuclearElement[] = [];
  for (const b of bindings ?? []) {
    const v = (k: string) => (b?.[k]?.value ?? "").trim();
    const m = v("osm").match(/openstreetmap\.org\/(node|way|relation)\/(\d+)$/);
    const p = v("centroid").match(/POINT\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/);
    if (!m || !p) continue;
    const tags: Record<string, string> = {};
    const pairs: [string, string][] = [
      ["name", "name"],
      ["nameEn", "name:en"],
      ["output", "plant:output:electricity"],
      ["operator", "operator"],
      ["start", "start_date"],
      ["wikidata", "wikidata"],
    ];
    for (const [k, tag] of pairs) if (v(k)) tags[tag] = v(k);
    out.push({ type: m[1], id: Number(m[2]), lat: Number(p[2]), lon: Number(p[1]), tags });
  }
  return out;
}

/** The Wikidata status read for a set of item ids. Mirrors statusQuery() in the script. */
export function wikidataStatusQuery(qids: string[]): string {
  return `SELECT ?item ?statusLabel ?end WHERE {
  VALUES ?item { ${qids.map((q) => `wd:${q}`).join(" ")} }
  OPTIONAL { ?item wdt:P5817 ?status . }
  OPTIONAL { ?item wdt:P576 ?end . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
}

/** Pure: Wikidata bindings → QID → status string ("in use", "decommissioned; closed 2000-12-15"). */
export function wikidataToStatus(bindings: SparqlBinding[]): Record<string, string> {
  const labels = new Map<string, Set<string>>();
  const ends = new Map<string, string>();
  for (const b of bindings ?? []) {
    const q = (b?.item?.value ?? "").split("/").pop() ?? "";
    if (!/^Q\d+$/.test(q)) continue;
    const label = b?.statusLabel?.value?.trim();
    if (label) labels.set(q, new Set([...(labels.get(q) ?? []), label]));
    const end = b?.end?.value;
    if (end) ends.set(q, end.slice(0, 10));
  }
  const out: Record<string, string> = {};
  for (const q of new Set([...labels.keys(), ...ends.keys()])) {
    const parts = [...(labels.get(q) ?? [])].sort();
    if (ends.has(q)) parts.push(`closed ${ends.get(q)}`);
    out[q] = parts.join("; ");
  }
  return out;
}

export type PlantStatusKey = "operating" | "construction" | "planned" | "retired" | "cancelled" | "unknown";

/**
 * Pure: a Wikidata status string → what the layer says. "in use" wins over a closed
 * date (a site whose first unit closed can still run others); with no statement the
 * answer is "unknown", never "operating".
 */
export function plantStatus(raw: string | undefined): { key: PlantStatusKey; label: string } {
  const s = (raw ?? "").toLowerCase();
  if (!s) return { key: "unknown", label: "Not stated" };
  if (/partial operation/.test(s)) return { key: "operating", label: "Partly operating" };
  if (/in use|operational|in operation/.test(s)) return { key: "operating", label: "Operating" };
  if (/starting up/.test(s)) return { key: "operating", label: "Starting up" };
  if (/construction/.test(s)) return { key: "construction", label: "Under construction" };
  if (/cancel/.test(s)) return { key: "cancelled", label: "Cancelled" };
  if (/decommission|demolish|destroy|shut|disused|abandon|retired|out of service|closed/.test(s)) {
    return { key: "retired", label: "Shut down" };
  }
  if (/proposed|project|planned|postponed|on hold/.test(s)) return { key: "planned", label: "Planned" };
  return { key: "unknown", label: "Not stated" };
}

const STATUS_COLOR: Record<PlantStatusKey, string> = {
  operating: "#16a34a",
  unknown: "#16a34a",
  construction: "#84cc16",
  planned: "#84cc16",
  retired: "#6b7280",
  cancelled: "#6b7280",
};

/** Pure: OSM elements → SignalFeature[] (one point per named plant).
 *  `dataset` is stamped onto every feature so a reader can always tell whether they
 *  are looking at a live answer or the dated snapshot. `statusByQid` supplies a
 *  Wikidata status for rows whose element carries none (the live path). */
export function normalizeOsmNuclear(
  json: { elements?: OsmNuclearElement[] },
  dataset?: string,
  statusByQid: Record<string, string> = {},
): SignalFeature[] {
  const out: SignalFeature[] = [];
  const byQid = new Map<string, number>(); // wikidata id → index in `out`
  for (const e of json.elements ?? []) {
    const t = e.tags ?? {};
    // Prefer OSM's English name where it exists (many plants are tagged only in the
    // local script, e.g. 柏崎刈羽原子力発電所); fall back to the default name. No translation.
    const name = (t["name:en"] || t.name)?.trim();
    if (!name) continue; // skip unnamed fragments
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const osmId = `${e.type ?? "n"}/${e.id ?? ""}`.trim();
    if (osmId === "n/") continue;
    if (isDenylistedNuclear(osmId)) continue;
    const qid = /^Q\d+$/.test(t.wikidata ?? "") ? t.wikidata : undefined;
    const status = plantStatus(e.status ?? (qid ? statusByQid[qid] : undefined));
    const output = t["plant:output:electricity"];
    const outputMw = parseOutputMw(output);
    // The capacity bar ranks plants that can generate. A shut, cancelled or unbuilt
    // plant keeps its tagged output as text but drops out of the ranking.
    const generating = status.key === "operating" || status.key === "unknown";
    const operator = t.operator || t["operator:wikidata"];
    const feature: SignalFeature = {
      id: `nuclear:${osmId}`,
      lat: lat as number,
      lon: lon as number,
      title: name,
      signalId: "nuclear",
      color: STATUS_COLOR[status.key],
      link: `https://www.openstreetmap.org/${e.type}/${e.id}`,
      props: {
        type: "Nuclear power plant",
        status: status.label,
        ...(output ? { output } : {}),
        ...(outputMw != null && generating ? { outputMw } : {}),
        ...(operator ? { operator } : {}),
        ...(t["start_date"] ? { commissioned: t["start_date"] } : {}),
        ...(qid ? { wikidata: qid } : {}),
        ...(dataset ? { dataset } : {}),
      },
    };
    // Two OSM rows for ONE Wikidata plant (e.g. Taishan, Tsuruga: a site outline and
    // a second polygon tagged output "yes") are one plant. Keep the row that states a
    // capacity.
    if (qid && byQid.has(qid)) {
      const i = byQid.get(qid)!;
      if (out[i].props?.outputMw == null && outputMw != null) out[i] = feature;
      continue;
    }
    if (qid) byQid.set(qid, out.length);
    out.push(feature);
  }
  return out;
}

export const LIVE_DATASET_LABEL = "OpenStreetMap via QLever (live)";
export const SNAPSHOT_DATASET_LABEL = `OpenStreetMap via QLever (snapshot ${NUCLEAR_SNAPSHOT_DATE})`;
/** When the committed extract was ACTUALLY harvested. The outcome stamps the age of
 *  the DATA, so a snapshot answer must not read as a fresh one. */
const SNAPSHOT_AT = Date.parse(`${NUCLEAR_SNAPSHOT_DATE}T00:00:00Z`);

/** The Wikidata statuses the snapshot carries, by QID: the fallback for a live OSM
 *  read whose Wikidata read failed. */
function snapshotStatusByQid(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of NUCLEAR_SNAPSHOT) {
    const q = e.tags?.wikidata;
    if (q && e.status) out[q] = e.status;
  }
  return out;
}

/** The committed extract, mapped once. Real OSM data — the layer's floor, not a stub. */
let snapshotFeatures: SignalFeature[] | null = null;
export function nuclearSnapshotFeatures(): SignalFeature[] {
  if (!snapshotFeatures) {
    snapshotFeatures = normalizeOsmNuclear({ elements: NUCLEAR_SNAPSHOT }, SNAPSHOT_DATASET_LABEL);
  }
  return snapshotFeatures;
}

// --- live refresh -----------------------------------------------------------

let cache: { features: SignalFeature[]; at: number } | null = null;
let inflight: Promise<SignalFeature[] | null> | null = null;
let lastAttemptAt = 0;
/** Don't re-hammer a public SPARQL endpoint on every request. */
const MIN_RETRY_MS = 10 * 60 * 1000;

async function sparql(endpoint: string, query: string, method: "GET" | "POST"): Promise<SparqlBinding[]> {
  const headers = { Accept: "application/sparql-results+json", "User-Agent": UA };
  const res =
    method === "GET"
      ? await fetch(`${endpoint}?query=${encodeURIComponent(query)}`, {
          headers,
          signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
        })
      : await fetch(endpoint, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
          body: `query=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
        });
  if (!res.ok) throw new Error(`sparql ${res.status}`);
  const json = (await res.json()) as { results?: { bindings?: SparqlBinding[] } };
  return json.results?.bindings ?? [];
}

async function readLive(): Promise<SignalFeature[]> {
  const elements = qleverToElements(await sparql(QLEVER_ENDPOINT, QLEVER_QUERY, "GET"));
  const qids = [...new Set(elements.map((e) => e.tags?.wikidata).filter((q): q is string => /^Q\d+$/.test(q ?? "")))];
  // Wikidata is the status, not the list: if it fails, the snapshot's statuses stand in.
  let status = snapshotStatusByQid();
  if (qids.length) {
    try {
      status = { ...status, ...wikidataToStatus(await sparql(WIKIDATA_ENDPOINT, wikidataStatusQuery(qids), "POST")) };
    } catch {
      /* keep the snapshot's statuses */
    }
  }
  const features = normalizeOsmNuclear({ elements }, LIVE_DATASET_LABEL, status);
  // A partial answer must not overwrite a complete world with a plausible fragment.
  if (features.length < PLAUSIBLE_MIN) throw new Error(`live read returned ${features.length} plants`);
  return features;
}

/** One shared in-flight read; a plausible answer populates the module cache (even if
 *  the caller has already given up on it). */
function refresh(): Promise<SignalFeature[] | null> {
  if (!inflight) {
    if (Date.now() - lastAttemptAt < MIN_RETRY_MS) return Promise.resolve(cache?.features ?? null);
    lastAttemptAt = Date.now();
    inflight = readLive()
      .then((features) => {
        cache = { features, at: Date.now() };
        return features;
      })
      .catch(() => null)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Test-only: reset the module memo so unit tests are order-independent. */
export function __resetNuclearCache(): void {
  cache = null;
  inflight = null;
  lastAttemptAt = 0;
  snapshotFeatures = null;
}

/** Test-only: settle the background refresh so a test can observe the upgrade
 *  without racing it. Resolves to the live features, or null if the read failed. */
export function __nuclearRefreshSettled(): Promise<SignalFeature[] | null> {
  return inflight ?? Promise.resolve(cache?.features ?? null);
}

export const NUCLEAR_SOURCE: SignalSource = {
  id: "nuclear",
  // A named plant.
  precision: "facility",
  label: "Nuclear plants",
  group: "Infrastructure",
  color: "#16a34a",
  refreshMs: CACHE_TTL_MS,
  attribution: NUCLEAR_ATTRIBUTION,
  kind: "asset", // permanent infrastructure → asset-directory focus view, ranked by capacity
  // Real per-plant scalar: net electrical capacity in MW (OSM plant:output:electricity),
  // for plants that can generate. Calm ≈ 0; extreme ≈ 8000 MW (Kashiwazaki-Kariwa).
  metric: { field: "outputMw", domain: [0, 8000], unit: " MW" },
  // OSM carries no country, so the directory ranks by capacity and shows the operator.
  directory: { detailKey: "operator", detailLabel: "Operator" },
  async fetch() {
    // A live answer is a real upstream read — stamped when it landed, not now.
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) return observed(cache.features, cache.at);
    // Start (or join) the background refresh and DO NOT wait for it: a late or
    // never-arriving answer must not delay the response. Its result lands in `cache`
    // and is served from the next call onwards. `refresh()` swallows its own failures.
    void refresh();
    // The snapshot is a COMPILED extract, not a failed read. Serverless instances
    // are cold constantly, so a `degraded` here would have shown "no answer" much of
    // the time while a complete world was on the map. Stamped when the extract was
    // harvested, so a consumer can say "compiled <date>".
    return compiled(nuclearSnapshotFeatures(), SNAPSHOT_AT);
  },
};
