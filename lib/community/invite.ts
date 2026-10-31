// What Discord says about the invite in BRAND.discordUrl. The Discord pop-up
// (components/shell/CommunityNote.tsx) shows these figures, and it says "the link works
// again", so this module is also what keeps that sentence true.
//
// THE THREE ANSWERS. "live": Discord knows the invite, with its member counts. "dead":
// Discord says the invite is unknown or has expired, so the pop-up stays closed and the
// visitor keeps their one showing for later. "unknown": we could not find out (a network
// fault, a 429, a body we cannot read), so the pop-up opens without any figure. No figure
// is ever invented for it: a count is printed only when Discord gave it.
//
// THE SERVER ASKS, NOT THE BROWSER. The public endpoint needs no key, but a browser that
// called it would hand Discord the visitor's IP address before they chose to go there, and
// /privacy lists every party a browser reaches. So app/api/community/route.ts asks, with
// nothing about the visitor in the request, and one answer serves everybody for five minutes.

import { BRAND } from "@/lib/brand";

export type InviteState = "live" | "dead" | "unknown";

export interface InviteStatus {
  state: InviteState;
  /** Discord's `approximate_member_count`. It includes any bots on the server. */
  members: number | null;
  /** Discord's `approximate_presence_count`. It includes any bots that are online. */
  online: number | null;
}

export const UNKNOWN_INVITE: InviteStatus = { state: "unknown", members: null, online: null };
export const DEAD_INVITE: InviteStatus = { state: "dead", members: null, online: null };

/** The code in a discord.gg invite address, or null for any other shape of address. */
export function inviteCode(url: string): string | null {
  const m = /^https:\/\/discord\.gg\/([A-Za-z0-9-]+)$/.exec(url);
  return m ? m[1] : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

/** Turn Discord's answer into one of the three states. Pure, so a test can hold each arm. */
export function parseInvite(status: number, body: unknown, now: number): InviteStatus {
  // 404 is what Discord answers for an unknown invite AND for an expired one.
  if (status === 404) return DEAD_INVITE;
  if (status !== 200 || !body || typeof body !== "object") return UNKNOWN_INVITE;
  const b = body as { expires_at?: unknown; approximate_member_count?: unknown; approximate_presence_count?: unknown };
  if (typeof b.expires_at === "string") {
    const at = Date.parse(b.expires_at);
    if (Number.isFinite(at) && at <= now) return DEAD_INVITE;
  }
  return { state: "live", members: count(b.approximate_member_count), online: count(b.approximate_presence_count) };
}

/** Read /api/community's JSON in the browser. Anything unexpected is "unknown". */
export function coerceInviteStatus(value: unknown): InviteStatus {
  if (!value || typeof value !== "object") return UNKNOWN_INVITE;
  const v = value as { state?: unknown; members?: unknown; online?: unknown };
  if (v.state === "dead") return DEAD_INVITE;
  if (v.state !== "live") return UNKNOWN_INVITE;
  return { state: "live", members: count(v.members), online: count(v.online) };
}

/* ── The server's copy ──────────────────────────────────────────────────── */

/** How long one answer serves everybody. Member counts move slowly; the pop-up says "online",
 *  not "online now", because this figure can be up to this old. */
export const LIVE_TTL_MS = 5 * 60_000;
/** A dead or unknown answer is asked again sooner, so a repaired invite shows quickly. */
export const RETRY_TTL_MS = 60_000;
/** After a fault, how long the last good figures may stand in for a fresh answer. */
export const LAST_GOOD_MS = 60 * 60_000;

const ASK_TIMEOUT_MS = 4_000;

export function inviteTtlMs(status: InviteStatus): number {
  return status.state === "live" ? LIVE_TTL_MS : RETRY_TTL_MS;
}

type Fetcher = (url: string, init: RequestInit) => Promise<Pick<Response, "status" | "json">>;

let held: { at: number; status: InviteStatus } | null = null;
let lastGood: { at: number; status: InviteStatus } | null = null;
let asking: Promise<InviteStatus> | null = null;

/** For tests: forget everything this module holds. */
export function resetInviteCache(): void {
  held = null;
  lastGood = null;
  asking = null;
}

async function ask(url: string, fetcher: Fetcher, now: number): Promise<InviteStatus> {
  const code = inviteCode(url);
  if (!code) return UNKNOWN_INVITE;
  try {
    const res = await fetcher(`https://discord.com/api/v10/invites/${code}?with_counts=true`, {
      headers: { Accept: "application/json", "User-Agent": `${BRAND.name} (+${BRAND.repoUrl})` },
      cache: "no-store",
      signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
    });
    return parseInvite(res.status, await res.json().catch(() => null), now);
  } catch {
    return UNKNOWN_INVITE;
  }
}

/**
 * The status of the invite, from memory while it is fresh. One request at a time: everyone
 * who arrives while an ask is out shares its answer. A fault does not erase a good answer
 * from the last hour, because a passing 429 should not cost a visitor the member count. A
 * "dead" answer is never covered this way: Discord said so, and the pop-up must believe it.
 */
export async function getInviteStatus(
  url: string = BRAND.discordUrl,
  fetcher: Fetcher = fetch,
  now: number = Date.now(),
): Promise<InviteStatus> {
  if (held && now - held.at < inviteTtlMs(held.status)) return held.status;
  asking ??= ask(url, fetcher, now).then((answer) => {
    asking = null;
    const stands = answer.state === "unknown" && lastGood && now - lastGood.at < LAST_GOOD_MS;
    const status = stands ? lastGood!.status : answer;
    if (answer.state === "live") lastGood = { at: now, status: answer };
    held = { at: now, status };
    return status;
  });
  return asking;
}
