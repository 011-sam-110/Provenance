import { describe, expect, test } from "vitest";
import {
  bucketKey,
  clientIpFrom,
  CAP_EMAIL,
  CAP_OCCUPATION,
  CAP_USEFUL,
  EMPTY_FEEDBACK_STATE,
  FEEDBACK_KEY,
  FEEDBACK_VERSION,
  MIN_DWELL_MS,
  QUALIFY_ACTIVE_MS,
  ROLL_DENOMINATOR,
  addActiveMs,
  blockedBy,
  forcedFromSearch,
  formatFeedbackMessage,
  loadFeedbackState,
  markResolved,
  qualifies,
  recordVisit,
  rollWins,
  saveFeedbackState,
  shouldPrompt,
  triggerFor,
  validateFeedback,
  type FeedbackState,
} from "@/lib/shell/feedback";

/** A stand-in for window.localStorage, so the round trip and the version guard are
 *  testable in the node environment. Same trick lib/shell/persist.ts is built for. */
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    raw: map,
  };
}

const CLEAR = { bootPlaying: false, tourOpen: false, diveActive: false };
const state = (over: Partial<FeedbackState> = {}): FeedbackState => ({ ...EMPTY_FEEDBACK_STATE, ...over });

/* ── The qualifying arms ──────────────────────────────────────────────────── */

describe("who qualifies", () => {
  test("a fresh first visit does not", () => {
    expect(qualifies(recordVisit(state()))).toBe(false);
    expect(triggerFor(recordVisit(state()))).toBeNull();
  });

  test("15 minutes is the boundary, and it is exclusive", () => {
    // Exactly 15:00 has not passed 15 minutes. 15:00.001 has.
    expect(qualifies(state({ visits: 1, activeMs: QUALIFY_ACTIVE_MS }))).toBe(false);
    expect(qualifies(state({ visits: 1, activeMs: QUALIFY_ACTIVE_MS + 1 }))).toBe(true);
  });

  test("a second visit qualifies on its own, with no time at all", () => {
    expect(qualifies(state({ visits: 2, activeMs: 0 }))).toBe(true);
    expect(triggerFor(state({ visits: 2, activeMs: 0 }))).toBe("return");
  });

  test("the trigger reports which arm fired, so answers can be read against reach", () => {
    expect(triggerFor(state({ visits: 1, activeMs: QUALIFY_ACTIVE_MS + 1 }))).toBe("time");
    expect(triggerFor(state({ visits: 3, activeMs: QUALIFY_ACTIVE_MS + 1 }))).toBe("both");
  });
});

/* ── Visible time ─────────────────────────────────────────────────────────── */

describe("active time", () => {
  test("accumulates across visits", () => {
    let s = state();
    s = addActiveMs(s, 60_000);
    s = addActiveMs(s, 30_000);
    expect(s.activeMs).toBe(90_000);
  });

  test("ignores nonsense deltas rather than poisoning the total with NaN", () => {
    const s = state({ activeMs: 1_000 });
    expect(addActiveMs(s, Number.NaN).activeMs).toBe(1_000);
    expect(addActiveMs(s, -5_000).activeMs).toBe(1_000);
    expect(addActiveMs(s, 0).activeMs).toBe(1_000);
  });
});

/* ── What is permanent, and what is not ───────────────────────────────────── */

