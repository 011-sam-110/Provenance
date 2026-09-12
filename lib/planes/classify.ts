// Classify an aircraft into a coarse *type*.
//
// PREFERRED: the ADS-B emitter category (adsb.lol's `category`, e.g. A7 = rotor-
// craft, A5 = heavy) — an actual broadcast field, not a guess. FALLBACK: when no
// category is present we infer from altitude + ground speed + on-ground state
// (an honest estimate, surfaced in the UI as "est."). Pure + unit-tested.

export type PlaneCategory = "airliner" | "regional" | "light" | "helicopter" | "ground";

export interface PlaneProfile {
  /** Altitude above sea level in kilometres. */
  altKm: number;
  /** Ground speed in m/s, or null when unknown. */
  velocityMs: number | null;
  /** True when the aircraft reports itself on the ground. */
  onGround: boolean;
  /** ADS-B emitter category (A0–A7, B0–B7…) when known. */
  category?: string;
}

// ADS-B emitter category → our coarse type (the reliable path). Exported so callers
// can tell whether a category was actually trusted (vs. fell through to the estimate).
export const ADSB_CATEGORY: Record<string, PlaneCategory> = {
  A1: "light", // light (<15500 lbs)
  A2: "regional", // small
  A3: "airliner", // large
  A4: "airliner", // high-vortex large (B757)
  A5: "airliner", // heavy
  A7: "helicopter", // rotorcraft
  B1: "light", // glider/sailplane
  B4: "light", // ultralight
};

// Thresholds (kept named so the heuristic is legible).
const HELI_ALT_KM = 1.5; //  helicopters work low …
const HELI_SPEED_MS = 70; //  … and slow (~135 kt)
const AIRLINER_ALT_KM = 7; // jets cruise high …
const AIRLINER_SPEED_MS = 150; // … and fast (~290 kt)
const REGIONAL_ALT_KM = 3; // turboprops / regional jets mid-band
const REGIONAL_SPEED_MS = 110;

export interface ClassifyResult {
  category: PlaneCategory;
  /**
   * True when `category` came from the broadcast ADS-B emitter field, not the
   * altitude/speed/on-ground heuristic. On-ground is real transmitted telemetry
   * too, but it is not the broadcast *category* the "· est." distinction is
   * about — help.ts's TYPE sentence already groups on-ground with the guess
   * bucket, so `trusted` is false there as well, not a special case.
   */
  trusted: boolean;
}

/**
 * Coarse aircraft type, with the trust flag alongside it. Single source of
 * truth for the branching below — {@link classifyPlane} is a thin wrapper so
 * existing callers that only want the category keep working unchanged.
 */
export function classifyPlaneDetailed(p: PlaneProfile): ClassifyResult {
  if (p.onGround) return { category: "ground", trusted: false };
  if (p.category && ADSB_CATEGORY[p.category]) {
    return { category: ADSB_CATEGORY[p.category], trusted: true };
  }
  const alt = Number.isFinite(p.altKm) ? p.altKm : 0;
  const v = p.velocityMs ?? 0;
  if (alt < HELI_ALT_KM && v < HELI_SPEED_MS) return { category: "helicopter", trusted: false };
  if (alt >= AIRLINER_ALT_KM && v >= AIRLINER_SPEED_MS) return { category: "airliner", trusted: false };
  if (alt >= REGIONAL_ALT_KM || v >= REGIONAL_SPEED_MS) return { category: "regional", trusted: false };
  return { category: "light", trusted: false };
}

/** Coarse aircraft type — prefers the ADS-B category, else the flight profile. */
export function classifyPlane(p: PlaneProfile): PlaneCategory {
  return classifyPlaneDetailed(p).category;
}
