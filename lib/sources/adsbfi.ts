/**
 * adsb.fi — a second, independent community ADS-B network, for the planes layer.
 *
 * adsb.lol stays the primary (lib/sources/adsb.ts): one request covers its whole
 * network. adsb.fi has no type endpoint (`/v2/type` answers 400) and no keyless
 * whole-network file, only a point + radius query, `/api/v3/lat/{lat}/lon/{lon}/dist/{nm}`
 * with nm at most 250, and its terms allow one request per second. So it does two
 * smaller jobs here.
 *
 * 1. GAP FILL, every cycle. Where adsb.lol's receivers are thin, adsb.fi's often
 *    hear aircraft adsb.lol does not. Measured 2026-10-16 from provenance-1, against
 *    one adsb.lol type pull of 10,298 positioned aircraft, civil aircraft adsb.fi
 *    had and the pull did not, per 250 nm cell: Istanbul 45 of 140, Kolkata 28 of 56,
 *    Delhi 26 of 49, Dubai 21 of 131, Sao Paulo 15, Seoul 14, Sydney 14, Manila 12,
 *    Hong Kong 11, Tokyo 9, Mexico City 8, Bangalore 7, Cairo 7. Dense cells (Atlanta
 *    142 of 960) add more aircraft but no coverage: the spatial sample keeps each
 *    cell's share, so extra rows in a full cell are mostly sampled away. GAP_CELLS
 *    are the thin ones. They run alongside the adsb.lol request, on another host, so
 *    they cost the snapshot no adsb.lol allowance and little wall time.
 *
 * 2. FAILOVER, only when adsb.lol has not answered for FAILOVER_AFTER_MS. Then the
 *    gap cells plus FAILOVER_CELLS (the busiest hubs) are the snapshot, labelled as
 *    regional, not worldwide. Before that, the last good adsb.lol snapshot is served
 *    with its age, as it always was.
 *
 * TERMS (https://github.com/adsbfi/opendata): "for personal, non-commercial use
 * only", and "You must cite adsb.fi and include a link". Every aircraft that comes
 * from here carries `meta.network = "adsb.fi"`, and the plane dossier then credits
 * adsb.fi and links its map. If Provenance ever charges money, this module goes.
 *
 * Military-flagged rows (dbFlags bit 1) are dropped: the military-air signal layer
 * already draws them, and drawing them twice would double-count.
 */

import type { WorldObject } from "@/lib/world";
import { adsbRowToWorldObject, type AdsbRow } from "@/lib/sources/adsb";
import { sampleSpatially } from "@/lib/planes/sample";
import { withCoverage } from "@/lib/signals/coverage";
import { laneFetch } from "@/lib/http/hostLane";

export const ADSBFI_CREDIT = "adsb.fi (non-commercial use)";
export const ADSBFI_RADIUS_NM = 250;
/** A position older than this, in the network's own `seen_pos`, is not drawn. */
export const MAX_POSITION_AGE_S = 60;

export interface FiCell {
  name: string;
  lat: number;
  lon: number;
}

/** Thin-coverage cells, in measured order of what they add (see the header). */
export const GAP_CELLS: readonly FiCell[] = [
  { name: "Istanbul", lat: 41.0, lon: 29.0 },
  { name: "Kolkata", lat: 22.6, lon: 88.4 },
  { name: "Delhi", lat: 28.6, lon: 77.2 },
  { name: "Dubai", lat: 25.2, lon: 55.3 },
  { name: "Sao Paulo", lat: -23.5, lon: -46.6 },
  { name: "Seoul", lat: 37.5, lon: 127.0 },
  { name: "Sydney", lat: -33.9, lon: 151.2 },
  { name: "Manila", lat: 14.5, lon: 121.0 },
  { name: "Hong Kong", lat: 22.3, lon: 114.2 },
  { name: "Tokyo", lat: 35.7, lon: 139.7 },
  { name: "Mexico City", lat: 19.4, lon: -99.1 },
  { name: "Bangalore", lat: 13.0, lon: 77.6 },
  { name: "Cairo", lat: 30.0, lon: 31.2 },
];

/** The busiest hubs, asked only in failover, after GAP_CELLS. */
export const FAILOVER_CELLS: readonly FiCell[] = [
  { name: "Atlanta", lat: 33.7, lon: -84.4 },
  { name: "New York", lat: 40.7, lon: -74.0 },
  { name: "Chicago", lat: 41.9, lon: -87.6 },
  { name: "Los Angeles", lat: 34.0, lon: -118.2 },
  { name: "Dallas", lat: 32.9, lon: -97.0 },
  { name: "Denver", lat: 39.8, lon: -104.7 },
  { name: "Miami", lat: 25.8, lon: -80.3 },
  { name: "Seattle", lat: 47.4, lon: -122.3 },
  { name: "Toronto", lat: 43.7, lon: -79.6 },
  { name: "London", lat: 51.5, lon: -0.1 },
  { name: "Frankfurt", lat: 50.0, lon: 8.6 },
  { name: "Paris", lat: 49.0, lon: 2.5 },
  { name: "Madrid", lat: 40.5, lon: -3.6 },
  { name: "Rome", lat: 41.8, lon: 12.3 },
  { name: "Warsaw", lat: 52.2, lon: 21.0 },
  { name: "Stockholm", lat: 59.6, lon: 17.9 },
  { name: "Johannesburg", lat: -26.1, lon: 28.2 },
  { name: "Buenos Aires", lat: -34.6, lon: -58.4 },
  { name: "Bangkok", lat: 13.7, lon: 100.7 },
  { name: "Singapore", lat: 1.35, lon: 103.9 },
  { name: "Beijing", lat: 40.0, lon: 116.4 },
  { name: "Shanghai", lat: 31.2, lon: 121.5 },
];

