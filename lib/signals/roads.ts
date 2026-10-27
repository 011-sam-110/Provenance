import type { SignalFeature, SignalGeometry, SignalSource } from "@/lib/signals/types";
import { degraded, degradedWith, observed } from "@/lib/signals/outcome";
import { newestChange, type RoadNotice } from "@/lib/roads/notice";
import { TFL_CREDIT, TFL_DISRUPTIONS_URL, TFL_NAME, normalizeTflNotices } from "@/lib/roads/tfl";
import { DRIVEBC_CREDIT, DRIVEBC_EVENTS_URL, DRIVEBC_HOME, DRIVEBC_NAME, normalizeOpen511 } from "@/lib/roads/open511";
import { NSW_CREDIT, NSW_FEEDS, NSW_HOME, NSW_NAME, normalizeNswHazards, nswFeedUrl } from "@/lib/roads/nsw";

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
/** One read of each operator serves all three layers for this long. */
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
}

export const TFL_OPERATOR: RoadOperator = {
  key: "tfl",
  name: TFL_NAME,
  credit: TFL_CREDIT,
  home: "https://tfl.gov.uk/traffic/status/",
  feeds: [{ name: "road disruptions", url: TFL_DISRUPTIONS_URL, normalize: normalizeTflNotices }],
};

export const DRIVEBC_OPERATOR: RoadOperator = {
  key: "bc",
  name: DRIVEBC_NAME,
  credit: DRIVEBC_CREDIT,
  home: DRIVEBC_HOME,
  feeds: [{ name: "events", url: DRIVEBC_EVENTS_URL, normalize: normalizeOpen511 }],
};

export const NSW_OPERATOR: RoadOperator = {
  key: "nsw",
  name: NSW_NAME,
  credit: NSW_CREDIT,
  home: NSW_HOME,
  feeds: NSW_FEEDS.map((feed) => ({ name: feed, url: nswFeedUrl(feed), normalize: (raw: unknown) => normalizeNswHazards(raw, feed) })),
};

export const ROAD_OPERATORS: readonly RoadOperator[] = [TFL_OPERATOR, DRIVEBC_OPERATOR, NSW_OPERATOR];

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
    const geometry = multi(lines);
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

const shared = new Map<string, { at: number; read: Promise<OperatorRead | null> }>();

/** One file; null when it did not answer. Never throws. */
function readFeed(feed: RoadFeed): Promise<RoadNotice[] | null> {
  return fetch(feed.url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((raw) => (raw == null ? null : feed.normalize(raw)))
    .catch(() => null);
}

/** One read of one operator for the three layers; null when none of its files answered. */
function readOperator(op: RoadOperator): Promise<OperatorRead | null> {
  const now = Date.now();
  const hit = shared.get(op.key);
  if (hit && now - hit.at < SHARED_READ_MS) return hit.read;
  const read = Promise.all(op.feeds.map(readFeed)).then((lists) => {
    const missing = op.feeds.filter((_, i) => lists[i] == null).map((f) => f.name);
    if (missing.length === op.feeds.length) return null;
    return { notices: lists.flatMap((l) => l ?? []), missing };
  });
  shared.set(op.key, { at: now, read });
  return read;
}

/** "TfL", or "Transport for NSW (flood)" when only some of its files did not answer. */
function missingName(op: RoadOperator, missing: string[]): string {
  return missing.length === op.feeds.length ? op.name : `${op.name} (${missing.join(", ")})`;
}

/** "TfL did not answer", "TfL and DriveBC did not answer", "A, B and C did not answer". */
export function notAnswered(names: string[]): string {
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  return `${list} did not answer`;
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
    attribution: `${TFL_CREDIT} (TfL road disruptions, London). ${DRIVEBC_CREDIT} (DriveBC road events, British Columbia). ${NSW_CREDIT} (hazards, New South Wales).`,
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
