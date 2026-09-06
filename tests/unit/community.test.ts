import { describe, expect, test } from "vitest";
import {
  COMMUNITY_KEY,
  COMMUNITY_VERSION,
  EMPTY_COMMUNITY_STATE,
  QUALIFY_ACTIVE_MS,
  addActiveMs,
  blockedBy,
  forcedFromSearch,
  loadCommunityState,
  markResolved,
  qualifies,
  recordVisit,
  saveCommunityState,
  shouldInvite,
  type CommunityState,
} from "@/lib/shell/community";
import { BRAND } from "@/lib/brand";

/** A stand-in for window.localStorage, so the round trip and the version guard are
 *  testable in the node environment. Same trick tests/unit/feedback.test.ts uses. */
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    raw: map,
  };
}

const OPEN_CTX = { bootPlaying: false, diveActive: false };

function stateWith(over: Partial<CommunityState> = {}): CommunityState {
  return { ...EMPTY_COMMUNITY_STATE, ...over };
}

describe("community state persistence", () => {
  test("round-trips through the versioned envelope", () => {
    const store = memoryStorage();
    const state = stateWith({ visits: 3, activeMs: 90_000, resolved: "joined" });
    saveCommunityState(state, store);
    expect(loadCommunityState(store)).toEqual(state);
  });

  test("an absent key loads the empty state rather than throwing", () => {
    expect(loadCommunityState(memoryStorage())).toEqual(EMPTY_COMMUNITY_STATE);
  });

  test("a hand-edited envelope cannot become NaN maths downstream", () => {
    const store = memoryStorage();
    store.setItem(
      COMMUNITY_KEY,
      JSON.stringify({ v: COMMUNITY_VERSION, d: { visits: "lots", activeMs: -5, resolved: "maybe" } }),
    );
    const loaded = loadCommunityState(store);
    expect(loaded).toEqual({ visits: 0, activeMs: 0 });
    // The junk `resolved` must not survive as a truthy stop — the person has not
    // actually answered, so they are still eligible to be asked.
    expect(loaded.resolved).toBeUndefined();
  });

  test("a stale version is discarded, not migrated", () => {
    const store = memoryStorage();
    store.setItem(
      COMMUNITY_KEY,
      JSON.stringify({ v: COMMUNITY_VERSION + 1, d: { visits: 9, activeMs: 999_999 } }),
    );
    expect(loadCommunityState(store)).toEqual(EMPTY_COMMUNITY_STATE);
  });
});

describe("pure transitions", () => {
  test("recordVisit increments and does not mutate", () => {
    const before = stateWith({ visits: 1 });
    const after = recordVisit(before);
    expect(after.visits).toBe(2);
    expect(before.visits).toBe(1);
  });

  test("addActiveMs ignores a non-finite or negative delta", () => {
    const before = stateWith({ activeMs: 1_000 });
    expect(addActiveMs(before, Number.NaN)).toBe(before);
    expect(addActiveMs(before, -1)).toBe(before);
    expect(addActiveMs(before, 0)).toBe(before);
    expect(addActiveMs(before, 500).activeMs).toBe(1_500);
  });

  test("markResolved records which way it went", () => {
    expect(markResolved(stateWith(), "joined").resolved).toBe("joined");
    expect(markResolved(stateWith(), "dismissed").resolved).toBe("dismissed");
  });
});

describe("the gate", () => {
  test("does not qualify below the visible-time bar", () => {
    expect(qualifies(stateWith({ activeMs: QUALIFY_ACTIVE_MS - 1 }))).toBe(false);
    expect(qualifies(stateWith({ activeMs: QUALIFY_ACTIVE_MS }))).toBe(true);
  });

  test("a bounce is never asked", () => {
    expect(shouldInvite(stateWith({ visits: 1, activeMs: 5_000 }), OPEN_CTX)).toBe(false);
  });

  test("someone who has stayed is asked", () => {
    expect(shouldInvite(stateWith({ visits: 1, activeMs: QUALIFY_ACTIVE_MS }), OPEN_CTX)).toBe(true);
  });

  test("EVERY qualifying visitor is asked — there is no sampling roll", () => {
    // The distinguishing rule against the feedback gate, which samples one in
    // three. If a roll is ever added here this test is the thing that should be
    // argued with first: an invitation loses two thirds of its reach to sampling
    // and gains nothing, because it is not a survey.
    const qualified = stateWith({ visits: 1, activeMs: QUALIFY_ACTIVE_MS });
    for (let i = 0; i < 50; i++) expect(shouldInvite(qualified, OPEN_CTX)).toBe(true);
  });

  test("resolving is permanent, either way", () => {
    const long = { visits: 9, activeMs: QUALIFY_ACTIVE_MS * 100 };
    expect(shouldInvite({ ...long, resolved: "dismissed" }, OPEN_CTX)).toBe(false);
    expect(shouldInvite({ ...long, resolved: "joined" }, OPEN_CTX)).toBe(false);
  });

  test("the boot plate and a cinematic dive each hold it back", () => {
    const qualified = stateWith({ activeMs: QUALIFY_ACTIVE_MS });
    expect(blockedBy(qualified, { bootPlaying: true, diveActive: false })).toBe("boot");
    expect(blockedBy(qualified, { bootPlaying: false, diveActive: true })).toBe("dive");
    expect(blockedBy(qualified, OPEN_CTX)).toBeNull();
    expect(shouldInvite(qualified, { bootPlaying: true, diveActive: false })).toBe(false);
    expect(shouldInvite(qualified, { bootPlaying: false, diveActive: true })).toBe(false);
  });

  test("a recorded resolution outranks every other reason", () => {
    expect(blockedBy(stateWith({ resolved: "joined" }), { bootPlaying: true, diveActive: true })).toBe("joined");
  });
});

describe("the ?discord=1 review override", () => {
  test("reads the flag, and only that flag", () => {
    expect(forcedFromSearch("?discord=1")).toBe(true);
    expect(forcedFromSearch("?foo=bar&discord=1")).toBe(true);
    expect(forcedFromSearch("?discord=0")).toBe(false);
    expect(forcedFromSearch("?feedback=1")).toBe(false);
    expect(forcedFromSearch("")).toBe(false);
  });
});

describe("the invite URL", () => {
  test("is a discord.gg invite, not a channel or a server-settings deep link", () => {
    // A `discord.com/channels/<guild>/<channel>` URL is what the desktop app puts
    // on the clipboard when you copy a channel, and it is NOT joinable — someone
    // who is not already a member lands on their own last-used server instead.
    expect(BRAND.discordUrl).toMatch(/^https:\/\/discord\.gg\/[A-Za-z0-9-]+$/);
  });
});
