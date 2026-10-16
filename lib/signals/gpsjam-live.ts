import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { applyCap, carryCoverage } from "@/lib/signals/coverage";
import { degraded, degradedWith, observed } from "@/lib/signals/outcome";
import { gpsjamColor, gpsjamRatio, type H3Index, type H3Lib } from "@/lib/signals/gpsjam";

// GPS jamming in the last hour — computed by Provenance from live adsb.lol aircraft,
// the same way GPSJAM computes its daily grid: each aircraft reports its navigation
// accuracy (NACp); a low value means degraded GPS. The ratio is GPSJAM's
// (bad - 1) / total. adsb.lol data is ODbL 1.0.
//
// CELLS ARE H3 RESOLUTION 3 (about 12,000 km²), one step coarser than GPSJAM's daily
// grid, and that was measured, not chosen: one live read on 2026-10-16 put at most 4
// airborne aircraft in any resolution-4 cell that had a bad report, so with a
// 5-aircraft floor resolution 4 showed nothing. Resolution 3 showed the Romanian
// coast, the Black Sea and the Gulf from the same read.
//
// WHY A SECOND LAYER. `gpsJamming` (gpsjam.ts) is a 24-hour aggregate published after
// midnight UTC, so it can never show today. This one shows the last hour, from far
// fewer aircraft. Same meaning, different window and different sample size, so the
// two are kept apart rather than drawn on top of each other.
//
// HONEST LIMITS, also in the explainer:
//   • It asks adsb.lol for the mainline airliner types only (one request), so the
//     denominators are a partial sample of what is flying.
//   • The window builds up in this server's memory, one snapshot per refresh, up to
//     an hour. A cold server has one snapshot.
//   • adsb.lol rate-limits per IP and the planes layer shares the bucket. One request
//     per 10 minutes; a refusal keeps the window it has.

export const GPSJAM_LIVE_ATTRIBUTION = "GPS interference computed by Provenance from adsb.lol live aircraft (ODbL 1.0)";
const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";
const REFRESH_MS = 10 * 60_000;
const WINDOW_MS = 60 * 60_000;
/** The mainline narrowbodies and widebodies: the bulk of what flies, in one request. */
export const LIVE_TYPES = [
  "B738", "A320", "A321", "A20N", "B38M", "A21N", "B77W", "A319", "B789", "B739",
  "A359", "A333", "B788", "B737", "B763", "B752", "A332", "B744", "B77L", "B78X",
  "B772", "A388", "A339", "B748", "B39M", "B764", "B712", "MD11",
];
const URL = `https://api.adsb.lol/v2/type/${LIVE_TYPES.join(",")}`;

/** NACp below this is "bad": a 95% position bound worse than 0.1 NM. */
export const BAD_NACP = 7;
const MIN_SAMPLE = 5; // a 1-hour window sees far fewer aircraft per cell than a day
const MIN_RATIO = 0.1;
const MAX_CELLS = 200;
/** H3 resolution of this layer's cells (see the header). */
export const LIVE_RES = 3;

export interface LiveAircraft {
  hex?: string;
  lat?: number;
  lon?: number;
  nac_p?: number;
  /** Feet, or the literal "ground". */
  alt_baro?: number | string;
}

/** One aircraft in one cell. */
interface Sighting {
  cell: string;
  bad: boolean;
}

/** Pure: one adsb.lol answer → aircraft id → its cell and whether its NACp is bad.
 *  An aircraft with no NACp is not counted at all, and neither is one on the ground:
 *  parked aircraft report NACp 0 at ordinary airports (16 of 551 on the ground in one
 *  read on 2026-10-16, at Denver, Atlanta and Orlando), which is not jamming. */
export function sightings(rows: LiveAircraft[], h3: H3Index): Map<string, Sighting> {
  const out = new Map<string, Sighting>();
  for (const a of rows ?? []) {
    if (!a.hex || typeof a.nac_p !== "number" || typeof a.lat !== "number" || typeof a.lon !== "number") continue;
    if (typeof a.alt_baro !== "number") continue; // on the ground, or no altitude
    let cell: string;
    try {
      cell = h3.latLngToCell(a.lat, a.lon, LIVE_RES);
    } catch {
      continue;
    }
    out.set(a.hex, { cell, bad: a.nac_p < BAD_NACP });
  }
  return out;
}

export interface LiveCell {
  hex: string;
  good: number;
  bad: number;
  ratio: number;
}

