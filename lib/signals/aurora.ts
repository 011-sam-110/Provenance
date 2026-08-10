import type { SignalFeature, SignalSource } from "@/lib/signals/types";

// NOAA SWPC OVATION aurora forecast — the modelled probability (%) of visible
// aurora on a 1°×1° global grid for the next ~30 min. Keyless JSON:
//   { "Observation Time", "Forecast Time", "Data Format", "coordinates", "type" }
// `coordinates` is a flat array of [lon, lat, aurora%] triples, lon 0–359 (wrapped
// to −180..180 here), lat −90..90 → 360 × 181 = 65,160 cells every run.
//
// WHY THE OLD THRESHOLD MADE THIS LAYER DARK: the previous version kept only cells
// at ≥50%. OVATION probabilities almost never get there. On the live 2026-08-10
// 11:10 UTC run (HTTP 200, 920,220 bytes) the GLOBAL MAXIMUM was 22% — 0 cells ≥25,
// 2,158 cells ≥10, 8,836 ≥5 — so the filter threw away the entire grid and the layer
// rendered nothing while the feed was perfectly healthy. Values only approach 50–90%
// inside a strong geomagnetic storm; a floor that high is an "aurora off" switch for
// ordinary nights.
//
// So the floor is now 5% (the honest "worth drawing" edge of the oval) and the grid
// is thinned SPATIALLY rather than by taking a global top-N: sorting 8,836 cells by
// probability and slicing the first 400 would hand back one dense clump plus an
// arbitrary slice of a tie band. Instead the survivors are bucketed onto a coarse
// 8°lon × 4°lat grid, keeping the PEAK cell of each bucket, which draws the whole
// oval in both hemispheres at a bounded point count (376 points on the 2026-08-10
// run: 162 northern, 214 southern). The cap is a backstop for storm conditions.

const ENDPOINT = "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json";
/** Cells below this viewing probability (%) are not drawn. */
const MIN_PROBABILITY = 5;
/** Downsampling bucket size in degrees — one point per bucket, the bucket's peak. */
const LON_STEP = 8;
const LAT_STEP = 4;
/** Backstop cap on the point count once bucketed (storms widen the oval). */
const MAX_POINTS = 400;

export const AURORA_ATTRIBUTION = "Aurora forecast © NOAA Space Weather Prediction Center";

export interface OvationGrid {
  "Observation Time"?: string;
  "Forecast Time"?: string;
  coordinates?: [number, number, number][];
}

export interface AuroraOptions {
  /** Minimum viewing probability (%) to draw. Default 5. */
  minProbability?: number;
  /** Downsample bucket width in degrees of longitude. Default 8. */
  lonStep?: number;
  /** Downsample bucket height in degrees of latitude. Default 4. */
  latStep?: number;
  /** Hard cap on the returned point count. Default 400. */
  cap?: number;
}

/**
 * Green ramp keyed to the probabilities OVATION actually produces (a quiet night
 * peaks near 20%, a storm reaches 60%+). Dim deep green at the faint edge of the
 * oval, near-white at storm probabilities.
 */
export function auroraColor(pct: number): string {
  if (pct >= 60) return "#ecfdf5";
  if (pct >= 40) return "#a7f3d0";
  if (pct >= 25) return "#6ee7b7";
  if (pct >= 15) return "#34d399";
  if (pct >= 8) return "#22c55e";
  return "#15803d";
}

/** OVATION longitudes run 0..359; the map wants −180..180. */
export function wrapLon(lon: number): number {
  return lon > 180 ? lon - 360 : lon;
}

/**
 * Pure: thin an OVATION grid down to one representative cell per
 * `lonStep`×`latStep` bucket — the bucket's HIGHEST probability, so the crest of
 * the oval survives. Cells under `minProbability` and malformed rows are dropped.
 * Output order is deterministic: probability descending, then latitude descending,
 * then longitude ascending. Coordinates are the real cell's, never a bucket centre.
 */
