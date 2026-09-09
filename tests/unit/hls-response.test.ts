import { expect, test } from "vitest";
import {
  PLAYLIST_CACHE_CONTROL,
  SEGMENT_BROWSER_TTL_SECONDS,
  SEGMENT_SHARED_TTL_SECONDS,
  describeFetchError,
  isPlaylistResponse,
  isServableUpstream,
  statusForUpstream,
} from "@/lib/proxy/hls-response";

// The case this file exists for. Measured on prod 2026-09-09: every one of the site's
// 502s was /api/hls, and 376 of the 382 distinct upstream URLs behind them were .ts
// segments answering 404 because they had rolled out of the live window.
test("a rolled-off segment is reported as 404, not as our gateway failing", () => {
  expect(statusForUpstream(404)).toBe(404);
  expect(statusForUpstream(404)).not.toBe(502);
});

test("410 Gone also passes through rather than becoming 502", () => {
  expect(statusForUpstream(410)).toBe(410);
});

test("403 passes through, so hotlink protection is visible as itself", () => {
  expect(statusForUpstream(403)).toBe(403);
});

test("206 survives, so range requests keep working", () => {
  expect(statusForUpstream(206)).toBe(206);
  expect(statusForUpstream(200)).toBe(200);
});

test("a broken upstream is still a bad gateway", () => {
  for (const s of [500, 502, 503, 504]) expect(statusForUpstream(s)).toBe(502);
});

test("a redirect that escapes redirect:error is a bad gateway", () => {
  for (const s of [301, 302, 307]) expect(statusForUpstream(s)).toBe(502);
});

test("only 2xx bodies are served", () => {
  expect(isServableUpstream(200)).toBe(true);
  expect(isServableUpstream(206)).toBe(true);
  expect(isServableUpstream(404)).toBe(false);
  expect(isServableUpstream(500)).toBe(false);
});

test("a playlist is detected by content-type or by suffix", () => {
  expect(isPlaylistResponse("application/vnd.apple.mpegurl", "/D12/x.stream/seg.ts")).toBe(true);
  expect(isPlaylistResponse("application/octet-stream", "/D12/x.stream/chunklist_w1.m3u8")).toBe(true);
  expect(isPlaylistResponse("application/octet-stream", "/D12/x.stream/CHUNKLIST.M3U8")).toBe(true);
  expect(isPlaylistResponse(null, "/D12/x.stream/media_w1_0.ts")).toBe(false);
  expect(isPlaylistResponse("video/mp2t", "/D12/x.stream/media_w1_0.ts")).toBe(false);
});

// A playlist IS the freshness statement of a live stream. Caching one hands the player
// a segment window that has already moved.
test("playlists are never cached", () => {
  expect(PLAYLIST_CACHE_CONTROL).toBe("no-store");
});

// Segments are immutable bytes under a unique name, so the previous max-age=5 was far
// shorter than the content allows. The shared TTL is deliberately the longer of the two.
test("segments get a shared TTL longer than the browser one", () => {
  expect(SEGMENT_SHARED_TTL_SECONDS).toBeGreaterThan(SEGMENT_BROWSER_TTL_SECONDS);
  expect(SEGMENT_BROWSER_TTL_SECONDS).toBeGreaterThan(5);
});

test("a fetch failure describes itself, including the transport cause code", () => {
  const err = new TypeError("fetch failed");
  (err as { cause?: unknown }).cause = { code: "ECONNRESET" };
  expect(describeFetchError(err)).toBe("TypeError: fetch failed (ECONNRESET)");
});

test("a non-Error rejection still produces a usable line", () => {
  expect(describeFetchError("boom")).toBe("boom");
  expect(describeFetchError(new Error("timed out"))).toBe("Error: timed out");
});
