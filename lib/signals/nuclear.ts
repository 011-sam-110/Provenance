import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { NUCLEAR_SNAPSHOT, NUCLEAR_SNAPSHOT_DATE } from "@/lib/signals/nuclear.data";

// Nuclear power plants — OpenStreetMap `power=plant` + `plant:source=nuclear`.
// Keyless. ~216 named plants worldwide, so the payload is light; the PROBLEM is
// latency, not size. Measured from a UK home connection on 2026-08-10 with the
// exact QUERY below:
//
//   overpass-api.de          200 in 1.5s / 1.8s / 2.6s  …but 504 at ~7.8-8.3s on
//                            roughly half the attempts (server under load)
//   overpass.kumi.systems    200 in 15.5s once, then 504 at 36s and three 40s timeouts
//   overpass.private.coffee  no response inside 90s
//   overpass.osm.ch          200 in 0.5s — but only 3 elements: it is a REGIONAL
//                            extract, not the planet. Answering fast with a
//                            near-empty world is worse than answering slowly, which
//                            is why every live answer must clear PLAUSIBLE_MIN.
//
// Overpass therefore cannot be trusted to answer inside a request budget, and
// WAITING on it buys almost nothing: a nuclear power station is not a live feed,
// the set changes on a scale of months. So the layer is SNAPSHOT-FIRST — it returns
// a dated, real OSM extract immediately (0 ms, never empty, never a placeholder)
// and kicks off a background mirror race whose result replaces the in-memory copy
// for subsequent requests. Overpass being slow, overloaded or regional can no
// longer make this layer empty OR slow; it can only make it slightly less fresh,
// and every feature says which it is via `props.dataset`.

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const QUERY =
  '[out:json][timeout:25];nwr["plant:source"="nuclear"]["power"="plant"];out center tags;';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
/** A mirror gets this long in the BACKGROUND. No request ever waits on it. */
const MIRROR_TIMEOUT_MS = 20_000;
/** Floor for accepting a live answer as "the world". Guards against a regional
 *  Overpass instance (or a truncated answer) silently replacing 216 plants with 3. */
const PLAUSIBLE_MIN = 100;

export const NUCLEAR_ATTRIBUTION = "Nuclear plant data © OpenStreetMap contributors (via Overpass API)";

/** One Overpass element (node / way / relation) as this layer consumes it. The
 *  committed snapshot in nuclear.data.ts uses the SAME shape, so one pure mapper
 *  serves both the live and the snapshot path. */
export interface OverpassNuclearElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
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

/** Pure: Overpass elements → SignalFeature[] (one point per named plant).
 *  `dataset` is stamped onto every feature so a reader can always tell whether they
 *  are looking at a live Overpass answer or the dated snapshot. */
export function normalizeOverpassNuclear(
  json: { elements?: OverpassNuclearElement[] },
  dataset?: string,
): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const e of json.elements ?? []) {
    const t = e.tags ?? {};
    // Prefer OSM's English name where it exists (many plants are tagged only in the
    // local script, e.g. 柏崎刈羽原子力発電所); fall back to the default name. No translation.
    const name = (t["name:en"] || t.name)?.trim();
    if (!name) continue; // skip unnamed fragments
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const id = `${e.type ?? "n"}/${e.id ?? ""}`.trim();
    if (id === "n/") continue;
    const output = t["plant:output:electricity"];
    const outputMw = parseOutputMw(output);
    const operator = t.operator || t["operator:wikidata"];
    out.push({
      id: `nuclear:${id}`,
      lat: lat as number,
      lon: lon as number,
      title: name,
      signalId: "nuclear",
      color: "#16a34a",
      link: `https://www.openstreetmap.org/${e.type}/${e.id}`,
      props: {
        type: "Nuclear power plant",
        ...(output ? { output } : {}),
        ...(outputMw != null ? { outputMw } : {}),
        ...(operator ? { operator } : {}),
        ...(t["start_date"] ? { commissioned: t["start_date"] } : {}),
        ...(dataset ? { dataset } : {}),
      },
    });
  }
  return out;
}

export const LIVE_DATASET_LABEL = "OpenStreetMap via Overpass (live)";
export const SNAPSHOT_DATASET_LABEL = `OpenStreetMap via Overpass (snapshot ${NUCLEAR_SNAPSHOT_DATE})`;

/** The committed extract, mapped once. Real OSM data — the layer's floor, not a stub. */
let snapshotFeatures: SignalFeature[] | null = null;
export function nuclearSnapshotFeatures(): SignalFeature[] {
  if (!snapshotFeatures) {
    snapshotFeatures = normalizeOverpassNuclear({ elements: NUCLEAR_SNAPSHOT }, SNAPSHOT_DATASET_LABEL);
  }
  return snapshotFeatures;
}

// --- live refresh -----------------------------------------------------------

let cache: { features: SignalFeature[]; at: number } | null = null;
let inflight: Promise<SignalFeature[] | null> | null = null;
let lastAttemptAt = 0;
/** Don't re-hammer a struggling public Overpass instance on every request. */
const MIN_RETRY_MS = 10 * 60 * 1000;

async function askMirror(url: string): Promise<SignalFeature[]> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `data=${encodeURIComponent(QUERY)}`,
    signal: AbortSignal.timeout(MIRROR_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`overpass ${res.status}`);
  const json = (await res.json()) as { elements?: OverpassNuclearElement[] };
  const features = normalizeOverpassNuclear(json, LIVE_DATASET_LABEL);
  // A regional instance answers fast with a handful of plants — reject it rather
  // than let it overwrite a complete world with a plausible-looking fragment.
  if (features.length < PLAUSIBLE_MIN) throw new Error(`overpass returned ${features.length} plants`);
  return features;
}

/** One shared in-flight race across the mirrors; first plausible answer wins and
 *  populates the module cache (even if the caller has already given up on it). */
function refresh(): Promise<SignalFeature[] | null> {
  if (!inflight) {
    if (Date.now() - lastAttemptAt < MIN_RETRY_MS) return Promise.resolve(cache?.features ?? null);
    lastAttemptAt = Date.now();
    inflight = Promise.any(MIRRORS.map(askMirror))
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
 *  without racing it. Resolves to the live features, or null if the race failed. */
export function __nuclearRefreshSettled(): Promise<SignalFeature[] | null> {
  return inflight ?? Promise.resolve(cache?.features ?? null);
}

export const NUCLEAR_SOURCE: SignalSource = {
  id: "nuclear",
  label: "Nuclear plants",
  group: "Infrastructure",
  color: "#16a34a",
  refreshMs: CACHE_TTL_MS,
  attribution: NUCLEAR_ATTRIBUTION,
  kind: "asset", // permanent infrastructure → asset-directory focus view, ranked by capacity
  // Real per-plant scalar: net electrical capacity in MW (OSM plant:output:electricity).
  // Calm ≈ 0; extreme ≈ 8000 MW (world's largest stations, e.g. Kashiwazaki-Kariwa).
  metric: { field: "outputMw", domain: [0, 8000], unit: " MW" },
  // OSM carries no country, so the directory ranks by capacity and shows the operator.
  directory: { detailKey: "operator", detailLabel: "Operator" },
  async fetch() {
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.features;
    // Start (or join) the background refresh and DO NOT wait for it: a late or
    // never-arriving Overpass answer must not delay the response. Its result lands
    // in `cache` and is served from the next call onwards. `refresh()` already
    // swallows its own failures, so there is nothing to reject here.
    void refresh();
    return nuclearSnapshotFeatures();
  },
};
