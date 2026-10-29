import type { SignalFeature, SignalGeometry, SignalSource } from "@/lib/signals/types";
import { degraded, degradedWith, observed } from "@/lib/signals/outcome";
import { newestChange, type RoadNotice } from "@/lib/roads/notice";
import { simplifyLine } from "@/lib/roads/lines";
import { TFL_CREDIT, TFL_DISRUPTIONS_URL, TFL_NAME, normalizeTflNotices } from "@/lib/roads/tfl";
import { DRIVEBC_CREDIT, DRIVEBC_EVENTS_URL, DRIVEBC_HOME, DRIVEBC_NAME, normalizeOpen511 } from "@/lib/roads/open511";
import { NSW_CREDIT, NSW_FEEDS, NSW_HOME, NSW_NAME, normalizeNswHazards, nswFeedUrl } from "@/lib/roads/nsw";
import {
  DIGITRAFFIC_CREDIT,
  DIGITRAFFIC_HOME,
  DIGITRAFFIC_NAME,
  DIGITRAFFIC_USER,
  digitrafficUrl,
  normalizeDigitraffic,
} from "@/lib/roads/digitraffic";
import {
  CASTLEROCK_ROADS_CREDIT,
  CASTLEROCK_SYSTEMS,
  LAYERS_SERVED,
  loadCastleRockLayer,
} from "@/lib/roads/castlerock";

// ── Road notices: three console layers from the road operators' own feeds ──────
//
// What each operator says about its roads, split by what it is:
//
//   road-works      planned works on a road, drawn as dashes
//   road-incidents  everything else the operator lists (collisions, hazards, police
//                   activity, signal faults, washouts), drawn as dots
//   road-closures   only the roads the operator marks closed, drawn as bars
//
// The operators, each keyless and read by the server only:
//   TfL      London's roads (lib/roads/tfl.ts), "Powered by TfL Open Data"
//   DriveBC  British Columbia's highways, Open511 (lib/roads/open511.ts), OGL-BC
//   TfNSW    New South Wales, Live Traffic NSW's six hazard files (lib/roads/nsw.ts), CC BY
//   Fintraffic  Finland, Digitraffic road works and traffic announcements
//               (lib/roads/digitraffic.ts), CC BY 4.0
//   511      the nine Castle Rock systems (Florida, Georgia, Idaho, Louisiana, New
//            England, Ontario, Alberta, Nova Scotia, New Brunswick), each its own
//            operator, read every 10 minutes (lib/roads/castlerock.ts)
//
// A NOTICE IS NEVER A SPEED, so none of the three is ever a solid line: the console's
// solid signal line is a cable or a route, and a solid road line will be a measured
// speed. The line style rides on each feature (`SignalFeature.line`).
//
// One notice can feed two layers: a works notice that closes one stretch and leaves
// the next open is a "works" line for the open stretch and a "closure" line for the
// closed one, because that is what the operator says about each road.
//
// TIME. Each feature's `ts` is its operator's own last change to that notice, and the
// read passes the newest change of all as the data's "as of" (observed's sourceAt), so
// the freshness line can say how old the notices are, not only when they were fetched.
//
// ONE OPERATOR DOWN IS NOT ALL DOWN. Each operator, and each of its files, is read apart.
// When one does not answer, the others' notices are still drawn and the layer says which
// one is missing.

export const ROADS_GROUP = "Roads";
const REFRESH_MS = 120_000;
/** One read of a file serves all three layers for this long, unless the file says longer. */
const SHARED_READ_MS = 60_000;
const FETCH_TIMEOUT_MS = 15_000;

/** Light-skin colours, each readable on the light basemap and on satellite. */
export const ROAD_WORKS_COLOR = "#e11d48";
export const ROAD_INCIDENTS_COLOR = "#7e22ce";
export const ROAD_CLOSURES_COLOR = "#be123c";

export type RoadLayer = "works" | "incidents" | "closures";

/** One file an operator publishes, and how to read it. */
export interface RoadFeed {
  /** How a "did not answer" names it, e.g. "roadwork". */
  name: string;
  url: string;
  normalize(raw: unknown): RoadNotice[];
  /** Read it again after this long; a big file is read less often. Default 60 s. */
  everyMs?: number;
  /** Headers the operator asks for, e.g. Digitraffic's Digitraffic-User. */
  headers?: Record<string, string>;
  /**
   * Reads the file itself, for an operator that needs more than one request per file
   * (Castle Rock: list pages, then the map points). `url` then only names it for the cache.
   */
  load?: () => Promise<RoadNotice[] | null>;
}

