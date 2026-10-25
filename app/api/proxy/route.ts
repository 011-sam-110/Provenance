import type { NextRequest } from "next/server";
import { getCameraById } from "@/lib/sources/registry";
import { isAllowed, upstreamRequest } from "@/lib/proxy/allowlist";
import { extractScotlandImage, isScotlandCard } from "@/lib/sources/trafficscotland";
import { notePlaceholder } from "@/lib/sources/placeholderMemo";
import { extractTxdotSnapshot } from "@/lib/sources/txdot";
import { needsH2, h2Fetch } from "@/lib/http/h2";
import { frameCacheHeaders } from "@/lib/http/cache";
import { CLIP_MAX_BYTES, clipUrl, pictureTimeHeader } from "@/lib/proxy/clip";
import type { Camera } from "@/lib/types";

export const dynamic = "force-dynamic";

const UA = "TrafficNerd/2.0 (+https://github.com/011-sam-110/TrafficNerd-V2)";

/**
 * The operator's own Last-Modified, passed on. It is when the operator published this
 * picture, which is the only honest age a viewer can print; without it, a cache in
 * front of this route stamps its own fetch time instead (production did: the God's
 * eye view's recon found every frame "modified" at the moment the proxy fetched it).
 */
function takenHeader(lastModified: string | null | undefined): Record<string, string> {
  const value = pictureTimeHeader(lastModified, Date.now());
  return value ? { "Last-Modified": value } : {};
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return new Response("missing id", { status: 400 });

  const cam = await getCameraById(id);
  // `clip=1`: the camera's short recording instead of its still. See lib/proxy/clip.ts.
  if (req.nextUrl.searchParams.get("clip") === "1") return proxyClip(cam);
  if (!cam?.imageUrl) return new Response("camera or image not found", { status: 404 });

  let target: URL;
  try { target = new URL(cam.imageUrl); } catch { return new Response("bad image url", { status: 500 }); }
  if (!isAllowed(target)) return new Response("forbidden host", { status: 403 });

  // Traffic Scotland has no direct snapshot .jpg — its camera image is a base64
  // JPEG embedded in the /tsis/camerahtml page. Fetch the page and pull the bytes.
  if (target.hostname === "www.traffic.gov.scot") {
    return proxyTrafficScotland(target, cam.refreshSeconds, cam.id);
  }

  // TxDOT ITS has no snapshot file either: its snapshot endpoint answers JSON whose
  // `snippet` is a base64 JPEG. Fetch it and hand back the decoded bytes.
  if (target.hostname === "its.txdot.gov") {
    return proxyTxdot(target, cam.refreshSeconds);
  }

  // A handful of upstreams serve HTTP/1.1 that Node's parser rejects outright, so
  // `fetch` returns nothing at all for them and every one of their cameras would
  // render as a broken image. Those hosts are named in lib/http/h2.ts and are
  // fetched over HTTP/2 instead, where the defect is not representable.
  if (needsH2(target.hostname)) {
    return proxyOverH2(target, cam.refreshSeconds);
  }

  // A host may need a server-only credential or agent string (lib/proxy/allowlist.ts).
  // A dormant credential means there is nothing honest to fetch.
  const upstreamReq = upstreamRequest(target);
  if (!upstreamReq) return new Response("camera feed is not configured", { status: 404 });

  let upstream: Response;
  try {
    upstream = await fetch(upstreamReq.url, {
      headers: { "User-Agent": UA, ...upstreamReq.headers },
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
      ...takenHeader(upstream.headers.get("last-modified")),
      // Never serve a camera faster than the source refresh (TfL = 300s).
      ...frameCacheHeaders(cam.refreshSeconds),
    },
  });
}

