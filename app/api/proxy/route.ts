import type { NextRequest } from "next/server";
import { getCameraById } from "@/lib/sources/registry";
import { isAllowed } from "@/lib/proxy/allowlist";
import { extractScotlandImage } from "@/lib/sources/trafficscotland";
import { needsH2, h2Fetch } from "@/lib/http/h2";

export const dynamic = "force-dynamic";

const UA = "TrafficNerd/2.0 (+https://github.com/011-sam-110/TrafficNerd-V2)";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return new Response("missing id", { status: 400 });

  const cam = await getCameraById(id);
  if (!cam?.imageUrl) return new Response("camera or image not found", { status: 404 });

  let target: URL;
  try { target = new URL(cam.imageUrl); } catch { return new Response("bad image url", { status: 500 }); }
  if (!isAllowed(target)) return new Response("forbidden host", { status: 403 });

  // Traffic Scotland has no direct snapshot .jpg — its camera image is a base64
  // JPEG embedded in the /tsis/camerahtml page. Fetch the page and pull the bytes.
  if (target.hostname === "www.traffic.gov.scot") {
    return proxyTrafficScotland(target, cam.refreshSeconds);
  }

  // A handful of upstreams serve HTTP/1.1 that Node's parser rejects outright, so
  // `fetch` returns nothing at all for them and every one of their cameras would
  // render as a broken image. Those hosts are named in lib/http/h2.ts and are
  // fetched over HTTP/2 instead, where the defect is not representable.
  if (needsH2(target.hostname)) {
    return proxyOverH2(target, cam.refreshSeconds);
  }

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
      // Never serve a camera faster than the source refresh (TfL = 300s).
      "Cache-Control": `public, max-age=${cam.refreshSeconds}, s-maxage=${cam.refreshSeconds}`,
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
  return new Response(new Uint8Array(upstream.body), {
    status: 200,
    headers: {
      "Content-Type": ct && ct.startsWith("image/") ? ct : "image/jpeg",
      "Cache-Control": `public, max-age=${refreshSeconds}, s-maxage=${refreshSeconds}`,
    },
  });
}

// Traffic Scotland helper: fetch the camerahtml page and decode the embedded
// base64 JPEG into real image bytes. Host is already allowlist-checked by GET().
async function proxyTrafficScotland(target: URL, refreshSeconds: number): Promise<Response> {
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

  return new Response(Buffer.from(img.base64, "base64"), {
    status: 200,
    headers: {
      "Content-Type": img.contentType,
      "Cache-Control": `public, max-age=${refreshSeconds}, s-maxage=${refreshSeconds}`,
    },
  });
}
