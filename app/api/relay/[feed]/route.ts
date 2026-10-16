import { inflateBounded } from "@/lib/http/inflate";
import { RELAY_FEEDS, isRelayFeed } from "@/lib/relay/feeds";
import {
  RELAY_DIGEST_HEADER,
  RELAY_SIGNATURE_HEADER,
  RELAY_TIMESTAMP_HEADER,
  parseEnvelope,
  relayBodyDigestHex,
  verifyRelay,
} from "@/lib/relay/protocol";
import { putRelay, relayHeld } from "@/lib/relay/store";

export const dynamic = "force-dynamic";

const refuse = (status: number, reason?: string) =>
  Response.json(reason ? { ok: false, reason } : { ok: false }, { status });

/**
 * POST /api/relay/[feed]: the door provenance-1 pushes relayed upstream snapshots
 * through. The protocol, the feed table and the store each say why they look the way
 * they do (lib/relay/protocol.ts, feeds.ts, store.ts); this file is only the I/O.
 *
 * DORMANT IS A 401, NOT A 404 AND NEVER A 5xx. With RELAY_SIGNING_SECRET unset every
 * push answers 401, the same as a wrong signature, so a prober learns nothing about
 * whether the secret exists. Nothing here can answer 5xx: every step that can throw is
 * caught and mapped to a 4xx, and a failed push changes nothing a reader sees.
 *
 * ORDER OF CHECKS, CHEAPEST FIRST: the feed id (404 before reading a byte), the declared
 * length, the wire length, the decompressed length, THEN the signature, then the shape.
 * An unknown or oversized body never costs an HMAC.
 *
 * MAINTENANCE MODE GATES THIS, as it gates /api/news/ingest: the curtain answers 503 from
 * middleware before this handler runs. Nothing is lost; the sender's next run re-pushes.
 */
export async function POST(request: Request, { params }: { params: Promise<{ feed: string }> }): Promise<Response> {
  const { feed } = await params;
  if (!isRelayFeed(feed)) return new Response(null, { status: 404 });
  const spec = RELAY_FEEDS[feed];

  const declared = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > spec.maxBytes) return refuse(413);

  let raw: Uint8Array;
  try {
    raw = new Uint8Array(await request.arrayBuffer());
  } catch {
    return refuse(400);
  }
  if (raw.byteLength > spec.maxBytes) return refuse(413);

  let json: string | null;
  if ((request.headers.get("content-encoding") ?? "").toLowerCase().includes("gzip")) {
    json = await inflateBounded(raw, spec.maxBytes);
    if (json === null) return refuse(413);
  } else {
    json = new TextDecoder().decode(raw);
  }

  const verdict = await verifyRelay({
    secret: process.env.RELAY_SIGNING_SECRET ?? "",
    timestampHeader: request.headers.get(RELAY_TIMESTAMP_HEADER),
    signatureHeader: request.headers.get(RELAY_SIGNATURE_HEADER),
    body: json,
    nowMs: Date.now(),
  });
  if (!verdict.ok) return refuse(401);

  // From here on the sender is us, so reasons come back: they are a debugging aid now,
  // not an oracle.
  const declaredDigest = request.headers.get(RELAY_DIGEST_HEADER);
  if (declaredDigest && declaredDigest.trim().toLowerCase() !== (await relayBodyDigestHex(json))) {
    return refuse(422, "digest-mismatch");
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(json);
  } catch {
    return refuse(400, "bad-json");
  }

  const now = Date.now();
  const envelope = parseEnvelope(decoded, feed, now);
  if (!envelope.ok) return refuse(422, envelope.reason);

  if (envelope.envelope.kind === "probe") {
    return Response.json({ ok: true, feed, held: relayHeld(feed) });
  }

  const parsed = spec.schema.safeParse(envelope.envelope.data);
  if (!parsed.success) {
    // The first issue's path is enough to find the field on the sender's side. The whole
    // zod report would echo the payload back.
    const issue = parsed.error.issues[0];
    return refuse(422, `schema:${issue ? issue.path.join(".") || "(root)" : "?"}`);
  }

  const outcome = putRelay(feed, parsed.data, envelope.envelope.fetchedAtMs, now);
  return Response.json({ ok: true, feed, outcome, held: relayHeld(feed) });
}
