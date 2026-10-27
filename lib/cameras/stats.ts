// The camera stats behind the top bar's strip and its breakdown (GET /api/camera-stats).
//
// PURE. The route hands it the registry's cameras with each one's `live` flag already
// decided by the play check (lib/liveness/playcheck.ts), the feed health, the play-check
// summary and the webcam manifest; this turns them into one object. Every figure carries
// its own time (`at`) and a source line, because each one moves: the road count is a
// sum over ~50 operator feeds, the play check runs on its own clock, and the webcam
// count is a catalogue harvested on a date of its own.
//
// What is NOT here, on purpose: no "picture age" (nothing measures it yet), no "video
// online" figure, and no visitor numbers of any kind.

import { CAMERA_REGIONS_ORDER, continentOf, type CameraRegion } from "@/lib/cameras/continents";
import type { PlayCheckSummary } from "@/lib/liveness/playcheck";

/** Where the webcam count comes from. The strip shows it even when the road count failed. */
export const WEBCAMS_SOURCE = "Windy's webcam catalogue, harvested into this site's static webcam layer";

/** A road count older than this is shown as stale (its time in the warning colour). */
export const STATS_STALE_MS = 15 * 60 * 1000;

/** What the builder needs from each registry camera. */
export interface StatsCamera {
  source: string;
  country: string;
  /** Decided by the play check: the stream played at its last check (or the warm-up rule). */
  live: boolean;
  refreshSeconds: number;
  license: string;
}

export interface StatsFeedHealth {
  key: string;
  ok: boolean;
  dormant?: boolean;
}

export interface RegionRow {
  region: CameraRegion;
  video: number;
  stills: number;
  /** Distinct countries with at least one camera in this region. */
  countries: number;
  /** Those countries, most cameras first, for the tooltips. */
  byCountry: { country: string; video: number; stills: number }[];
}

export interface RefreshBucket {
  /** "1 min or less", "2 min", "3 to 5 min", "6 to 9 min", "10 min or more". */
  label: string;
  count: number;
}

export interface OperatorRow {
  /** The feed key (`Camera.source`). */
  key: string;
  name: string;
  /** The licence text the operator's cameras carry (the most common one). */
  license: string;
  /** False when that text says the operator states no licence. */
  licenceStated: boolean;
  cameras: number;
  video: number;
  /** Median of the operator's stated refresh intervals, over its stills; null with none. */
  refreshSeconds: number | null;
}

export interface CameraStats {
  /** When this object was built (ms epoch). */
  generatedAt: number;
  road: {
    /** When the registry last refreshed (ms epoch); null before its first refresh. */
    at: number | null;
    source: string;
    total: number;
    /** Cameras shown as video: the stream played at its last check (see `play.warm`). */
    video: number;
    stills: number;
    countries: number;
    /** Operator feeds that answered at the last refresh. */
    operators: number;
    /** Operator feeds registered, dormant ones included. */
    feeds: number;
    regions: RegionRow[];
    /** Country codes the continent table does not know (counted in no region). */
    unplaced: string[];
  };
  refresh: {
    at: number | null;
    source: string;
    /** Median stated refresh interval over the stills, in seconds. */
    medianSeconds: number | null;
    mix: RefreshBucket[];
  };
  play: PlayCheckSummary & {
    /** The newest check in the window (ms epoch), or null before any verdict. */
    at: number | null;
    source: string;
  };
  webcams: {
    /** When the catalogue was harvested (ms epoch), or null when it could not be read. */
    at: number | null;
    source: string;
    count: number | null;
  };
  operators: {
    at: number | null;
    source: string;
    licenceStated: number;
    noLicence: number;
    rows: OperatorRow[];
  };
}

export interface StatsInput {
  cams: readonly StatsCamera[];
  registryAt: number | null;
  health: readonly StatsFeedHealth[];
  feedCount: number;
  play: PlayCheckSummary;
  webcams: { count: number | null; at: number | null };
  names: Readonly<Record<string, string>>;
  now: number;
}

/** The middle value; the mean of the two middle values for an even count. Rounded. */
export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return Math.round(s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
}

/** The refresh buckets in display order. "6 to 9 min" shows only when it holds cameras. */
const BUCKETS: readonly { label: string; upTo: number; optional?: boolean }[] = [
  { label: "1 min or less", upTo: 60 },
  { label: "2 min", upTo: 120 },
  { label: "3 to 5 min", upTo: 300 },
  { label: "6 to 9 min", upTo: 599.999, optional: true },
  { label: "10 min or more", upTo: Infinity },
];

