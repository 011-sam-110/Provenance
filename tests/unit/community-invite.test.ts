import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import {
  DEAD_INVITE,
  LAST_GOOD_MS,
  LIVE_TTL_MS,
  RETRY_TTL_MS,
  UNKNOWN_INVITE,
  coerceInviteStatus,
  getInviteStatus,
  inviteCode,
  inviteTtlMs,
  parseInvite,
  resetInviteCache,
} from "@/lib/community/invite";
import { BRAND } from "@/lib/brand";

const NOW = Date.parse("2026-10-30T20:00:00Z");
/** The fields Discord sent for the live invite on 2026-10-30. */
const LIVE_BODY = { code: "bjJMe9MHXg", expires_at: null, approximate_member_count: 265, approximate_presence_count: 27 };

describe("the invite code", () => {
  test("reads the code out of the address the site links to", () => {
    expect(inviteCode(BRAND.discordUrl)).toMatch(/^[A-Za-z0-9-]+$/);
    expect(inviteCode("https://discord.gg/bjJMe9MHXg")).toBe("bjJMe9MHXg");
  });

  test("asks about nothing else", () => {
    expect(inviteCode("https://discord.com/channels/1/2")).toBeNull();
    expect(inviteCode("https://discord.gg/abc/../../x")).toBeNull();
    expect(inviteCode("https://evil.example/abc")).toBeNull();
  });
});

describe("Discord's answer", () => {
  test("a live invite gives its two counts", () => {
    expect(parseInvite(200, LIVE_BODY, NOW)).toEqual({ state: "live", members: 265, online: 27 });
  });

  test("404 is a dead invite: Discord answered 'Invite is expired.' for the old one, measured", () => {
    expect(parseInvite(404, { message: "Invite is expired.", code: 50270 }, NOW)).toEqual(DEAD_INVITE);
    expect(parseInvite(404, { message: "Unknown Invite", code: 10006 }, NOW)).toEqual(DEAD_INVITE);
  });

  test("an expiry already past is dead too, whatever the status", () => {
    expect(parseInvite(200, { ...LIVE_BODY, expires_at: "2026-10-07T02:37:00+00:00" }, NOW)).toEqual(DEAD_INVITE);
  });

  test("an expiry still to come is live", () => {
    expect(parseInvite(200, { ...LIVE_BODY, expires_at: "2027-01-01T00:00:00+00:00" }, NOW).state).toBe("live");
  });

  test("a fault is unknown, and never a dead invite: only Discord can say that", () => {
    expect(parseInvite(429, { retry_after: 3 }, NOW)).toEqual(UNKNOWN_INVITE);
    expect(parseInvite(500, null, NOW)).toEqual(UNKNOWN_INVITE);
    expect(parseInvite(200, null, NOW)).toEqual(UNKNOWN_INVITE);
    expect(parseInvite(200, "<html>", NOW)).toEqual(UNKNOWN_INVITE);
  });

  test("a live invite with no counts has no figures, and no invented ones", () => {
    expect(parseInvite(200, { expires_at: null }, NOW)).toEqual({ state: "live", members: null, online: null });
    expect(parseInvite(200, { approximate_member_count: -4, approximate_presence_count: "many" }, NOW)).toEqual({
      state: "live",
      members: null,
      online: null,
    });
  });
});

describe("the browser's reading of /api/community", () => {
  test("takes the three states as they come", () => {
    expect(coerceInviteStatus({ state: "live", members: 265, online: 27 })).toEqual({ state: "live", members: 265, online: 27 });
    expect(coerceInviteStatus(DEAD_INVITE)).toEqual(DEAD_INVITE);
    expect(coerceInviteStatus(UNKNOWN_INVITE)).toEqual(UNKNOWN_INVITE);
  });

  test("anything else is unknown", () => {
    for (const junk of [null, undefined, "live", 7, {}, { state: "great", members: 9 }]) {
      expect(coerceInviteStatus(junk)).toEqual(UNKNOWN_INVITE);
    }
  });
});

describe("the server's copy", () => {
  const answering = (status: number, body: unknown) => {
    const calls: string[] = [];
    const fetcher = async (url: string) => {
      calls.push(url);
      return { status, json: async () => body };
    };
    return { calls, fetcher };
  };
  const URL_ = "https://discord.gg/bjJMe9MHXg";

  beforeEach(resetInviteCache);

  test("asks Discord's public endpoint for that code, with the counts", async () => {
    const { calls, fetcher } = answering(200, LIVE_BODY);
    await getInviteStatus(URL_, fetcher, NOW);
    expect(calls).toEqual(["https://discord.com/api/v10/invites/bjJMe9MHXg?with_counts=true"]);
  });

  test("one answer serves everybody for five minutes", async () => {
    const { calls, fetcher } = answering(200, LIVE_BODY);
    await getInviteStatus(URL_, fetcher, NOW);
    await getInviteStatus(URL_, fetcher, NOW + LIVE_TTL_MS - 1);
    expect(calls).toHaveLength(1);
    await getInviteStatus(URL_, fetcher, NOW + LIVE_TTL_MS);
    expect(calls).toHaveLength(2);
  });

  test("everyone who arrives during an ask shares it", async () => {
    const { calls, fetcher } = answering(200, LIVE_BODY);
    const answers = await Promise.all([1, 2, 3].map(() => getInviteStatus(URL_, fetcher, NOW)));
    expect(calls).toHaveLength(1);
    expect(answers[2].members).toBe(265);
  });

  test("a fault leaves the last good figures standing for an hour, and no longer", async () => {
    await getInviteStatus(URL_, answering(200, LIVE_BODY).fetcher, NOW);
    const later = NOW + LIVE_TTL_MS;
    expect((await getInviteStatus(URL_, answering(429, {}).fetcher, later)).members).toBe(265);
    const tooLate = NOW + LAST_GOOD_MS + RETRY_TTL_MS;
    expect(await getInviteStatus(URL_, answering(429, {}).fetcher, tooLate)).toEqual(UNKNOWN_INVITE);
  });

  test("a dead answer is believed at once, even with good figures in hand", async () => {
    await getInviteStatus(URL_, answering(200, LIVE_BODY).fetcher, NOW);
    const later = NOW + LIVE_TTL_MS;
    expect(await getInviteStatus(URL_, answering(404, {}).fetcher, later)).toEqual(DEAD_INVITE);
  });

  test("a network fault is unknown, not a thrown error", async () => {
    const broken = async () => {
      throw new Error("no route");
    };
    expect(await getInviteStatus(URL_, broken, NOW)).toEqual(UNKNOWN_INVITE);
  });

  test("a repaired invite shows inside a minute", () => {
    expect(inviteTtlMs(DEAD_INVITE)).toBe(RETRY_TTL_MS);
    expect(inviteTtlMs(UNKNOWN_INVITE)).toBe(RETRY_TTL_MS);
    expect(inviteTtlMs({ state: "live", members: 1, online: 1 })).toBe(LIVE_TTL_MS);
  });
});

describe("the route", () => {
  const route = readFileSync(join(process.cwd(), "app/api/community/route.ts"), "utf8");

  test("takes no parameter, so nothing about the visitor can reach it", () => {
    expect(route).toContain("export async function GET()");
  });

  test("lets the shared cache answer", () => {
    expect(route).toContain("edgeCacheHeaders(inviteTtlMs(status))");
  });
});
