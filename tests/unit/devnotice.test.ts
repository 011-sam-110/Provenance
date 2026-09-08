import { describe, it, expect } from "vitest";
import {
  DEV_NOTICE_ENABLED,
  DEV_NOTICE_KEY,
  DEV_NOTICE_VERSION,
  NOTICE_REVISION,
  type DevNoticeState,
  EMPTY_DEV_NOTICE_STATE,
  loadDevNoticeState,
  saveDevNoticeState,
  markAcknowledged,
  blockedBy,
  shouldOpen,
  shouldWarn,
  forcedFromSearch,
} from "@/lib/shell/devnotice";

/**
 * The gate for the "this is a live build" warning, which is the FIRST thing anyone
 * handed an access code sees. Its whole job is to be shown once, before the console
 * is used, and then never nag again.
 *
 * It is deliberately NOT modelled on the community invitation next door, and the
 * two differences are the interesting part:
 *
 *   (a) NO QUALIFYING TIME. CommunityNote waits 40 seconds of visible time because
 *       an invitation shown to a bounce is wasted. A warning shown late is WORSE
 *       than not shown at all - the person has already hit the bug it was warning
 *       about. So it shows the moment the boot plate is gone.
 *
 *   (b) ACKNOWLEDGEMENT IS VERSIONED, NOT PERMANENT. Community records "resolved"
 *       forever. This records WHICH REVISION of the text was acknowledged, so
 *       bumping NOTICE_REVISION re-shows it to people who are already through the
 *       gate. That is the only channel to them once they hold a code, and a warning
 *       nobody can update is a warning that rots.
 */

function store(seed?: Record<string, string>) {
  const map = new Map(Object.entries(seed ?? {}));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    raw: map,
  };
}

const AFTER_BOOT = { bootPlaying: false };

/* ── THE OFF SWITCH ───────────────────────────────────────────────────────────
 *
 * The notice is switched OFF right now, and these are the cases that say so. They
 * are separated from the gate's own arms below because they test different things:
 * this block tests the switch, and the block after it tests the gate the switch is
 * currently holding shut — which still has to be correct on the day it opens again.
 */
describe("the off switch", () => {
  it("is off, and turning it back on means changing this line too", () => {
    // Deliberately a red on the flip. Turning the notice back on is one constant in
    // lib/shell/devnotice.ts, and this is the test that makes it a DECISION rather
    // than something that happened. When you flip it: change `false` to `true` here,
    // and the four cases below invert with it.
    expect(DEV_NOTICE_ENABLED).toBe(false);
  });

  it("withholds the notice from a first-time visitor, and names the reason", () => {
    expect(blockedBy(EMPTY_DEV_NOTICE_STATE, AFTER_BOOT)).toBe("disabled");
    expect(shouldWarn(EMPTY_DEV_NOTICE_STATE, AFTER_BOOT)).toBe(false);
  });

  it("OUTRANKS every other arm, so no state can talk its way past it", () => {
    // Asserted over the whole cross-product rather than one example: the switch is
    // the outermost reason, so nothing about this visitor may change the answer.
    for (const acknowledged of [0, NOTICE_REVISION - 1, NOTICE_REVISION, 99]) {
      for (const bootPlaying of [true, false]) {
        expect(blockedBy({ acknowledged }, { bootPlaying })).toBe("disabled");
      }
    }
  });

  it("REFUSES ?notice=1 — a URL may not summon a notice that is switched off", () => {
    // The judgement call, and it goes the other way from the two arms below it.
    // `boot` and `acknowledged` are facts about THIS VISITOR, and re-reading a
    // warning costs a visitor nothing, so a link may override them. `disabled` is
    // not about the visitor at all: it is the operator saying this text is not the
    // one to be showing. `?notice=1` is unauthenticated and pasteable, so honouring
    // it would let anyone republish a statement about warranty and data quality that
    // the project has taken down. The switch is what turns it back on, not a query
    // string — and flipping a constant is cheaper than the review that link skips.
    expect(shouldOpen(EMPTY_DEV_NOTICE_STATE, AFTER_BOOT, true)).toBe(false);

    // The PARSER is untouched, and that is on purpose: it is what makes the force a
    // one-line restoration rather than a rewrite. What refuses is the gate.
    expect(forcedFromSearch("?notice=1")).toBe(true);
  });
});

/* ── THE GATE ITSELF, EXERCISED WITH THE SWITCH ON ───────────────────────────
 *
 * Every case below passes `true` as the switch explicitly. That is not ceremony:
 * with the notice off, a gate test that took the default would assert "disabled"
 * four times over and stop testing the thing it is named after. Held ON, these keep
 * proving the acknowledgement ladder works — which is the state the product returns
 * to the moment the constant flips, and the worst possible time to find it broken.
 */
