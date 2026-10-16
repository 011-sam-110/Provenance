import { describe, expect, it } from "vitest";
import {
  RELAY_MAX_SKEW_MS,
  parseEnvelope,
  relayBodyDigestHex,
  relaySigningString,
  signRelay,
  verifyRelay,
} from "@/lib/relay/protocol";

/**
 * CROSS-REPO VECTORS. The NewsScraper repo's `sources/sign.py` pins the same three
 * literals per vector in TEST_VECTORS and tests/test_sources_sign.py. The expected values
 * were computed with node:crypto, a third implementation beside WebCrypto (here) and
 * hashlib/hmac (there), so these assert agreement between libraries, not a function with
 * itself.
 *
 * IF ONE FAILS, THE PROTOCOL CHANGED. Do not update the literal to make it pass.
 */
const VECTORS = [
  {
    name: "probe",
    secret: "provenance-relay-test-secret-00000001",
    ts: 1792180000000,
    body: '{"version":1,"feed":"celestrak","probe":true}',
    digest: "6fa575fc7259ec4870a16a84ec041b6b4169faf725639e759ae3cdeb952e97ee",
    signature: "83e31984f2d782f89fb00963bd1d59cc74e71d3280c3ba3a0f9f096ea9fbf51b",
  },
  {
    // Three-byte UTF-8 (U+5317 U+6771 U+5C71 U+9E93), written as escapes so no editor can
    // normalise it: byte-versus-code-unit counting is where two HMACs disagree.
    name: "unicode snapshot",
    secret: "provenance-relay-test-secret-00000002",
    ts: 1792180060000,
    body: '{"version":1,"feed":"jma-volcam","fetchedAt":"2026-10-16T19:00:00Z","data":{"site":"北東山麓"}}',
    digest: "55a1973314edbd3284a932d063214d144b9d7e88996c15e031edb757bd7e04d6",
    signature: "eed2ee898884ccc3cbbdce9f5319ce70608076f0a41242b00cb9955e67495b59",
  },
] as const;

describe("relay signature: cross-repo vectors", () => {
  it.each(VECTORS)("$name: digest", async (v) => {
    expect(await relayBodyDigestHex(v.body)).toBe(v.digest);
  });
  it.each(VECTORS)("$name: signature", async (v) => {
    expect(await signRelay(v.secret, v.ts, v.body)).toBe(`sha256=${v.signature}`);
  });
  it.each(VECTORS)("$name: signing string has the relay prefix, not the news one", (v) => {
    expect(relaySigningString(v.ts, v.digest)).toBe(`provenance-relay-v1:${v.ts}:${v.digest}`);
  });
});

describe("verifyRelay", () => {
  const secret = "provenance-relay-test-secret-00000001";
  const body = '{"version":1,"feed":"celestrak","probe":true}';
  const now = 1792180000000;

  it("accepts a correct signature inside the window", async () => {
    const sig = await signRelay(secret, now, body);
    expect(await verifyRelay({ secret, timestampHeader: String(now), signatureHeader: sig, body, nowMs: now + 1000 })).toEqual({ ok: true });
  });

  it("refuses when no secret is configured, whatever is presented", async () => {
    const sig = await signRelay(secret, now, body);
    const r = await verifyRelay({ secret: "", timestampHeader: String(now), signatureHeader: sig, body, nowMs: now });
    expect(r.ok).toBe(false);
  });

  it("refuses an edited body, a wrong secret and a stale timestamp", async () => {
    const sig = await signRelay(secret, now, body);
    const edited = body.replace("celestrak", "eea-aqi");
    expect((await verifyRelay({ secret, timestampHeader: String(now), signatureHeader: sig, body: edited, nowMs: now })).ok).toBe(false);
    expect((await verifyRelay({ secret: secret + "x", timestampHeader: String(now), signatureHeader: sig, body, nowMs: now })).ok).toBe(false);
    expect(
      (await verifyRelay({ secret, timestampHeader: String(now), signatureHeader: sig, body, nowMs: now + RELAY_MAX_SKEW_MS + 1 })).ok,
    ).toBe(false);
  });

  it("refuses a timestamp with trailing junk instead of parsing a prefix of it", async () => {
    const sig = await signRelay(secret, now, body);
    const r = await verifyRelay({ secret, timestampHeader: `${now}abc`, signatureHeader: sig, body, nowMs: now });
    expect(r).toEqual({ ok: false, reason: "bad-timestamp" });
  });

  it("cannot be satisfied by a news-rail signature over the same body", async () => {
    const { signIngest } = await import("@/lib/news/ingest");
    const newsSig = await signIngest(secret, now, body);
    expect((await verifyRelay({ secret, timestampHeader: String(now), signatureHeader: newsSig, body, nowMs: now })).ok).toBe(false);
  });
});

describe("parseEnvelope", () => {
  const now = Date.parse("2026-10-16T20:00:00Z");

  it("reads a probe", () => {
    expect(parseEnvelope({ version: 1, feed: "celestrak", probe: true }, "celestrak", now)).toEqual({
      ok: true,
      envelope: { kind: "probe", feed: "celestrak" },
    });
  });

  it("reads a snapshot and keeps fetchedAt as the data's time", () => {
    const r = parseEnvelope({ version: 1, feed: "celestrak", fetchedAt: "2026-10-16T19:00:00Z", data: { a: 1 } }, "celestrak", now);
    expect(r).toEqual({
      ok: true,
      envelope: { kind: "snapshot", feed: "celestrak", fetchedAtMs: Date.parse("2026-10-16T19:00:00Z"), data: { a: 1 } },
    });
  });

  it("refuses a body that names another feed than the path, so a push cannot be replayed across feeds", () => {
    const r = parseEnvelope({ version: 1, feed: "celestrak", fetchedAt: "2026-10-16T19:00:00Z", data: {} }, "eea-aqi", now);
    expect(r).toEqual({ ok: false, reason: "feed-mismatch" });
  });

  it("refuses an unknown version, a missing or future fetchedAt, and missing data", () => {
    expect(parseEnvelope({ version: 2, feed: "x", probe: true }, "x", now)).toMatchObject({ ok: false, reason: "unsupported-version" });
    expect(parseEnvelope({ version: 1, feed: "x", data: {} }, "x", now)).toMatchObject({ ok: false, reason: "no-fetched-at" });
    expect(parseEnvelope({ version: 1, feed: "x", fetchedAt: "2026-10-16T21:00:00Z", data: {} }, "x", now)).toMatchObject({
      ok: false,
      reason: "fetched-in-future",
    });
    expect(parseEnvelope({ version: 1, feed: "x", fetchedAt: "2026-10-16T19:00:00Z" }, "x", now)).toMatchObject({ ok: false, reason: "no-data" });
    expect(parseEnvelope([], "x", now)).toMatchObject({ ok: false, reason: "not-an-object" });
  });
});
