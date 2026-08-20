/**
 * The discovery run: ask the catalogues, probe what they name, and produce candidates.
 *
 * The shape is a funnel and it is worth stating in full, because every stage throws
 * most of its input away and a reader who does not expect that will read a low number
 * as a bug:
 *
 *   portals x queries  ->  catalogue hits     (a few hundred)
 *   looksLikeCameraDataset  ->  plausible     (most are speed cameras and traffic counts)
 *   machineReadable resources  ->  fetchable  (most are PDFs and spreadsheets)
 *   fetch + sniff  ->  parsed                 (most answer 404, or are not cameras)
 *   runGates  ->  admissible                  (relays and duplicates die here)
 *   a human at /admin/verify  ->  admitted
 *
 * Nothing here writes to the registry and nothing here decides. The output is a queue.
 *
 * NETWORK MANNERS. Requests are serialised per host with a delay, carry a User-Agent
 * that names the project and links the repo, and every response is size-capped. This
 * pipeline reads other people's public catalogues on their infrastructure; a discovery
 * tool that hammers a national open-data portal is a discovery tool that gets the
 * project blocked, and being blocked is not recoverable by writing better code.
 */

import type { Camera } from "@/lib/types";
import {
  CAMERA_QUERIES,
  CKAN_PORTALS,
  arcgisHubSearchUrl,
  ckanSearchUrl,
  licenceStatement,
  looksLikeCameraDataset,
  machineReadable,
  parseArcgisHub,
  parseCkanSearch,
  parseSocrataCatalog,
  scoreHit,
  socrataSearchUrl,
  type CatalogueHit,
} from "@/lib/discovery/catalogues";
import { runGates } from "@/lib/discovery/gates";
import { inferCountry } from "@/lib/discovery/geo";
import { normalizeFeed } from "@/lib/discovery/normalize";
import { extractRows, findRowArrays, sniffFormat, sniffMapping } from "@/lib/discovery/sniff";
import type { Candidate, FeedDescriptor, SampleCamera } from "@/lib/discovery/types";

const USER_AGENT = "TrafficNerd/2.0 discovery (+https://github.com/011-sam-110/Provenance)";

/** Nothing this pipeline needs is larger than this; a 200 MB body is a mistake. */
const MAX_BODY_BYTES = 12 * 1024 * 1024;

/** Per-request ceiling. A portal that cannot answer in this is not worth the run. */
const REQUEST_TIMEOUT_MS = 20_000;

/** Politeness delay between two requests to the same host. */
const HOST_DELAY_MS = 800;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const lastHit = new Map<string, number>();

