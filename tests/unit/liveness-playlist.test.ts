import { describe, expect, it } from "vitest";
import { advanced, judgeHlsPair, parsePlaylist } from "@/lib/liveness/playlist";

/**
 * The whole point of these tests is the distinction the project keeps re-learning:
 * an upstream answering 200 is not an upstream serving anything. BIHAMK and ACT both
 * serve dead cameras as HTTP 200, and a finished recording is a perfectly valid
 * playlist. So "parses" and "live" are different questions and are tested apart.
 */

const LIVE_MEDIA = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:4207
#EXTINF:10.0,
seg4207.ts
#EXTINF:10.0,
seg4208.ts
#EXTINF:10.0,
seg4209.ts
`;

const LIVE_MEDIA_LATER = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:4208
#EXTINF:10.0,
seg4208.ts
#EXTINF:10.0,
seg4209.ts
#EXTINF:10.0,
seg4210.ts
`;

const VOD = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:10.0,
seg0.ts
#EXTINF:10.0,
seg1.ts
#EXT-X-ENDLIST
`;

const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=1280x720
720p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=640x360
360p/index.m3u8
`;

describe("parsePlaylist", () => {
  it("reads a live media playlist", () => {
    const p = parsePlaylist(LIVE_MEDIA);
    expect(p.isPlaylist).toBe(true);
    expect(p.isMaster).toBe(false);
    expect(p.hasEndList).toBe(false);
    expect(p.mediaSequence).toBe(4207);
    expect(p.segmentUris).toEqual(["seg4207.ts", "seg4208.ts", "seg4209.ts"]);
    expect(p.targetDurationS).toBe(10);
  });

  it("reads a master playlist and its variants", () => {
    const p = parsePlaylist(MASTER);
    expect(p.isMaster).toBe(true);
    expect(p.variantUris).toEqual(["720p/index.m3u8", "360p/index.m3u8"]);
    // A master carries no segments of its own; treating its variant URIs as segments
    // would make a master look like a live media playlist.
    expect(p.segmentUris).toEqual([]);
  });

  it("flags a finished recording", () => {
    expect(parsePlaylist(VOD).hasEndList).toBe(true);
  });

  it("refuses anything that is not a playlist", () => {
    expect(parsePlaylist("<!doctype html><html>404</html>").isPlaylist).toBe(false);
    expect(parsePlaylist("").isPlaylist).toBe(false);
    expect(parsePlaylist('{"error":"not found"}').isPlaylist).toBe(false);
  });

  it("tolerates CRLF, which real CDNs serve", () => {
    const p = parsePlaylist(LIVE_MEDIA.replace(/\n/g, "\r\n"));
    expect(p.mediaSequence).toBe(4207);
    expect(p.segmentUris).toEqual(["seg4207.ts", "seg4208.ts", "seg4209.ts"]);
  });
});

describe("advanced", () => {
  it("sees a rolling window move", () => {
    expect(advanced(parsePlaylist(LIVE_MEDIA), parsePlaylist(LIVE_MEDIA_LATER))).toBe(true);
  });

  it("sees an identical re-read as not moving", () => {
    expect(advanced(parsePlaylist(LIVE_MEDIA), parsePlaylist(LIVE_MEDIA))).toBe(false);
  });

  it("sees an appended segment as movement even when the sequence number is pinned", () => {
    // EVENT playlists append rather than roll, so MEDIA-SEQUENCE never changes. Testing
    // only the sequence number would record every EVENT stream as dead.
    const appended = LIVE_MEDIA + "#EXTINF:10.0,\nseg4210.ts\n";
    expect(advanced(parsePlaylist(LIVE_MEDIA), parsePlaylist(appended))).toBe(true);
  });

  it("sees a changed last segment as movement even when the count is pinned", () => {
    const rolled = LIVE_MEDIA.replace("seg4209.ts", "seg4210.ts");
    expect(advanced(parsePlaylist(LIVE_MEDIA), parsePlaylist(rolled))).toBe(true);
  });
});

describe("judgeHlsPair", () => {
  it("admits a stream whose window moved", () => {
    const v = judgeHlsPair(parsePlaylist(LIVE_MEDIA), parsePlaylist(LIVE_MEDIA_LATER));
    expect(v.status).toBe("live");
  });

  it("rejects a finished recording even though it parses and has segments", () => {
    const v = judgeHlsPair(parsePlaylist(VOD), parsePlaylist(VOD));
    expect(v.status).toBe("dead");
    expect(v.reason).toMatch(/ENDLIST|recording/i);
  });

  it("rejects a stalled stream that answered 200 twice", () => {
    const v = judgeHlsPair(parsePlaylist(LIVE_MEDIA), parsePlaylist(LIVE_MEDIA));
    expect(v.status).toBe("dead");
    expect(v.reason).toMatch(/advance|stalled|moved/i);
  });

  it("reports a non-playlist as unknown, not dead", () => {
    // The difference matters: dead is a fact about the camera, unknown is a fact about
    // our run. Recording a blocked request as dead is how a VPN exit quietly deletes a
    // good operator from the map.
    const v = judgeHlsPair(parsePlaylist("<html>403</html>"), parsePlaylist("<html>403</html>"));
    expect(v.status).toBe("unknown");
  });

  it("reports a master playlist as needing its variant followed, not as a verdict", () => {
    const v = judgeHlsPair(parsePlaylist(MASTER), parsePlaylist(MASTER));
    // toMatchObject rather than two reads: `followUri` only exists on the "follow"
    // variant, and an expect() call does not narrow the union for the type checker.
    expect(v).toMatchObject({ status: "follow", followUri: "720p/index.m3u8" });
  });

  it("reports a playlist with no segments as unknown rather than dead", () => {
    const empty = "#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXT-X-MEDIA-SEQUENCE:0\n";
    const v = judgeHlsPair(parsePlaylist(empty), parsePlaylist(empty));
    expect(v.status).toBe("unknown");
  });
});
