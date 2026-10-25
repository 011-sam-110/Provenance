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

/** What a card asks for first. A stream before a clip before a still. */
export type CardMedia = "stream" | "clip" | "still";

export function preferredMedia(cam: Pick<NearCamera, "live" | "clip">): CardMedia {
  if (cam.live) return "stream";
  if (cam.clip) return "clip";
  return "still";
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
