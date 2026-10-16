import { Camera, CameraArray, Source } from "@/lib/types";

export const TFL_SOURCE: Source = {
  id: "tfl",
  name: "TfL JamCams",
  license: "OGL",
  attribution: "Powered by TfL Open Data",
  refreshSeconds: 300,
  needsKey: false,
};

interface TflProp {
  key: string;
  value: string;
}

export interface TflPlace {
  id: string;
  commonName: string;
  lat: number;
  lon: number;
  additionalProperties: TflProp[];
}

// WHY THE `available` FLAG IS NOT THE ANSWER ANY MORE (audit 2026-10-16).
//
// TfL's own `available` flag is wrong in both directions. Of 109 cameras flagged
// false that evening, 55 showed a live picture; the rest showed one of two grey
// cards ("Camera … offline", or "Camera … in use keeping London moving" when the
// control room has turned it). And 1 of 60 sampled cameras flagged TRUE showed the
// "in use" card. The flag's `modified` stamps went back three weeks, so it moves
// slowly and cannot be trusted as a liveness signal.
//
// The picture itself decides now, and the cheapest honest view of the picture is
// the size of the 5-second MP4 clip TfL publishes beside every still. A clip of a
// motionless grey card compresses to almost nothing; a clip of a road does not,
// even at night. Measured on all 890 cameras on 2026-10-16 at about 20:45 UTC
// (night in London, the hardest case because dark frames compress well):
//   - every grey card clip was 9,269 to 12,678 bytes;
//   - the smallest live clip was 35,137 bytes.
// 20,000 bytes sits in that gap with room on both sides. The still JPEG cannot do
// this: at night a live frame (9.8 to 11.9 KB) is the same size as a card.
//
// The clip size comes from a HEAD per camera (no body), run with a deadline inside
// the refresh. A camera whose clip has not been measured yet keeps the operator's
// flag, so a slow or failed sweep degrades to the old behaviour, never to "all
// offline".

/** A clip at or under this size is TfL's grey card, not a camera picture. */
export const TFL_CARD_MAX_CLIP_BYTES = 20_000;

/** Whether one camera is live: its clip size when measured, else TfL's flag. Pure. */
export function tflAvailable(flag: boolean, clipBytes: number | undefined): boolean {
  if (clipBytes === undefined || !Number.isFinite(clipBytes) || clipBytes <= 0) return flag;
  return clipBytes > TFL_CARD_MAX_CLIP_BYTES;
}

/**
 * @param clipBytes measured MP4 clip size per camera id (`tfl:…`). Omitted or
 *   missing for a camera, TfL's own flag is used.
 */
export function normalizeTfl(
  places: TflPlace[],
  clipBytes: ReadonlyMap<string, number> = new Map(),
): Camera[] {
  return places.map((p): Camera => {
    const props: Record<string, string> = {};
    for (const a of p.additionalProperties) props[a.key] = a.value;
    const hasVideo = Boolean(props.videoUrl);
    const id = `tfl:${p.id}`;
    return {
      id,
      source: "tfl",
      country: "GB",
      region: "London",
      name: p.commonName,
      lat: p.lat,
      lon: p.lon,
      imageUrl: props.imageUrl,
      streamUrl: props.videoUrl,
      mediaType: hasVideo ? "both" : "jpeg",
      refreshSeconds: TFL_SOURCE.refreshSeconds,
      license: TFL_SOURCE.license,
      attribution: TFL_SOURCE.attribution,
      available: tflAvailable(props.available === "true", clipBytes.get(id)),
    };
  });
}

/** Last measured clip size per camera id. Kept across rounds so a slow sweep still counts. */
const clipSizes = new Map<string, number>();
let sweep: Promise<void> | null = null;

/** How long one refresh waits for the clip sweep before it uses what it has. */
const SWEEP_WAIT_MS = 6_000;
const SWEEP_CONCURRENCY = 48;

async function headClip(url: string): Promise<number | undefined> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return undefined;
    const n = Number(res.headers.get("content-length"));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

/** HEAD every clip with bounded concurrency, writing sizes into `clipSizes` as they land. */
function sweepClips(cams: readonly Camera[]): Promise<void> {
  if (sweep) return sweep; // one sweep at a time; a late one still feeds the next round
  const queue = cams.filter((c) => c.streamUrl).map((c) => ({ id: c.id, url: c.streamUrl! }));
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const n = await headClip(next.url);
      if (n !== undefined) clipSizes.set(next.id, n);
    }
  };
  sweep = Promise.all(Array.from({ length: SWEEP_CONCURRENCY }, worker))
    .then(() => undefined)
    .finally(() => {
      sweep = null;
    });
  return sweep;
}

export async function fetchRegistry(): Promise<Camera[]> {
  const res = await fetch("https://api.tfl.gov.uk/Place/Type/JamCam", {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`TfL JamCam fetch failed: ${res.status}`);
  const places = (await res.json()) as TflPlace[];
  const first = normalizeTfl(places);
  await Promise.race([sweepClips(first), new Promise((r) => setTimeout(r, SWEEP_WAIT_MS))]);
  return CameraArray.parse(normalizeTfl(places, clipSizes));
}