/** One road operator: its files, and how its notices are named and credited. */
export interface RoadOperator {
  /** The feature id prefix, e.g. "tfl" in "tfl:TIMS-237054". */
  key: string;
  /** How the words name it: "TfL", "DriveBC". */
  name: string;
  /** The credit its terms ask for. */
  credit: string;
  /** Where a reader can check a notice: the operator's own traffic page. */
  home: string;
  feeds: readonly RoadFeed[];
  /**
   * The box its roads lie in, [west, south, east, north] in degrees. A camera's road line
   * (lib/roads/nearCamera.ts) reads only the operators whose box holds the camera.
   */
  area: readonly [number, number, number, number];
}

export const TFL_OPERATOR: RoadOperator = {
  key: "tfl",
  name: TFL_NAME,
  credit: TFL_CREDIT,
  home: "https://tfl.gov.uk/traffic/status/",
  feeds: [{ name: "road disruptions", url: TFL_DISRUPTIONS_URL, normalize: normalizeTflNotices }],
  area: [-0.53, 51.27, 0.34, 51.7],
};

export const DRIVEBC_OPERATOR: RoadOperator = {
  key: "bc",
  name: DRIVEBC_NAME,
  credit: DRIVEBC_CREDIT,
  home: DRIVEBC_HOME,
  feeds: [{ name: "events", url: DRIVEBC_EVENTS_URL, normalize: normalizeOpen511 }],
  area: [-139.1, 48.2, -114, 60.1],
};

export const NSW_OPERATOR: RoadOperator = {
  key: "nsw",
  name: NSW_NAME,
  credit: NSW_CREDIT,
  home: NSW_HOME,
  feeds: NSW_FEEDS.map((feed) => ({ name: feed, url: nswFeedUrl(feed), normalize: (raw: unknown) => normalizeNswHazards(raw, feed) })),
  // New South Wales, with the ACT inside it.
  area: [140.9, -37.6, 153.7, -28.1],
};

export const DIGITRAFFIC_OPERATOR: RoadOperator = {
  key: "fi",
  name: DIGITRAFFIC_NAME,
  credit: DIGITRAFFIC_CREDIT,
  home: DIGITRAFFIC_HOME,
  feeds: [
    // 5.9 MB on 27 Oct 2026: read every 10 minutes, not every minute.
    { name: "road works", url: digitrafficUrl("ROAD_WORK"), normalize: normalizeDigitraffic, everyMs: 600_000, headers: { "Digitraffic-User": DIGITRAFFIC_USER } },
    { name: "announcements", url: digitrafficUrl("TRAFFIC_ANNOUNCEMENT"), normalize: normalizeDigitraffic, headers: { "Digitraffic-User": DIGITRAFFIC_USER } },
  ],
  area: [19, 59.6, 31.7, 70.1],
};

/** Each Castle Rock system's state or province, [west, south, east, north]. */
const CASTLEROCK_AREAS: Readonly<Record<string, readonly [number, number, number, number]>> = {
  fl: [-87.7, 24.4, -79.9, 31.1],
  ga: [-85.7, 30.3, -80.8, 35.1],
  id: [-117.3, 41.9, -111, 49.1],
  // Maine, New Hampshire and Vermont.
  newengland: [-73.5, 42.6, -66.8, 47.5],
  la: [-94.1, 28.9, -88.8, 33.1],
  on: [-95.2, 41.6, -74.3, 56.9],
  ab: [-120.1, 48.9, -109.9, 60.1],
  ns: [-66.4, 43.3, -59.6, 47.1],
  nb: [-69.1, 44.5, -63.7, 48.1],
};

/** Each Castle Rock system is its own operator: its own agency names and links its rows. */
export const CASTLEROCK_OPERATORS: readonly RoadOperator[] = CASTLEROCK_SYSTEMS.map((sys) => ({
  key: `cr-${sys.system}`,
  name: sys.agency,
  credit: CASTLEROCK_ROADS_CREDIT,
  home: `https://${sys.site}/`,
  feeds: (LAYERS_SERVED[sys.system] ?? []).map((layer) => ({
    name: layer.toLowerCase(),
    url: `https://${sys.site}/List/GetData/${layer}`,
    normalize: () => [],
    // Pages plus map points per read, on hosts the camera adapter also reads.
    everyMs: 600_000,
    load: () => loadCastleRockLayer(sys, layer),
  })),
  area: CASTLEROCK_AREAS[sys.system] ?? [0, 0, 0, 0],
}));

