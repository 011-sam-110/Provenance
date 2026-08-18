// The feedback prompt's gate and payload contract. PURE: no React, no DOM, no
// "use client" — the API route imports the validator from here too, so the rules
// the browser applies and the rules the server enforces come from one source.
//
// Storage is injectable for the same reason lib/shell/persist.ts does it: the
// interesting behaviour (who qualifies, what is permanent, what a version bump
// invalidates) is then testable in the node vitest environment with no window.
//
// WHY THE ROLL IS PER VISIT, NOT PER BROWSER. Dismissing or submitting is
// permanent — nobody who has answered or said no is ever asked again. But if
// LOSING the 1-in-3 roll were also permanent, two thirds of everyone who ever
// used the console would be excluded forever, which is a cap rather than a
// sample. So the roll is made once per visit and a returning visitor gets a
// fresh one.

import { loadPersisted, savePersisted } from "@/lib/shell/persist";

export const FEEDBACK_KEY = "tn.feedback.v1";
export const FEEDBACK_VERSION = 1;

/** 15 minutes of VISIBLE time. Wall clock would qualify a tab left open overnight,
 *  which on a live map is normal and means nobody looked at it. */
export const QUALIFY_ACTIVE_MS = 15 * 60_000;
/** A second visit is itself evidence of use, whatever the clock says. */
export const QUALIFY_VISITS = 2;
/** 1-in-3. Sampling, not a queue — see the note at the top of this file. */
export const ROLL_DENOMINATOR = 3;
/** A human cannot read four questions and answer them faster than this. */
export const MIN_DWELL_MS = 3_000;

export const CAP_OCCUPATION = 100;
export const CAP_USEFUL = 1_000;
export const CAP_EMAIL = 200;
/** Hard ceiling on the whole JSON body, enforced server-side. The client's own
 *  field caps are a convenience; nothing trusts them. */
export const CAP_BODY_BYTES = 4_096;

export type FeedbackResolution = "submitted" | "dismissed";

export interface FeedbackState {
  /** Distinct page loads, incremented once per visit. */
  visits: number;
  /** Cumulative VISIBLE milliseconds across all visits. */
  activeMs: number;
  /** Set once, forever. Its presence is the permanent stop. */
  resolved?: FeedbackResolution;
}

export const EMPTY_FEEDBACK_STATE: FeedbackState = { visits: 0, activeMs: 0 };

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function loadFeedbackState(storage?: StorageLike): FeedbackState {
  const raw = loadPersisted<FeedbackState>(FEEDBACK_KEY, FEEDBACK_VERSION, storage);
  if (!raw || typeof raw !== "object") return { ...EMPTY_FEEDBACK_STATE };
  // A hand-edited or half-written envelope must not become NaN maths downstream.
  const visits = Number.isFinite(raw.visits) && raw.visits > 0 ? Math.floor(raw.visits) : 0;
  const activeMs = Number.isFinite(raw.activeMs) && raw.activeMs > 0 ? raw.activeMs : 0;
  const resolved = raw.resolved === "submitted" || raw.resolved === "dismissed" ? raw.resolved : undefined;
  return resolved ? { visits, activeMs, resolved } : { visits, activeMs };
}

export function saveFeedbackState(state: FeedbackState, storage?: StorageLike): void {
  savePersisted<FeedbackState>(FEEDBACK_KEY, FEEDBACK_VERSION, state, storage);
}

/* ── Pure state transitions ─────────────────────────────────────────────── */

export function recordVisit(state: FeedbackState): FeedbackState {
  return { ...state, visits: state.visits + 1 };
}

export function addActiveMs(state: FeedbackState, ms: number): FeedbackState {
  if (!Number.isFinite(ms) || ms <= 0) return state;
  return { ...state, activeMs: state.activeMs + ms };
}

export function markResolved(state: FeedbackState, how: FeedbackResolution): FeedbackState {
  return { ...state, resolved: how };
}

/* ── The gate ───────────────────────────────────────────────────────────── */

export type FeedbackTrigger = "time" | "return" | "both";

/** Which arm qualified them, or null if neither did. Reported with the response so
 *  the answers can be read against how the person was reached. */
export function triggerFor(state: FeedbackState): FeedbackTrigger | null {
  const byTime = state.activeMs > QUALIFY_ACTIVE_MS;
  const byReturn = state.visits >= QUALIFY_VISITS;
  if (byTime && byReturn) return "both";
  if (byTime) return "time";
  if (byReturn) return "return";
  return null;
}

