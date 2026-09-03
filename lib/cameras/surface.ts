// Road-surface readings — the only thing in this repo allowed to claim it knows the
// state of a road surface, and the rules that decide when it must stop claiming it.
//
// WHY THIS IS A SEPARATE MODULE. Two networks publish a surface state and they word it
// differently (Estonia sends `DRY`, Fintraffic sends the sentence "Dry"). Both are the
// OPERATOR'S words. Nothing here invents a label, maps one word to another, or grades a
// road as safe. The most this file does is change `COLD_WET_SURFACE` to "Cold wet
// surface" so it reads as English — a casing transform, reversible, and tested as such.
//
// THE POINT OF `surfaceValidity`. A reading can exist and still not be usable, for five
// separate reasons, and the difference between them is the difference between "the road
// is wet" and "a sensor 37 km away was wet, two hours ago, and it is broken". Every
// caller must ask before it renders.

/** A surface reading, normalised from whichever network published it. */
export interface SurfaceReading {
  /** The operator's own words for the state, e.g. "Dry", "Cold wet surface". Never ours. */
  state: string;
  /** Road-surface temperature in °C where the station reports one. */
  roadTempC?: number;
  /** Air temperature in °C at the station. Distinct from `roadTempC` and not a substitute. */
  airTempC?: number;
  /** The station that measured it, named as the operator names it. */
  station?: string;
  /** Kilometres from the camera to that station, per the operator or computed from both
   *  published coordinates. Absent means we do not know the gap — which is not the same
   *  as zero, and `surfaceValidity` refuses rather than assumes. */
  km?: number;
  /** When the station took the reading (epoch ms). */
  observedAt?: number;
  /** Set when the OPERATOR itself declares the reading unusable — Estonia's
   *  `OVER_2_HOURS`, or a Fintraffic sensor reporting a fault. We pass their verdict
   *  through rather than second-guessing it. */
  operatorFlag?: string;
}

/**
 * How stale a reading may be before we stop showing it.
 *
 * BORROWED, NOT INVENTED. Estonia's own `road_status_aggregate` raises `OVER_2_HOURS`
 * at exactly this age, so the operator has already told us where its confidence ends.
 * Adopting their number rather than picking our own is the difference between honouring
 * a published threshold and inventing a safety margin.
 */
export const MEASURED_MAX_AGE_MS = 2 * 60 * 60 * 1000;

/**
 * How far a road-weather station may sit from a camera and still describe its road.
 *
 * THIS ONE IS OURS, and it is a judgement call, so it is written down rather than
 * buried. Measured across all 180 Estonian cameras on 2026-09-03: median 0.0 km,
 * p90 12 km, max 36.8 km, with 27 of 180 beyond 10 km. A surface state measured 37 km
 * away is not a reading of the road in the picture, and presenting it as one would be
 * the exact failure this whole feature exists to avoid.
 *
 * The distance is always rendered alongside the state when it is 1 km or more, so a
 * reader can disagree with this threshold using the same number we used.
 */
export const NEARBY_KM = 10;

/** Why a reading cannot be shown, or `"current"` when it can. */
export type SurfaceValidity =
  | "current"
  /** The operator says the reading is stale. */
  | "stale"
  /** The operator says the sensor is broken. */
  | "fault"
  /** Older than `MEASURED_MAX_AGE_MS` by our own clock. */
  | "old"
  /** The station is further than `NEARBY_KM`, or the distance is unknown. */
  | "far";

const FAULT = /fault|error|missing|broken/i;
const STALE = /over_\d+_hours?|stale|expired/i;

/**
 * Whether a reading may be presented as this camera's road state.
 *
 * Order matters: an operator's own verdict outranks our arithmetic, so a station that
 * says it is faulty reads as "fault" even if it is also 40 km away. The operator told
 * us something specific and we repeat it rather than substituting our own reason.
 */
export function surfaceValidity(reading: SurfaceReading, now: number): SurfaceValidity {
  const flag = reading.operatorFlag ?? "";
  if (FAULT.test(flag)) return "fault";
  if (STALE.test(flag)) return "stale";

  // Unknown distance is refused, not assumed near. We would rather show nothing than
  // silently treat "we never learned the gap" as "the gap is zero".
  if (!Number.isFinite(reading.km as number) || (reading.km as number) > NEARBY_KM) return "far";

  const at = reading.observedAt;
  if (Number.isFinite(at as number) && now - (at as number) > MEASURED_MAX_AGE_MS) return "old";

  return "current";
}

/**
 * An operator's machine-cased code rendered as English: `COLD_WET_SURFACE` →
 * `Cold wet surface`, `DRY` → `Dry`.
 *
 * A PURE CASING TRANSFORM AND NOTHING MORE. It must never map one word onto another —
 * no `MOIST` → `Damp`, no code → severity. A network we have never seen can publish a
 * state this repo has no knowledge of and it will still render correctly, because the
 * only thing this function knows is where the underscores are. A value already written
 * as a sentence ("The sensor has a fault") is returned untouched.
 */
export function humaniseOperatorCode(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  // Already prose (has a lowercase letter and a space, or no underscores at all).
  if (!s.includes("_") && /[a-z]/.test(s)) return s;
  const words = s.replace(/_/g, " ").toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Kilometres between two coordinates. Used to give Finland the same distance
 *  discipline Estonia publishes for itself, so one `NEARBY_KM` governs both. */
export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
