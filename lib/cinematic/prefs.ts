// lib/cinematic/prefs.ts
// Pure model for the console's ISS-orbit follow, the feature the Map settings
// page toggles. NO React and NO MapLibre — everything here runs in the repo's
// node vitest environment, and tests/unit/iss-orbit-prefs.test.ts pins the
// table so a speed change cannot drift silently.
//
// The store wrapper (./store.ts) mirrors lib/hud/store.ts exactly: module
// state + useSyncExternalStore + the same persisted-envelope helpers.

export const ISS_ORBIT_SPEEDS = ["slow", "normal", "fast"] as const;
export type IssOrbitSpeed = (typeof ISS_ORBIT_SPEEDS)[number];

/** User-facing speed names, in the repo's calm plain language. */
export const ISS_ORBIT_SPEED_LABEL: Record<IssOrbitSpeed, string> = {
  slow: "Slow",
  normal: "Normal",
  fast: "Fast",
};

/** Heading advance around the station, degrees per second, per speed word.
 *  "normal" is pinned to ORBIT_DEFAULTS.degPerSec in verbs.ts (see the test). */
export const ISS_ORBIT_DEG_PER_SEC: Record<IssOrbitSpeed, number> = {
  slow: 4.5,
  normal: 9,
  fast: 18,
};

export interface IssOrbitPrefs {
  /** The camera circles the station. Default OFF — the follow is opt-in from
   *  Map settings, and any touch of the map hands the camera back (flips this
   *  off) so the switch never lies about what the camera is doing. */
  enabled: boolean;
  /** How fast the camera circles. */
  speed: IssOrbitSpeed;
}

export const DEFAULT_ISS_ORBIT_PREFS: IssOrbitPrefs = {
  enabled: false,
  speed: "normal",
};

export function isIssOrbitSpeed(v: unknown): v is IssOrbitSpeed {
  return typeof v === "string" && (ISS_ORBIT_SPEEDS as readonly string[]).includes(v);
}

/** Validate + repair a persisted blob into a usable IssOrbitPrefs. Same
 *  contract as lib/hud/model.ts's sanitizeHudPrefs: a wrong field falls back
 *  to that field's default, a foreign shape yields all defaults, never a
 *  crash. */
export function sanitizeIssOrbitPrefs(raw: unknown): IssOrbitPrefs {
  const d = DEFAULT_ISS_ORBIT_PREFS;
  if (!raw || typeof raw !== "object") return { ...d };
  const r = raw as Record<string, unknown>;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : d.enabled,
    speed: isIssOrbitSpeed(r.speed) ? r.speed : d.speed,
  };
}