describe("the permanent stop", () => {
  test("dismissing blocks forever, even for someone who plainly qualifies", () => {
    const s = markResolved(state({ visits: 9, activeMs: QUALIFY_ACTIVE_MS * 4 }), "dismissed");
    expect(blockedBy(s, CLEAR)).toBe("dismissed");
    expect(shouldPrompt(s, CLEAR, true)).toBe(false);
  });

  test("submitting blocks forever too", () => {
    const s = markResolved(state({ visits: 4 }), "submitted");
    expect(shouldPrompt(s, CLEAR, true)).toBe(false);
  });

  test("losing the roll does not resolve anyone - the same state still prompts on a win", () => {
    const s = state({ visits: 2 });
    expect(shouldPrompt(s, CLEAR, false)).toBe(false);
    expect(shouldPrompt(s, CLEAR, true)).toBe(true);
  });

  // THE ACTUAL GUARD FOR "a lost roll is not permanent", and it is worth being
  // precise about why it is shaped like this. The obvious test - assert the state
  // is unchanged after a lost roll - proves nothing, because shouldPrompt is pure
  // and never mutates anything, so it passes even if stickiness is added.
  // VERIFIED by injecting the real regression (a persisted `rolledLost` flag that
  // blockedBy honours): all the behavioural cases above stayed green, and only the
  // test below went red, with "rolledLost" named in the diff.
  //
  // So the lock is on the PERSISTED CONTRACT instead. Making a lost roll permanent
  // requires storing it somewhere, and anything stored has to survive this. Adding
  // a field forces someone to edit this test, which is where they will read that
  // two thirds of all visitors would be silently excluded forever.
  test("the persisted contract is exactly visits/activeMs/resolved - a stored roll flag is dropped", () => {
    const s = memoryStorage();
    s.setItem(
      FEEDBACK_KEY,
      JSON.stringify({ v: FEEDBACK_VERSION, d: { visits: 2, activeMs: 0, rolledLost: true } }),
    );
    expect(Object.keys(loadFeedbackState(s)).sort()).toEqual(["activeMs", "visits"]);

    saveFeedbackState({ visits: 2, activeMs: 5, resolved: "dismissed" }, s);
    const stored = JSON.parse(s.getItem(FEEDBACK_KEY)!) as { d: Record<string, unknown> };
    expect(Object.keys(stored.d).sort()).toEqual(["activeMs", "resolved", "visits"]);
  });
});

/* ── Yielding to the other first-run surfaces ─────────────────────────────── */

describe("what blocks the prompt", () => {
  const qualified = state({ visits: 3 });

  test("the boot plate, the tour and a cinematic dive each block it", () => {
    expect(blockedBy(qualified, { ...CLEAR, bootPlaying: true })).toBe("boot");
    expect(blockedBy(qualified, { ...CLEAR, tourOpen: true })).toBe("tour");
    expect(blockedBy(qualified, { ...CLEAR, diveActive: true })).toBe("dive");
    for (const ctx of [
      { ...CLEAR, bootPlaying: true },
      { ...CLEAR, tourOpen: true },
      { ...CLEAR, diveActive: true },
    ]) {
      expect(shouldPrompt(qualified, ctx, true)).toBe(false);
    }
  });

  test("nothing blocks a clear context", () => {
    expect(blockedBy(qualified, CLEAR)).toBeNull();
    expect(shouldPrompt(qualified, CLEAR, true)).toBe(true);
  });
});

/* ── The roll ─────────────────────────────────────────────────────────────── */

describe("the 1-in-3 roll", () => {
  test("wins strictly below one third", () => {
    expect(rollWins(0)).toBe(true);
    expect(rollWins(1 / ROLL_DENOMINATOR - 1e-9)).toBe(true);
    expect(rollWins(1 / ROLL_DENOMINATOR)).toBe(false);
    expect(rollWins(0.99)).toBe(false);
  });
});

/* ── Persistence ──────────────────────────────────────────────────────────── */

