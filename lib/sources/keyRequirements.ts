// Which capabilities need a credential, and are we holding it?
//
// WHY THIS EXISTS. Several of our layers are key-gated. Without a key they resolve to
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

/**
 * Whether a credential is REQUIRED for the capability to work at all, or merely
 * improves it.
 *
 * This distinction was missing and /api/status lied because of it: it reported the
 * Markets equities and macro sections as "locked — stays dormant" while both were
 * rendering six and four rows from a keyless Yahoo fallback. Telling a user a
 * working feature is dead is the same class of error as telling them a dead one is
 * live.
 */
export type KeyKind = "required" | "enhancement";

/** What a gated capability needs, and what the user loses while it is missing. */
export interface KeyRequirement {
  /** "required" = dead without it. "enhancement" = works keylessly, better with it. */
  kind: KeyKind;
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
    kind: "required",
    id: "ais",
    label: "Ship traffic (AIS)",
    env: ["AISSTREAM_API_KEY"],
    degrades: "No live vessel positions at chokepoints and ports.",
    obtain: "Free — aisstream.io.",
  },
  {
    kind: "required",
    id: "air-quality-stations",
    label: "Air-quality monitoring stations",
    env: ["OPENAQ_API_KEY"],
    degrades: "No station-level air quality; the modelled air-quality layer still works.",
    obtain: "Free — openaq.org.",
  },
  {
    kind: "required",
    id: "fire-active",
    label: "NASA FIRMS active fires",
    env: ["FIRMS_MAP_KEY"],
    degrades: "No satellite thermal-anomaly detections; the EONET wildfire layer still works.",
    obtain: "Free — firms.modaps.eosdis.nasa.gov/api/map_key.",
  },
  {
    kind: "required",
    id: "grid-load",
    label: "European grid load",
    env: ["ENTSOE_API_TOKEN"],
    degrades: "No electricity demand or generation for the European grid.",
    obtain: "Free — register at transparency.entsoe.eu, then email transparency@entsoe.eu for REST access (~3 working days).",
  },
  {
    kind: "required",
    id: "reliefweb",
    label: "ReliefWeb situation reports",
    env: ["RELIEFWEB_APPNAME"],
    degrades: "No UN OCHA humanitarian situation reports.",
    obtain: "Free, no signup — ReliefWeb only wants an identifying app-name string.",
  },
  // --- capabilities that are not signal layers ------------------------------
  {
    kind: "required",
    id: "webcams",
    label: "Windy global webcams",
    env: ["WINDY_WEBCAMS_API_KEY"],
    degrades: "The 70k-webcam layer is empty. Our 11 government camera networks are keyless and unaffected.",
    obtain: "Free tier — api.windy.com/webcams.",
  },
  {
    kind: "required",
    id: "youtube-live",
    label: "Live channel resolution (news presets, ISS panel)",
    env: ["YOUTUBE_API_KEY"],
    degrades:
      "Live video ids fall back to the pinned ones, which rot: 8 of the 12 news presets were already dead when audited on 2026-08-14, and the ISS panel shows an empty state instead of a stream. Nothing errors, and no other layer is affected.",
    obtain:
      "Free, no billing account: console.cloud.google.com → enable YouTube Data API v3 → Credentials → API key. Restrict it to that API, leave application restrictions as None (it is called server-side).",
  },
  {
    kind: "enhancement",
    id: "markets-equities",
    label: "Real-time equities",
    env: ["FINNHUB_API_KEY"],
    degrades:
      "Equities still render, keylessly, from Yahoo Finance delayed quotes. The key upgrades them to real time.",
    obtain: "Free tier — finnhub.io.",
  },
  {
    kind: "enhancement",
    id: "markets-macro",
    label: "US macro series (FRED)",
    env: ["FRED_API_KEY"],
    degrades:
      "Treasury yields and VIX still render, keylessly, from Yahoo. The key adds the full FRED series set (CPI and the rest).",
    obtain: "Free — fred.stlouisfed.org/docs/api/api_key.html.",
  },
  {
    // Found by the env-scan guard in tests/unit/sources-status.test.ts, which is
    // exactly what that guard is for: FREELLMAPI_VISION_MODEL gates a real user-
    // facing fallback and was in nobody's table.
    kind: "enhancement",
    id: "geolocate-vision",
    label: "Photo geolocation — vision fallback",
    env: ["FREELLMAPI_BASE_URL", "FREELLMAPI_KEY", "FREELLMAPI_VISION_MODEL"],
    degrades:
      "The /locate tool still runs on EXIF and landmark matching. Without these it cannot fall back to a vision model for a photo that carries no metadata, so it answers 'no location could be estimated' more often.",
    obtain: "Any OpenAI-compatible gateway with a vision model.",
  },
  {
    kind: "enhancement",
    id: "ai-brief",
    label: "AI-written brief and news synthesis",
    env: ["FREELLMAPI_BASE_URL", "FREELLMAPI_KEY"],
    degrades:
      "The brief falls back to the keyless heuristic version. The numbers are identical either way — only the prose is missing.",
    obtain: "Any OpenAI-compatible gateway.",
  },
  {
    kind: "required",
    id: "feedback-prompt",
    label: "In-console feedback prompt",
    env: ["FEEDBACK_TELEGRAM_BOT_TOKEN", "FEEDBACK_TELEGRAM_CHAT_ID"],
    degrades:
      "The prompt never mounts, so nobody is asked and no dead form is shown. Nothing else about the console changes.",
    obtain:
      "Free - @BotFather on Telegram issues the token; the chat id is the destination chat. Unlike the /api/telegram relay, these are the DEPLOYMENT'S own credentials, not the visitor's.",
  },
];

