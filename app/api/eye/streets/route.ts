import { cachedBody } from "@/lib/http/originCache";
import { edgeCacheHeaders } from "@/lib/http/cache";
import { STREETS_EVERY_MS, TFL_DISRUPTIONS_URL, normalizeTflDisruptions, streetsBody } from "@/lib/eye/streets";

export const dynamic = "force-dynamic";

/**
 * GET /api/eye/streets: TfL's road disruptions across London, for the God's eye view.
 *
 * Keyless (TfL's Unified API, Open Government Licence) and read at most once per two
 * minutes for the whole deployment: the body is held on the origin and rebuilt behind
 * the request (lib/http/originCache.ts), so no visitor waits on TfL and a failed
 * refresh keeps serving the last good answer, whose `fetchedAt` says how old it is.
 * A cold start with TfL down answers an empty list with `ok: false`, never a 5xx.
 *
 * Response: { ok, credit, fetchedAt, count, features } (lib/eye/streets.ts).
 */
async function build(): Promise<string> {
  const res = await fetch(TFL_DISRUPTIONS_URL, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`TfL answered ${res.status}`);
  return streetsBody(normalizeTflDisruptions(await res.json()), Date.now());
}

export async function GET() {
  try {
    const body = await cachedBody({ key: "eye-streets", ttlMs: STREETS_EVERY_MS, build });
    return new Response(body, {
      headers: { "Content-Type": "application/json", ...edgeCacheHeaders(STREETS_EVERY_MS) },
    });
  } catch {
    return Response.json(
      { ok: false, fetchedAt: null, count: 0, features: [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