export const ROAD_OPERATORS: readonly RoadOperator[] = [
  TFL_OPERATOR,
  DRIVEBC_OPERATOR,
  NSW_OPERATOR,
  DIGITRAFFIC_OPERATOR,
  ...CASTLEROCK_OPERATORS,
];

/** Every operator's credit once, in operator order: the layers' attribution. */
export const ROADS_ATTRIBUTION = [...new Set(ROAD_OPERATORS.map((op) => op.credit))].join(". ") + ".";

const multi = (lines: [number, number][][]): SignalGeometry | undefined =>
  lines.length === 0 ? undefined : lines.length === 1 ? { type: "LineString", coordinates: lines[0] } : { type: "MultiLineString", coordinates: lines };

/**
 * The map label: the operator's sub-category and the road. The road is the one the
 * operator names, else the start of its own location, up to the postcodes and the
 * borough ("Utility works, [A12] EASTERN AVENUE EAST"). The dossier keeps the whole
 * location.
 */
export function roadTitle(n: RoadNotice): string {
  const street = n.street ?? n.location?.split(" - ")[0].split(" (")[0].trim();
  return [n.subCategory ?? n.category, street].filter(Boolean).join(", ");
}

/** The dossier's rows: the operator's own words, and its own time. */
function noticeProps(n: RoadNotice, op: RoadOperator): Record<string, unknown> {
  return {
    // `agency` names the record's publisher on the dossier's source chip.
    agency: op.name,
    category: n.category,
    ...(n.subCategory ? { subCategory: n.subCategory } : {}),
    severity: n.severity,
    ...(n.closure ? { closure: n.closure } : {}),
    ...(n.location ? { location: n.location } : {}),
    ...(n.description && n.description !== n.location ? { description: n.description } : {}),
    ...(n.updated ? { lastChange: n.updated } : {}),
  };
}

/**
 * Pure: one layer's features from one operator's notices. A notice with no road line is
 * a point at the operator's own point; a notice whose roads this layer does not draw is
 * left out of it.
 */
export function roadLayerFeatures(
  notices: readonly RoadNotice[],
  layer: RoadLayer,
  op: RoadOperator = TFL_OPERATOR,
): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const n of notices) {
    const hasLines = n.openLines.length + n.closedLines.length > 0;
    let lines: [number, number][][];
    if (layer === "closures") {
      if (!n.closure) continue;
      lines = n.closedLines;
    } else {
      if ((layer === "works") !== (n.kind === "works")) continue;
      // A notice whose every road is closed is drawn by the closures layer alone, and
      // so is a closing notice with no road line: one point, not two on one spot.
      if (hasLines && n.openLines.length === 0) continue;
      if (!hasLines && n.closure) continue;
      lines = n.openLines;
    }
    // No finer than the map can show (lib/roads/lines.ts).
    const geometry = multi(lines.map((l) => simplifyLine(l)));
    out.push({
      id: `${op.key}:${n.id}${layer === "closures" ? ":closed" : ""}`,
      lat: n.lat,
      lon: n.lon,
      title: roadTitle(n),
      signalId: `road-${layer}`,
      link: op.home,
      ...(geometry ? { geometry, line: layer === "closures" ? "bar" : layer === "works" ? "dash" : "dot" } : {}),
      props: noticeProps(n, op),
      ...(n.updated ? { ts: n.updated } : {}),
    });
  }
  return out;
}

/** One operator's read: the notices of the files that answered, and the files that did not. */
interface OperatorRead {
  notices: RoadNotice[];
  missing: string[];
}

// ON globalThis, NOT IN THIS MODULE. Each Next route is bundled with its own copy of this
// module, so a module-level Map would give /api/camera-road its own reads of every
// operator beside /api/signals/[id]'s. One map per server process means one read of
// each file, whichever route asks first.
const g = globalThis as unknown as { __pvRoadReads?: Map<string, { at: number; notices: Promise<RoadNotice[] | null> }> };
const shared = (g.__pvRoadReads ??= new Map());

