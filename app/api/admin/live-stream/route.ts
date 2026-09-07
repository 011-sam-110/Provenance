import type { NextRequest } from "next/server";
import { isProduction } from "@/lib/discovery/devOnly";
import { rewritePlaylist } from "@/lib/proxy/hls-rewrite";
import { readQueue } from "@/lib/liveness/queue";

/**
 * Play one QUEUED candidate stream for the review deck.
 *
 * DEV ONLY (404 in production).
 *
 * WHY /api/hls cannot do this. That route resolves a camera id through the registry and
 * checks the stream host against lib/proxy/hls-allowlist.ts. A candidate fails both by
 * definition: it is not in the registry, and its host is not on the allowlist — being
 * allowlisted is what admitting it would eventually earn. A review tool that could only
 * play already-approved streams would be useless.
 *
 * WHY IT IS NOT AN OPEN PROXY. The URL is not taken on trust. It is admitted only if a
 * camera in the current queue has a stream URL with the SAME ORIGIN and a path under
 * the same directory. That covers what a real HLS stream needs — variant playlists,
 * media segments and encryption keys sit beside the playlist — while keeping the
 * reachable set to hosts and paths a discovery run already found. It cannot be pointed
 * at localhost, at a cloud metadata endpoint, or at anything else on this machine.
 *
 * The cost of that rule is a stream whose segments live on a different host or a
 * different path root will not play, and the reviewer will see a card that does not
 * start. That is the correct direction to fail: a card that will not play is visible
 * and gets rejected, whereas an open proxy on a developer laptop is neither.
 */

export const dynamic = "force-dynamic";

const UA = "TrafficNerd/2.0 liveness review (+https://github.com/011-sam-110/Provenance)";

/** Origin plus everything up to the last slash — the directory a playlist lives in. */
function directoryOf(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    return u.origin + u.pathname.slice(0, u.pathname.lastIndexOf("/") + 1);
  } catch {
    return null;
  }
}

function isQueuedOrBeside(rawUrl: string): boolean {
  const dir = directoryOf(rawUrl);
  if (!dir) return false;
  for (const cam of readQueue().cameras) {
    if (cam.streamUrl === rawUrl) return true;
    const camDir = directoryOf(cam.streamUrl);
    if (camDir && dir.startsWith(camDir)) return true;
  }
  return false;
}

export async function GET(req: NextRequest) {
  if (isProduction()) return new Response(null, { status: 404 });

  const url = req.nextUrl.searchParams.get("u");
  if (!url) return new Response("missing u", { status: 400 });
  if (!isQueuedOrBeside(url)) {
    return new Response("not a stream URL of any queued camera", { status: 403 });
  }

  // The queue records a Referer only where the prober MEASURED a bare request failing.
  // Sending one that is not required is a claim we do not need to make, which is the
  // same reasoning already written into lib/proxy/hls-allowlist.ts.
  const referer = readQueue().cameras.find((c) => c.streamUrl === url)?.probe?.refererUsed;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "*/*", ...(referer ? { Referer: referer } : {}) },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return new Response("upstream fetch failed", { status: 502 });
  }
  if (!upstream.ok) {
    // Said out loud rather than rendered as a blank video. A 401 here is the signature
    // of a credentialed stream (Castle Rock's Divas hosts answer exactly that), and
    // that is a different verdict from a dead camera — the reviewer needs to see which.
    return new Response(`upstream ${upstream.status}`, { status: 502 });
  }

  const ct = upstream.headers.get("content-type") ?? "";
  const isPlaylist = /mpegurl/i.test(ct) || new URL(url).pathname.toLowerCase().endsWith(".m3u8");

  if (isPlaylist) {
    const body = await upstream.text();
    // Segment and key URIs are rewritten back through this route, so they inherit the
    // same scoping check rather than being fetched by the browser directly (which
    // would fail anyway on mixed content or a missing CORS header).
    return new Response(rewritePlaylist(body, upstream.url || url, "/api/admin/live-stream"), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-store",
      },
    });
  }

  // Segments and MJPEG are streamed rather than buffered: an MJPEG connection never
  // ends, so awaiting its body would hang the route until the timeout instead of
  // showing the reviewer a moving picture.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": ct || "application/octet-stream",
      "Cache-Control": "no-store",
    },
  });
}