/** Ids in KEY_REQUIREMENTS that are capabilities rather than signal layers. */
export const NON_SIGNAL_IDS = new Set([
  "webcams",
  // Console capability, not a map layer — resolves channel ids to live video ids.
  "youtube-live",
  "markets-equities",
  "markets-macro",
  "ai-brief",
  "geolocate-vision",
  // A product-feedback channel, not a data capability.
  "feedback-prompt",
]);

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

/**
 * - keyless    — needs no credential at all. The default and the norm.
 * - configured — required credential, we hold it, and nothing has been observed
 *                against it. NOT a promise that the upstream accepts it — only
 *                that no upstream has been seen refusing it in this process.
 * - refused    — required credential, we hold it, AND an upstream we send it to
 *                answered 401/402/403. See below.
 * - locked     — required credential, and we do not hold it. Genuinely unavailable.
 * - upgradable — OPTIONAL credential we do not hold. The feature works keylessly;
 *                a key would make it better. Reporting this as "locked" was a lie.
 * - enhanced   — optional credential, and we hold it.
 *
 * WHY `refused` EXISTS. Holding a credential and having it accepted are two
 * different facts, and the report used to carry only the first. ACLED was published
 * as `configured` with `missingEnv: []` — "we hold ACLED_EMAIL and ACLED_PASSWORD" —
 * while acleddata.com answered HTTP 403 to a token that had just passed ACLED's own
 * (ACLED was removed as a layer on 2026-09-05 for exactly that reason, so do not go
 * looking for it in the table above — the lesson it taught is why `refused` exists.)
 * OAuth password grant. Every reader hears "this works". It does not, and no amount
 * of reading the config could tell you so.
 *
 * `refused` is EVIDENCE-DRIVEN, never a list of layers we happen to know are broken:
 * it is reached only from a verdict of an actually-observed refusal (see
 * lib/sources/upstreamEvidence.ts). A capability nothing has been observed about
 * stays `configured`. Silence is not proof.
 */
export type CapabilityState =
  | "keyless"
  | "configured"
  | "refused"
  | "locked"
  | "upgradable"
  | "enhanced";

/** What observation supports about a credential we hold. */
export type CredentialVerdict = "refused" | "accepted" | "unknown";

/** True for a state in which the capability delivers something usable right now. */
export function isUsable(state: CapabilityState): boolean {
  return state !== "locked" && state !== "refused";
}

/**
 * Fold observed evidence into the configured state. Pure.
 *
 * Only a credential we actually SEND can be refused, so the transition is reachable
 * from `configured` and `enhanced` alone. A `keyless` layer sends nothing; `locked`
 * and `upgradable` mean we hold nothing to send. A 403 seen against any of those
 * three is somebody else's problem — a WAF, a geo-block, an unrelated caller — and
 * pinning it on our configuration would be a guess.
 */
export function stateWithEvidence(base: CapabilityState, verdict: CredentialVerdict): CapabilityState {
  if (verdict !== "refused") return base;
  return base === "configured" || base === "enhanced" ? "refused" : base;
}

export function capabilityState(id: string, env: Record<string, string | undefined>): CapabilityState {
  const req = BY_ID.get(id);
  if (!req) return "keyless";
  const held = missingEnvFor(id, env).length === 0;
  if (req.kind === "enhancement") return held ? "enhanced" : "upgradable";
  return held ? "configured" : "locked";
}

/** What a locked capability's badge says. Null when nothing is missing. */
export function lockedReason(id: string, env: Record<string, string | undefined>): string | null {
  const req = BY_ID.get(id);
  if (!req) return null;
  const missing = missingEnvFor(id, env);
  if (missing.length === 0) return null;
  return `Needs ${missing.join(" + ")}. ${req.degrades} ${req.obtain}`;
}
