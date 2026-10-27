import type { SignalFeature, SignalGeometry, SignalSource } from "@/lib/signals/types";
import { degraded, degradedWith, observed } from "@/lib/signals/outcome";
import { newestChange, type RoadNotice } from "@/lib/roads/notice";
import { TFL_CREDIT, TFL_DISRUPTIONS_URL, TFL_NAME, normalizeTflNotices } from "@/lib/roads/tfl";
import { DRIVEBC_CREDIT, DRIVEBC_EVENTS_URL, DRIVEBC_HOME, DRIVEBC_NAME, normalizeOpen511 } from "@/lib/roads/open511";

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
// ONE OPERATOR DOWN IS NOT ALL DOWN. Each operator is read apart. When one does not
// answer, the others' notices are still drawn and the layer says which one is missing.

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

/** One road operator: how to read it, and how its notices are named and credited. */
export interface RoadOperator {
  /** The feature id prefix, e.g. "tfl" in "tfl:TIMS-237054". */
  key: string;
  /** How the words name it: "TfL", "DriveBC". */
  name: string;
  /** The credit its terms ask for. */
  credit: string;
  /** Where a reader can check a notice: the operator's own traffic page. */
  home: string;
  url: string;
  normalize(raw: unknown): RoadNotice[];
}

export const TFL_OPERATOR: RoadOperator = {
  key: "tfl",
  name: TFL_NAME,
  credit: TFL_CREDIT,
  home: "https://tfl.gov.uk/traffic/status/",
  url: TFL_DISRUPTIONS_URL,
  normalize: normalizeTflNotices,
};

export const DRIVEBC_OPERATOR: RoadOperator = {
  key: "bc",
  name: DRIVEBC_NAME,
  credit: DRIVEBC_CREDIT,
  home: DRIVEBC_HOME,
  url: DRIVEBC_EVENTS_URL,
  normalize: normalizeOpen511,
};

export const ROAD_OPERATORS: readonly RoadOperator[] = [TFL_OPERATOR, DRIVEBC_OPERATOR];

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

const shared = new Map<string, { at: number; notices: Promise<RoadNotice[] | null> }>();

/** One read of one operator for the three layers; null when it did not answer. Never throws. */
function readOperator(op: RoadOperator): Promise<RoadNotice[] | null> {
  const now = Date.now();
  const hit = shared.get(op.key);
  if (hit && now - hit.at < SHARED_READ_MS) return hit.notices;
  const notices = fetch(op.url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((raw) => (raw == null ? null : op.normalize(raw)))
    .catch(() => null);
  shared.set(op.key, { at: now, notices });
  return notices;
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
    attribution: `${TFL_CREDIT} (TfL road disruptions, London). ${DRIVEBC_CREDIT} (DriveBC road events, British Columbia).`,
    async fetch() {
      const reads = await Promise.all(ROAD_OPERATORS.map(async (op) => ({ op, notices: await readOperator(op) })));
      const answered = reads.filter((r) => r.notices != null) as { op: RoadOperator; notices: RoadNotice[] }[];
      const missing = reads.filter((r) => r.notices == null).map((r) => r.op.name);
      if (answered.length === 0) return degraded(`${missing.join(" and ")} did not answer`);
      const features = answered.flatMap((r) => roadLayerFeatures(r.notices, layer, r.op));
      if (missing.length > 0) return degradedWith(features, `${missing.join(" and ")} did not answer`);
      return observed(features, Date.now(), newestChange(answered.flatMap((r) => r.notices)) ?? undefined);
    },
  };
}

export const ROAD_WORKS_SOURCE = roadSource("works", "Roadworks", ROAD_WORKS_COLOR);
export const ROAD_INCIDENTS_SOURCE = roadSource("incidents", "Road incidents", ROAD_INCIDENTS_COLOR);
export const ROAD_CLOSURES_SOURCE = roadSource("closures", "Road closures", ROAD_CLOSURES_COLOR);
