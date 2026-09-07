// The live-build warning's gate. PURE: no React, no DOM, no "use client" — the same
// reason lib/shell/community.ts and lib/shell/feedback.ts are pure, and the same
// payoff: whether anyone is warned, and what makes it stop, is unit-tested in the
// node environment with no window.
//
// WHAT THIS IS FOR. Access codes are being handed out while the site is behind the
// maintenance gate, so the people arriving are invited testers rather than passers-by.
// They are the first to see a half-built console, and they need to know that before
// they hit it — what looks like a broken product is a product mid-build.
//
// HOW IT DIFFERS FROM THE COMMUNITY INVITATION, AND WHY. Both are one-time cards over
// a persisted envelope, so the shape is deliberately the same. Two rules are not:
//
//   (a) NO QUALIFYING TIME. CommunityNote waits 40 seconds of visible time, because an
//       invitation shown to a bounce is wasted. A warning is the opposite: shown late,
//       it arrives after the person already hit the bug it was warning about, which is
//       worse than not showing it. So it appears the moment the boot plate is gone.
//
//   (b) ACKNOWLEDGEMENT IS VERSIONED, NOT PERMANENT. Community stores `resolved`
//       forever. This stores WHICH REVISION of the text was acknowledged, so bumping
//       NOTICE_REVISION re-shows it to everyone — including people already holding a
//       code. Once a code is issued there is no other channel to them, and a warning
//       that cannot be updated is a warning that rots.
//
// AND IT IS A MODAL, where CommunityNote is a corner card. The invitation asks for
// nothing and may be ignored at no cost. This one carries the only statement anybody
// gets that the data is unverified and the software is unwarranted, so it takes the
// veil and the focus trap that FeedbackPrompt uses. Escape still closes it, because a
// dialog nobody can leave is an accessibility defect and this is a notice, not a
// contract.

import { loadPersisted, savePersisted } from "@/lib/shell/persist";

export const DEV_NOTICE_KEY = "tn.devnotice.v1";
export const DEV_NOTICE_VERSION = 1;

/**
 * The revision of the notice's TEXT, not of its storage schema.
 *
 * Bump it when the warning itself changes in a way people who already acknowledged
 * need to see — a new limitation, a changed promise. Bumping re-shows the dialog to
 * everyone exactly once. Do NOT bump it for a typo: every bump spends the attention
 * of every existing tester, and a card people learn to click through unread is worth
 * nothing when it finally says something that matters.
 */
export const NOTICE_REVISION = 1;

export interface DevNoticeState {
  /** The highest NOTICE_REVISION this person has acknowledged. 0 means never. */
  acknowledged: number;
}

export const EMPTY_DEV_NOTICE_STATE: DevNoticeState = { acknowledged: 0 };

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * Read the envelope, and FAIL OPEN on anything unexpected.
 *
 * A corrupt, hand-edited or half-written value resolves to "never acknowledged", so
 * the cost of confusion is one extra dialog. The other direction — treating nonsense
 * as an acknowledgement — silently suppresses the warning, and nothing downstream
 * would ever reveal that it had.
 */
export function loadDevNoticeState(storage?: StorageLike): DevNoticeState {
  const raw = loadPersisted<DevNoticeState>(DEV_NOTICE_KEY, DEV_NOTICE_VERSION, storage);
  if (!raw || typeof raw !== "object") return { ...EMPTY_DEV_NOTICE_STATE };
  const n = raw.acknowledged;
  // Number.isFinite rejects NaN and both infinities; 1e400 parses to Infinity.
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return { ...EMPTY_DEV_NOTICE_STATE };
  return { acknowledged: Math.floor(n) };
}

export function saveDevNoticeState(state: DevNoticeState, storage?: StorageLike): void {
  savePersisted<DevNoticeState>(DEV_NOTICE_KEY, DEV_NOTICE_VERSION, state, storage);
}

/* ── Pure state transitions ─────────────────────────────────────────────── */

export function markAcknowledged(state: DevNoticeState, revision: number): DevNoticeState {
  if (!Number.isFinite(revision) || revision <= 0) return state;
  return { ...state, acknowledged: Math.max(state.acknowledged, Math.floor(revision)) };
}

/* ── The gate ───────────────────────────────────────────────────────────── */

export interface DevNoticeGateContext {
  /** The cold-start plate is still on screen. */
  bootPlaying: boolean;
}

/**
 * Why the notice is being withheld, or null if nothing is withholding it. A reason
 * rather than a boolean so a test names the arm it is exercising.
 *
 * There is deliberately no `diveActive` arm, unlike the community gate. A cinematic
 * dive cannot be running before the first paint, and if one somehow were, a warning
 * still outranks it — that gate protects an immersive moment from an advert, which is
 * not what this is.
 */
export function blockedBy(state: DevNoticeState, ctx: DevNoticeGateContext): string | null {
  if (ctx.bootPlaying) return "boot";
  if (state.acknowledged >= NOTICE_REVISION) return "acknowledged";
  return null;
}

export function shouldWarn(state: DevNoticeState, ctx: DevNoticeGateContext): boolean {
  return blockedBy(state, ctx) === null;
}

/**
 * `?notice=1` forces it open, the precedent `?discord=1` and `?feedback=1` set.
 *
 * IT DIFFERS FROM BOTH ON PURPOSE. Those refuse to bypass a recorded answer, because
 * re-asking someone who already said no disrespects the no. There is no "no" here —
 * acknowledging a warning declines nothing — so re-reading it costs nothing, and being
 * able to send a tester straight back to the terms is worth having. It does not
 * override the boot arm: that one is about the notice being readable at all.
 */
export function forcedFromSearch(search: string): boolean {
  try {
    return new URLSearchParams(search).get("notice") === "1";
  } catch {
    return false;
  }
}
