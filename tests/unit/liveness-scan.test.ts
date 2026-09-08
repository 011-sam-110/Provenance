import { describe, expect, it } from "vitest";
import { classifyStreamUrl, isPlayableKind, scanJsonForStreams, scanTextForStreams } from "@/lib/liveness/scan";

describe("classifyStreamUrl", () => {
  it("names the shapes we can serve", () => {
    expect(classifyStreamUrl("https://x.gov/live/cam1/index.m3u8")).toBe("hls");
    expect(classifyStreamUrl("https://x.gov/live/cam1/manifest.mpd")).toBe("dash");
    expect(classifyStreamUrl("https://x.gov/mjpg/video.mjpg")).toBe("mjpeg");
    expect(classifyStreamUrl("https://x.gov/cgi-bin/mjpeg?cam=4")).toBe("mjpeg");
  });

  it("names the shapes we cannot serve, rather than dropping them", () => {
    // Recorded on purpose: "this operator publishes RTSP" is a useful finding even
    // though no browser can play it. Dropping it silently would make the report say
    // the operator publishes nothing.
    expect(classifyStreamUrl("rtsp://x.gov/cam1")).toBe("rtsp");
    expect(classifyStreamUrl("rtmp://x.gov/live/cam1")).toBe("rtmp");
  });

  it("is not fooled by a still image or a clip", () => {
    expect(classifyStreamUrl("https://x.gov/snapshot/cam1.jpg")).toBe(null);
    expect(classifyStreamUrl("https://x.gov/clips/cam1.mp4")).toBe(null);
  });

  it("survives a query string and a fragment", () => {
    expect(classifyStreamUrl("https://x.gov/live.m3u8?token=abc#t=0")).toBe("hls");
  });

  it("is case-insensitive, because paths are not normalised upstream", () => {
    expect(classifyStreamUrl("https://x.gov/LIVE/CAM1/INDEX.M3U8")).toBe("hls");
  });
});

describe("isPlayableKind", () => {
  it("separates what the deck can show from what it cannot", () => {
    expect(isPlayableKind("hls")).toBe(true);
    expect(isPlayableKind("mjpeg")).toBe(true);
    expect(isPlayableKind("rtsp")).toBe(false);
    expect(isPlayableKind("rtmp")).toBe(false);
  });
});

describe("scanJsonForStreams", () => {
  it("finds a stream at any depth and records where it came from", () => {
    const payload = {
      features: [
        { properties: { name: "A1 North", video: "https://dot.gov/live/a1n/index.m3u8" } },
        { properties: { name: "A1 South", image: "https://dot.gov/snap/a1s.jpg" } },
      ],
    };
    const hits = scanJsonForStreams(payload);
    expect(hits).toHaveLength(1);
    expect(hits[0].url).toBe("https://dot.gov/live/a1n/index.m3u8");
    expect(hits[0].kind).toBe("hls");
    expect(hits[0].path).toBe("features.0.properties.video");
  });

  it("deduplicates a URL that appears many times", () => {
    const payload = [
      { u: "https://dot.gov/live/x.m3u8" },
      { u: "https://dot.gov/live/x.m3u8" },
      { u: "https://dot.gov/live/y.m3u8" },
    ];
    expect(scanJsonForStreams(payload)).toHaveLength(2);
  });

  it("refuses a bare-IP host, because that is somebody leaked camera and not a feed", () => {
    const payload = { u: "http://85.12.44.9:8080/mjpg/video.mjpg" };
    expect(scanJsonForStreams(payload)).toEqual([]);
  });

  it("refuses a relay host, because a relay cannot license the video it republishes", () => {
    const payload = { u: "https://www.earthcam.com/live/cam1/index.m3u8" };
    expect(scanJsonForStreams(payload)).toEqual([]);
  });

  it("returns nothing rather than throwing on a payload with cycles", () => {
    const a: Record<string, unknown> = { u: "https://dot.gov/live/x.m3u8" };
    a.self = a;
    expect(scanJsonForStreams(a)).toHaveLength(1);
  });

  it("ignores a string that merely mentions m3u8 without being a URL", () => {
    expect(scanJsonForStreams({ note: "we may add m3u8 support later" })).toEqual([]);
  });
});

describe("scanTextForStreams", () => {
  it("finds a stream embedded in a viewer page, which is where portals usually hide it", () => {
    const html = `<html><script>
      var player = new Hls();
      player.loadSource("https://cam.dot.gov/hls/cam42/playlist.m3u8");
    </script></html>`;
    const hits = scanTextForStreams(html);
    expect(hits.map((h) => h.url)).toContain("https://cam.dot.gov/hls/cam42/playlist.m3u8");
  });

  it("finds a single-quoted and an unquoted occurrence too", () => {
    const html = `src='https://a.gov/x.m3u8' data-src=https://b.gov/y.m3u8 `;
    const urls = scanTextForStreams(html).map((h) => h.url);
    expect(urls).toContain("https://a.gov/x.m3u8");
    expect(urls).toContain("https://b.gov/y.m3u8");
  });

  it("does not invent a stream out of prose", () => {
    expect(scanTextForStreams("<p>Our m3u8 streams are coming soon.</p>")).toEqual([]);
  });
});