export const cellUrl = (c: FiCell): string =>
  `https://opendata.adsb.fi/api/v3/lat/${c.lat}/lon/${c.lon}/dist/${ADSBFI_RADIUS_NM}`;

/** Is this adsb.fi row worth drawing on the planes layer? Pure. */
function usable(row: AdsbRow): boolean {
  if (typeof row.dbFlags === "number" && (row.dbFlags & 1) === 1) return false; // military-air draws it
  if (typeof row.seen_pos === "number" && row.seen_pos > MAX_POSITION_AGE_S) return false;
  return true;
}

/** Pure: adsb.fi rows → planes-layer objects, each marked as adsb.fi's. */
export function adsbFiRowsToObjects(rows: readonly AdsbRow[]): WorldObject[] {
  const out: WorldObject[] = [];
  for (const row of rows) {
    if (!usable(row)) continue;
    const o = adsbRowToWorldObject(row);
    if (o) out.push({ ...o, meta: { ...o.meta, network: "adsb.fi" } });
  }
  return out;
}

/**
 * Pure: add the aircraft `extra` has and `primary` lacks, by id. The primary's row
 * always wins, so an aircraft adsb.lol saw keeps adsb.lol's position and credit.
 */
export function mergeGapFill(
  primary: readonly WorldObject[],
  extra: readonly WorldObject[],
): { objects: WorldObject[]; added: number } {
  const seen = new Set(primary.map((o) => o.id));
  const objects = primary.slice();
  let added = 0;
  for (const o of extra) {
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    objects.push(o);
    added++;
  }
  return { objects, added };
}

export interface SweepResult {
  objects: WorldObject[];
  cellsPlanned: number;
  cellsAttempted: number;
  cellsSucceeded: number;
  /** Names of the cells that answered, for the coverage rule. */
  answered: string[];
}

export interface SweepDeps {
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
  /** Epoch ms after which no new cell is started. */
  deadline: number;
}

const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";
const CELL_TIMEOUT_MS = 8_000;
const MIN_CELL_MS = 1_500;

/**
 * Ask the cells one after another (laneFetch spaces them at adsb.fi's one request per
 * second) until the deadline. A failed cell is counted and logged, never thrown: one
 * refused cell must not cost the others, and this whole job is optional.
 */
export async function fetchAdsbFiCells(cells: readonly FiCell[], deps: SweepDeps): Promise<SweepResult> {
  const fetchImpl = deps.fetchImpl ?? laneFetch;
  const now = deps.now ?? Date.now;
  const seen = new Set<string>();
  const objects: WorldObject[] = [];
  const answered: string[] = [];
  let attempted = 0;
  let failed = 0;
  for (const cell of cells) {
    const left = deps.deadline - now();
    if (left < MIN_CELL_MS) break;
    attempted++;
    try {
      const res = await fetchImpl(cellUrl(cell), {
        headers: { Accept: "application/json", "User-Agent": UA },
        signal: AbortSignal.timeout(Math.min(CELL_TIMEOUT_MS, left)),
      });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const json = (await res.json()) as { ac?: AdsbRow[] };
      for (const o of adsbFiRowsToObjects(json.ac ?? [])) {
        if (seen.has(o.id)) continue; // neighbouring cells overlap
        seen.add(o.id);
        objects.push(o);
      }
      answered.push(cell.name);
    } catch (err) {
      failed++;
      console.warn(`adsb.fi cell ${cell.name} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (failed) console.warn(`adsb.fi: ${failed} of ${attempted} cells failed`);
  return { objects, cellsPlanned: cells.length, cellsAttempted: attempted, cellsSucceeded: answered.length, answered };
}

/** Failover is for an outage, not a blip: before this, the last good adsb.lol snapshot is served with its age. */
export const FAILOVER_AFTER_MS = 10 * 60 * 1000;
/** A failover snapshot smaller than this is not worth replacing an empty layer's honesty with. */
export const MIN_FAILOVER_AIRCRAFT = 500;

/** Pure: should this cycle fail over to adsb.fi? `lastOkAt` is adsb.lol's last good pull in this process. */
export function shouldFailOver(lastOkAt: number | null, now: number): boolean {
  return lastOkAt == null || now - lastOkAt > FAILOVER_AFTER_MS;
}

/**
 * Pure: a failover sweep → the served set, capped as a spatial sample, with a coverage
 * record that says it is regional. `available` is never exact: it is what the asked
 * cells' receivers heard, not what is flying.
 */
export function sweepToObjects(sweep: SweepResult, cap: number): WorldObject[] {
  const capped = Number.isFinite(cap) && cap > 0 && sweep.objects.length > cap;
  const out = capped ? sampleSpatially(sweep.objects, cap) : sweep.objects.slice();
  return withCoverage(out, {
    available: sweep.objects.length,
    availableExact: false,
    capped: true,
    ...(capped ? { cap } : {}),
    noun: "aircraft",
    rule:
      `adsb.lol did not answer, so ${capped ? "a proportional spatial sample of " : ""}aircraft heard by ` +
      `adsb.fi's community receivers within ${ADSBFI_RADIUS_NM} nm of ${sweep.cellsSucceeded} of ` +
      `${sweep.cellsPlanned} cities - regional, not worldwide, and a lower bound`,
  });
}