export function qualifies(state: FeedbackState): boolean {
  return triggerFor(state) !== null;
}

export interface GateContext {
  /** The cold-start plate is still on screen. */
  bootPlaying: boolean;
  /** The guided tour is open — landing a modal on a first-run walkthrough is the
   *  worst possible first impression. */
  tourOpen: boolean;
  /** A cinematic dive is flying or landed. */
  diveActive: boolean;
}

export function blockedBy(state: FeedbackState, ctx: GateContext): string | null {
  if (state.resolved) return state.resolved;
  if (ctx.bootPlaying) return "boot";
  if (ctx.tourOpen) return "tour";
  if (ctx.diveActive) return "dive";
  return null;
}

/** The whole decision. `rollWon` is passed in rather than drawn here so the gate
 *  stays a pure function of its inputs and the test does not have to stub
 *  Math.random. */
export function shouldPrompt(state: FeedbackState, ctx: GateContext, rollWon: boolean): boolean {
  if (blockedBy(state, ctx) !== null) return false;
  if (!qualifies(state)) return false;
  return rollWon;
}

export function rollWins(draw: number): boolean {
  return draw < 1 / ROLL_DENOMINATOR;
}

/** `?feedback=1` forces the prompt open for review — the same override precedent
 *  `?boot=1` sets in lib/terminal/boot.ts. It bypasses the roll and the qualifying
 *  arms; it does NOT bypass a recorded dismissal, so a review pass cannot silently
 *  undo a visitor's "no". */
export function forcedFromSearch(search: string): boolean {
  try {
    return new URLSearchParams(search).get("feedback") === "1";
  } catch {
    return false;
  }
}

/* ── The payload contract ───────────────────────────────────────────────── */

export interface FeedbackPayload {
  occupation: string;
  useful: string;
  rating: number;
  email: string;
  trigger: FeedbackTrigger | "forced";
  dwellMs: number;
  /** Honeypot. A human never sees this field, so anything in it is a bot. */
  website?: string;
}

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TRIGGERS = new Set(["time", "return", "both", "forced"]);
const BAD_REQUEST = "Bad request body.";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * The single validator, run in the browser before sending and again in the route
 * before anything leaves the server. Rejects rather than coerces: a payload that
 * does not fit the shape is a bug or an attack, and quietly truncating it into
 * something plausible would hide both.
 */
export function validateFeedback(input: unknown): Validated<FeedbackPayload> {
  if (!input || typeof input !== "object") return { ok: false, error: BAD_REQUEST };
  const b = input as Record<string, unknown>;

  // Honeypot first: it is the cheapest rejection, and it deliberately returns the
  // same generic error as everything else so a bot cannot learn which field caught it.
  if (str(b.website)) return { ok: false, error: BAD_REQUEST };

  const occupation = str(b.occupation);
  if (!occupation || occupation.length > CAP_OCCUPATION) return { ok: false, error: BAD_REQUEST };

  const useful = str(b.useful);
  if (!useful || useful.length > CAP_USEFUL) return { ok: false, error: BAD_REQUEST };

  const rating = b.rating;
  if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 10) {
    return { ok: false, error: BAD_REQUEST };
  }

  // Optional, and optional means it validates when absent. An empty string is the
  // normal case, not an error state.
  const email = str(b.email);
  if (email && (email.length > CAP_EMAIL || !EMAIL_RE.test(email))) {
    return { ok: false, error: "That email address does not look right." };
  }

  const trigger = str(b.trigger);
  if (!TRIGGERS.has(trigger)) return { ok: false, error: BAD_REQUEST };

  const dwellMs = b.dwellMs;
  if (typeof dwellMs !== "number" || !Number.isFinite(dwellMs) || dwellMs < MIN_DWELL_MS) {
    return { ok: false, error: BAD_REQUEST };
  }

  return {
    ok: true,
    value: { occupation, useful, rating, email, trigger: trigger as FeedbackPayload["trigger"], dwellMs },
  };
}

/** The Telegram message body. Kept pure so its shape is pinned by a test rather
 *  than discovered in a chat window. */
export function formatFeedbackMessage(p: FeedbackPayload): string {
  return [
    `Provenance feedback - ${p.rating}/10`,
    "",
    `Occupation: ${p.occupation}`,
    `Useful: ${p.useful}`,
    p.email ? `Email: ${p.email} (wants a call)` : "Email: not given",
    `Triggered by: ${p.trigger}`,
  ].join("\n");
}
