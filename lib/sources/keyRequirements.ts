// Which capabilities need a credential, and are we holding it?
//
// WHY THIS EXISTS. Six of our layers are key-gated. Without a key they resolve to
// [] — which is the right dormant-safe behaviour, but on screen it is
// indistinguishable from a dead upstream, a broken adapter, or a genuinely quiet
// feed. A visitor sees an empty layer and concludes the product is broken. Both
// competitors get this exact complaint filed against them (worldmonitor #5829,
// #6149), and we had no answer either.
//
// So: one declarative table of what each capability requires, a pure resolver
// against an env bag, and /api/status to publish it. The table is deliberately
// separate from the adapters rather than a field on SignalSource, because
// (a) it is the ONE place to see the whole gating picture, and (b) several of the
// gated capabilities are not signal layers at all (webcams, equities, the brief).
//
// SECURITY. Nothing here ever reads or exposes a VALUE. `configured` is a boolean
// derived from presence-and-non-emptiness, and only variable NAMES are published.
// Publishing the names is fine and useful — they are documented in docs/API_KEYS.md
// and are what a self-hoster needs to know.

/** What a gated capability needs, and what the user loses while it is missing. */
export interface KeyRequirement {
  /** Signal id, or a synthetic id for a non-signal capability (see NON_SIGNAL_IDS). */
  id: string;
  label: string;
  /** Env var NAMES. All of them must be present for the capability to work. */
  env: string[];
  /** Plain-English consequence of the key being absent. Shown in the UI. */
  degrades: string;
  /** Where a self-hoster gets one. Free unless stated. */
  obtain: string;
}

export const KEY_REQUIREMENTS: KeyRequirement[] = [
  {
    id: "acled",
    label: "ACLED conflict events",
    env: ["ACLED_EMAIL", "ACLED_PASSWORD"],
    degrades:
      "The conflict-event layer is empty, and the Country Instability Index loses its 0.40-weight conflict factor, capping every score at roughly 49/100.",
    obtain: "Free for non-commercial use — register at acleddata.com and request API read access.",
  },
  {
    id: "ais",
    label: "Ship traffic (AIS)",
    env: ["AISSTREAM_API_KEY"],
    degrades: "No live vessel positions at chokepoints and ports.",
    obtain: "Free — aisstream.io.",
  },
  {
    id: "air-quality-stations",
    label: "Air-quality monitoring stations",
    env: ["OPENAQ_API_KEY"],
    degrades: "No station-level air quality; the modelled air-quality layer still works.",
    obtain: "Free — openaq.org.",
  },
  {
    id: "fire-active",
    label: "NASA FIRMS active fires",
    env: ["FIRMS_MAP_KEY"],
    degrades: "No satellite thermal-anomaly detections; the EONET wildfire layer still works.",
    obtain: "Free — firms.modaps.eosdis.nasa.gov/api/map_key.",
  },
  {
    id: "grid-load",
    label: "European grid load",
    env: ["ENTSOE_API_TOKEN"],
    degrades: "No electricity demand or generation for the European grid.",
    obtain: "Free — register at transparency.entsoe.eu, then email transparency@entsoe.eu for REST access (~3 working days).",
  },
  {
    id: "reliefweb",
    label: "ReliefWeb situation reports",
    env: ["RELIEFWEB_APPNAME"],
    degrades: "No UN OCHA humanitarian situation reports.",
    obtain: "Free, no signup — ReliefWeb only wants an identifying app-name string.",
  },
  // --- capabilities that are not signal layers ------------------------------
  {
    id: "webcams",
    label: "Windy global webcams",
    env: ["WINDY_WEBCAMS_API_KEY"],
    degrades: "The 70k-webcam layer is empty. Our 11 government camera networks are keyless and unaffected.",
    obtain: "Free tier — api.windy.com/webcams.",
  },
  {
    id: "markets-equities",
    label: "Live equities",
    env: ["FINNHUB_API_KEY"],
    degrades: "The Markets widget shows crypto and FX only; the equities section stays dormant.",
    obtain: "Free tier — finnhub.io.",
  },
  {
    id: "markets-macro",
    label: "US macro series",
    env: ["FRED_API_KEY"],
    degrades: "No rates / VIX / CPI in the Markets widget.",
    obtain: "Free — fred.stlouisfed.org/docs/api/api_key.html.",
  },
  {
    id: "ai-brief",
    label: "AI-written brief and news synthesis",
    env: ["FREELLMAPI_BASE_URL", "FREELLMAPI_KEY"],
    degrades:
      "The brief falls back to the keyless heuristic version. The numbers are identical either way — only the prose is missing.",
    obtain: "Any OpenAI-compatible gateway.",
  },
];

/** Ids in KEY_REQUIREMENTS that are capabilities rather than signal layers. */
export const NON_SIGNAL_IDS = new Set(["webcams", "markets-equities", "markets-macro", "ai-brief"]);

const BY_ID = new Map(KEY_REQUIREMENTS.map((r) => [r.id, r]));

export function keyRequirementFor(id: string): KeyRequirement | undefined {
  return BY_ID.get(id);
}

/** A capability with no entry in the table is keyless — that is the default and the norm. */
export function isKeyless(id: string): boolean {
  return !BY_ID.has(id);
}

/** Present AND non-blank. An empty string in .env is the classic "I thought I set that". */
export function hasEnv(env: Record<string, string | undefined>, name: string): boolean {
  const v = env[name];
  return typeof v === "string" && v.trim().length > 0;
}

/** Env var NAMES that a capability needs but we do not hold. Empty = ready to go. */
export function missingEnvFor(id: string, env: Record<string, string | undefined>): string[] {
  const req = BY_ID.get(id);
  if (!req) return [];
  return req.env.filter((name) => !hasEnv(env, name));
}

export type CapabilityState = "keyless" | "configured" | "locked";

export function capabilityState(id: string, env: Record<string, string | undefined>): CapabilityState {
  if (isKeyless(id)) return "keyless";
  return missingEnvFor(id, env).length === 0 ? "configured" : "locked";
}

/** What a locked capability's badge says. Null when nothing is locked. */
export function lockedReason(id: string, env: Record<string, string | undefined>): string | null {
  const req = BY_ID.get(id);
  if (!req) return null;
  const missing = missingEnvFor(id, env);
  if (missing.length === 0) return null;
  return `Needs ${missing.join(" + ")}. ${req.degrades} ${req.obtain}`;
}