describe("persistence", () => {
  test("round-trips through the versioned envelope", () => {
    const s = memoryStorage();
    saveFeedbackState({ visits: 3, activeMs: 42_000, resolved: "dismissed" }, s);
    expect(loadFeedbackState(s)).toEqual({ visits: 3, activeMs: 42_000, resolved: "dismissed" });
  });

  test("a version bump invalidates old data instead of crashing on it", () => {
    const s = memoryStorage();
    s.setItem(FEEDBACK_KEY, JSON.stringify({ v: FEEDBACK_VERSION + 1, d: { visits: 9, activeMs: 9 } }));
    expect(loadFeedbackState(s)).toEqual(EMPTY_FEEDBACK_STATE);
  });

  test("a corrupt or hand-edited envelope degrades to the default, never to NaN", () => {
    const s = memoryStorage();
    s.setItem(FEEDBACK_KEY, "{not json");
    expect(loadFeedbackState(s)).toEqual(EMPTY_FEEDBACK_STATE);

    s.setItem(FEEDBACK_KEY, JSON.stringify({ v: FEEDBACK_VERSION, d: { visits: "many", activeMs: null } }));
    const loaded = loadFeedbackState(s);
    expect(loaded.visits).toBe(0);
    expect(loaded.activeMs).toBe(0);
    expect(Number.isNaN(loaded.activeMs)).toBe(false);
  });

  test("an unrecognised resolution is dropped rather than trusted as a stop", () => {
    const s = memoryStorage();
    s.setItem(FEEDBACK_KEY, JSON.stringify({ v: FEEDBACK_VERSION, d: { visits: 2, activeMs: 0, resolved: "maybe" } }));
    expect(loadFeedbackState(s).resolved).toBeUndefined();
  });

  test("missing storage is a no-op, not a throw (private mode, sandboxed iframe)", () => {
    expect(() => saveFeedbackState(state(), undefined)).not.toThrow();
  });
});

/* ── The review override ──────────────────────────────────────────────────── */

describe("?feedback=1", () => {
  test("is recognised, and nothing else is", () => {
    expect(forcedFromSearch("?feedback=1")).toBe(true);
    expect(forcedFromSearch("?boot=1&feedback=1")).toBe(true);
    expect(forcedFromSearch("?feedback=0")).toBe(false);
    expect(forcedFromSearch("?feedback=yes")).toBe(false);
    expect(forcedFromSearch("")).toBe(false);
  });
});

/* ── The payload contract ─────────────────────────────────────────────────── */

const GOOD = {
  occupation: "Journalist",
  useful: "The camera wall and the country dossiers.",
  rating: 8,
  email: "jo@example.com",
  trigger: "return",
  dwellMs: 20_000,
};

describe("validateFeedback", () => {
  test("accepts a well-formed response", () => {
    const r = validateFeedback(GOOD);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.rating).toBe(8);
  });

  test("OPTIONAL MEANS OPTIONAL - it accepts a blank email with no error", () => {
    for (const email of ["", "   ", undefined]) {
      const r = validateFeedback({ ...GOOD, email });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.email).toBe("");
    }
  });

  test("rejects a malformed email, but only when one was actually given", () => {
    const r = validateFeedback({ ...GOOD, email: "not-an-address" });
    expect(r.ok).toBe(false);
  });

  test("rejects a non-integer or out-of-range rating", () => {
    for (const rating of [0, 11, 5.5, -1, "8", null, Number.NaN]) {
      expect(validateFeedback({ ...GOOD, rating }).ok).toBe(false);
    }
  });

  test("requires the two required fields", () => {
    expect(validateFeedback({ ...GOOD, occupation: "   " }).ok).toBe(false);
    expect(validateFeedback({ ...GOOD, useful: "" }).ok).toBe(false);
  });

  test("rejects oversized fields rather than silently truncating them", () => {
    expect(validateFeedback({ ...GOOD, occupation: "x".repeat(CAP_OCCUPATION + 1) }).ok).toBe(false);
    expect(validateFeedback({ ...GOOD, useful: "x".repeat(CAP_USEFUL + 1) }).ok).toBe(false);
    expect(validateFeedback({ ...GOOD, email: `${"x".repeat(CAP_EMAIL)}@e.com` }).ok).toBe(false);
    // And accepts them exactly at the cap.
    expect(validateFeedback({ ...GOOD, occupation: "x".repeat(CAP_OCCUPATION) }).ok).toBe(true);
  });

  test("the honeypot rejects, and does not say why", () => {
    const r = validateFeedback({ ...GOOD, website: "http://spam.example" });
    expect(r.ok).toBe(false);
    // Identical to every other generic rejection, so a bot cannot learn which
    // field caught it.
    if (!r.ok) expect(r.error).toBe("Bad request body.");
  });

  test("rejects a submit faster than a human could type it", () => {
    expect(validateFeedback({ ...GOOD, dwellMs: MIN_DWELL_MS - 1 }).ok).toBe(false);
    expect(validateFeedback({ ...GOOD, dwellMs: MIN_DWELL_MS }).ok).toBe(true);
    expect(validateFeedback({ ...GOOD, dwellMs: "20000" }).ok).toBe(false);
  });

  test("rejects an unknown trigger", () => {
    expect(validateFeedback({ ...GOOD, trigger: "whatever" }).ok).toBe(false);
    for (const trigger of ["time", "return", "both", "forced"]) {
      expect(validateFeedback({ ...GOOD, trigger }).ok).toBe(true);
    }
  });

  test("rejects non-objects outright", () => {
    for (const bad of [null, undefined, "string", 42, []]) {
      expect(validateFeedback(bad).ok).toBe(false);
    }
  });
});

