import { describe, expect, it } from "vitest";
import {
  DEFAULT_HUD_PREFS,
  HUD_CHIP_LABEL,
  HUD_HOTKEY,
  HUD_OPACITY_MAX,
  HUD_OPACITY_MIN,
  HUD_VARIANTS,
  VARIANT_LABEL,
  VARIANT_SPEC,
  clampOpacity,
  compassPoint,
  formatCount,
  formatHeading,
  formatLat,
  formatLon,
  formatUtcClock,
  formatZoom,
  isHudVariant,
  sanitizeHudPrefs,
} from "@/lib/hud/model";

// The HUD's pure model: defaults, the variant table, persisted-prefs repair, and
// the readout formatters. Node environment, pure functions only.

describe("defaults and variants", () => {
  it("ships every switch off (HUD off, animation off), full variant, opacity inside the band", () => {
    expect(DEFAULT_HUD_PREFS).toEqual({
      enabled: false,
      variant: "full",
      animate: false,
      opacity: 88,
    });
    expect(DEFAULT_HUD_PREFS.opacity).toBeGreaterThanOrEqual(HUD_OPACITY_MIN);
    expect(DEFAULT_HUD_PREFS.opacity).toBeLessThanOrEqual(HUD_OPACITY_MAX);
  });

  it("lists exactly three variants and labels every one", () => {
    expect(HUD_VARIANTS).toEqual(["full", "compact", "minimal"]);
    for (const v of HUD_VARIANTS) {
      expect(VARIANT_LABEL[v].length).toBeGreaterThan(0);
    }
  });

  it("full shows everything; compact drops clock+chips; minimal keeps counts only", () => {
    expect(VARIANT_SPEC.full).toEqual({ camera: true, clock: true, counts: true, chips: true });
    expect(VARIANT_SPEC.compact).toEqual({ camera: true, clock: false, counts: true, chips: false });
    expect(VARIANT_SPEC.minimal).toEqual({ camera: false, clock: false, counts: true, chips: false });
  });

  it("every variant keeps the counts — that is the HUD's reason to exist", () => {
    for (const v of HUD_VARIANTS) expect(VARIANT_SPEC[v].counts).toBe(true);
  });

  it("the hotkey is H", () => {
    expect(HUD_HOTKEY).toBe("H");
  });

  it("chips label the four core layers, short", () => {
    expect(HUD_CHIP_LABEL).toEqual({
      cameras: "CAM",
      planes: "PLN",
      satellites: "SAT",
      webcams: "WBC",
    });
  });
});

describe("clampOpacity", () => {
  it("passes values inside the 40–100 band through, rounded", () => {
    expect(clampOpacity(40)).toBe(40);
    expect(clampOpacity(100)).toBe(100);
    expect(clampOpacity(88.4)).toBe(88);
    expect(clampOpacity(88.5)).toBe(89);
  });

  it("clamps the extremes", () => {
    expect(clampOpacity(0)).toBe(HUD_OPACITY_MIN);
    expect(clampOpacity(25)).toBe(HUD_OPACITY_MIN);
    expect(clampOpacity(150)).toBe(HUD_OPACITY_MAX);
    expect(clampOpacity(1000)).toBe(HUD_OPACITY_MAX);
  });

  it("non-finite input falls back to the default rather than rendering invisibly", () => {
    expect(clampOpacity(NaN)).toBe(DEFAULT_HUD_PREFS.opacity);
    expect(clampOpacity(Infinity)).toBe(DEFAULT_HUD_PREFS.opacity);
    expect(clampOpacity(-Infinity)).toBe(DEFAULT_HUD_PREFS.opacity);
  });
});