describe("the live-build warning gate", () => {
  const ON = true;

  it("warns a first-time visitor as soon as the boot plate is gone", () => {
    expect(shouldWarn(EMPTY_DEV_NOTICE_STATE, AFTER_BOOT, ON)).toBe(true);
  });

  // The cold-start plate owns the screen. A dialog on top of it is a dialog nobody
  // reads, and this is the one card that has to actually be read.
  it("withholds it while the boot plate is still playing", () => {
    expect(blockedBy(EMPTY_DEV_NOTICE_STATE, { bootPlaying: true }, ON)).toBe("boot");
    expect(shouldWarn(EMPTY_DEV_NOTICE_STATE, { bootPlaying: true }, ON)).toBe(false);
  });

  it("does not warn twice for the same revision", () => {
    const seen = markAcknowledged(EMPTY_DEV_NOTICE_STATE, NOTICE_REVISION);
    expect(blockedBy(seen, AFTER_BOOT, ON)).toBe("acknowledged");
    expect(shouldWarn(seen, AFTER_BOOT, ON)).toBe(false);
  });

  // The reason the state stores a number and not a boolean.
  it("warns again when the text is revised past what was acknowledged", () => {
    const seenOld: DevNoticeState = { acknowledged: NOTICE_REVISION - 1 };
    expect(shouldWarn(seenOld, AFTER_BOOT, ON)).toBe(true);
  });

  it("survives a hand-edited or half-written envelope by warning again", () => {
    const s = store({ [DEV_NOTICE_KEY]: '{"v":1,"d":{"acknowledged":"yes"}}' });
    expect(loadDevNoticeState(s)).toEqual(EMPTY_DEV_NOTICE_STATE);
    expect(shouldWarn(loadDevNoticeState(s), AFTER_BOOT, ON)).toBe(true);
  });

  // Failing OPEN is the correct direction for a warning: an unreadable envelope
  // costs one extra dialog, where the other direction silently suppresses it.
  it("warns again rather than staying quiet when the value is nonsense", () => {
    for (const bad of ["-3", "NaN", "1e400", "null"]) {
      const s = store({ [DEV_NOTICE_KEY]: `{"v":1,"d":{"acknowledged":${bad}}}` });
      expect(shouldWarn(loadDevNoticeState(s), AFTER_BOOT, ON), bad).toBe(true);
    }
  });

  it("round-trips an acknowledgement through storage", () => {
    const s = store();
    saveDevNoticeState(markAcknowledged(EMPTY_DEV_NOTICE_STATE, NOTICE_REVISION), s);
    expect(loadDevNoticeState(s).acknowledged).toBe(NOTICE_REVISION);
    expect(shouldWarn(loadDevNoticeState(s), AFTER_BOOT, ON)).toBe(false);
  });

  it("ignores an envelope written by a different schema version", () => {
    const s = store({
      [DEV_NOTICE_KEY]: JSON.stringify({ v: DEV_NOTICE_VERSION + 1, d: { acknowledged: 99 } }),
    });
    expect(shouldWarn(loadDevNoticeState(s), AFTER_BOOT, ON)).toBe(true);
  });

  /**
   * `?notice=1` forces it open, the precedent `?discord=1` and `?feedback=1` set.
   *
   * IT DIFFERS FROM THOSE TWO ON PURPOSE: they refuse to bypass a recorded answer,
   * because re-asking someone who already said no disrespects the no. There is no
   * "no" here - acknowledging a warning is not declining anything - so re-reading it
   * costs nothing and being able to link someone straight to it is worth having.
   */
  it("can be forced open for review, even after it has been acknowledged", () => {
    expect(forcedFromSearch("?notice=1")).toBe(true);
    expect(forcedFromSearch("?notice=0")).toBe(false);
    expect(forcedFromSearch("")).toBe(false);
    expect(forcedFromSearch("not a query string")).toBe(false);

    const seen = markAcknowledged(EMPTY_DEV_NOTICE_STATE, NOTICE_REVISION);
    expect(shouldOpen(seen, AFTER_BOOT, false, ON)).toBe(false);
    expect(shouldOpen(seen, AFTER_BOOT, true, ON)).toBe(true);
  });

  it("still withholds a forced notice while the boot plate is playing", () => {
    // The force overrides the acknowledgement, not the readability problem.
    expect(blockedBy(EMPTY_DEV_NOTICE_STATE, { bootPlaying: true }, ON)).toBe("boot");
  });
});
