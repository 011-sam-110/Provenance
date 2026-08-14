import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { applyCap, carryCoverage } from "@/lib/signals/coverage";
import { degraded, degradedWith, observed } from "@/lib/signals/outcome";

// gpsjam.org — daily GPS/GNSS interference, aggregated from ADS-B Exchange flight
// telemetry into H3 hexagons. Keyless. NOTE: the site migrated from GeoJSON to a
// gzipped CSV of H3 cells — confirmed live 2026-06-27 the JSON endpoint
// (…-h3-7.json) now 404s and the live data is `data/<YYYY-MM-DD>-h3_4.csv` with
// columns `hex,count_good_aircraft,count_bad_aircraft` (resolution 7 no longer
// published; resolution 4 is the global grid). We compute YESTERDAY server-side
// and walk back a few days until a file exists (today's is usually missing).
//
// Each row's interference ratio = bad / (good + bad). The global grid is ~46k
// cells, almost all clean, so we keep only well-sampled HIGH-interference hexes
// and HARD-CAP the count, then convert those H3 indices to hexagon Polygons with
// h3-js (dynamically imported, server-only — kept out of the client bundle since
// the registry is also imported client-side). This is the framework's first
// POLYGON layer.

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // daily data; re-probe a few times a day
const MIN_SAMPLE = 10; // ignore hexes seen by too few aircraft (noise)
const MIN_RATIO = 0.1; // ≥10% of aircraft reporting bad GNSS
const MAX_CELLS = 400; // hard cap — keep the layer light on the globe
const LOOKBACK_DAYS = 4; // today is usually unpublished; walk back this far

export const GPSJAM_ATTRIBUTION = "GPS interference data © gpsjam.org (from ADS-B Exchange)";

export interface GpsjamCell {
  hex: string;
  good: number;
  bad: number;
  ratio: number; // bad / (good + bad)
}

/** Red ramp by interference ratio (heavier jamming = deeper red). */
export function gpsjamColor(ratio: number): string {
  if (ratio >= 0.5) return "#b91c1c";
  if (ratio >= 0.3) return "#dc2626";
  if (ratio >= 0.2) return "#ea580c";
  return "#f59e0b";
}

/**
 * Pure: gpsjam CSV text → the high-interference cells, well-sampled, sorted by
 * ratio descending and capped. Tolerates a header row and blank lines.
 */
export function parseGpsjamCsv(
  text: string,
  { minSample = MIN_SAMPLE, minRatio = MIN_RATIO, cap = MAX_CELLS } = {},
): GpsjamCell[] {
  const lines = text.split(/\r?\n/);
  const out: GpsjamCell[] = [];
  for (const line of lines) {
    if (!line) continue;
    const [hex, g, b] = line.split(",");
    if (!hex || hex === "hex") continue; // header / malformed
    const good = Number(g);
    const bad = Number(b);
    if (!Number.isFinite(good) || !Number.isFinite(bad)) continue;
    const total = good + bad;
    if (total < minSample) continue;
    const ratio = bad / total;
    if (ratio < minRatio) continue;
    out.push({ hex, good, bad, ratio });
  }
  out.sort((a, b) => b.ratio - a.ratio);
  // `available` counts the cells that CLEAR the interference threshold, not all
  // ~46k cells in the grid — the threshold defines the layer, the cap truncates it.
  return applyCap(out, cap, {
    noun: "interference cells",
    rule: "the worst by interference ratio",
  });
}

/** The slice of h3-js this adapter needs — injected so the mapping stays pure. */
export interface H3Lib {
  cellToBoundary(h3Index: string, formatAsGeoJson: boolean): number[][];
  cellToLatLng(h3Index: string): number[];
}

/**
 * Pure (given an h3 implementation): GpsjamCell[] → SignalFeature[] with a
 * Polygon hexagon geometry per cell. `cellToBoundary(hex, true)` yields a closed
 * [lon, lat] ring; `cellToLatLng` yields the [lat, lon] centroid anchor.
 */
