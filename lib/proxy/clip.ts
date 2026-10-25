// A camera's recorded clip, and the time its operator took a picture. Pure, so the
// rules are unit-tested (tests/unit/proxy-clip.test.ts) apart from the route.
//
// THE CLIP. TfL publishes a short MP4 beside every JamCam still: 352 x 288, recorded
// at the same moment as the still (both carry the same Last-Modified), measured at
// 9.9 s and 14.6 s on 24 Oct 2026. It is a RECORDING, not a stream, so the God's eye
// view labels it "Clip" with its age and never "Live". The proxy serves it by camera
// id only, from the camera's own `streamUrl`, and only when that is an .mp4 on a host
// the proxy already allows. Nobody can ask it for an arbitrary URL.
//
// THE PICTURE TIME. An operator's Last-Modified is when it published the picture, and
// it is the only honest age a card can print. The proxy passes it through; this file
// decides whether a value is one worth passing.

import { isAllowed } from "@/lib/proxy/allowlist";

/** The camera's clip URL when the proxy may serve it, else null. */
export function clipUrl(streamUrl: string | undefined | null): URL | null {
  if (!streamUrl) return null;
  let url: URL;
  try {
    url = new URL(streamUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!url.pathname.toLowerCase().endsWith(".mp4")) return null;
  return isAllowed(url) ? url : null;
}

/** Clips above this are not a short recording, and are refused rather than relayed. */
export const CLIP_MAX_BYTES = 4 * 1024 * 1024;

/** A clock that runs a little ahead of ours is fine; a picture from the future is not. */
const FUTURE_SLACK_MS = 5 * 60_000;

/**
 * The upstream's Last-Modified, if it is a real time and not in the future, as the
 * header value to send on. Null when it should be dropped.
 */
export function pictureTimeHeader(lastModified: string | null | undefined, now: number): string | null {
  if (!lastModified) return null;
  const t = Date.parse(lastModified);
  if (!Number.isFinite(t) || t > now + FUTURE_SLACK_MS) return null;
  return new Date(t).toUTCString();
}