export function downsampleAurora(
  coordinates: [number, number, number][],
  minProbability: number,
  lonStep: number,
  latStep: number,
): [number, number, number][] {
  const best = new Map<string, [number, number, number]>();
  for (const cell of coordinates) {
    if (!Array.isArray(cell) || cell.length < 3) continue;
    const lon = Number(cell[0]);
    const lat = Number(cell[1]);
    const pct = Number(cell[2]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(pct)) continue;
    if (lat < -90 || lat > 90) continue;
    if (pct < minProbability) continue;
    const key = `${Math.floor(lon / lonStep)}:${Math.floor((lat + 90) / latStep)}`;
    const held = best.get(key);
    if (!held || pct > held[2]) best.set(key, [lon, lat, pct]);
  }
  return [...best.values()].sort((a, b) => b[2] - a[2] || b[1] - a[1] || a[0] - b[0]);
}

/**
 * Pure: OVATION grid → SignalFeature[]. Thresholds, spatially downsamples and caps,
 * so the result is bounded and evenly spread however active the aurora is.
 */
export function normalizeAurora(json: OvationGrid, opts: AuroraOptions = {}): SignalFeature[] {
  const minProbability = opts.minProbability ?? MIN_PROBABILITY;
  const lonStep = opts.lonStep ?? LON_STEP;
  const latStep = opts.latStep ?? LAT_STEP;
  const cap = opts.cap ?? MAX_POINTS;

  const forecast = json["Forecast Time"];
  const observed = json["Observation Time"];
  const rows = downsampleAurora(json.coordinates ?? [], minProbability, lonStep, latStep).slice(0, cap);

  const out: SignalFeature[] = [];
  for (const [rawLon, lat, pct] of rows) {
    out.push({
      id: `aurora:${rawLon}:${lat}`,
      lat,
      lon: wrapLon(rawLon),
      title: `Aurora ${pct}% likely`,
      signalId: "aurora",
      color: auroraColor(pct),
      // The forecast view labels this "forecast for", so `ts` is the time the grid
      // is VALID for, not when it was computed; the observation time rides in props.
      ts: forecast,
      props: {
        probability: `${pct}%`,
        // Sibling numeric scalar (the display string above is "NN%"): the real
        // OVATION aurora-visibility probability, so the generic monitor can rank
        // + bar it instead of the log-radius proxy.
        probabilityPct: pct,
        forecastFor: forecast ?? "—",
        ...(observed ? { observed } : {}),
      },
    });
  }
  return out;
}

export const AURORA_SOURCE: SignalSource = {
  id: "aurora",
  label: "Aurora",
  group: "Space weather",
  color: "#22c55e",
  refreshMs: 5 * 60 * 1000, // SWPC publishes a new grid every few minutes
  attribution: AURORA_ATTRIBUTION,
  kind: "forecast", // a spatial visibility FIELD → the forecast focus view (peak + where)
  // Real OVATION visibility probability (0–100%). The domain stays the full scale
  // because that is what the number means; a quiet night simply reads low.
  metric: { field: "probabilityPct", domain: [0, 100], unit: "%" },
  forecast: {
    spatial: true,
    activeNoun: "cells ≥5% likely",
    quietNote:
      "No aurora forecast right now — no cell in the OVATION grid reaches a 5% chance of a visible aurora.",
    // Bands rebased onto the probabilities OVATION really emits: a typical active
    // night peaks in the teens/twenties, and 50%+ means a geomagnetic storm.
    bands: [
      { min: 5, label: "Faint edge", color: "#15803d" },
      { min: 15, label: "Visible", color: "#22c55e" },
      { min: 30, label: "Strong", color: "#34d399" },
      { min: 50, label: "Storm-level", color: "#10b981" },
    ],
  },
  async fetch() {
    try {
      const res = await fetch(ENDPOINT, {
        headers: { "User-Agent": "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return [];
      const json = (await res.json()) as OvationGrid;
      return normalizeAurora(json);
    } catch {
      return []; // dormant-safe
    }
  },
};
