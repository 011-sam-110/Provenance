import { describe, it, expect } from "vitest";
import {
  TEMP_KEY_DEFAULT_MINUTES,
  TEMP_KEY_MAX_MINUTES,
  isTempKey,
  mintTempKey,
  verifyTempKey,
  tempKeyTtlSeconds,
} from "@/lib/gate/tempkey";
import { GATE_COOKIE_MAX_AGE, gateCookieHeader, gateToken } from "@/lib/gate/token";

/**
 * Temporary access keys: handed to someone for half an hour, then dead, with NOTHING
 * stored anywhere.
 *
 * The key carries its own expiry and an HMAC over it, signed with the master code. So
 * a deployment can verify one with only the env var it already has — no KV, no table,
 * no per-key record to clean up — which is the same property the permanent cookie was
 * built on and the only one that keeps this free.
 *
 * THE SIGNATURE COVERS THE EXPIRY. That is the whole security argument: the expiry is
 * in plain sight and completely untrusted, so editing it invalidates the key rather
 * than extending it.
 */

const SECRET = "a-long-master-code-nobody-guesses";
const NOW = 1_760_000_000; // fixed, so nothing here depends on the wall clock

describe("temporary access keys", () => {
  it("mints a key that verifies against the same secret", async () => {
    const key = await mintTempKey(SECRET, NOW + 1800);
    const v = await verifyTempKey(SECRET, key, NOW);
    expect(v.ok).toBe(true);
    expect(v.expiresAt).toBe(NOW + 1800);
  });

  it("is recognisable as a temp key without verifying it", async () => {
    expect(isTempKey(await mintTempKey(SECRET, NOW + 60))).toBe(true);
    // The permanent cookie is a bare sha256 hex, and must not be mistaken for one.
    expect(isTempKey(await gateToken(SECRET))).toBe(false);
    expect(isTempKey("")).toBe(false);
    expect(isTempKey("t.")).toBe(false);
  });

  it("refuses a key that has expired", async () => {
    const key = await mintTempKey(SECRET, NOW + 1800);
    expect((await verifyTempKey(SECRET, key, NOW + 1799)).ok).toBe(true);
    expect((await verifyTempKey(SECRET, key, NOW + 1801)).ok).toBe(false);
    expect((await verifyTempKey(SECRET, key, NOW + 1801)).reason).toBe("expired");
  });

  it("refuses a key signed with a different secret", async () => {
    const key = await mintTempKey(SECRET, NOW + 1800);
    const v = await verifyTempKey("some-other-code", key, NOW);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("signature");
  });

  // The point of signing the expiry rather than trusting it.
  it("refuses a key whose expiry has been edited to last longer", async () => {
    const key = await mintTempKey(SECRET, NOW + 60);
    const [tag, , sig] = key.split(".");
    const forged = [tag, (NOW + 999_999).toString(36), sig].join(".");
    const v = await verifyTempKey(SECRET, forged, NOW);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("signature");
  });

  it("refuses a truncated or re-signed key", async () => {
    const key = await mintTempKey(SECRET, NOW + 1800);
    expect((await verifyTempKey(SECRET, key.slice(0, -1), NOW)).ok).toBe(false);
    expect((await verifyTempKey(SECRET, key + "0", NOW)).ok).toBe(false);
  });

  it("returns a reason rather than throwing on anything malformed", async () => {
    for (const junk of ["", "t", "t.", "t..", "t.zz.zz", "....", "not-a-key", "t.-1.abc"]) {
      const v = await verifyTempKey(SECRET, junk, NOW);
      expect(v.ok, junk).toBe(false);
      expect(v.reason, junk).toBeTruthy();
    }
  });

  // Rotating the master code is the ONLY revocation there is, because nothing is
  // stored. Worth a test so the property is not quietly lost.
  it("invalidates every outstanding key when the master code changes", async () => {
    const a = await mintTempKey(SECRET, NOW + 1800);
    const b = await mintTempKey(SECRET, NOW + 3600);
    for (const key of [a, b]) {
      expect((await verifyTempKey(SECRET + "!", key, NOW)).ok).toBe(false);
    }
  });

  it("refuses to mint against an empty secret", async () => {
    await expect(mintTempKey("", NOW + 60)).rejects.toThrow();
  });

  it("defaults to thirty minutes and caps how long one may last", () => {
    expect(TEMP_KEY_DEFAULT_MINUTES).toBe(30);
    expect(tempKeyTtlSeconds(TEMP_KEY_DEFAULT_MINUTES)).toBe(1800);
    expect(() => tempKeyTtlSeconds(0)).toThrow();
    expect(() => tempKeyTtlSeconds(-5)).toThrow();
    expect(() => tempKeyTtlSeconds(TEMP_KEY_MAX_MINUTES + 1)).toThrow();
  });
});

/**
 * THE COOKIE MUST NOT OUTLIVE THE KEY, and this is the part that is easy to get wrong.
 *
 * The permanent code sets a thirty-DAY cookie. Reusing that for a thirty-MINUTE key
 * would hand out thirty days of access and the mistake would be invisible: everything
 * would work, and the key would simply never stop working.
 *
 * Two independent stops, because the first one is client-side and therefore advisory:
 * Max-Age asks the browser to drop it, and the signed expiry inside the cookie value
 * means a browser that keeps it anyway is refused at the edge.
 */
describe("the cookie a temporary key buys", () => {
  it("can be issued for less than the permanent lifetime", () => {
    const short = gateCookieHeader("value", true, 1800);
    expect(short).toContain("Max-Age=1800");
    expect(short).toContain("HttpOnly");
    expect(short).toContain("Secure");
  });

  it("still defaults to the permanent lifetime when no age is given", () => {
    expect(gateCookieHeader("value", true)).toContain(`Max-Age=${GATE_COOKIE_MAX_AGE}`);
  });

  it("never issues a cookie that outlives the key inside it", async () => {
    const key = await mintTempKey(SECRET, NOW + 1800);
    const v = await verifyTempKey(SECRET, key, NOW);
    const remaining = v.expiresAt - NOW;
    expect(gateCookieHeader(key, true, remaining)).toContain(`Max-Age=${remaining}`);
    expect(remaining).toBeLessThan(GATE_COOKIE_MAX_AGE);
  });

  // A browser that ignores Max-Age, or a cookie copied to another machine, is still
  // refused — because the value itself is checked, not merely its presence.
  it("is refused at the edge once the key inside it has expired, however it got there", async () => {
    const key = await mintTempKey(SECRET, NOW + 1800);
    expect((await verifyTempKey(SECRET, key, NOW + 5000)).ok).toBe(false);
  });
});
