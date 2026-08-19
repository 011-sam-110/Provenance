// The cross-layer severity ramp — one scale, read by anything that has to show
// "how bad is this" across layers that do not share units.
//
// WHY THIS EXISTS. `rankAnomalies` (lib/console/anomaly/anomaly.ts) already
// normalises every layer onto a single 0..1 `severity` using that layer's declared
// metric domain. The "What's abnormal" widget then ranked BY that number and
// coloured by something else entirely — the feature's own colour — so the list
// answered "what should I look at right now?" in colours calibrated against a
// different scale on every row. A green GDACS row is green because green is
// GDACS's LOWEST alert level; a wildfire is orange because every wildfire feature
// is orange and the hue encodes nothing at all; an M5.5 is orange because that is
// where it sits on the USGS ramp. Three scales, one list, no way to read urgency
// down the column.
//
// So: colour comes from the ranked severity, which is the only quantity in that
// widget that IS comparable across layers, and layer identity stays on the text
// label beside it, which is where it was already being carried.
//
// The thresholds are not taste. They were checked against what each layer's
// declared domain actually maps real events onto (measured on live feeds
// 2026-08-19):
//
//   earthquakes      domain [2, 8] on Richter  → M6.0 = 0.67 warn, M7.0 = 0.83 critical
//   tropical cyclones domain [34, 160] on kt   → Cat 3 = 0.60 warn, Cat 5 = 0.80+ critical
//   GDACS            domain [0, 3] alertScore  → orange = 0.67 warn, red = 1.00 critical
//   space weather    domain [0, 9] on Kp       → G1 storm = 0.56, G4 = 0.89 critical
//
// i.e. `critical` lands on M7+, a Cat 5, and a GDACS red — which is roughly what
// those communities themselves treat as the top band. `warn` covers the tier below.
// Everything else is NEUTRAL, and that is the point: on a normal day the column is
// grey, so the day it is not grey means something.
//
// Pure and node-testable: it returns a CSS variable reference, never a hex, so the
// two skins stay the single source of truth for the actual colours.

/** The three rungs. `none` is the resting state, not an absence of data. */
export type SeverityBand = "none" | "warn" | "critical";

/** Severity at/above this is the top band. */
export const CRITICAL_AT = 0.8;
/** Severity at/above this needs a look; below it is routine. */
export const WARN_AT = 0.6;

/**
 * PURE: a 0..1 cross-layer severity → its band.
 *
 * Clamps rather than rejects. `rankAnomalies` floors its output at 0.45 so nothing
 * routine reaches a widget in the first place, but this is also called from places
 * with no floor, and a NaN from a malformed upstream must degrade to "not urgent"
 * rather than to "critical" — the failure mode of a monitoring tool that cries wolf
 * on bad data is worse than the one that stays quiet.
 */
export function severityBand(severity: number): SeverityBand {
  if (!Number.isFinite(severity)) return "none";
  if (severity >= CRITICAL_AT) return "critical";
  if (severity >= WARN_AT) return "warn";
  return "none";
}

/** PURE: a 0..1 cross-layer severity → the CSS custom property to paint it with. */
export function severityColor(severity: number): string {
  return `var(--tnx-alert-${severityBand(severity)})`;
}