async function politeFetchJson(url: string, signal?: AbortSignal): Promise<unknown | null> {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  const wait = (lastHit.get(host) ?? 0) + HOST_DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => ac.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: ac.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_BODY_BYTES) return null;
    const text = await res.text();
    // Length is checked again after reading, because a chunked response carries no
    // content-length and the header is the upstream's claim rather than a fact.
    if (text.length > MAX_BODY_BYTES) return null;
    return JSON.parse(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export interface RunOptions {
  /** Restrict to these portal base URLs. Empty means every CKAN portal on file. */
  portals?: string[];
  /** Include the Socrata cross-domain catalogue. */
  socrata?: boolean;
  /** Include ArcGIS Hub. */
  arcgis?: boolean;
  /** Stop after this many candidates. A full sweep is slow and rarely what you want. */
  limit?: number;
  /** Cameras already served, for the overlap gate. */
  existing?: Pick<Camera, "id" | "source" | "lat" | "lon">[];
  signal?: AbortSignal;
  /** Progress line sink, so a long run is not a blank screen. */
  onProgress?: (line: string) => void;
}

export interface RunReport {
  startedAt: string;
  finishedAt: string;
  counts: {
    catalogueHits: number;
    plausible: number;
    fetchable: number;
    parsed: number;
    admissible: number;
  };
  /** Per-portal yield, so a portal that has stopped answering is visible. */
  perPortal: Array<{ portal: string; hits: number; candidates: number }>;
  candidates: Candidate[];
}

/** Stable across runs, so a verdict survives re-discovery of the same endpoint. */
export function candidateId(endpoint: string): string {
  let h = 2166136261;
  for (let i = 0; i < endpoint.length; i++) {
    h ^= endpoint.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const host = (() => {
    try {
      return new URL(endpoint).hostname.replace(/^www\./, "").replace(/[^a-z0-9]+/gi, "-");
    } catch {
      return "unknown";
    }
  })();
  return host + "-" + (h >>> 0).toString(36);
}

/** A registry key from a host: short, stable, and readable in a camera id. */
export function feedKeyFor(hit: CatalogueHit, endpoint: string): string {
  const base = (() => {
    try {
      const host = new URL(endpoint).hostname.replace(/^www\./, "");
      return host.split(".").slice(0, 2).join("-");
    } catch {
      return "feed";
    }
  })();
  const slug = hit.datasetId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
  return (base + "-" + slug).replace(/-+/g, "-").slice(0, 48);
}

/**
 * Which country a catalogue hit is about.
 *
 * The portal it came from is the only signal that is reliably present, which is why
 * `CKAN_PORTALS` carries one. It is a HINT — it feeds the coordinate tie-break and the
 * country-fit gate, both of which fail safe when it is wrong. Socrata and ArcGIS Hub
 * are multi-country and get no hint at all, so their candidates only resolve a
 * coordinate pair when the column names say which is which.
 */
function countryFor(hit: CatalogueHit): string | undefined {
  return CKAN_PORTALS.find((p) => p.base === hit.portal)?.country;
}

async function gatherHits(opts: RunOptions): Promise<CatalogueHit[]> {
  const wanted = opts.portals?.length
    ? CKAN_PORTALS.filter((p) => opts.portals!.includes(p.base))
    : CKAN_PORTALS;
  const hits: CatalogueHit[] = [];

  for (const portal of wanted) {
    for (const query of CAMERA_QUERIES) {
      if (opts.signal?.aborted) return hits;
      const body = await politeFetchJson(ckanSearchUrl(portal.base, query), opts.signal);
      const parsed = body ? parseCkanSearch(body, portal.base) : [];
      hits.push(...parsed);
      opts.onProgress?.(portal.name + " / " + JSON.stringify(query) + ": " + parsed.length + " datasets");
    }
  }

  if (opts.socrata) {
    for (const query of CAMERA_QUERIES) {
      if (opts.signal?.aborted) return hits;
      const body = await politeFetchJson(socrataSearchUrl(query), opts.signal);
      const parsed = body ? parseSocrataCatalog(body) : [];
      hits.push(...parsed);
      opts.onProgress?.("Socrata / " + JSON.stringify(query) + ": " + parsed.length + " datasets");
    }
  }

  if (opts.arcgis) {
    for (const query of CAMERA_QUERIES) {
      if (opts.signal?.aborted) return hits;
      const body = await politeFetchJson(arcgisHubSearchUrl(query), opts.signal);
      const parsed = body ? parseArcgisHub(body) : [];
      hits.push(...parsed);
      opts.onProgress?.("ArcGIS Hub / " + JSON.stringify(query) + ": " + parsed.length + " datasets");
    }
  }

  return hits;
}

/** Sample evenly rather than off the top: the first 12 rows of a sorted feed all look alike. */
function pickSamples(cameras: Camera[], n = 12): SampleCamera[] {
  const step = Math.max(1, Math.floor(cameras.length / n));
  const out: SampleCamera[] = [];
  for (let i = 0; i < cameras.length && out.length < n; i += step) {
    const c = cameras[i];
    out.push({
      nativeId: c.id.slice(c.source.length + 1),
      name: c.name,
      lat: c.lat,
      lon: c.lon,
      imageUrl: c.imageUrl,
      streamUrl: c.streamUrl,
      road: c.road,
    });
  }
  return out;
}

export async function runDiscovery(opts: RunOptions = {}): Promise<RunReport> {
  const startedAt = new Date().toISOString();
  const hits = await gatherHits(opts);

  const plausible = hits.filter(looksLikeCameraDataset).sort((a, b) => scoreHit(b) - scoreHit(a));
  opts.onProgress?.(hits.length + " datasets, " + plausible.length + " plausibly cameras");

  const seenEndpoints = new Set<string>();
  const candidates: Candidate[] = [];
  const perPortal = new Map<string, { hits: number; candidates: number }>();
  for (const h of hits) {
    const row = perPortal.get(h.portal) ?? { hits: 0, candidates: 0 };
    row.hits++;
    perPortal.set(h.portal, row);
  }

  let fetchable = 0;
  let parsedCount = 0;

  for (const hit of plausible) {
    if (opts.signal?.aborted) break;
    if (opts.limit && candidates.length >= opts.limit) break;

    for (const resource of hit.resources.filter(machineReadable)) {
      if (opts.limit && candidates.length >= opts.limit) break;
      if (seenEndpoints.has(resource.url)) continue;
      seenEndpoints.add(resource.url);
      fetchable++;

      const body = await politeFetchJson(resource.url, opts.signal);
      if (body == null) continue;

      const format = sniffFormat(body);
      const rowsPath = format === "json" ? findRowArrays(body)[0] : undefined;
      if (format === "json" && rowsPath === undefined) continue;

      // Sniff against the same extraction the runtime adapter will use, so a mapping
      // that works here cannot fail to work there for a reason nobody can see.
      const country = countryFor(hit);
      const probe: FeedDescriptor = {
        key: feedKeyFor(hit, resource.url),
        name: hit.publisher ?? hit.title,
        country: country ?? "??",
        endpoint: resource.url,
        format,
        rowsPath,
        mapping: { id: "", name: "", lat: "", lon: "" },
        license: licenceStatement(hit.license, hit.publisher),
        attribution: (hit.publisher ?? hit.title) + " — via " + hit.portal,
        refreshSeconds: 300,
      };

      // The SAME extraction the runtime adapter uses, so a mapping that works here
      // cannot fail there for a reason nobody can see from the candidate.
      const rawRows = extractRows(body, format, rowsPath);
      if (rawRows.length < 3) continue;
      const sniffed = sniffMapping(rawRows, { country });
      if (!sniffed.mapping.lat || !sniffed.mapping.lon || !sniffed.mapping.id || !sniffed.mapping.name) continue;

      const descriptor: FeedDescriptor = {
        ...probe,
        mapping: sniffed.mapping as FeedDescriptor["mapping"],
      };
      let normalized = normalizeFeed(descriptor, body);
      if (normalized.cameras.length === 0) continue;
      parsedCount++;

      // ArcGIS Hub and Socrata are multi-country and record no country per dataset, so
      // without this every candidate from them ships `country: "??"` — which passes
      // CameraSchema's two-character rule and means a camera in no country. Inferred
      // from where the cameras actually are, and said out loud as inferred.
      const inferredNotes: string[] = [];
      if (descriptor.country === "??") {
        const inferred = inferCountry(normalized.cameras);
        if (inferred) {
          descriptor.country = inferred;
          normalized = normalizeFeed(descriptor, body);
          inferredNotes.push(
            "The catalogue states no country. " + inferred +
              " was inferred from where the cameras are, not read from the data — check it against the pictures.",
          );
        }
      }

      const samples = pickSamples(normalized.cameras);
      const gates = runGates({
        descriptor,
        samples,
        parsed: { rows: normalized.rows, valid: normalized.cameras.length },
        catalogueLicense: hit.license,
        existing: opts.existing,
      });

      candidates.push({
        id: candidateId(resource.url),
        descriptor,
        provenance: {
          probe: hit.portal.includes("socrata") ? "socrata" : hit.portal.includes("arcgis") ? "arcgis-hub" : "ckan",
          discoveredVia: hit.landingPage ?? hit.portal,
          publisher: hit.publisher,
          catalogueLicense: hit.license,
          foundAt: new Date().toISOString(),
        },
        gates,
        parsed: { rows: normalized.rows, valid: normalized.cameras.length },
        samples,
        confidence: sniffed.confidence,
        notes: [...sniffed.notes, ...inferredNotes],
      });
      const row = perPortal.get(hit.portal);
      if (row) row.candidates++;
      opts.onProgress?.(
        "candidate: " + descriptor.key + " — " + normalized.cameras.length + " cameras, confidence " +
          sniffed.confidence + (sniffed.notes.length ? " (" + sniffed.notes.length + " notes)" : ""),
      );
    }
  }

  // Best first. A reviewer's attention is the scarce resource in this pipeline.
  candidates.sort((a, b) => b.confidence - a.confidence || b.parsed.valid - a.parsed.valid);

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    counts: {
      catalogueHits: hits.length,
      plausible: plausible.length,
      fetchable,
      parsed: parsedCount,
      admissible: candidates.filter((c) => !c.gates.some((g) => g.status === "fail")).length,
    },
    perPortal: [...perPortal].map(([portal, v]) => ({ portal, ...v })).sort((a, b) => b.candidates - a.candidates),
    candidates,
  };
}
