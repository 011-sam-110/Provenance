import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { degraded, observed } from "@/lib/signals/outcome";
import {
  HK_SPEED_CREDIT,
  HK_SPEED_HOME,
  HK_SPEEDS_URL,
  joinSpeeds,
  parseHkSpeeds,
  speedBand,
  type SegmentLine,
  type SpeedFile,
} from "@/lib/roads/hk-speed";
import { ROADS_GROUP } from "@/lib/signals/roads";

// ── Measured road speed: the one road layer that is a measurement ───────────────
//
// Hong Kong only, today (lib/roads/hk-speed.ts says why it is the first). Each feature is
// one road segment, drawn as a SOLID line in its speed band's colour, because a solid
// road line means a measured speed and nothing else (the notice layers are patterned).
// A segment the Transport Department marks invalid is not drawn. A road with no line
// is not measured; the legend says so.

// THE LINES ARE LOADED ON THE SERVER, ON FIRST READ. The registry is imported by the
// console's client code, so a static import of the 470 KB lines file would put it in every
// visitor's download. A dynamic import inside fetch() is its own chunk, which only the
// server ever runs.
let segmentsOnce: Promise<Record<string, SegmentLine>> | null = null;
function loadSegments(): Promise<Record<string, SegmentLine>> {
  segmentsOnce ??= import("@/lib/roads/hk-irn-segments.data.json").then(
    (m) => (m.default as unknown as { segments: Record<string, SegmentLine> }).segments,
  );
  return segmentsOnce;
}

/** Pure: one speed file to the layer's features. */
export function roadSpeedFeatures(file: SpeedFile, segments: Readonly<Record<string, SegmentLine>>): SignalFeature[] {
  const ts = new Date(file.at).toISOString();
  return joinSpeeds(file, segments).map((s) => {
    const kmh = Math.round(s.kmh);
    const coords = s.lines;
    const mid = coords[0][Math.floor(coords[0].length / 2)];
    return {
      id: `hk:${s.id}`,
      lat: mid[1],
      lon: mid[0],
      title: [`${kmh} km/h`, s.street].filter(Boolean).join(", "),
      signalId: "road-speed",
      color: s.color,
      line: "speed",
      geometry: coords.length === 1 ? { type: "LineString", coordinates: coords[0] } : { type: "MultiLineString", coordinates: coords },
      // Kept short: Hong Kong is about 4,500 rows every 2 minutes. The source chip comes
      // from the layer's sourceUrl, and the time from `ts`.
      props: {
        speed: `${s.kmh} km/h (${speedBand(s.kmh).words})`,
        segment: s.id,
        ...(s.street ? { street: s.street } : {}),
      },
      ts,
    };
  });
}

export const ROAD_SPEED_SOURCE: SignalSource = {
  id: "road-speed",
  kind: "event",
  precision: "exact",
  label: "Road speed (measured, Hong Kong)",
  group: ROADS_GROUP,
  color: "#4ade80",
  refreshMs: 120_000,
  attribution: HK_SPEED_CREDIT,
  sourceUrl: HK_SPEED_HOME,
  async fetch() {
    try {
      const res = await fetch(HK_SPEEDS_URL, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return degraded(`Transport Department answered ${res.status}`);
      const file = parseHkSpeeds(await res.text());
      if (!file) return degraded("Transport Department sent no speed file");
      return observed(roadSpeedFeatures(file, await loadSegments()), Date.now(), file.at);
    } catch {
      return degraded("Transport Department did not answer");
    }
  },
};