/* ── The rate-limit bucket key ────────────────────────────────────────────── */

describe("bucketKey", () => {
  // The property the limiter needs: the same visitor lands in the same bucket.
  test("is stable for the same salt and address", async () => {
    expect(await bucketKey("s", "203.0.113.7")).toBe(await bucketKey("s", "203.0.113.7"));
  });

  test("separates different addresses", async () => {
    expect(await bucketKey("s", "203.0.113.7")).not.toBe(await bucketKey("s", "203.0.113.8"));
  });

  // THE POINT OF THE SALT. Without it this is an unsalted digest over ~4.3 billion
  // enumerable IPv4 candidates and a fixed prefix in a PUBLIC repo, which is a
  // lookup table, not a one-way function - measured at ~743k hashes/sec on one
  // core, so a full sweep is ~96 min single-threaded and ~12 min on eight. This
  // case fails the moment someone drops the salt back out, which is the change to
  // be afraid of.
  test("the same address under different salts shares nothing", async () => {
    const a = await bucketKey("salt-one", "203.0.113.7");
    const b = await bucketKey("salt-two", "203.0.113.7");
    expect(a).not.toBe(b);
    // And it must not be the unsalted digest either - i.e. the salt is genuinely
    // mixed in rather than appended somewhere ignorable.
    expect(a).not.toBe(await bucketKey("", "203.0.113.7"));
  });

  test("is a short fixed-width hex key", async () => {
    expect(await bucketKey("s", "203.0.113.7")).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("clientIpFrom", () => {
  test("takes the first hop and trims it", () => {
    expect(clientIpFrom("203.0.113.7, 70.41.3.18, 150.172.238.178")).toBe("203.0.113.7");
    expect(clientIpFrom("  203.0.113.7  ")).toBe("203.0.113.7");
  });

  test("falls back to a shared bucket rather than throwing", () => {
    expect(clientIpFrom(null)).toBe("unknown");
    expect(clientIpFrom("")).toBe("unknown");
    expect(clientIpFrom(",  ,")).toBe("unknown");
  });
});

/* ── The message ──────────────────────────────────────────────────────────── */

describe("formatFeedbackMessage", () => {
  test("carries only what the visitor typed, plus the trigger", () => {
    const r = validateFeedback(GOOD);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const msg = formatFeedbackMessage(r.value);
    expect(msg).toContain("8/10");
    expect(msg).toContain("Journalist");
    expect(msg).toContain("jo@example.com");
    expect(msg).toContain("return");
    // Nothing inferred about the person is ever in the body.
    expect(msg).not.toMatch(/\d+\.\d+\.\d+\.\d+/); // no IP
    expect(msg.toLowerCase()).not.toContain("mozilla"); // no user agent
  });

  test("says so plainly when no email was given, rather than leaving a blank line", () => {
    const r = validateFeedback({ ...GOOD, email: "" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(formatFeedbackMessage(r.value)).toContain("Email: not given");
  });
});