/** One file, shared by the three layers for its `everyMs`; null when it did not answer. Never throws. */
function readFeed(feed: RoadFeed): Promise<RoadNotice[] | null> {
  const now = Date.now();
  const hit = shared.get(feed.url);
  if (hit && now - hit.at < (feed.everyMs ?? SHARED_READ_MS)) return hit.notices;
  const notices = feed.load
    ? feed.load().catch(() => null)
    : fetch(feed.url, {
        headers: { Accept: "application/json", ...feed.headers },
        cache: "no-store",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((raw) => (raw == null ? null : feed.normalize(raw)))
        .catch(() => null);
  shared.set(feed.url, { at: now, notices });
  return notices;
}

/** One operator for the three layers; null when none of its files answered. */
async function readOperator(op: RoadOperator): Promise<OperatorRead | null> {
  const lists = await Promise.all(op.feeds.map(readFeed));
  const missing = op.feeds.filter((_, i) => lists[i] == null).map((f) => f.name);
  if (missing.length === op.feeds.length) return null;
  return { notices: lists.flatMap((l) => l ?? []), missing };
}

/** True when the operator's area holds this point. */
export function operatorCovers(op: Pick<RoadOperator, "area">, lat: number, lon: number): boolean {
  const [w, s, e, n] = op.area;
  return lon >= w && lon <= e && lat >= s && lat <= n;
}

/** One operator's notices for one place, and when they were read. */
export interface OperatorNotices {
  op: RoadOperator;
  notices: RoadNotice[];
  /** The oldest read of its files that this answer used, epoch ms. */
  readAt: number;
}

/** The operators whose area holds the point. */
export function operatorsAt(lat: number, lon: number): RoadOperator[] {
  return ROAD_OPERATORS.filter((op) => operatorCovers(op, lat, lon));
}

/**
 * The notices of these operators, through the same shared reads as the three layers.
 * An operator none of whose files answered is left out.
 */
export async function noticesOf(ops: readonly RoadOperator[]): Promise<OperatorNotices[]> {
  const reads = await Promise.all(
    ops.map(async (op) => {
      const read = await readOperator(op);
      const readAt = Math.min(...op.feeds.map((f) => shared.get(f.url)?.at ?? Date.now()));
      return read ? { op, notices: read.notices, readAt } : null;
    }),
  );
  return reads.filter((r): r is OperatorNotices => r != null);
}

/** "TfL", or "Transport for NSW (flood)" when only some of its files did not answer. */
function missingName(op: RoadOperator, missing: string[]): string {
  return missing.length === op.feeds.length ? op.name : `${op.name} (${missing.join(", ")})`;
}

/** A failure reason is kept short (tests/unit/signals-outcome.test.ts caps it at 80). */
const REASON_MAX = 80;

/**
 * "TfL did not answer", "TfL and DriveBC did not answer", "A, B and C did not answer";
 * past 80 characters, "TfL and 12 more did not answer".
 */
export function notAnswered(names: string[]): string {
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  const full = `${list} did not answer`;
  if (full.length <= REASON_MAX) return full;
  const short = `${names[0]} and ${names.length - 1} more did not answer`;
  return short.length <= REASON_MAX ? short : `${names.length} road operators did not answer`;
}

function roadSource(layer: RoadLayer, label: string, color: string): SignalSource {
  return {
    id: `road-${layer}`,
    kind: "event",
    // The operator's own road lines, or its own point for a notice it gave no line.
    precision: "exact",
    label,
    group: ROADS_GROUP,
    color,
    refreshMs: REFRESH_MS,
    attribution: ROADS_ATTRIBUTION,
    async fetch() {
      const reads = await Promise.all(ROAD_OPERATORS.map(async (op) => ({ op, read: await readOperator(op) })));
      const missing: string[] = [];
      for (const r of reads) {
        if (r.read == null) missing.push(r.op.name);
        else if (r.read.missing.length > 0) missing.push(missingName(r.op, r.read.missing));
      }
      const answered = reads.filter((r) => r.read != null) as { op: RoadOperator; read: OperatorRead }[];
      if (answered.length === 0) return degraded(notAnswered(missing));
      const features = answered.flatMap((r) => roadLayerFeatures(r.read.notices, layer, r.op));
      if (missing.length > 0) return degradedWith(features, notAnswered(missing));
      return observed(features, Date.now(), newestChange(answered.flatMap((r) => r.read.notices)) ?? undefined);
    },
  };
}

export const ROAD_WORKS_SOURCE = roadSource("works", "Roadworks", ROAD_WORKS_COLOR);
export const ROAD_INCIDENTS_SOURCE = roadSource("incidents", "Road incidents", ROAD_INCIDENTS_COLOR);
export const ROAD_CLOSURES_SOURCE = roadSource("closures", "Road closures", ROAD_CLOSURES_COLOR);