/**
 * Pure: the snapshots in the window → interference cells. An aircraft counts once per
 * cell over the window, and as bad if it was bad in any snapshot there.
 */
export function windowCells(snapshots: Map<string, Sighting>[], cap = MAX_CELLS): LiveCell[] {
  const perCell = new Map<string, Map<string, boolean>>();
  for (const snap of snapshots) {
    for (const [id, s] of snap) {
      const m = perCell.get(s.cell) ?? new Map<string, boolean>();
      m.set(id, (m.get(id) ?? false) || s.bad);
      perCell.set(s.cell, m);
    }
  }
  const cells: LiveCell[] = [];
  for (const [hex, m] of perCell) {
    const total = m.size;
    if (total < MIN_SAMPLE) continue;
    const bad = [...m.values()].filter(Boolean).length;
    const ratio = gpsjamRatio(total - bad, bad);
    if (ratio < MIN_RATIO) continue;
    cells.push({ hex, good: total - bad, bad, ratio });
  }
  cells.sort((a, b) => b.ratio - a.ratio);
  return applyCap(cells, cap, { noun: "interference cells", rule: "the worst by interference ratio" });
}

/** Pure (given h3): cells → hexagon features. */
export function liveCellsToFeatures(cells: LiveCell[], h3: H3Lib, windowLabel: string): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const c of cells) {
    let ring: number[][];
    let center: number[];
    try {
      ring = h3.cellToBoundary(c.hex, true);
      center = h3.cellToLatLng(c.hex);
    } catch {
      continue;
    }
    const [lat, lon] = center as [number, number];
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Array.isArray(ring) || ring.length < 4) continue;
    const pct = Math.round(c.ratio * 100);
    out.push({
      id: `gpsjam-live:${c.hex}`,
      lat,
      lon,
      title: `GPS interference ${pct}% (${windowLabel})`,
      signalId: "gpsJammingLive",
      color: gpsjamColor(c.ratio),
      geometry: { type: "Polygon", coordinates: [ring as [number, number][]] },
      link: "https://adsb.lol/",
      props: {
        interference: `${pct}%`,
        interferencePct: pct,
        aircraft: c.good + c.bad,
        badReports: c.bad,
        window: windowLabel,
      },
    });
  }
  return carryCoverage(cells, out);
}

let snapshots: { at: number; s: Map<string, Sighting> }[] = [];
let lastReadAt = 0;
let lastFailAt = 0;

/** Test-only. */
export function __resetGpsjamLive(): void {
  snapshots = [];
  lastReadAt = 0;
  lastFailAt = 0;
}

export const GPS_JAMMING_LIVE_SOURCE: SignalSource = {
  id: "gpsJammingLive",
  // An H3 hexagon. The feature carries the polygon.
  precision: "area",
  label: "GPS jamming (last hour)",
  group: "Infrastructure",
  color: "#b91c1c",
  refreshMs: REFRESH_MS,
  attribution: GPSJAM_LIVE_ATTRIBUTION,
  sourceUrl: "https://adsb.lol/",
  metric: { field: "interferencePct", domain: [0, 100], unit: "%" },
  async fetch() {
    const h3 = (await import("h3-js")) as unknown as H3Lib & H3Index;
    const now = Date.now();
    let failed = false;
    if (now - lastReadAt >= REFRESH_MS && now - lastFailAt >= REFRESH_MS) {
      try {
        const res = await fetch(URL, {
          headers: { Accept: "application/json", "User-Agent": UA },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`http ${res.status}`);
        const json = (await res.json()) as { ac?: LiveAircraft[] };
        snapshots.push({ at: now, s: sightings(json.ac ?? [], h3) });
        lastReadAt = now;
      } catch {
        failed = true;
        lastFailAt = now;
      }
    }
    snapshots = snapshots.filter((x) => now - x.at <= WINDOW_MS);
    if (!snapshots.length) return degraded(failed ? "fetch failed" : "no snapshot");
    const minutes = Math.max(1, Math.round((now - snapshots[0].at) / 60_000));
    const label = snapshots.length === 1 ? "one snapshot" : `last ${minutes} min`;
    const features = liveCellsToFeatures(windowCells(snapshots.map((x) => x.s)), h3, label);
    return failed ? degradedWith(features, "fetch failed", lastReadAt) : observed(features, lastReadAt);
  },
};
