import { describe, expect, it } from "vitest";
import {
  DEFAULT_ISS_ORBIT_PREFS,
  ISS_ORBIT_DEG_PER_SEC,
  ISS_ORBIT_SPEED_LABEL,
  ISS_ORBIT_SPEEDS,
  isIssOrbitSpeed,
  sanitizeIssOrbitPrefs,
} from "@/lib/cinematic/prefs";
import { ORBIT_DEFAULTS } from "@/lib/cinematic/verbs";

// The ISS-orbit-follow prefs model: defaults, the speed table, persisted-blob
// repair. Node environment, pure functions only.

describe("iss orbit prefs", () => {
  it("ships opt-in — disabled until the user enables it in Map settings", () => {
    expect(DEFAULT_ISS_ORBIT_PREFS).toEqual({ enabled: false, speed: "normal" });
  });

  it("lists exactly three speeds, labels every one, and they accelerate in order", () => {
    expect(ISS_ORBIT_SPEEDS).toEqual(["slow", "normal", "fast"]);
    for (const s of ISS_ORBIT_SPEEDS) {
      expect(ISS_ORBIT_SPEED_LABEL[s].length).toBeGreaterThan(0);
      expect(ISS_ORBIT_DEG_PER_SEC[s]).toBeGreaterThan(0);
    }
    expect(ISS_ORBIT_DEG_PER_SEC.slow).toBeLessThan(ISS_ORBIT_DEG_PER_SEC.normal);
    expect(ISS_ORBIT_DEG_PER_SEC.normal).toBeLessThan(ISS_ORBIT_DEG_PER_SEC.fast);
  });

  it("'normal' is pinned to the orbit verb defaults so the settings and the math cannot drift apart", () => {
    expect(ISS_ORBIT_DEG_PER_SEC.normal).toBe(ORBIT_DEFAULTS.degPerSec);
  });

  it("sanitize repairs partial and foreign blobs field-by-field, never crashing", () => {
    expect(sanitizeIssOrbitPrefs(undefined)).toEqual(DEFAULT_ISS_ORBIT_PREFS);
    expect(sanitizeIssOrbitPrefs(null)).toEqual(DEFAULT_ISS_ORBIT_PREFS);
    expect(sanitizeIssOrbitPrefs("wat")).toEqual(DEFAULT_ISS_ORBIT_PREFS);
    expect(sanitizeIssOrbitPrefs({ enabled: true })).toEqual({ enabled: true, speed: "normal" });
    expect(sanitizeIssOrbitPrefs({ speed: "fast" })).toEqual({ enabled: false, speed: "fast" });
    expect(sanitizeIssOrbitPrefs({ speed: "warp" })).toEqual({ enabled: false, speed: "normal" });
    expect(sanitizeIssOrbitPrefs({ enabled: "yes", speed: 3 })).toEqual(DEFAULT_ISS_ORBIT_PREFS);
  });

  it("the speed guard recognises exactly the three speeds", () => {
    expect(ISS_ORBIT_SPEEDS.every(isIssOrbitSpeed)).toBe(true);
    expect(isIssOrbitSpeed("warp")).toBe(false);
    expect(isIssOrbitSpeed(9)).toBe(false);
    expect(isIssOrbitSpeed(null)).toBe(false);
  });
});