// The camera's own short recording (lib/proxy/clip.ts): an .mp4 on an allowlisted
// host, found from the camera id and never from the request. Same contract as the
// still: same agent, no redirects, the operator's Last-Modified, the source's cadence.
async function proxyClip(cam: Camera | null): Promise<Response> {
  const target = clipUrl(cam?.streamUrl);
  if (!cam || !target) return new Response("camera has no clip", { status: 404 });
  const upstreamReq = upstreamRequest(target);
  if (!upstreamReq) return new Response("camera feed is not configured", { status: 404 });

  let upstream: Response;
  try {
    upstream = await fetch(upstreamReq.url, {
      headers: { "User-Agent": UA, ...upstreamReq.headers },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return new Response("upstream fetch failed", { status: 502 });
  }
  if (!upstream.ok) return new Response("upstream error", { status: 502 });
  const declared = Number(upstream.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > CLIP_MAX_BYTES) return new Response("clip too large", { status: 502 });
  const body = await upstream.arrayBuffer();
  if (body.byteLength > CLIP_MAX_BYTES) return new Response("clip too large", { status: 502 });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "video/mp4",
      ...takenHeader(upstream.headers.get("last-modified")),
      ...frameCacheHeaders(cam.refreshSeconds),
    },
  });
}

// HTTP/2 helper, for the hosts listed in lib/http/h2.ts. Same contract as the
// `fetch` path above — allowlist already checked by GET(), same cache headers, and
// a non-image content-type still falls back to image/jpeg.
async function proxyOverH2(target: URL, refreshSeconds: number): Promise<Response> {
  let upstream: Awaited<ReturnType<typeof h2Fetch>>;
  try {
    upstream = await h2Fetch(target.toString(), {
      headers: { "user-agent": UA },
      timeoutMs: 10_000,
    });
  } catch {
    return new Response("upstream fetch failed", { status: 502 });
  }
  if (upstream.status < 200 || upstream.status >= 300) {
    return new Response("upstream error", { status: 502 });
  }
  const ct = upstream.headers["content-type"];
  const lm = upstream.headers["last-modified"];
  return new Response(new Uint8Array(upstream.body), {
    status: 200,
    headers: {
      "Content-Type": ct && ct.startsWith("image/") ? ct : "image/jpeg",
      ...takenHeader(Array.isArray(lm) ? lm[0] : lm),
      ...frameCacheHeaders(refreshSeconds),
    },
  });
}

// Traffic Scotland helper: fetch the camerahtml page and decode the embedded
// base64 JPEG into real image bytes. Host is already allowlist-checked by GET().
async function proxyTrafficScotland(target: URL, refreshSeconds: number, cameraId: string): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      headers: { "User-Agent": UA, Accept: "text/html" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return new Response("upstream fetch failed", { status: 502 });
  }
  if (!upstream.ok) return new Response("upstream error", { status: 502 });

  const img = extractScotlandImage(await upstream.text());
  if (!img) return new Response("no embedded image", { status: 502 });

  const bytes = Buffer.from(img.base64, "base64");
  // The operator's "Currently Unavailable" card is still served (it is the honest
  // picture), but it is recorded, so the next registry refresh marks the camera
  // unavailable instead of live. See lib/sources/placeholderMemo.ts.
  const card = await isScotlandCard(bytes);
  notePlaceholder(cameraId, card);
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": img.contentType,
      ...(card ? { "X-Camera-Placeholder": "operator-unavailable-card" } : {}),
      ...frameCacheHeaders(refreshSeconds),
    },
  });
}

// TxDOT helper: fetch the snapshot JSON and decode its base64 JPEG. Host and path are
// already allowlist-checked by GET().
async function proxyTxdot(target: URL, refreshSeconds: number): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      headers: { "User-Agent": UA, Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return new Response("upstream fetch failed", { status: 502 });
  }
  if (!upstream.ok) return new Response("upstream error", { status: 502 });

  let body: unknown;
  try {
    body = await upstream.json();
  } catch {
    return new Response("no snapshot", { status: 502 });
  }
  const img = extractTxdotSnapshot(body);
  if (!img) return new Response("no snapshot", { status: 502 });

  return new Response(Buffer.from(img.base64, "base64"), {
    status: 200,
    headers: {
      "Content-Type": img.contentType,
      ...frameCacheHeaders(refreshSeconds),
    },
  });
}