export function gpsjamCellsToFeatures(cells: GpsjamCell[], h3: H3Lib, day?: string): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const c of cells) {
    let ring: number[][];
    let center: number[];
    try {
      ring = h3.cellToBoundary(c.hex, true);
      center = h3.cellToLatLng(c.hex);
    } catch {
      continue; // skip an invalid index rather than fail the whole layer
    }
    if (!Array.isArray(ring) || ring.length < 4) continue;
    const [lat, lon] = center as [number, number];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const pct = Math.round(c.ratio * 100);
    out.push({
      id: `gpsjam:${c.hex}`,
      lat,
      lon,
      title: `GPS interference ${pct}%`,
      signalId: "gpsJamming",
      color: gpsjamColor(c.ratio),
      geometry: { type: "Polygon", coordinates: [ring as [number, number][]] },
      link: "https://gpsjam.org/",
      ts: day,
      props: {
        interference: `${pct}%`,
        interferencePct: pct, // numeric sibling of `interference` → drives the metric bar
        aircraft: c.good + c.bad,
        badReports: c.bad,
        ...(day ? { day } : {}),
      },
    });
  }
  // The cap was applied to the CELLS; carry that record onto the features they
  // became, so a dropped invalid H3 index shrinks `returned` without erasing the
  // fact that jammed cells beyond the cap are not on the globe at all.
  return carryCoverage(cells, out);
}

/** UTC YYYY-MM-DD `offset` days before `from` (server-side; not a workflow script). */
function utcDay(from: Date, offset: number): string {
  const d = new Date(from.getTime() - offset * 86_400_000);
  return d.toISOString().slice(0, 10);
}

let cache: { features: SignalFeature[]; at: number } | null = null;

export const GPS_JAMMING_SOURCE: SignalSource = {
  id: "gpsJamming",
  label: "GPS jamming",
  group: "Infrastructure",
  color: "#dc2626",
  refreshMs: CACHE_TTL_MS,
  attribution: GPSJAM_ATTRIBUTION,
  sourceUrl: "https://gpsjam.org/", // interference map (dossier source)

  // Real per-cell scalar: % of sampled aircraft reporting bad GNSS (bad / total).
  metric: { field: "interferencePct", domain: [0, 100], unit: "%" },
  async fetch() {
    // A cache hit is a real upstream read — stamped when it happened, not now.
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) return observed(cache.features, cache.at);
    try {
      const now = new Date();
      let csv: string | null = null;
      let day: string | undefined;
      for (let off = 1; off <= LOOKBACK_DAYS; off++) {
        const d = utcDay(now, off);
        const res = await fetch(`https://gpsjam.org/data/${d}-h3_4.csv`, {
          headers: { "User-Agent": "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)" },
          signal: AbortSignal.timeout(20_000),
        });
        if (res.ok) {
          const body = await res.text();
          // A 404 page is JSON ({"message":"File not found"}); a real file is CSV.
          if (body.startsWith("hex,") || body.includes("count_good_aircraft")) {
            csv = body;
            day = d;
            break;
          }
        }
      }
      // Nothing published across the whole lookback window. Keep the last-good
      // cells rather than emptying the layer, but declare the failure and stamp
      // the age of the data we are actually serving — `degraded()` would have
      // dropped the cache, `observed()` would claim a read that did not happen.
      if (!csv) {
        return cache
          ? degradedWith(cache.features, "no data file", cache.at)
          : degraded("no data file");
      }
      const cells = parseGpsjamCsv(csv);
      const h3 = (await import("h3-js")) as unknown as H3Lib;
      const features = gpsjamCellsToFeatures(cells, h3, day);
      cache = { features, at: Date.now() };
      return observed(features, cache.at);
    } catch {
      // Same last-good rule as the no-file path above.
      return cache
        ? degradedWith(cache.features, "fetch failed", cache.at)
        : degraded("fetch failed"); // dormant-safe
    }
  },
};