/** Count stated refresh intervals into the buckets above. */
export function refreshMix(seconds: readonly number[]): RefreshBucket[] {
  const counts = BUCKETS.map(() => 0);
  for (const s of seconds) {
    const i = BUCKETS.findIndex((b) => s <= b.upTo);
    counts[i === -1 ? BUCKETS.length - 1 : i]++;
  }
  return BUCKETS.map((b, i) => ({ label: b.label, count: counts[i], optional: b.optional }))
    .filter((b) => !b.optional || b.count > 0)
    .map(({ label, count }) => ({ label, count }));
}

/** True when a count is older than STATS_STALE_MS, or has no time at all. */
export function isStale(at: number | null, now: number): boolean {
  return at === null || now - at > STATS_STALE_MS;
}

/** Operator-written licence lines that say there is no licence ("No licence stated by …"). */
const NO_LICENCE = /\bno stated licen[cs]e\b|\bno licen[cs]e stated\b/i;

export function licenceIsStated(text: string): boolean {
  return !NO_LICENCE.test(text);
}

function mostCommon(values: readonly string[]): string {
  const n = new Map<string, number>();
  for (const v of values) n.set(v, (n.get(v) ?? 0) + 1);
  let best = "";
  let bestN = -1;
  for (const [v, c] of n) if (c > bestN) [best, bestN] = [v, c];
  return best;
}

export function buildCameraStats(input: StatsInput): CameraStats {
  const { cams, registryAt, health, feedCount, play, webcams, names, now } = input;

  let video = 0;
  const countries = new Set<string>();
  const stillRefresh: number[] = [];
  type Split = { video: number; stills: number };
  const region = new Map<CameraRegion, Split & { countries: Map<string, Split> }>();
  for (const r of CAMERA_REGIONS_ORDER) region.set(r, { video: 0, stills: 0, countries: new Map() });
  const unplaced = new Set<string>();
  const ops = new Map<string, { cameras: number; video: number; refresh: number[]; licences: string[] }>();

  for (const c of cams) {
    const country = c.country.toUpperCase();
    countries.add(country);
    if (c.live) video++;
    else stillRefresh.push(c.refreshSeconds);

    const cont = continentOf(country);
    if (cont) {
      const row = region.get(cont)!;
      let split = row.countries.get(country);
      if (!split) row.countries.set(country, (split = { video: 0, stills: 0 }));
      if (c.live) {
        row.video++;
        split.video++;
      } else {
        row.stills++;
        split.stills++;
      }
    } else {
      unplaced.add(country);
    }

    let op = ops.get(c.source);
    if (!op) ops.set(c.source, (op = { cameras: 0, video: 0, refresh: [], licences: [] }));
    op.cameras++;
    if (c.live) op.video++;
    else op.refresh.push(c.refreshSeconds);
    op.licences.push(c.license);
  }

  const answered = health.filter((h) => h.ok && !h.dormant).length;
  const regions: RegionRow[] = CAMERA_REGIONS_ORDER.map((r) => {
    const row = region.get(r)!;
    const byCountry = [...row.countries.entries()]
      .map(([country, n]) => ({ country, video: n.video, stills: n.stills }))
      .sort((a, b) => b.video + b.stills - (a.video + a.stills) || a.country.localeCompare(b.country));
    return { region: r, video: row.video, stills: row.stills, countries: byCountry.length, byCountry };
  });

  const rows: OperatorRow[] = [...ops.entries()]
    .map(([key, o]) => {
      const license = mostCommon(o.licences);
      return {
        key,
        name: names[key] ?? key,
        license,
        licenceStated: licenceIsStated(license),
        cameras: o.cameras,
        video: o.video,
        refreshSeconds: medianOf(o.refresh),
      };
    })
    .sort((a, b) => b.cameras - a.cameras || a.name.localeCompare(b.name));

  const stated = rows.filter((r) => r.licenceStated).length;

  return {
    generatedAt: now,
    road: {
      at: registryAt,
      source: `Road and public operator feeds read by this server: ${answered} of ${feedCount} answered at the last refresh`,
      total: cams.length,
      video,
      stills: cams.length - video,
      countries: countries.size,
      operators: answered,
      feeds: feedCount,
      regions,
      unplaced: [...unplaced].sort(),
    },
    refresh: {
      at: registryAt,
      source: "The refresh interval each operator states for each still camera",
      medianSeconds: medianOf(stillRefresh),
      mix: refreshMix(stillRefresh),
    },
    play: {
      ...play,
      at: play.windowTo,
      source: `This server's play check: each listed stream is read twice and its newest segment asked for, every ${Math.round(play.cycleMs / 3_600_000)} h`,
    },
    webcams: {
      at: webcams.at,
      source: WEBCAMS_SOURCE,
      count: webcams.count,
    },
    operators: {
      at: registryAt,
      source: "Each operator's own camera records: licence text, cameras, stated refresh",
      licenceStated: stated,
      noLicence: rows.length - stated,
      rows,
    },
  };
}
