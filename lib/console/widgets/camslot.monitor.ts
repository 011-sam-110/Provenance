// A drawn area becomes a board.
//
// Kept apart from the gesture (camslot.circle.ts) and from the stores it reads,
// so the WHOLE rule — what is inside the ring, which cameras lead, how they are
// dealt out, and what the user is told — is a pure function over plain rows. That
// is the only way it can be tested here: vitest runs in the node environment and
// there is no React testing library in this repo.

import { planFanOut, type FanOutTile } from "@/lib/console/widgets/camslot.fanout";
import { camerasInRing, pickKey, type PickedCamera } from "@/lib/console/widgets/camslot.pick";
import { webcamRef, type LatLon } from "@/lib/console/widgets/camslot.arm";

/** Mirrors camslot.area.ts and WorldMap — Windy's image tokens last ~10 minutes. */
const WEBCAM_REFRESH_SECONDS = 600;

export interface CameraRow extends LatLon {
  id: string;
  name?: string;
  refreshSeconds?: number;
  source?: string;
  /** Set by lib/cameras/body.ts from isLiveStreamUrl — a stream /api/hls can play. */
  live?: boolean;
}

export interface WebcamRow extends LatLon {
  id: string;
  label?: string;
}

export interface MonitorInput {
  ring: readonly [number, number][];
  cameras: readonly CameraRow[];
  webcams: readonly WebcamRow[];
}

export interface MonitorPlan {
  tiles: FanOutTile[];
  /** How many cameras the ring contained. Every one of them is on the board — the
   *  overflow rotates rather than being dropped — so this is not a "found vs
   *  shown" pair and must never be reported as one. */
  found: number;
  live: number;
  /** A sentence for the user. Always populated. */
  message: string;
}

/**
 * The mean of a ring's vertices.
 *
 * Good enough to rank distance within one ring, which is all it is used for. It is
 * NOT a centroid and must not be shown to anyone as "the middle of this area" —
 * the same caveat `camslot.area.ts` carries on its own copy.
 */
export function ringCentre(ring: readonly [number, number][]): LatLon {
  let lat = 0;
  let lon = 0;
  for (const [x, y] of ring) { lon += x; lat += y; }
  const n = Math.max(1, ring.length);
  return { lat: lat / n, lon: lon / n };
}

export function planMonitor(input: MonitorInput, tiles?: number): MonitorPlan {
  const { ring } = input;
  if (ring.length < 3) {
    return { tiles: [], found: 0, live: 0, message: "That area is not a shape." };
  }

  const inRing = camerasInRing(input.cameras, ring);
  const webcamsInRing = camerasInRing(input.webcams, ring);

  const picks: PickedCamera[] = [
    ...inRing.map((c) => ({
      ref: { k: "cam" as const, id: c.id },
      key: pickKey({ k: "cam", id: c.id }),
      label: c.name || c.id,
      lat: c.lat,
      lon: c.lon,
      refreshSeconds: c.refreshSeconds,
      source: c.source,
      live: c.live === true,
    })),
    ...webcamsInRing.map((w) => {
      const ref = webcamRef(w.id, w.label);
      return {
        ref,
        key: pickKey(ref),
        label: w.label || w.id,
        lat: w.lat,
        lon: w.lon,
        refreshSeconds: WEBCAM_REFRESH_SECONDS,
        source: "Windy",
        // A Windy webcam is a refreshing still by definition — there is no HLS
        // stream behind one — so this is a fact, not a default.
        live: false,
      };
    }),
  ];

  const found = picks.length;
  if (found === 0) {
    return { tiles: [], found: 0, live: 0, message: "No cameras inside that area." };
  }

  const live = picks.filter((p) => p.live).length;
  const centre = ringCentre(ring);
  const plan = planFanOut(picks, centre, tiles);

  // The honest sentence. It states the total and how many of them play video,
  // because those are different numbers and the difference is the whole reason
  // the default area is where it is.
  const noun = found === 1 ? "camera" : "cameras";
  const message =
    live === found
      ? `${found} ${noun}, all live.`
      : `${found} ${noun}, ${live} live.`;

  return { tiles: plan, found, live, message };
}
