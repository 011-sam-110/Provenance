// The live-build warning's gate. IT IS CURRENTLY SWITCHED OFF — see
// DEV_NOTICE_ENABLED below for why, and for the one line that turns it back on.
// Everything under that switch is intact and still tested, deliberately.
//
// PURE: no React, no DOM, no "use client" — the same
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
 * THE OFF SWITCH. Set to `false`, so nobody is shown the notice at all.
 *
 * WHY IT IS OFF. Asked for — "turn it off for now". Nothing about the card is
 * broken and nothing here is deprecated: the text, the storage envelope, the focus
 * trap and the revision ladder are all intact and all still tested. This is a
 * product decision about whether the console currently opens with a modal, and it
 * is expected to be reversed.
 *
 * WHY A CONSTANT AND NOT A DELETION. A deleted modal comes back as a rewrite, and
 * the rewrite loses the parts that were argued for rather than designed — that
 * acknowledgement is versioned rather than permanent, that the veil does not
 * dismiss, that focus lands on the primary action and not on the licence link
 * mid-sentence. Those decisions are more expensive than the markup they sit in.
 *
 * HOW TO TURN IT BACK ON. Set this to `true`. That is the whole change; nothing
 * else in the app reads it, and nothing needs to be re-wired. One test asserts this
 * value on purpose (tests/unit/devnotice.test.ts, "the off switch"), so the flip
 * goes red once and tells you which cases invert with it — turning it back on is
 * meant to be a decision somebody made, not a line that drifted.
 *
 * WHY IT IS NOT AN ENV VAR. Every other gate in this shell is a constant in its own
 * pure module, testable in the node environment with no process state. An env var
 * would make "is the notice on?" a question about a deployment rather than about
 * the tree, and it would be unanswerable from a unit test — which is the one place
 * this decision is currently written down.
 */
export const DEV_NOTICE_ENABLED = false;

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
 * `disabled` IS FIRST, AND THE ORDER IS THE POINT. The other two arms answer "not
 * to this person, not yet"; this one answers "not at all". Reporting `boot` while
 * the notice is switched off would be true of the boot plate and misleading about
 * the product, and a reason that names the wrong cause is worse than a boolean.
 *
 * `enabled` IS A PARAMETER DEFAULTING TO THE CONSTANT, for the same reason `storage`
 * is injectable above: it keeps the switch a single exported constant for the app
 * while letting the tests hold the gate OPEN and go on proving the acknowledgement
 * ladder works. A gate whose arms stop being exercised the moment it is shut is a
 * gate nobody can flip back on with any confidence.
 *
 * There is deliberately no `diveActive` arm, unlike the community gate. A cinematic
 * dive cannot be running before the first paint, and if one somehow were, a warning
 * still outranks it — that gate protects an immersive moment from an advert, which is
 * not what this is.
 */
export function blockedBy(
  state: DevNoticeState,
  ctx: DevNoticeGateContext,
  enabled: boolean = DEV_NOTICE_ENABLED,
): string | null {
  if (!enabled) return "disabled";
  if (ctx.bootPlaying) return "boot";
  if (state.acknowledged >= NOTICE_REVISION) return "acknowledged";
  return null;
}

export function shouldWarn(
  state: DevNoticeState,
  ctx: DevNoticeGateContext,
  enabled: boolean = DEV_NOTICE_ENABLED,
): boolean {
  return blockedBy(state, ctx, enabled) === null;
}

/**
 * The WHOLE decision, `?notice=1` included — what the component actually asks.
 *
 * It lives here rather than as `FORCED || shouldWarn(...)` at the call site because
 * the force is no longer a plain OR, and an `||` in a .tsx file is a rule no test in
 * this project can reach (vitest is node-environment and collects .ts only).
 *
 * THE FORCE DOES NOT BEAT THE OFF SWITCH, and that is the one judgement in this
 * file. `boot` and `acknowledged` are facts about the visitor in front of us, and
 * overriding them costs that visitor nothing — re-reading a warning declines
 * nothing, which is why the param was allowed to override them in the first place.
 * `disabled` is not about the visitor: it records that this text is not what the
 * project is currently saying about itself. `?notice=1` is unauthenticated and
 * pasteable, so honouring it would let any link republish a withdrawn statement
 * about warranty and data quality. Turning the notice back on is a constant in this
 * file, reviewed like any other change; a query string skips that review, and a
 * warning that can be resurrected by a stranger is not switched off.
 */
export function shouldOpen(
  state: DevNoticeState,
  ctx: DevNoticeGateContext,
  forced: boolean,
  enabled: boolean = DEV_NOTICE_ENABLED,
): boolean {
  const why = blockedBy(state, ctx, enabled);
  if (why === "disabled") return false;
  return forced || why === null;
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
