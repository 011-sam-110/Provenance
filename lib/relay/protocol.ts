// lib/relay/protocol.ts
// The wire contract for POST /api/relay/[feed]: signature, envelope and limits. PURE
// and node-testable; the route in app/api/relay/[feed]/route.ts does the I/O.
//
// WHAT THE RELAY IS FOR. Some upstreams refuse this app's server. CelesTrak firewalls
// the production IP (measured 2026-10-16: an 8 s timeout from the box, a 200 from
// anywhere else), and a few others are HTML pages or session-bound portals that need a
// scraper rather than one GET. A second machine (provenance-1, the same host as the
// NewsScraper timers) fetches those, and pushes ONE signed snapshot per feed here.
// Nothing in this app ever dials that machine: it is behind residential NAT.
//
// THE SCHEME IS lib/news/ingest.ts's, WITH ITS OWN PREFIX AND ITS OWN SECRET. HMAC-SHA256
// over `prefix:timestamp:sha256(body)`, a replay window, and a size cap. The prefix is
// domain separation: a signature minted for the news rail can never verify here, and the
// reverse, even if somebody sets the two secrets to the same value. The signature covers
// the UNCOMPRESSED JSON for the reason ingest.ts gives: Cloudflare may re-encode the
// wire bytes without changing a character of the content.
//
// THE FEED IS NOT IN THE SIGNED STRING, BUT IT IS IN THE SIGNED BODY. The envelope
// carries `feed`, and parseEnvelope refuses a body whose feed differs from the path. So
// a captured celestrak push cannot be replayed against /api/relay/eea-aqi: the body
// would name the wrong feed, and editing it breaks the signature.
import { constantTimeEqual } from "@/lib/gate/token";

/** Domain separation. Changing this string is a breaking protocol change on both ends. */
export const RELAY_SIGNATURE_PREFIX = "provenance-relay-v1";

/** Same window as the news ingest, for the same reason: two NTP clocks, a captured request. */
export const RELAY_MAX_SKEW_MS = 5 * 60 * 1000;

/** The only envelope version this app reads. */
export const RELAY_ENVELOPE_VERSION = 1;

export const RELAY_TIMESTAMP_HEADER = "x-provenance-timestamp";
export const RELAY_SIGNATURE_HEADER = "x-provenance-signature";
export const RELAY_DIGEST_HEADER = "x-provenance-content-sha256";

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 of the uncompressed body, lowercase hex. */
export async function relayBodyDigestHex(body: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(body) as unknown as BufferSource));
}

/** Exactly what both sides sign. */
export function relaySigningString(timestampMs: number, digestHex: string): string {
  return `${RELAY_SIGNATURE_PREFIX}:${timestampMs}:${digestHex}`;
}

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

/** The `x-provenance-signature` value. Exported so the tests sign for real. */
export async function signRelay(secret: string, timestampMs: number, body: string): Promise<string> {
  return `sha256=${await hmacHex(secret, relaySigningString(timestampMs, await relayBodyDigestHex(body)))}`;
}

export type RelaySignatureResult = { ok: true } | { ok: false; reason: string };

/**
 * Check one push. Every refusal has the same shape and the route turns all of them into
 * one 401, so a prober cannot tell which part it got right.
 */
export async function verifyRelay(input: {
  secret: string;
  timestampHeader: string | null;
  signatureHeader: string | null;
  body: string;
  nowMs: number;
}): Promise<RelaySignatureResult> {
  const { secret, timestampHeader, signatureHeader, body, nowMs } = input;
  if (!secret) return { ok: false, reason: "not-configured" };
  if (!timestampHeader || !signatureHeader) return { ok: false, reason: "missing-headers" };

  const timestampMs = Number.parseInt(timestampHeader, 10);
  // parseInt stops at the first bad character instead of failing, so round-trip it.
  if (!Number.isFinite(timestampMs) || String(timestampMs) !== timestampHeader.trim()) {
    return { ok: false, reason: "bad-timestamp" };
  }
  if (Math.abs(nowMs - timestampMs) > RELAY_MAX_SKEW_MS) return { ok: false, reason: "skew" };

  const expected = await signRelay(secret, timestampMs, body);
  if (!(await constantTimeEqual(signatureHeader.trim(), expected))) {
    return { ok: false, reason: "signature" };
  }
  return { ok: true };
}

// --- the envelope ----------------------------------------------------------------

/**
 * One push, after the signature passed. Two kinds:
 *
 * - a SNAPSHOT carries `fetchedAt` (when provenance-1 read the upstream, NOT when it
 *   pushed) and `data`, which the feed's own schema then checks;
 * - a PROBE carries `probe: true` and no data. It asks "what do you hold for this feed?",
 *   which is how the sender decides whether to push at all. This app keeps snapshots in
 *   process memory, so after a restart the answer is "nothing" and the sender's next run
 *   refills it. That is the same recovery path the news rail uses (lib/news/scrapedStore.ts).
 */
export type RelayEnvelope =
  | { kind: "probe"; feed: string }
  | { kind: "snapshot"; feed: string; fetchedAtMs: number; data: unknown };

export type EnvelopeResult = { ok: true; envelope: RelayEnvelope } | { ok: false; reason: string };

/**
 * Validate the outer shape. `nowMs` bounds `fetchedAt`: a snapshot dated in the future
 * beyond the skew window is refused, because a reader would treat it as fresher than
 * anything that could ever replace it.
 */
export function parseEnvelope(raw: unknown, pathFeed: string, nowMs: number): EnvelopeResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "not-an-object" };
  const r = raw as Record<string, unknown>;
  if (r.version !== RELAY_ENVELOPE_VERSION) return { ok: false, reason: "unsupported-version" };
  if (r.feed !== pathFeed) return { ok: false, reason: "feed-mismatch" };

  if (r.probe === true) return { ok: true, envelope: { kind: "probe", feed: pathFeed } };

  if (typeof r.fetchedAt !== "string") return { ok: false, reason: "no-fetched-at" };
  const fetchedAtMs = Date.parse(r.fetchedAt);
  if (!Number.isFinite(fetchedAtMs)) return { ok: false, reason: "bad-fetched-at" };
  if (fetchedAtMs - nowMs > RELAY_MAX_SKEW_MS) return { ok: false, reason: "fetched-in-future" };
  if (!("data" in r) || r.data === null || r.data === undefined) return { ok: false, reason: "no-data" };

  return { ok: true, envelope: { kind: "snapshot", feed: pathFeed, fetchedAtMs, data: r.data } };
}
