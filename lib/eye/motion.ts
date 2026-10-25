// The God's eye view's two camera moves: an orbit about the middle of the view, and a
// fly-along a short way ahead. Pure: each step takes a camera and a time step
// and returns the next camera, so tests/unit/eye-motion.test.ts holds them without a
// map, and the record script can drive them from a clock of its own.
//
// ONE MOVE AT A TIME, AND THE FIRST TOUCH ENDS IT (components/eye/EyeApp.tsx). With
// reduced motion asked for, neither runs.
//
// Each step clamps its time step (lib/cinematic/verbs.ts, clampStepDt): a tab that was
// hidden for a minute resumes the move where it stopped, it does not jump.

import { clampStepDt, destinationPoint } from "@/lib/cinematic/verbs";
import { tangentBearingDeg } from "@/lib/cinematic/routeFlight";
import { haversineKm } from "@/lib/geo/haversine";

export type EyeMotion = "orbit" | "fly";

/** The orbit's turn: a full circle a minute, the speed the design was framed at. */
export const ORBIT_DEG_PER_SEC = 6;
/**
 * The fly-along's ground speed. At the presets' zoom the frame spans about a kilometre,
 * so this crosses a quarter of it in nine seconds.
 */
export const FLY_METRES_PER_SEC = 28;
/** The fly-along slows over its last stretch instead of stopping dead. */
export const FLY_EASE_METRES = 60;
/** How far ahead a fly-along goes: about nine seconds at its speed, then it stops. */
export const FLY_AHEAD_KM = 0.22;

export interface EyePose {
  lat: number;
  lon: number;
  /** Degrees clockwise from north: the heading the view looks along. */
  bearing: number;
}

/** A link's `motion=`: only the two moves; anything else is no move. */
export function parseMotion(raw: string | null): EyeMotion | null {
  return raw === "orbit" || raw === "fly" ? raw : null;
}

const wrap = (deg: number) => ((deg % 360) + 360) % 360;

/** One frame of orbit: the heading turns about the middle of the view; nothing else moves. */
export function stepOrbit(pose: EyePose, dtSec: number, degPerSec: number = ORBIT_DEG_PER_SEC): EyePose {
  const dt = clampStepDt(dtSec);
  return { ...pose, bearing: wrap(pose.bearing + degPerSec * dt) };
}

/**
 * One frame of fly-along. The middle of the view moves at a steady ground speed toward
 * `to`, slowing over the last FLY_EASE_METRES and stopping on it; the heading stays.
 * With no `to` (a spot or a camera link has none), it moves ahead along the heading.
 */
export function stepFly(
  pose: EyePose,
  to: { lat: number; lon: number } | null,
  dtSec: number,
  metresPerSec: number = FLY_METRES_PER_SEC,
): EyePose {
  const dt = clampStepDt(dtSec);
  if (dt === 0 || !(metresPerSec > 0)) return pose;
  if (!to) {
    const next = destinationPoint(pose.lat, pose.lon, pose.bearing, (metresPerSec * dt) / 1000);
    return { ...pose, lat: next.lat, lon: next.lon };
  }
  const left = haversineKm(pose.lat, pose.lon, to.lat, to.lon) * 1000;
  const speed = metresPerSec * Math.min(1, Math.max(0.12, left / FLY_EASE_METRES));
  const step = speed * dt;
  if (left <= step || left < 0.5) return { ...pose, lat: to.lat, lon: to.lon };
  const heading = tangentBearingDeg([pose.lon, pose.lat], [to.lon, to.lat]);
  const next = destinationPoint(pose.lat, pose.lon, heading, step / 1000);
  return { ...pose, lat: next.lat, lon: next.lon };
}

/** Where a fly-along from this view ends: FLY_AHEAD_KM ahead along its heading. */
export function flyAheadOf(view: EyePose): { lat: number; lon: number } {
  return destinationPoint(view.lat, view.lon, view.bearing, FLY_AHEAD_KM);
}

/** Has the fly-along arrived? Then the move is over and the loop can stop. */
export function flyArrived(pose: EyePose, to: { lat: number; lon: number } | null): boolean {
  return to != null && pose.lat === to.lat && pose.lon === to.lon;
}

/**
 * The view's clock. Live, it is the wall clock. In a film (clock=manual) it is the
 * film's own: it stands still while a frame is drawn and moves on only by the film's
 * steps. So every time a film shows (the HUD's clock, a card's age, the aircraft's age)
 * is the time in the film, however slowly the film is drawn. On 25 Oct 2026 a 4 s film
 * took about five minutes to draw, and on the wall clock its HUD minute changed three
 * times.
 */
export interface EyeClock {
  readonly film: boolean;
  /** Milliseconds since 1970, as Date.now(). */
  now(): number;
  /** Called after each step of a film's clock. The wall clock never calls it. */
  subscribe(fn: () => void): () => void;
}

export const wallClock: EyeClock = {
  film: false,
  now: () => Date.now(),
  subscribe: () => () => undefined,
};

export interface FilmClock extends EyeClock {
  /** Move the film's time on by `ms`: one frame of the film, or more. */
  step(ms: number): void;
}

/** A film's clock, standing at `start` until the film steps it. */
export function filmClock(start: number): FilmClock {
  let t = start;
  const subs = new Set<() => void>();
  return {
    film: true,
    now: () => t,
    step(ms: number) {
      if (!(ms > 0) || !Number.isFinite(ms)) return;
      t += ms;
      for (const fn of subs) fn();
    },
    subscribe(fn: () => void) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
  };
}