describe("sanitizeHudPrefs", () => {
  it("a foreign shape yields all defaults", () => {
    expect(sanitizeHudPrefs(null)).toEqual(DEFAULT_HUD_PREFS);
    expect(sanitizeHudPrefs(undefined)).toEqual(DEFAULT_HUD_PREFS);
    expect(sanitizeHudPrefs(42)).toEqual(DEFAULT_HUD_PREFS);
    expect(sanitizeHudPrefs("full")).toEqual(DEFAULT_HUD_PREFS);
    expect(sanitizeHudPrefs({})).toEqual(DEFAULT_HUD_PREFS);
  });

  it("repairs field by field, keeping what is valid", () => {
    expect(
      sanitizeHudPrefs({ enabled: false, variant: "compact", animate: false, opacity: 55 }),
    ).toEqual({ enabled: false, variant: "compact", animate: false, opacity: 55 });
  });

  it("a bad variant falls back to full without touching the rest", () => {
    expect(sanitizeHudPrefs({ variant: "huge", opacity: 60 }).variant).toBe("full");
    expect(sanitizeHudPrefs({ variant: "huge", opacity: 60 }).opacity).toBe(60);
  });

  it("non-boolean flags and non-numeric opacity fall back to defaults", () => {
    const p = sanitizeHudPrefs({ enabled: "yes", animate: 1, opacity: "77" });
    expect(p).toEqual(DEFAULT_HUD_PREFS);
  });

  it("clamps a persisted out-of-band opacity instead of trusting it", () => {
    expect(sanitizeHudPrefs({ opacity: 250 }).opacity).toBe(HUD_OPACITY_MAX);
    expect(sanitizeHudPrefs({ opacity: -5 }).opacity).toBe(HUD_OPACITY_MIN);
  });

  it("round-trips the defaults and drops unknown keys", () => {
    expect(sanitizeHudPrefs(DEFAULT_HUD_PREFS)).toEqual(DEFAULT_HUD_PREFS);
    const p = sanitizeHudPrefs({ ...DEFAULT_HUD_PREFS, extra: "junk" });
    expect(Object.keys(p).sort()).toEqual(["animate", "enabled", "opacity", "variant"]);
  });
});

describe("isHudVariant", () => {
  it("accepts the three variants and nothing else", () => {
    for (const v of HUD_VARIANTS) expect(isHudVariant(v)).toBe(true);
    expect(isHudVariant("Full")).toBe(false);
    expect(isHudVariant("")).toBe(false);
    expect(isHudVariant(1)).toBe(false);
    expect(isHudVariant(null)).toBe(false);
    expect(isHudVariant(undefined)).toBe(false);
    expect(isHudVariant({})).toBe(false);
  });
});

describe("compassPoint", () => {
  it("maps the eight cardinals", () => {
    expect(compassPoint(0)).toBe("N");
    expect(compassPoint(45)).toBe("NE");
    expect(compassPoint(90)).toBe("E");
    expect(compassPoint(135)).toBe("SE");
    expect(compassPoint(180)).toBe("S");
    expect(compassPoint(225)).toBe("SW");
    expect(compassPoint(270)).toBe("W");
    expect(compassPoint(315)).toBe("NW");
  });

  it("normalises negatives and wrap-around", () => {
    expect(compassPoint(360)).toBe("N");
    expect(compassPoint(720)).toBe("N");
    expect(compassPoint(-45)).toBe("NW");
    expect(compassPoint(-90)).toBe("W");
  });

  it("rounds to the nearest octant", () => {
    expect(compassPoint(22.4)).toBe("N");
    expect(compassPoint(22.5)).toBe("NE");
    expect(compassPoint(337.5)).toBe("N");
  });
});

describe("readout formatters", () => {
  it("lat and lon carry three decimals and a hemisphere", () => {
    expect(formatLat(28.424)).toBe("28.424°N");
    expect(formatLat(-28.424)).toBe("28.424°S");
    expect(formatLat(0)).toBe("0.000°N");
    expect(formatLon(-30)).toBe("30.000°W");
    expect(formatLon(45.5)).toBe("45.500°E");
  });

  it("zoom keeps one decimal", () => {
    expect(formatZoom(1.4)).toBe("Z1.4");
    expect(formatZoom(3)).toBe("Z3.0");
  });

  it("heading is three digits + cardinal, and 360 wraps to 000° N", () => {
    expect(formatHeading(45)).toBe("045° NE");
    expect(formatHeading(0)).toBe("000° N");
    expect(formatHeading(359.6)).toBe("000° N");
    expect(formatHeading(-45)).toBe("315° NW");
  });

  it("UTC clock is padded HH:MM:SS", () => {
    expect(formatUtcClock(Date.UTC(2026, 0, 2, 3, 4, 5))).toBe("03:04:05");
    expect(formatUtcClock(Date.UTC(2026, 0, 2, 23, 59, 59))).toBe("23:59:59");
    expect(formatUtcClock(Date.UTC(2026, 0, 2, 0, 0, 0))).toBe("00:00:00");
  });

  it("counts are thousands-separated and never negative", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(19112)).toBe("19,112");
    expect(formatCount(1234567)).toBe("1,234,567");
    expect(formatCount(12.9)).toBe("12");
    expect(formatCount(-3)).toBe("0");
  });
});
