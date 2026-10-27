import type { SignalFeature, SignalGeometry, SignalSource } from "@/lib/signals/types";
import { degraded, observed } from "@/lib/signals/outcome";
import { newestChange, type RoadNotice } from "@/lib/roads/notice";
import { TFL_CREDIT, TFL_DISRUPTIONS_URL, normalizeTflNotices } from "@/lib/roads/tfl";

// ── London road notices: three console layers from one TfL read ─────────────
//
// TfL's road disruptions (keyless Unified API, TfL transport data terms based on the
// Open Government Licence v2, "Powered by TfL Open Data"), split by what they are:
//
//   road-works      planned works on a street, drawn as dashes
//   road-incidents  everything else TfL lists (collisions, hazards, police activity,
//                   signal faults), drawn as dots
//   road-closures   only the streets TfL marks "Closed", drawn as bars
//
// A NOTICE IS NEVER A SPEED, so none of the three is ever a solid line: the console's
// solid signal line is a cable or a route, and a solid road line will be a measured
// speed. The line style rides on each feature (`SignalFeature.line`).
//
// One notice can feed two layers: a works notice that closes one stretch and leaves
// the next open is a "works" line for the open stretch and a "closure" line for the
// closed one, because that is what TfL says about each street (lib/roads/tfl.ts).
//
// TIME. Each feature's `ts` is TfL's own last change to that notice, and the read
// passes TfL's newest change as the data's "as of" (observed's sourceAt), so the
// freshness line can say how old the notices are, not only when they were fetched.

export const ROADS_GROUP = "Roads";
const REFRESH_MS = 120_000;
/** One TfL read serves all three layers for this long. */
const SHARED_READ_MS = 60_000;
const FETCH_TIMEOUT_MS = 15_000;

/** Light-skin colours, each readable on the light basemap and on satellite. */
export const ROAD_WORKS_COLOR = "#e11d48";
export const ROAD_INCIDENTS_COLOR = "#7e22ce";
export const ROAD_CLOSURES_COLOR = "#be123c";

export type RoadLayer = "works" | "incidents" | "closures";

const multi = (lines: [number, number][][]): SignalGeometry | undefined =>
  lines.length === 0 ? undefined : lines.length === 1 ? { type: "LineString", coordinates: lines[0] } : { type: "MultiLineString", coordinates: lines };

/**
 * The map label: TfL's sub-category and the start of TfL's own location, up to its
 * postcodes and borough ("Utility works, [A12] EASTERN AVENUE EAST"). The dossier
 * keeps the whole location.
 */
export function roadTitle(n: RoadNotice): string {
  const street = n.location?.split(" - ")[0].split(" (")[0].trim();
  return [n.subCategory ?? n.category, street].filter(Boolean).join(", ");
}

/** The dossier's rows: TfL's own words, and TfL's own time. */
function noticeProps(n: RoadNotice): Record<string, unknown> {
  return {
    category: n.category,
    ...(n.subCategory ? { subCategory: n.subCategory } : {}),
    severity: n.severity,
    ...(n.closure ? { closure: n.closure } : {}),
    ...(n.location ? { location: n.location } : {}),
    ...(n.updated ? { tflLastChange: n.updated } : {}),
  };
}

/**
 * Pure: one layer's features from TfL's notices. A notice with no street line is a
 * point at TfL's own point; a notice whose streets this layer does not draw is left
 * out of it.
 */
export function roadLayerFeatures(notices: readonly RoadNotice[], layer: RoadLayer): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const n of notices) {
    const hasLines = n.openLines.length + n.closedLines.length > 0;
    let lines: [number, number][][];
    if (layer === "closures") {
      if (!n.closure) continue;
      lines = n.closedLines;
    } else {
      if ((layer === "works") !== (n.kind === "works")) continue;
      // A notice whose every street is Closed is drawn by the closures layer alone, and
      // so is a closing notice TfL gave no street line: one point, not two on one spot.
      if (hasLines && n.openLines.length === 0) continue;
      if (!hasLines && n.closure) continue;
      lines = n.openLines;
    }
    const geometry = multi(lines);
    const id = `tfl:${n.id}${layer === "closures" ? ":closed" : ""}`;
    out.push({
      id,
      lat: n.lat,
      lon: n.lon,
      title: roadTitle(n),
      signalId: `road-${layer}`,
      ...(geometry ? { geometry, line: layer === "closures" ? "bar" : layer === "works" ? "dash" : "dot" } : {}),
      props: noticeProps(n),
      ...(n.updated ? { ts: n.updated } : {}),
    });
  }
  return out;
}

let shared: { at: number; notices: Promise<RoadNotice[] | null> } | null = null;

/** One TfL read for the three layers; null when TfL did not answer. Never throws. */
function readTfl(): Promise<RoadNotice[] | null> {
  const now = Date.now();
  if (shared && now - shared.at < SHARED_READ_MS) return shared.notices;
  const notices = fetch(TFL_DISRUPTIONS_URL, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((raw) => (raw == null ? null : normalizeTflNotices(raw)))
    .catch(() => null);
  shared = { at: now, notices };
  return notices;
}

function roadSource(layer: RoadLayer, label: string, color: string): SignalSource {
  return {
    id: `road-${layer}`,
    kind: "event",
    // TfL's own street segments, or TfL's own point for a notice it gave no line.
    precision: "exact",
    label,
    group: ROADS_GROUP,
    color,
    refreshMs: REFRESH_MS,
    attribution: `${TFL_CREDIT} (Transport for London road disruptions, London only)`,
    sourceUrl: "https://tfl.gov.uk/traffic/status/",
    async fetch() {
      const notices = await readTfl();
      if (notices == null) return degraded("TfL did not answer");
      return observed(roadLayerFeatures(notices, layer), Date.now(), newestChange(notices) ?? undefined);
    },
  };
}

export const ROAD_WORKS_SOURCE = roadSource("works", "Roadworks (London)", ROAD_WORKS_COLOR);
export const ROAD_INCIDENTS_SOURCE = roadSource("incidents", "Road incidents (London)", ROAD_INCIDENTS_COLOR);
export const ROAD_CLOSURES_SOURCE = roadSource("closures", "Road closures (London)", ROAD_CLOSURES_COLOR);
