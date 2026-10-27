// Every string the camera stats strip and its breakdown show (components/terminal/CameraStats.tsx).
//
// PURE, so the honesty rules are tested here rather than hoped for in a component:
// tests/unit/camera-stats-view.test.ts renders every label and tooltip below from a
// fixture and fails if any of them says "live". A still is never called live, and the
// strip counts video by what PLAYED at its check (lib/liveness/playcheck.ts).
//
// Operator names are the operators' own (lib/sources/operators.ts) and are shown as
// written, so one of them can contain the word ("Live Traffic NSW"). The rule is about
// what this site SAYS about a camera, not about renaming an agency.

import type { CameraStats, OperatorRow, RegionRow } from "@/lib/cameras/stats";
import { isStale } from "@/lib/cameras/stats";

export const fmt = (n: number): string => n.toLocaleString("en-GB");

const pad = (n: number) => String(n).padStart(2, "0");

/** "14:05 UTC". */
export function hhmmUtc(at: number): string {
  const d = new Date(at);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "5 Sep 2026". */
export function dateUtc(at: number): string {
  const d = new Date(at);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "under 1 min ago", "4 min ago", "3 h ago", "2 days ago". */
export function agoText(at: number, now: number): string {
  const m = Math.floor(Math.max(0, now - at) / 60_000);
  if (m < 1) return "under 1 min ago";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}

/** A refresh interval: "45 s", "2 min", "1.5 h". */
export function secondsText(s: number): string {
  if (s < 60) return `${Math.round(s)} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  const h = s / 3600;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
}

/** Milliseconds as seconds with one decimal: "1.7 s". */
export function msText(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

/** A share as a whole percent, or null when there is nothing to divide by. */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

let regionNames: Intl.DisplayNames | null | undefined;
/** "US" -> "United States"; the code itself when the runtime has no names. */
export function countryName(code: string): string {
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      regionNames = null;
    }
  }
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

// ---------------------------------------------------------------------------
// The strip's segments and the order the narrow widths drop them in
// ---------------------------------------------------------------------------

export type SegmentId = "video" | "stills" | "countries" | "operators" | "counted" | "webcams";

/** The strip's segments, left to right. */
export const SEGMENTS: readonly SegmentId[] = ["video", "stills", "countries", "operators", "counted", "webcams"];

/**
 * The quieter numbers leave first as the header narrows: operators, then webcams,
 * then countries. Each stays one click away in the breakdown. app/globals.css hides
 * `.is-drop-1` from 1419px, `.is-drop-2` from 1319px and `.is-drop-3` from 1239px, and
 * below 1180px the strip moves to its own row; tests/unit/camera-stats-view.test.ts holds
 * the CSS to this list.
 */
export const DROP_ORDER: readonly SegmentId[] = ["operators", "webcams", "countries"];

export function dropClass(id: SegmentId): string {
  const i = DROP_ORDER.indexOf(id);
  return i === -1 ? "" : `is-drop-${i + 1}`;
}

export const SEGMENT_LABEL: Record<SegmentId, string> = {
  video: "Video",
  stills: "Stills",
  countries: "Countries",
  operators: "Operators",
  counted: "Counted",
  webcams: "Webcams",
};

// ---------------------------------------------------------------------------
// Tooltips: what a number counts, its source and its time
// ---------------------------------------------------------------------------

export interface Tip {
  title: string;
  body: string;
  /** Where the number comes from and when. Shown after "Source: ". */
  source: string;
}

function roadWhen(s: CameraStats, now: number): string {
  return s.road.at === null ? "Not counted yet." : `Counted ${hhmmUtc(s.road.at)}, ${agoText(s.road.at, now)}.`;
}

function webWhen(s: Pick<CameraStats, "webcams">): string {
  return s.webcams.at === null ? "Harvest date unknown." : `Harvested ${dateUtc(s.webcams.at)}.`;
}

/** The webcam count's tooltip. Takes only the webcam figure: it has its own source and
 *  time, so it is shown even when the road count failed. */
export function webcamsTip(w: CameraStats["webcams"]): Tip {
  return {
    title: w.count === null ? "Webcams: count unavailable" : `Webcams: ${fmt(w.count)}`,
    body: "Webcams that Windy lists, on their own map layer. They are not in the road and public operator counts.",
    source: `${w.source}. ${webWhen({ webcams: w })}`,
  };
}

/** The VIDEO count, said honestly while the first play check is still running. */
export function videoSentence(s: CameraStats): string {
  const p = s.play;
  if (p.warm) {
    return (
      `The first play check since this server started is still running (${fmt(p.checked)} of ${fmt(p.listed)} ` +
      "listed streams checked). Until it ends, a stream not yet checked counts as video; one that failed never does."
    );
  }
  if (p.checked === 0) return "No stream has a play-check result yet.";
  return `${fmt(p.rolling)} of ${fmt(p.checked)} checked streams played at their last check (${percent(p.rolling, p.checked)}%).`;
}

/** What the play check found, in a few words, for the breakdown's VIDEO caption. */
export function playedShort(s: CameraStats): string {
  const p = s.play;
  if (p.warm) return "first check running";
  if (p.checked === 0) return "no check results yet";
  return `${percent(p.rolling, p.checked)}% played at the last check`;
}

/** The big figure in the VIDEO facts row: a share from real verdicts, never a guess. */
export function playedFigure(s: CameraStats): string {
  const p = s.play;
  if (p.warm) return "First check running";
  if (p.checked === 0) return "No results yet";
  return `${fmt(p.rolling)} of ${fmt(p.checked)}`;
}

export function segmentTip(id: SegmentId, s: CameraStats, now: number): Tip {
  const road = `${s.road.source}. ${roadWhen(s, now)}`;
  switch (id) {
    case "video":
      return {
        title: `Video: ${fmt(s.road.video)} cameras`,
        body: `Cameras whose stream played at its last check. ${videoSentence(s)}`,
        source: road,
      };
    case "stills":
      return {
        title: `Stills: ${fmt(s.road.stills)} cameras`,
        body:
          "A picture that refreshes on the operator's own interval" +
          (s.refresh.medianSeconds === null ? "." : `: ${secondsText(s.refresh.medianSeconds)} median.`),
        source: road,
      };
    case "countries":
      return {
        title: `Countries: ${fmt(s.road.countries)}`,
        body: "Countries with at least one road or public operator camera. The webcams are not in this count.",
        source: road,
      };
    case "operators":
      return {
        title: `Operators: ${fmt(s.road.operators)}`,
        body: `Road agencies and public bodies whose own camera feed answered at the last refresh, of ${fmt(s.road.feeds)} feeds this site reads.`,
        source: road,
      };
    case "counted":
      return {
        title: "When this server last counted",
        body:
          "The time of the road and public operator count. Totals move between counts as operators add and drop cameras." +
          (isStale(s.road.at, now) ? " This count is older than 15 min." : ""),
        source: road,
      };
    case "webcams":
      return webcamsTip(s.webcams);
  }
}

/** The tooltip for the strip as a whole, shown on keyboard focus. */
export function stripTip(s: CameraStats, now: number): Tip {
  return {
    title: "Camera counts",
    body: "Video, stills, countries and operators are one count; the webcams are a second, with their own source and time. Open the breakdown for the detail.",
    source: `${s.road.source}. ${roadWhen(s, now)} Webcams: ${s.webcams.source}. ${webWhen(s)}`,
  };
}

export function regionTip(row: RegionRow, kind: "video" | "stills" | "countries", s: CameraStats, now: number): Tip {
  const list =
    kind === "countries"
      ? row.byCountry.map((c) => countryName(c.country)).join(", ")
      : row.byCountry
          .filter((c) => c[kind] > 0)
          .map((c) => `${countryName(c.country)} ${fmt(c[kind])}`)
          .join(" · ");
  const n = kind === "countries" ? row.countries : row[kind];
  return {
    title: `${row.region}: ${fmt(n)} ${kind === "countries" ? (n === 1 ? "country" : "countries") : kind}`,
    body: list ? `${list}.` : "None.",
    source: `${s.road.source}. Each camera's country field. ${roadWhen(s, now)}`,
  };
}

export function playedTip(s: CameraStats): Tip {
  const p = s.play;
  return {
    title: "Played at the last check",
    body:
      videoSentence(s) +
      " A stream counts as played when its playlist moved on between two reads and its newest segment answered.",
    source: `${p.source}. ${windowText(s)}`,
  };
}

export function firstFrameTip(s: CameraStats): Tip {
  const p = s.play;
  return {
    title: "First frame",
    body:
      p.ttffMedianMs === null
        ? "No stream has played in a check yet, so there is no first-frame time."
        : `The time the operator took to hand this server the playlist and the newest segment, over the ${fmt(p.rolling)} streams that played: the operator's half of a visitor's wait, not all of it. Median ${msText(p.ttffMedianMs)}${p.ttffP90Ms === null ? "" : `, p90 ${msText(p.ttffP90Ms)}`}.`,
    source: `${p.source}. ${windowText(s)}`,
  };
}

export function listedTip(s: CameraStats): Tip {
  const p = s.play;
  return {
    title: `Video streams listed: ${fmt(p.listed)}`,
    body: `Cameras whose stream this site can play. The check reads each one every ${Math.round(p.cycleMs / 3_600_000)} h; ${fmt(p.checked)} have a recent result.`,
    source: `${p.source}. ${windowText(s)}`,
  };
}

export function refreshTip(s: CameraStats, now: number): Tip {
  const slow = s.refresh.mix.find((b) => b.label === "10 min or more")?.count ?? 0;
  return {
    title: "How often stills refresh",
    body:
      (s.refresh.medianSeconds === null
        ? "No still states a refresh interval."
        : `The interval each operator states for each still. Median ${secondsText(s.refresh.medianSeconds)}.`) +
      (slow > 0 ? ` It is not a promise for each camera: ${fmt(slow)} refresh every 10 min or slower.` : ""),
    source: `${s.refresh.source}, ${fmt(s.road.stills)} stills. ${roadWhen(s, now)}`,
  };
}

export function operatorTip(row: OperatorRow, s: CameraStats, now: number): Tip {
  return {
    // The operator's name sits beside this number in the list and is not repeated here:
    // names are the operators' own, and one of them contains the word this file avoids.
    title: `${fmt(row.cameras)} cameras from this operator`,
    body:
      `${fmt(row.video)} video, ${fmt(row.cameras - row.video)} stills` +
      (row.refreshSeconds === null ? "." : `; stills refresh every ${secondsText(row.refreshSeconds)} (median).`) +
      ` Licence: ${row.license}`,
    source: `${s.operators.source}. ${roadWhen(s, now)}`,
  };
}

/** "Checks 02:15 to 04:58 UTC." or a plain line before the first verdict. */
export function windowText(s: CameraStats): string {
  const { windowFrom, windowTo } = s.play;
  if (windowFrom === null || windowTo === null) return "No check has finished yet.";
  return `Checks ${hhmmUtc(windowFrom).replace(" UTC", "")} to ${hhmmUtc(windowTo)}.`;
}

// ---------------------------------------------------------------------------
// The strip's spoken label and the per-operator line
// ---------------------------------------------------------------------------

export function stripAriaLabel(s: CameraStats, now: number): string {
  const stale = isStale(s.road.at, now) ? ", older than 15 min" : "";
  const counted = s.road.at === null ? "not counted yet" : `counted ${agoText(s.road.at, now)}${stale}`;
  const web =
    s.webcams.count === null
      ? "Windy webcams: count unavailable."
      : `Windy webcams: ${fmt(s.webcams.count)}${s.webcams.at === null ? "" : `, harvested ${dateUtc(s.webcams.at)}`}.`;
  return (
    `Road and public operator cameras: ${fmt(s.road.video)} video, ${fmt(s.road.stills)} stills, ` +
    `${fmt(s.road.countries)} countries, ${fmt(s.road.operators)} operators, ${counted}. ${web} Show breakdown`
  );
}

/** "CC BY 4.0. 2,307 video, 1,291 stills every 2 min" or "No stated licence. 12 stills every 5 min". */
export function operatorMeta(row: OperatorRow): string {
  const stills = row.cameras - row.video;
  const parts: string[] = [];
  if (row.video > 0) parts.push(`${fmt(row.video)} video`);
  if (stills > 0) {
    const every = row.refreshSeconds === null ? "" : ` every ${secondsText(row.refreshSeconds)}`;
    parts.push(`${fmt(stills)} ${stills === 1 ? "still" : "stills"}${every}`);
  }
  return `${row.licenceStated ? row.license : "No stated licence"}. ${parts.join(", ")}`;
}
