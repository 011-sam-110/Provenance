// The Discord invitation's gate. PURE: no React, no DOM, no "use client" — the
// same reason lib/shell/feedback.ts is pure, and the same payoff: the interesting
// behaviour (who is asked, when, and what makes it stop forever) is testable in the
// node vitest environment with no window.
//
// HOW THIS DIFFERS FROM THE FEEDBACK GATE, AND WHY. Both are one-time asks over a
// persisted envelope, so the shape is deliberately the same. Two rules are not:
//
//   (a) NO SAMPLING ROLL. Feedback samples one in three because it is a survey, and
//       a survey wants a representative slice rather than every voice. An invitation
//       is not a survey — sampling it would simply throw away two thirds of the
//       reach for nothing in return.
//
//   (b) A MUCH SHORTER QUALIFYING TIME: 40 seconds of visible time, against
//       feedback's fifteen minutes. Feedback has to be earned — you cannot usefully
//       rate a thing you have not used. An invitation does not: the cost of asking
//       early is one dismissed card, and the cost of asking late is that the person
//       has already gone. Forty seconds is still long enough that a bounce (open,
//       glance, close) never sees it.
//
// WHAT IS THE SAME, AND IS LOAD-BEARING: resolving is PERMANENT. Nobody who has
// joined or said no is asked twice. The console header carries a DISCORD button, so
// a permanent "no" here closes the prompt and not the door — which is what makes a
// permanent no defensible rather than a one-way loss.

import { loadPersisted, savePersisted } from "@/lib/shell/persist";

export const COMMUNITY_KEY = "tn.community.v1";
export const COMMUNITY_VERSION = 1;

/**
 * 40 seconds of VISIBLE time before the invitation appears.
 *
 * Visible rather than wall clock, for the reason feedback.ts gives: this is a live
 * map, so a tab left open in the background is the normal case and means nobody
 * looked at it. A background tab must not burn through the qualifying time and
 * surface a card the person never sees, because the card would then be spent —
 * `resolved` is permanent, and an unseen impression is the worst way to spend it.
 */
export const QUALIFY_ACTIVE_MS = 40_000;

export type CommunityResolution = "joined" | "dismissed";

export interface CommunityState {
  /** Distinct page loads, incremented once per visit. Not a gate arm today — kept
   *  because it is the one number that says whether the ask is reaching new people
   *  or the same person repeatedly, and it costs one integer to have it later. */
  visits: number;
  /** Cumulative VISIBLE milliseconds across all visits. */
  activeMs: number;
  /** Set once, forever. Its presence is the permanent stop. */
  resolved?: CommunityResolution;
}

export const EMPTY_COMMUNITY_STATE: CommunityState = { visits: 0, activeMs: 0 };

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function loadCommunityState(storage?: StorageLike): CommunityState {
  const raw = loadPersisted<CommunityState>(COMMUNITY_KEY, COMMUNITY_VERSION, storage);
  if (!raw || typeof raw !== "object") return { ...EMPTY_COMMUNITY_STATE };
  // A hand-edited or half-written envelope must not become NaN maths downstream.
  const visits = Number.isFinite(raw.visits) && raw.visits > 0 ? Math.floor(raw.visits) : 0;
  const activeMs = Number.isFinite(raw.activeMs) && raw.activeMs > 0 ? raw.activeMs : 0;
  const resolved = raw.resolved === "joined" || raw.resolved === "dismissed" ? raw.resolved : undefined;
  return resolved ? { visits, activeMs, resolved } : { visits, activeMs };
}

export function saveCommunityState(state: CommunityState, storage?: StorageLike): void {
  savePersisted<CommunityState>(COMMUNITY_KEY, COMMUNITY_VERSION, state, storage);
}

/* ── Pure state transitions ─────────────────────────────────────────────── */

export function recordVisit(state: CommunityState): CommunityState {
  return { ...state, visits: state.visits + 1 };
}

export function addActiveMs(state: CommunityState, ms: number): CommunityState {
  if (!Number.isFinite(ms) || ms <= 0) return state;
  return { ...state, activeMs: state.activeMs + ms };
}

export function markResolved(state: CommunityState, how: CommunityResolution): CommunityState {
  return { ...state, resolved: how };
}

/* ── The gate ───────────────────────────────────────────────────────────── */

export function qualifies(state: CommunityState): boolean {
  return state.activeMs >= QUALIFY_ACTIVE_MS;
}

export interface CommunityGateContext {
  /** The cold-start plate is still on screen. */
  bootPlaying: boolean;
  /** A cinematic dive is flying or landed. A dive is the one deliberately
   *  immersive thing the console does; interrupting it with an ad for a chat
   *  server is the single worst moment available. */
  diveActive: boolean;
}

/** Why the card is being withheld, or null if nothing is withholding it. Returned
 *  as a reason rather than a boolean so a test names the arm it is exercising. */
export function blockedBy(state: CommunityState, ctx: CommunityGateContext): string | null {
  if (state.resolved) return state.resolved;
  if (ctx.bootPlaying) return "boot";
  if (ctx.diveActive) return "dive";
  return null;
}

export function shouldInvite(state: CommunityState, ctx: CommunityGateContext): boolean {
  if (blockedBy(state, ctx) !== null) return false;
  return qualifies(state);
}

/**
 * `?discord=1` forces the invitation open for review — the same override precedent
 * `?feedback=1` and `?boot=1` set. It bypasses the qualifying time; it does NOT
 * bypass a recorded resolution, so a review pass cannot silently re-ask someone who
 * has already said no.
 */
export function forcedFromSearch(search: string): boolean {
  try {
    return new URLSearchParams(search).get("discord") === "1";
  } catch {
    return false;
  }
}
