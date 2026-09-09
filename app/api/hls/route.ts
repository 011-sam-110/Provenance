import type { NextRequest } from "next/server";
import { getCameraById } from "@/lib/sources/registry";
import { isHlsAllowed } from "@/lib/proxy/hls-allowlist";
import { rewritePlaylist } from "@/lib/proxy/hls-rewrite";
import {
  PLAYLIST_CACHE_CONTROL,
  SEGMENT_BROWSER_TTL_SECONDS,
  SEGMENT_SHARED_TTL_SECONDS,
  describeFetchError,
  isPlaylistResponse,
  isServableUpstream,
  statusForUpstream,
} from "@/lib/proxy/hls-response";
import { browserAndEdgeHeaders } from "@/lib/http/cache";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const idParam = req.nextUrl.searchParams.get("id");
  const uParam = req.nextUrl.searchParams.get("u");

  let upstream: string | null = null;
  if (uParam) {
    upstream = uParam;
  } else if (idParam) {
    const cam = await getCameraById(idParam);
    if (!cam?.streamUrl) return new Response("camera or stream not found", { status: 404 });
    upstream = cam.streamUrl;
  }
  if (!upstream) return new Response("missing id or u", { status: 400 });

  let target: URL;
  try { target = new URL(upstream); } catch { return new Response("bad url", { status: 400 }); }

  const verdict = isHlsAllowed(target);
  if (!verdict.ok) return new Response("forbidden host", { status: 403 });

  const range = req.headers.get("range");
  let res: Response;
  try {
    res = await fetch(target.toString(), {
      headers: {
        Referer: verdict.referer ?? "",
        "User-Agent": "TrafficNerd/2.0 (+https://github.com/011-sam-110/TrafficNerd-V2)",
        Accept: "*/*",
        ...(range ? { Range: range } : {}),
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    // Logged rather than swallowed: a bare `catch {}` here meant every transport-level
    // failure — DNS, TLS, connection reset, the 10 s abort — arrived as one
    // indistinguishable 502 with nothing written down, so there was no way to tell
    // which had happened without reproducing it by hand.
    console.warn(`[hls] fetch failed for ${target.host}${target.pathname}: ${describeFetchError(err)}`);
    return new Response("upstream fetch failed", { status: 502 });
  }

  // A non-2xx upstream is reported as itself where that is the honest answer — see
  // lib/proxy/hls-response.ts. The case that matters in practice is 404 on a segment
  // that has rolled out of the live window, which is normal and is not our failure.
  if (!isServableUpstream(res.status)) {
    return new Response("upstream error", { status: statusForUpstream(res.status) });
  }

  const ct = res.headers.get("content-type");

  if (isPlaylistResponse(ct, target.pathname)) {
    const body = await res.text();
    return new Response(rewritePlaylist(body, target.toString()), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": PLAYLIST_CACHE_CONTROL,
      },
    });
  }

  // Segment / binary: stream straight through (do not buffer), preserve range semantics.
  const headers = new Headers();
  headers.set("Content-Type", ct ?? "video/mp2t");
  const cr = res.headers.get("content-range"); if (cr) headers.set("Content-Range", cr);
  const cl = res.headers.get("content-length"); if (cl) headers.set("Content-Length", cl);
  headers.set("Accept-Ranges", "bytes");
  for (const [k, v] of Object.entries(
    browserAndEdgeHeaders(SEGMENT_BROWSER_TTL_SECONDS, SEGMENT_SHARED_TTL_SECONDS),
  )) {
    headers.set(k, v);
  }
  return new Response(res.body, { status: res.status, headers });
}
