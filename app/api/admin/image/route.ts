import type { NextRequest } from "next/server";
import { readCandidates } from "@/lib/discovery/store";

/**
 * Fetch one candidate camera's picture for the review tool.
 *
 * DEV ONLY (404 in production).
 *
 * WHY A PROXY IS NEEDED AT ALL. A candidate is not in the registry yet, so
 * `/api/proxy` cannot serve it — that route resolves an id through `getCameraById`
 * and checks a host allowlist, both of which a candidate by definition fails. And the
 * picture usually cannot be loaded directly by the browser either: a good share of
 * road-camera feeds are plain http, which an https page blocks as mixed content, and
 * others refuse a cross-origin hotlink. Reviewing a feed means seeing its pictures, so
 * the pictures have to come through the server.
 *
 * WHY IT IS NOT AN OPEN PROXY. The URL is not taken on trust: it must appear verbatim
 * as a sample media URL of a candidate in the queue. That makes the reachable set
 * exactly "pictures a discovery run already found", so this cannot be pointed at
 * localhost, at a cloud metadata endpoint, or at anything else on the machine running
 * it. An allowlist derived from the data is the only kind that cannot drift out of
 * date as the data changes.
 */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return new Response(null, { status: 404 });
  }

  const url = req.nextUrl.searchParams.get("url");
  if (!url) return new Response("missing url", { status: 400 });

  const known = new Set<string>();
  for (const c of readCandidates()) {
    for (const s of c.samples) {
      if (s.imageUrl) known.add(s.imageUrl);
      if (s.streamUrl) known.add(s.streamUrl);
    }
  }
  if (!known.has(url)) {
    return new Response("not a media URL of any queued candidate", { status: 403 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: {
        "User-Agent": "TrafficNerd/2.0 discovery review (+https://github.com/011-sam-110/Provenance)",
      },
      cache: "no-store",
      // A camera URL that redirects to somewhere else is a fact the reviewer should
      // see as a failure rather than have silently followed for them.
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return new Response("upstream fetch failed", { status: 502 });
  }
  if (!upstream.ok) return new Response("upstream " + upstream.status, { status: 502 });

  const ct = upstream.headers.get("content-type") ?? "";
  if (!ct.startsWith("image/")) {
    // Worth surfacing rather than rendering: an endpoint answering 200 with HTML is
    // the signature of a login wall or an outage page, and it looks identical to a
    // broken picture in the review card unless the reason is said out loud.
    return new Response("upstream returned " + (ct || "no content-type") + ", not an image", { status: 415 });
  }
  return new Response(await upstream.arrayBuffer(), {
    status: 200,
    headers: { "Content-Type": ct, "Cache-Control": "no-store" },
  });
}
