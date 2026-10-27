// Hong Kong's measured road speeds: the Transport Department's average speed of each road
// segment, every 2 minutes, drawn on the segment's own line. Pure, so
// tests/unit/roads-hk-speed.test.ts holds it against a real answer.
//
// THIS IS A MEASUREMENT, AND IT IS THE ONLY ONE. Every other road layer is a notice: what
// an operator says about a road. This one is a speed the Transport Department measured
// on it, so it, and only it, is drawn as a solid line, in the speed's colour. A segment
// whose reading the Department marks invalid (`valid` N) is not drawn, and a road with no
// segment has no colour: it is not measured, not clear.
//
// THE FEED. resource.data.one.gov.hk/td/traffic-detectors/irnAvgSpeed-all.xml, keyless, on
// DATA.GOV.HK (4,525 segments on 27 Oct 2026, 46 of them invalid). It names each segment
// by its id in the Department's Road Network. The lines come from that network's
// CENTERLINE layer on the CSDI Portal, joined once by scripts/gen-hk-irn-segments.mjs into
// lib/roads/hk-irn-segments.data.json (4,502 of the 4,525 ids have a line).
//
// TIME. The file states one date and time for all its readings, in Hong Kong time
// (UTC+8, no summer time). That is the reading's "as of", and the map says it.
//
// TERMS. DATA.GOV.HK and the CSDI Portal: free for commercial and non-commercial use, on
// condition that the source is named, the Government's and the Department's ownership is
// acknowledged, and attribution is given (read 27 Oct 2026).

export const HK_SPEEDS_URL = "https://resource.data.one.gov.hk/td/traffic-detectors/irnAvgSpeed-all.xml";
export const HK_SPEED_CREDIT =
  "Road speeds: Transport Department, HKSAR Government, via DATA.GOV.HK. Road lines: Road Network, Transport Department, via the CSDI Portal";
export const HK_SPEED_NAME = "Transport Department (Hong Kong)";
export const HK_SPEED_HOME = "https://data.gov.hk/en/";

/** The speed bands of design A, in km/h. Red is never a speed: red is a closure. */
export const SPEED_BANDS = [
  { band: "hi", min: 70, color: "#4ade80", words: "70 km/h and over" },
  { band: "mid", min: 40, color: "#facc15", words: "40 to 70 km/h" },
  { band: "lo", min: 0, color: "#f97316", words: "under 40 km/h" },
] as const;

export type SpeedBand = (typeof SPEED_BANDS)[number]["band"];

export function speedBand(kmh: number): (typeof SPEED_BANDS)[number] {
  return SPEED_BANDS.find((b) => kmh >= b.min) ?? SPEED_BANDS[SPEED_BANDS.length - 1];
}

export interface SpeedReading {
  id: string;
  kmh: number;
}

export interface SpeedFile {
  /** The readings' time, in epoch ms (the file's Hong Kong date and time). */
  at: number;
  irnVersion?: string;
  /** Valid readings only. */
  readings: SpeedReading[];
  /** How many readings the Department marked invalid. */
  invalid: number;
}

/** Pure: the Department's XML to valid readings and their time; null when it is not that file. */
export function parseHkSpeeds(xml: unknown): SpeedFile | null {
  if (typeof xml !== "string") return null;
  const date = /<date>(\d{4}-\d{2}-\d{2})<\/date>/.exec(xml)?.[1];
  const time = /<time>(\d{2}:\d{2}:\d{2})<\/time>/.exec(xml)?.[1];
  const at = date && time ? Date.parse(`${date}T${time}+08:00`) : NaN;
  if (!Number.isFinite(at)) return null;
  const readings: SpeedReading[] = [];
  let invalid = 0;
  for (const m of xml.matchAll(/<segment>([\s\S]*?)<\/segment>/g)) {
    const id = /<segment_id>(\d+)<\/segment_id>/.exec(m[1])?.[1];
    const kmh = Number(/<speed>([\d.]+)<\/speed>/.exec(m[1])?.[1]);
    const valid = /<valid>([YN])<\/valid>/.exec(m[1])?.[1];
    if (!id || !Number.isFinite(kmh)) continue;
    if (valid !== "Y") {
      invalid += 1;
      continue;
    }
    readings.push({ id, kmh });
  }
  const irnVersion = /<irn_version>([^<]+)<\/irn_version>/.exec(xml)?.[1];
  return { at, ...(irnVersion ? { irnVersion } : {}), readings, invalid };
}

/** One segment's line, as scripts/gen-hk-irn-segments.mjs writes it. */
export interface SegmentLine {
  /** The street's English name, where the network gives one. */
  n?: string;
  c: [number, number][][];
}

export interface SpeedSegment {
  id: string;
  kmh: number;
  band: SpeedBand;
  color: string;
  street?: string;
  lines: [number, number][][];
}

/** Pure: valid readings joined to their segments' lines. A reading with no line is left out. */
export function joinSpeeds(file: SpeedFile, segments: Readonly<Record<string, SegmentLine>>): SpeedSegment[] {
  const out: SpeedSegment[] = [];
  for (const r of file.readings) {
    const seg = segments[r.id];
    const lines = (seg?.c ?? []).filter((l) => l.length >= 2);
    if (lines.length === 0) continue;
    const b = speedBand(r.kmh);
    // The network writes "-99" where a segment has no street name.
    const street = seg?.n && seg.n !== "-99" ? seg.n : undefined;
    out.push({ id: r.id, kmh: r.kmh, band: b.band, color: b.color, ...(street ? { street } : {}), lines });
  }
  return out;
}
