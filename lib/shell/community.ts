// The Discord pop-up's gate. PURE: no React, no DOM, no "use client" — the
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
//   (b) A MUCH SHORTER QUALIFYING TIME: 15 seconds of visible time, against
//       feedback's fifteen minutes. Feedback has to be earned — you cannot usefully
//       rate a thing you have not used. An invitation does not: the cost of asking
//       early is one dismissed pop-up, and the cost of asking late is that the person
//       has already gone. Fifteen seconds is still long enough that a bounce (open,
//       glance, close) never sees it.
//
// WHAT IS THE SAME, AND IS LOAD-BEARING: resolving is PERMANENT. Nobody who has
// joined or said no to THIS pop-up is asked twice. The settings drawer carries a Discord link, so
// a permanent "no" here closes the prompt and not the door — which is what makes a
// permanent no defensible rather than a one-way loss.

import { loadPersisted, savePersisted } from "@/lib/shell/persist";

export const COMMUNITY_KEY = "tn.community.v1";
/**
 * 2 since 2026-10-30, and the bump IS the feature. Version 1 recorded answers to the old
 * corner card, and the invite behind that card was dead from 7 October. Everyone who pressed
 * "Join" in those weeks reached a dead page and is stored as `joined`, so they are exactly the
 * people this pop-up is for, and a permanent stop would hide it from them. loadPersisted reads
 * an older envelope as a miss, so each browser sees the pop-up once more, whatever it answered
 * before. The same key is kept so that the next save overwrites the old value and strands nothing.
 */
export const COMMUNITY_VERSION = 2;

/**
 * 15 seconds of VISIBLE time before the pop-up appears.
 *
 * Visible rather than wall clock, for the reason feedback.ts gives: this is a live
 * map, so a tab left open in the background is the normal case and means nobody
 * looked at it. A background tab must not burn through the qualifying time and
 * surface a pop-up the person never sees, because the pop-up would then be spent —
 * `resolved` is permanent, and an unseen impression is the worst way to spend it.
 */
export const QUALIFY_ACTIVE_MS = 15_000;

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
  /** Any other `[role="dialog"]` is on screen: the feedback prompt, the palette, an object's
   *  inspector, settings. Two modals would fight over focus, and a person reading a panel
   *  is busy. It simply waits for the panel to close. */
  otherDialog: boolean;
  /** Focus is in a text field. A pop-up that takes the focus mid-word loses the word. */
  typing: boolean;
  /** `navigator.webdriver`: Playwright, a crawler, the reel filmer. The old corner card let
   *  clicks through. This one has a veil, so a journey running past 15 seconds would break on
   *  it, and a film would carry it. `?discord=1` still opens it, which is how a test asks. */
  automated: boolean;
}

/** Why the pop-up is being withheld, or null if nothing is withholding it. Returned
 *  as a reason rather than a boolean so a test names the arm it is exercising. */
export function blockedBy(state: CommunityState, ctx: CommunityGateContext): string | null {
  if (state.resolved) return state.resolved;
  if (ctx.bootPlaying) return "boot";
  if (ctx.diveActive) return "dive";
  if (ctx.otherDialog) return "dialog";
  if (ctx.typing) return "typing";
  if (ctx.automated) return "automated";
  return null;
}

export function shouldInvite(state: CommunityState, ctx: CommunityGateContext): boolean {
  if (blockedBy(state, ctx) !== null) return false;
  return qualifies(state);
}

/**
 * The one decision the component makes. A review opens it whatever was answered before, so a
 * reload keeps showing it, but it still will not land on a dive or on top of another dialog.
 */
export function shouldOpenInvite(state: CommunityState, ctx: CommunityGateContext, forced: boolean): boolean {
  return forced ? !ctx.diveActive && !ctx.otherDialog : shouldInvite(state, ctx);
}

/** A field that is taking typed words. Takes the two properties it reads, so a node test can call it. */
export function isTypingTarget(el: Pick<HTMLElement, "tagName" | "isContentEditable"> | null): boolean {
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable === true;
}

/* ── Surfaces ───────────────────────────────────────────────────────────── */

/**
 * The pop-up is mounted in two places: the console, and (since 2026-09-14) the landing page,
 * where most visitors arrive and many never open /app. Both read and write the SAME
 * `tn.community.v1` state, so an answer on one is final on the other. God's eye view does not
 * carry it, by request: the pop-up belongs on the dashboard, and that view stays the scene.
 */
export type CommunitySurface = "console" | "landing";

/** Only the console has a cold-start plate, so on the landing page the first evaluation waits only long
 *  enough for the page to settle. That is under the 15-second bar, so only a `?discord=1`
 *  review can show the pop-up this early. */
export const LANDING_HOLD_MS = 1_500;

/** How long the component waits before its first evaluation. The console passes its
 *  own boot-derived hold, and gets it back unchanged. */
export function initialHoldMs(surface: CommunitySurface, consoleHoldMs: number): number {
  return surface === "console" ? consoleHoldMs : LANDING_HOLD_MS;
}

/** The gate context for a surface. Only the console has a boot plate and a cinematic dive,
 *  so neither can hold the pop-up back on the landing page. The other arms apply on both. */
export function gateContext(surface: CommunitySurface, live: CommunityGateContext): CommunityGateContext {
  return surface === "console" ? live : { ...live, bootPlaying: false, diveActive: false };
}

/**
 * `?discord=1` forces the pop-up open for review, the same override precedent `?feedback=1`
 * and `?boot=1` set. It bypasses the qualifying time AND a recorded answer: nobody reaches it
 * by accident, so it cannot re-ask a visitor who said no, and a review by reloading must
 * show the pop-up every time.
 */
export function forcedFromSearch(search: string): boolean {
  try {
    return new URLSearchParams(search).get("discord") === "1";
  } catch {
    return false;
  }
}

export const COMMUNITY_REVIEW_KEY = "tn.community.review";

type SessionLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * The review flag, kept for the life of the tab. The console rewrites its address and drops
 * `discord=1`, so without this a plain reload there would show nothing. Reviews
 * are done by reloading. `?discord=0` ends one.
 */
export function reviewRequested(search: string, session?: SessionLike | null): boolean {
  try {
    if (forcedFromSearch(search)) {
      session?.setItem(COMMUNITY_REVIEW_KEY, "1");
      return true;
    }
    if (new URLSearchParams(search).get("discord") === "0") {
      session?.removeItem(COMMUNITY_REVIEW_KEY);
      return false;
    }
    return session?.getItem(COMMUNITY_REVIEW_KEY) === "1";
  } catch {
    return forcedFromSearch(search);
  }
}
