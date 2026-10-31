// Pure breadcrumb-trail helpers for the plane layer.
//
// A plane's trail = its recent ACTUAL positions (breadcrumbs dropped behind it)
// plus one PROJECTED point ahead along its current heading, so the line both
// shows where it has been and noses toward where it is going. Kept pure +
// unit-tested; WorldMap draws the result (toTrailFC). This is the 12-point line. The longer
// one the Full flight trail setting draws is lib/planes/fullHistory.ts, on the same path shape.

export interface TrailPoint {
  lat: number;
  lon: number;
  altKm: number;
  /** Epoch ms it was heard. The drawn path ignores it; Full flight trail starts from it. */
  t?: number;
}

const EARTH_R_KM = 6371;

/** Append a position to a capped history, ignoring near-duplicate samples. */
export function pushHistory(history: TrailPoint[], pt: TrailPoint, max = 12): TrailPoint[] {
  const last = history[history.length - 1];
  // Skip if essentially unchanged (plane hasn't moved between polls).
  if (last && Math.abs(last.lat - pt.lat) < 1e-4 && Math.abs(last.lon - pt.lon) < 1e-4) {
    return history;
  }
  const next = [...history, pt];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** Destination point from (lat,lon) travelling `distanceKm` along `bearingDeg`. */
export function projectAhead(
  lat: number,
  lon: number,
  bearingDeg: number,
  distanceKm: number,
): { lat: number; lon: number } {
  const δ = distanceKm / EARTH_R_KM;
  const θ = (bearingDeg * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;
  const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
  const φ2 = Math.asin(Math.min(1, Math.max(-1, sinφ2)));
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * sinφ2,
    );
  return {
    lat: (φ2 * 180) / Math.PI,
    // Normalise longitude to [-180, 180].
    lon: (((λ2 * 180) / Math.PI + 540) % 360) - 180,
  };
}

/** How far ahead to project, in km, scaled by speed (clamped). */
export function lookaheadKm(velocityMs: number | null, seconds = 90): number {
  const v = velocityMs && velocityMs > 0 ? velocityMs : 0;
  return Math.min(80, Math.max(4, (v * seconds) / 1000));
}

/**
 * Full trail to render: recent history + current position + a projected point
 * ahead. Returns at least the current point (never empty for a live plane).
 */
export function buildTrailPath(
  history: TrailPoint[],
  current: TrailPoint,
  headingDeg: number,
  velocityMs: number | null,
): TrailPoint[] {
  const ahead = projectAhead(current.lat, current.lon, headingDeg, lookaheadKm(velocityMs));
  return [...history, current, { ...ahead, altKm: current.altKm }];
}
