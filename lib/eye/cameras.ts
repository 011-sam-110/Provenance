// The God's eye view's camera cards, the pure half: which picture a card shows, what
// it calls that picture, and how old it says it is. components/eye/cameraCard.ts does
// the DOM. Pinned by tests/unit/eye-cameras.test.ts, which is where "a still is never
// labelled live" is held.

import { ofNearby, type LedgerRow } from "@/lib/eye/wording";

/** One row of /api/near, as the view reads it. */
export interface NearCamera {
  id: string;
  name: string;
  lat: number;
  lon: number;
  available: boolean;
  /** A stream /api/hls can play (lib/proxy/hls-allowlist.ts). */
  live: boolean;
  /** A short recording /api/proxy?clip=1 can serve (lib/proxy/clip.ts). */
  clip?: boolean;
  refreshSeconds?: number;
  attribution?: string;
  km: number;
}

/**
 * How far "nearby" reaches. /api/near answers the nearest cameras at ANY distance: with
 * TfL's feed missing for a moment, the 25 nearest to Piccadilly were in Plymouth and
 * Scotland (seen 25 Oct 2026). The view keeps the ones a frame at its zoom can hold.
 */
export const NEAR_KM = 4;

/** The cameras the view may show and count as nearby: within NEAR_KM of where it opened. */
export function nearCameras<T extends Pick<NearCamera, "km">>(cams: readonly T[]): T[] {
  return cams.filter((c) => Number.isFinite(c.km) && c.km <= NEAR_KM);
}

/** What a card asks for first. A stream before a clip before a still. */
export type CardMedia = "stream" | "clip" | "still";

/**
 * A stream before a clip before a still, except in a film (clock=manual). A film is
 * drawn one frame at a time, far slower than real time, so a stream filmed that way
 * runs many times too fast: traffic at a speed nobody drove. A film shows the clip,
 * moved on by the film's own clock (cameraCard.ts), or else the still.
 */
export function preferredMedia(cam: Pick<NearCamera, "live" | "clip">, film = false): CardMedia {
  if (cam.live && !film) return "stream";
  if (cam.clip) return "clip";
  return "still";
}

/** A card on screen, for clipsToPlay: what it shows and where its camera is. */
export interface PlayingCandidate {
  id: string;
  media: CardMedia;
  x: number;
  y: number;
}

/**
 * The cards whose clips play now. Measured on the production build on 25 Oct 2026, a
 * 6 s orbit at 60 Hz: with three clips playing the view drew 182 to 185 frames against
 * the bare scene's 361 and 362, and with one it drew 362. So while the view moves, ONE
 * video plays. A stream takes that place, because a stream is never held: a held stream
 * is not live. Else the clip of the camera the link opened on, else the clip nearest
 * the middle of the frame. The other clips hold their frame until the view rests, and
 * then every clip plays.
 */
export function clipsToPlay(
  cards: readonly PlayingCandidate[],
  centre: { x: number; y: number },
  moving: boolean,
  pinned?: string | null,
): Set<string> {
  const clips = cards.filter((c) => c.media === "clip");
  if (!moving) return new Set(clips.map((c) => c.id));
  if (clips.length === 0 || cards.some((c) => c.media === "stream")) return new Set();
  const pin = clips.find((c) => c.id === pinned);
  if (pin) return new Set([pin.id]);
  let best = clips[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const c of clips) {
    const d = Math.hypot(c.x - centre.x, c.y - centre.y);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return new Set([best.id]);
}

/** What a card falls back to when its media fails: a stream or a clip to the still. */
export function fallbackMedia(media: CardMedia): CardMedia | null {
  return media === "still" ? null : "still";
}

/**
 * The card's chip names what is ON SCREEN, never what the camera could do. A camera
 * with a stream that fell back to its still is showing a still, and says so.
 */
export function mediaLabel(showing: CardMedia): "Live" | "Clip" | "Still" {
  if (showing === "stream") return "Live";
  if (showing === "clip") return "Clip";
  return "Still";
}

/** "every 5 min", "every 30 s". The operator's cadence, never ours. */
export function cadenceText(refreshSeconds: number | undefined): string | null {
  if (!refreshSeconds || !Number.isFinite(refreshSeconds) || refreshSeconds <= 0) return null;
  if (refreshSeconds < 90) return `every ${Math.round(refreshSeconds)} s`;
  const min = Math.round(refreshSeconds / 60);
  if (min < 90) return `every ${min} min`;
  return `every ${Math.round(min / 60)} h`;
}

/** "just now", "4 min ago", "2 h ago", "3 days ago". Null when the time is unknown. */
export function ageText(takenAt: number | null | undefined, now: number): string | null {
  if (takenAt == null || !Number.isFinite(takenAt)) return null;
  const s = Math.max(0, Math.round((now - takenAt) / 1000));
  if (s < 60) return "just now";
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}

/** A picture older than this many of its own cycles is shown as stale. */
export const STALE_CYCLES = 3;

export function isStale(takenAt: number | null | undefined, refreshSeconds: number | undefined, now: number): boolean {
  if (takenAt == null || !refreshSeconds) return false;
  return now - takenAt > STALE_CYCLES * refreshSeconds * 1000;
}

/**
 * The line beside the chip. A stream needs no age. A still or a clip says when the
 * operator took it, and on a wide screen how often a new one comes; with no time from
 * the operator it says only the cadence.
 */
export function cardMeta(opts: {
  showing: CardMedia;
  takenAt: number | null;
  refreshSeconds?: number;
  now: number;
  phone: boolean;
}): string {
  if (opts.showing === "stream") return "stream";
  const age = ageText(opts.takenAt, opts.now);
  const cadence = cadenceText(opts.refreshSeconds);
  if (!age) return cadence ?? "";
  return !opts.phone && cadence ? `${age}, ${cadence}` : age;
}

/** Each feed's credit once, in the order its cameras appear. */
export function cameraCredits(cams: readonly Pick<NearCamera, "attribution">[]): string[] {
  const out: string[] = [];
  for (const c of cams) if (c.attribution && !out.includes(c.attribution)) out.push(c.attribution);
  return out;
}

/** The ledger row: cards on screen, of how many cameras nearby, and whose. */
export function cameraLedgerRow(shown: number, near: readonly NearCamera[]): LedgerRow {
  const available = near.filter((c) => c.available);
  const credits = cameraCredits(available);
  const noun = shown === 1 ? "road camera" : "road cameras";
  return {
    kind: "cam",
    count: shown,
    label: noun,
    detail: [...ofNearby(shown, available.length), ...credits].join(" · "),
    short: noun,
  };
}
