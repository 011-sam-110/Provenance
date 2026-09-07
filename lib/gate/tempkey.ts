/**
 * Temporary access keys for the maintenance gate: hand one to somebody, it works for
 * half an hour, then it is dead — and NOTHING is stored anywhere to make that true.
 *
 * THE KEY CARRIES ITS OWN EXPIRY, AND AN HMAC OVER THAT EXPIRY, signed with the master
 * access code. A deployment can therefore verify one with only the environment variable
 * it already has: no KV, no table, no per-key record, no cleanup job. That is the same
 * property the permanent cookie was built on, and it is the only thing that keeps this
 * free — the outage exists because the site got expensive, so a feature that adds a
 * datastore would be answering the wrong question.
 *
 * THE SIGNATURE COVERS THE EXPIRY, which is the whole security argument. The expiry
 * travels in plain sight and is completely untrusted; editing it does not extend the
 * key, it invalidates it. Anyone can read when a key dies, nobody can move it.
 *
 * FORMAT: `t.<expiry base36>.<hmac hex, truncated>`, e.g. `t.1n8kq7z.9f3c...`. The `t.`
 * tag makes a temp key distinguishable from the permanent cookie value (a bare SHA-256
 * hex) without verifying it, so the middleware can pick the right check.
 *
 * WHAT THIS IS NOT: authentication. There is no rate limiting on the unlock route, no
 * per-key identity and no audit trail — a key is a bearer token, so whoever holds it is
 * through, and forwarding one to a friend works exactly as well as using it. It is a
 * curtain held open for a named guest for thirty minutes, not a login.
 *
 * REVOCATION IS ALL-OR-NOTHING. Because nothing is stored, the only way to kill an
 * outstanding key early is to change MAINTENANCE_PASSWORD, which kills every key and
 * every session at once. That is the trade for storing nothing, and it is a fine trade
 * at a thirty-minute horizon; it would not be at a thirty-day one, which is part of why
 * the cap below exists.
 */

/** Distinguishes a temp key from the permanent cookie value. */
export const TEMP_KEY_TAG = "t";

/**
 * Domain-separates this HMAC from `gateToken`'s digest, so the two can never be
 * confused for one another even though both are keyed on the same secret. Bump the
 * version to invalidate every outstanding key without changing the master code.
 */
export const TEMP_KEY_PREFIX = "provenance-temp-v1:";

/** What Sampo asked for, and what the minting script uses when told nothing else. */
export const TEMP_KEY_DEFAULT_MINUTES = 30;

/**
 * A day. Not a technical limit — the format would happily carry a year — but a
 * deliberate one: revocation is all-or-nothing (see above), so a long-lived key is a
 * thing you cannot take back without logging everyone out. Past a day, the honest
 * answer is to give somebody the real code.
 */
export const TEMP_KEY_MAX_MINUTES = 60 * 24;

/**
 * 64 bits of signature, hex.
 *
 * Enough that guessing one is hopeless, short enough that the whole key is about thirty
 * characters and survives being pasted into a Discord message. The full 256-bit digest
 * would make a key nobody could read back over a call, and buys nothing against an
 * attacker who gets one online guess per request against a route with no rate limiting
 * — the master code's own length is the binding constraint there, not this.
 */
const SIG_CHARS = 16;

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Web Crypto only — no node:crypto — so the same function runs in Edge middleware. */
async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

/** Seconds for a duration in minutes, refusing anything outside the allowed band. */
export function tempKeyTtlSeconds(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error(`A temporary key must last a positive number of minutes, got ${minutes}`);
  }
  if (minutes > TEMP_KEY_MAX_MINUTES) {
    throw new Error(
      `A temporary key may last at most ${TEMP_KEY_MAX_MINUTES} minutes (got ${minutes}). ` +
        "Revoking one early means changing the master code, which logs everyone out.",
    );
  }
  return Math.round(minutes * 60);
}

/**
 * True for anything SHAPED like a temp key. Says nothing about whether it is valid —
 * it exists so the middleware can choose between the two checks without paying for a
 * signature it was never going to match.
 */
export function isTempKey(value: string): boolean {
  if (typeof value !== "string") return false;
  const parts = value.split(".");
  return parts.length === 3 && parts[0] === TEMP_KEY_TAG && parts[1].length > 0 && parts[2].length > 0;
}

/** Mint a key that stops working at `expiresAtSec` (absolute unix seconds). */
export async function mintTempKey(secret: string, expiresAtSec: number): Promise<string> {
  if (!secret) {
    // Minting against "" would produce a key that a deployment with no code set would
    // then happily accept, which is the fail-open the whole gate exists to avoid.
    throw new Error("Cannot mint a temporary key without a master access code");
  }
  if (!Number.isFinite(expiresAtSec) || expiresAtSec <= 0) {
    throw new Error(`Expiry must be a positive unix timestamp, got ${expiresAtSec}`);
  }
  const exp = Math.floor(expiresAtSec).toString(36);
  const sig = (await hmacHex(secret, TEMP_KEY_PREFIX + exp)).slice(0, SIG_CHARS);
  return `${TEMP_KEY_TAG}.${exp}.${sig}`;
}

export interface TempKeyVerdict {
  ok: boolean;
  /** Absolute unix seconds. 0 when the key could not be read at all. */
  expiresAt: number;
  /** Why it was refused; undefined when it was not. */
  reason?: "malformed" | "signature" | "expired";
}

/**
 * Check a key against the master code at a given moment.
 *
 * ORDER MATTERS: the signature is checked BEFORE the expiry. Checking expiry first
 * would answer "that key has expired" for a string that was never a valid key, which
 * tells an attacker their forgery parsed. The reason is only ever returned to code,
 * not to a visitor, but the ordering costs nothing and removes the question.
 */
export async function verifyTempKey(
  secret: string,
  key: string,
  nowSec: number,
): Promise<TempKeyVerdict> {
  if (!secret || !isTempKey(key)) return { ok: false, expiresAt: 0, reason: "malformed" };

  const [, exp, sig] = key.split(".");
  const expiresAt = Number.parseInt(exp, 36);
  // `parseInt` is lenient — it stops at the first bad character rather than failing —
  // so the parse is confirmed by round-tripping it back to the string that was signed.
  if (!Number.isFinite(expiresAt) || expiresAt <= 0 || expiresAt.toString(36) !== exp) {
    return { ok: false, expiresAt: 0, reason: "malformed" };
  }

  const expected = (await hmacHex(secret, TEMP_KEY_PREFIX + exp)).slice(0, SIG_CHARS);
  if (!constantTimeEqualHex(sig, expected)) {
    return { ok: false, expiresAt, reason: "signature" };
  }
  if (!Number.isFinite(nowSec) || nowSec > expiresAt) {
    return { ok: false, expiresAt, reason: "expired" };
  }
  return { ok: true, expiresAt };
}

/**
 * Equality with no early exit. Both sides are already fixed-width hex from the same
 * truncation, so unlike `constantTimeEqual` in token.ts there is nothing to hash first
 * — but a length mismatch is still answered in constant time over the expected length,
 * because returning early on length is itself a leak.
 */
function constantTimeEqualHex(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a.charCodeAt(i) || 0) ^ b.charCodeAt(i);
  return diff === 0;
}
