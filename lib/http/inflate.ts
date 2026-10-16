// lib/http/inflate.ts
// Gunzip with a ceiling, refusing to allocate past it.
//
// A signature over the CONTENT (see lib/relay/protocol.ts and lib/news/ingest.ts) means
// the body has to be decompressed before it can be authenticated, so an unauthenticated
// caller can make this app decompress. The cap while reading is what makes that safe: a
// compression bomb costs one capped buffer and a 413, not the box.
//
// The same loop lives inline in app/api/news/ingest/route.ts, which predates this file.

/** The decoded text, or null when the stream passes `limit` or is not valid gzip. */
export async function inflateBounded(raw: Uint8Array, limit: number): Promise<string | null> {
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
    return null; // truncated, or not gzip at all
  }
  const joined = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}
