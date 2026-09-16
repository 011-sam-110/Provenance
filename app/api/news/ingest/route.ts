import {
  INGEST_MAX_BODY_BYTES,
  INGEST_MAX_WIRE_BYTES,
  bodyDigestHex,
  parseSnapshot,
  verifyIngest,
} from "@/lib/news/ingest";
import { ingestItems, scrapedCursor, scrapedStats } from "@/lib/news/scrapedStore";

export const dynamic = "force-dynamic";

/**
 * Decompress with a ceiling, refusing to allocate past it.
 *
 * The signature is checked on the CONTENT, not the wire bytes (lib/news/ingest.ts
 * explains why Cloudflare makes that the only workable choice), which means an
 * unauthenticated caller can make this app decompress. A cap while reading is what
 * makes that safe: a compression bomb costs one capped buffer and a 413, not the box.
 */
async function inflateBounded(raw: Uint8Array, limit: number): Promise<string | null> {
  const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null; // truncated or not actually gzip
  }
  const joined = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

/**
 * POST /api/news/ingest — the door the NewsScraper host pushes through.
 *
 * It answers 404 when NEWS_INGEST_SECRET is unset, matching /api/gate, /api/private
 * and /admin. An unsigned ingest endpoint standing on a deployment with no secret is
 * a target and nothing else, and every preview build and every fork is in that state.
 *
 * THE CURSOR PROBE. A batch with `items: []` is valid and returns the cursor. That is
 * how the scraper asks "what do you already have?" on a cold start without needing a
 * second, separately-authenticated GET — and after a restart of this app the answer is
 * "", which it reads as "send me everything".
 *
 * MAINTENANCE MODE GATES THIS, deliberately. `lib/gate/paths.ts` gates all of api/,
 * so while the curtain is up a push gets a 503. Nothing is lost: a refused push does
 * not advance the cursor, so the scraper re-sends the same window when the site is
 * back. Do not add this path to GATE_EXEMPT_STARTS to "fix" that — the whole point of
 * the curtain is that compute stops.
 *
 * EVERY SIGNATURE REFUSAL IS THE SAME STATUS. A prober learns whether the secret is
 * configured (404 vs 401) and nothing finer. Once a body is authentic the reasons DO
 * come back, because at that point the sender is us and a reason is a debugging aid
 * rather than an oracle.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.NEWS_INGEST_SECRET ?? "";
  if (!secret) return new Response(null, { status: 404 });

  // Check the declared length before reading a byte, so an oversized body costs us
  // the headers and nothing else.
  const declared = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > INGEST_MAX_WIRE_BYTES) {
    return Response.json({ ok: false }, { status: 413 });
  }

  let raw: Uint8Array;
  try {
    raw = new Uint8Array(await request.arrayBuffer());
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  if (raw.byteLength > INGEST_MAX_WIRE_BYTES) {
    return Response.json({ ok: false }, { status: 413 });
  }

  const gzipped = (request.headers.get("content-encoding") ?? "").toLowerCase().includes("gzip");
  let json: string | null;
  if (gzipped) {
    json = await inflateBounded(raw, INGEST_MAX_BODY_BYTES);
    if (json === null) return Response.json({ ok: false }, { status: 413 });
  } else {
    if (raw.byteLength > INGEST_MAX_BODY_BYTES) {
      return Response.json({ ok: false }, { status: 413 });
    }
    json = new TextDecoder().decode(raw);
  }

  const verdict = await verifyIngest({
    secret,
    timestampHeader: request.headers.get("x-provenance-timestamp"),
    signatureHeader: request.headers.get("x-provenance-signature"),
    body: json,
    nowMs: Date.now(),
  });
  if (!verdict.ok) return Response.json({ ok: false }, { status: 401 });

  // Optional belt-and-braces: the sender may declare the content digest separately.
  // It proves nothing the signature does not already prove, but when it disagrees it
  // says WHICH of the two sides mangled the body, which the signature alone cannot.
  const declaredDigest = request.headers.get("x-provenance-content-sha256");
  if (declaredDigest && declaredDigest.trim().toLowerCase() !== (await bodyDigestHex(json))) {
    return Response.json({ ok: false, reason: "digest-mismatch" }, { status: 422 });
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(json);
  } catch {
    return Response.json({ ok: false, reason: "bad-json" }, { status: 400 });
  }

  const parsed = parseSnapshot(decoded);
  if (!parsed.ok) return Response.json({ ok: false, reason: parsed.reason }, { status: 422 });

  const outcome = ingestItems(parsed.snapshot.items, Date.now());
  const stats = scrapedStats();
  const { received, droppedIds } = parsed.snapshot;

  // THE SENDER MUST COMPARE `stored`, NOT `accepted`.
  //
  // `accepted` counts rows that were new or had changed. On a steady-state run most
  // rows are `unchanged`, so a sender watching `accepted < received` to detect losses
  // would read a healthy batch as a mass drop and rewind its cursor over the whole
  // window, every run. `stored` is the honest "we took it" number and `dropped` is
  // the honest "we did not" one, so neither side has to infer anything.
  const stored = outcome.accepted + outcome.unchanged;
  return Response.json({
    ok: true,
    received,
    stored,
    accepted: outcome.accepted,
    unchanged: outcome.unchanged,
    dropped: received - stored,
    // Refused for their shape, so they will be refused again. Log them; do not
    // rewind the cursor to retry them.
    droppedIds,
    // What WE hold, not what the batch claimed.
    cursor: scrapedCursor(),
    held: stats.items,
    withText: stats.withText,
  });
}
