import type { NextRequest } from "next/server";
import { fetchWebcamById, WINDY_SOURCE } from "@/lib/sources/windy";
import { isAllowed } from "@/lib/proxy/allowlist";
import { frameCacheHeaders } from "@/lib/http/cache";

export const dynamic = "force-dynamic";

const UA = "TrafficNerd/2.0 (+https://github.com/011-sam-110/TrafficNerd-V2)";

/**
 * GET /api/webcam-image?id=windy:<webcamId> — the SSRF-closed image proxy for the
 * Webcams layer (the analogue of /api/proxy for road cameras). The Windy image
 * URL token is short-lived, so we ALWAYS re-resolve it server-side from the live
 * detail endpoint rather than trust a cached/client URL, then proxy the bytes.
 * The x-windy-api-key stays server-side; the client only ever sees this route.
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return new Response("missing id", { status: 400 });

  const cam = await fetchWebcamById(id);
  if (!cam?.imageUrl) return new Response("webcam or image not found", { status: 404 });

  let target: URL;
  try {
    target = new URL(cam.imageUrl);
  } catch {
    return new Response("bad image url", { status: 500 });
  }
  if (!isAllowed(target)) return new Response("forbidden host", { status: 403 });

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      headers: { "User-Agent": UA },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return new Response("upstream fetch failed", { status: 502 });
  }
  if (!upstream.ok) return new Response("upstream error", { status: 502 });

  const body = await upstream.arrayBuffer();
  const ct = upstream.headers.get("content-type");
  const contentType = ct && ct.startsWith("image/") ? ct : "image/jpeg";
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      // Bounded by the source refresh — never re-pull faster than the token cadence.
      ...frameCacheHeaders(WINDY_SOURCE.refreshSeconds),
    },
  });
}
