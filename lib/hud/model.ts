// The HUD's pure model: the persisted-prefs shape, the variant table, and the small
// formatters the overlay and its settings tool share. NO React and NO DOM imports —
// everything here must run in the repo's node vitest environment, and tests/unit/
// hud-model.test.ts pins the table so a variant change cannot drift silently.
//
// WHY THE VARIANTS ARE A TABLE AND NOT THREE COMPONENT BRANCHES. "Full / Compact /
// Minimal" differ only in WHICH blocks render, not in how any one block renders, so
// the spec is data and Hud.tsx is one pass over it. Adding a fourth variant is one
// row here, one line in HUD_VARIANTS, and nothing else.

export const HUD_VARIANTS = ["full", "compact", "minimal"] as const;
export type HudVariant = (typeof HUD_VARIANTS)[number];

/** The hotkey that toggles the overlay — scoped to the /demo-hud page, not global. */
export const HUD_HOTKEY = "H";

export const HUD_OPACITY_MIN = 40;
export const HUD_OPACITY_MAX = 100;

export interface HudPrefs {
  /** The overlay is drawn at all. Default OFF — opt-in from Map settings. */
  enabled: boolean;
  /** Which blocks render (Full / Compact / Minimal). */
  variant: HudVariant;
  /** Split-flap cascades run, or values settle instantly. Default OFF — every
   *  switch ships off; the user turns the flourishes on. */
  animate: boolean;
  /** Overlay opacity in percent, clamped to 40–100. */
  opacity: number;
}

export const DEFAULT_HUD_PREFS: HudPrefs = {
  enabled: false,
  variant: "full",
  animate: false,
  opacity: 88,
};

/** User-facing variant names, in the repo's calm plain language. */
export const VARIANT_LABEL: Record<HudVariant, string> = {
  full: "Full",
  compact: "Compact",
  minimal: "Minimal",
};

/** Which blocks each variant renders. Every variant keeps the counts — that is the
 *  HUD's reason to exist; the variants trim the chrome around them. */
export interface HudVariantSpec {
  camera: boolean; // lat / lon / zoom / heading
  clock: boolean; // UTC clock
  counts: boolean; // live metric counts
  chips: boolean; // active layer chips
}

export const VARIANT_SPEC: Record<HudVariant, HudVariantSpec> = {
  full: { camera: true, clock: true, counts: true, chips: true },
  compact: { camera: true, clock: false, counts: true, chips: false },
  minimal: { camera: false, clock: false, counts: true, chips: false },
};

export function isHudVariant(v: unknown): v is HudVariant {
  return typeof v === "string" && (HUD_VARIANTS as readonly string[]).includes(v);
}

/** Clamp + round an opacity percent into the 40–100 band. Non-finite input falls
 *  back to the default, because a persisted NaN would render an invisible HUD. */
export function clampOpacity(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_HUD_PREFS.opacity;
  return Math.min(HUD_OPACITY_MAX, Math.max(HUD_OPACITY_MIN, Math.round(n)));
}

/**
 * Validate + repair a persisted blob into a usable HudPrefs. Mirror of the shell
 * stores' coerce functions: anything wrong falls back to the default for THAT field,
 * never to a crash, and a totally foreign shape yields all defaults.
 */
export function sanitizeHudPrefs(raw: unknown): HudPrefs {
  const d = DEFAULT_HUD_PREFS;
  if (!raw || typeof raw !== "object") return { ...d };
  const r = raw as Record<string, unknown>;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : d.enabled,
    variant: isHudVariant(r.variant) ? r.variant : d.variant,
    animate: typeof r.animate === "boolean" ? r.animate : d.animate,
    opacity: typeof r.opacity === "number" ? clampOpacity(r.opacity) : d.opacity,
  };
}

// ── Readout formatters ─────────────────────────────────────────────────────────
// Each returns the exact string a flap column will render, so the flap planner only
// ever sees display text. All are deterministic — no locale calls on the numbers
// that flap (toLocaleString is fine for counts, which only flap on real changes).

const COMPASS_DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** Cardinal direction for a 0–360 bearing. Normalises negatives and ≥360 first,
 *  so a bearing of 360 reads "N" and not an out-of-range index. */
export function compassPoint(bearing: number): string {
  const norm = ((bearing % 360) + 360) % 360;
  return COMPASS_DIRS[Math.round(norm / 45) % 8];
}

/** e.g. 28.424 → "28.424°N". The degree sign sits with the hemisphere. */
export function formatLat(lat: number): string {
  return `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? "N" : "S"}`;
}

/** e.g. -30.0 → "30.000°W". */
export function formatLon(lon: number): string {
  return `${Math.abs(lon).toFixed(3)}°${lon >= 0 ? "E" : "W"}`;
}

/** Zoom, one decimal: the HUD reads out what the camera is doing, not map internals. */
export function formatZoom(zoom: number): string {
  return `Z${zoom.toFixed(1)}`;
}

/** Heading: three digits + cardinal, e.g. "045° NE". 360 rounds to "000° N". */
export function formatHeading(bearing: number): string {
  const deg = ((Math.round(((bearing % 360) + 360) % 360) % 360) + 360) % 360;
  return `${String(deg).padStart(3, "0")}° ${compassPoint(bearing)}`;
}

/** UTC wall clock, HH:MM:SS. Padded, so every column always has two digits and the
 *  flap board never has to renumber for a single-digit hour. */
export function formatUtcClock(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** Thousands-separated count, e.g. 19112 → "19,112". */
export function formatCount(n: number): string {
  return Math.max(0, Math.floor(n)).toLocaleString("en-US");
}

/** Short chip label per core layer key — the HUD's chips are narrow by design. */
export type HudChipKey = "cameras" | "planes" | "satellites" | "webcams";
export const HUD_CHIP_LABEL: Record<HudChipKey, string> = {
  cameras: "CAM",
  planes: "PLN",
  satellites: "SAT",
  webcams: "WBC",
};
