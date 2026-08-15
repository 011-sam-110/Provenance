import { describe, it, expect } from "vitest";
import {
  parseYouTubeVideoId,
  parseStreamRef,
  sanitizeCamslotConfig,
  nextIndex,
  streamKey,
  embedUrl,
  MIN_INTERVAL_MS,
  MAX_INTERVAL_MS,
  MAX_STREAMS,
} from "@/lib/console/widgets/camslot.model";

describe("parseYouTubeVideoId", () => {
  it("accepts the three URL shapes people actually paste", () => {
    expect(parseYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeVideoId("https://www.youtube.com/live/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("accepts a bare 11-character id", () => {
    expect(parseYouTubeVideoId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("tolerates extra query parameters and whitespace", () => {
    expect(parseYouTubeVideoId("  https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s  ")).toBe(
      "dQw4w9WgXcQ",
    );
  });

  // The rejection cases are the point of this function.
  it("rejects anything that is not a YouTube video id", () => {
    expect(parseYouTubeVideoId("https://evil.example/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseYouTubeVideoId("javascript:alert(1)")).toBeNull();
    expect(parseYouTubeVideoId("https://www.youtube.com/watch?v=tooshort")).toBeNull();
    expect(parseYouTubeVideoId("https://www.youtube.com/watch?v=waaaaaaaaaytoolong")).toBeNull();
    expect(parseYouTubeVideoId('" onerror=alert(1) x="')).toBeNull();
    expect(parseYouTubeVideoId("../../../etc/passwd")).toBeNull();
    expect(parseYouTubeVideoId("")).toBeNull();
  });

  it("rejects a channel URL — channel refs are out of v1", () => {
    expect(parseYouTubeVideoId("https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw")).toBeNull();
  });
});

describe("embedUrl", () => {
  it("only ever builds a youtube.com/embed URL", () => {
    expect(embedUrl("dQw4w9WgXcQ")).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&mute=1&playsinline=1",
    );
  });

  it("refuses to build one from an unvalidated id", () => {
    expect(() => embedUrl('" onerror=alert(1) x="')).toThrow();
  });
});

describe("parseStreamRef", () => {
  it("accepts the three v1 kinds", () => {
    expect(parseStreamRef({ k: "cam", id: "tfl:JamCams_00001" })).toEqual({
      k: "cam",
      id: "tfl:JamCams_00001",
    });
    expect(parseStreamRef({ k: "webcam", id: "windy:1420893641" })).toEqual({
      k: "webcam",
      id: "windy:1420893641",
    });
    expect(parseStreamRef({ k: "yt", videoId: "dQw4w9WgXcQ" })).toEqual({
      k: "yt",
      videoId: "dQw4w9WgXcQ",
    });
  });

  it("rejects an unknown discriminant", () => {
    expect(parseStreamRef({ k: "ytc", channelId: "UCuAXFkgsw1L7xaCfnd5JJOw" })).toBeNull();
    expect(parseStreamRef({ k: "hls", id: "x" })).toBeNull();
  });

  it("rejects a malformed or oversized id", () => {
    expect(parseStreamRef({ k: "cam", id: "" })).toBeNull();
    expect(parseStreamRef({ k: "cam", id: "x".repeat(200) })).toBeNull();
    expect(parseStreamRef({ k: "cam", id: "../../../etc/passwd" })).toBeNull();
    expect(parseStreamRef({ k: "yt", videoId: "notelevenchars!" })).toBeNull();
    expect(parseStreamRef(null)).toBeNull();
    expect(parseStreamRef("cam:1")).toBeNull();
    expect(parseStreamRef([])).toBeNull();
  });
});

describe("sanitizeCamslotConfig", () => {
  it("returns an empty, usable config for junk", () => {
    expect(sanitizeCamslotConfig(null)).toEqual({ streams: [], intervalMs: 5000 });
    expect(sanitizeCamslotConfig("nope")).toEqual({ streams: [], intervalMs: 5000 });
  });

  it("survives an ARRAY config — typeof [] === 'object' passes sanitize.ts", () => {
    expect(sanitizeCamslotConfig([])).toEqual({ streams: [], intervalMs: 5000 });
  });

  it("clamps a hostile intervalMs", () => {
    expect(sanitizeCamslotConfig({ intervalMs: 0 }).intervalMs).toBe(MIN_INTERVAL_MS);
    expect(sanitizeCamslotConfig({ intervalMs: -1 }).intervalMs).toBe(MIN_INTERVAL_MS);
    expect(sanitizeCamslotConfig({ intervalMs: 999_999_999 }).intervalMs).toBe(MAX_INTERVAL_MS);
    expect(sanitizeCamslotConfig({ intervalMs: NaN }).intervalMs).toBe(5000);
  });

  it("truncates an oversized playlist and drops invalid refs", () => {
    const streams: unknown[] = Array.from({ length: MAX_STREAMS + 40 }, (_, i) => ({
      k: "cam",
      id: `tfl:${i}`,
    }));
    streams.push({ k: "evil", id: "x" });
    const out = sanitizeCamslotConfig({ streams });
    expect(out.streams.length).toBe(MAX_STREAMS);
    expect(out.streams.every((s) => s.k === "cam")).toBe(true);
  });

  it("keeps a user name and fit, and rejects a bad fit", () => {
    expect(sanitizeCamslotConfig({ name: "London squares" }).name).toBe("London squares");
    expect(sanitizeCamslotConfig({ fit: "contain" }).fit).toBe("contain");
    expect(sanitizeCamslotConfig({ fit: "explode" }).fit).toBeUndefined();
  });

  it("truncates an absurd name rather than storing it", () => {
    expect(sanitizeCamslotConfig({ name: "x".repeat(500) }).name?.length).toBe(80);
  });
});

describe("nextIndex", () => {
  it("advances and wraps", () => {
    expect(nextIndex(0, 3)).toBe(1);
    expect(nextIndex(2, 3)).toBe(0);
  });

  it("is safe for the degenerate lengths", () => {
    expect(nextIndex(0, 0)).toBe(0);
    expect(nextIndex(0, 1)).toBe(0);
    expect(nextIndex(9, 3)).toBe(0);
  });
});

describe("streamKey", () => {
  it("is stable and distinct per kind", () => {
    expect(streamKey({ k: "cam", id: "a" })).toBe("cam:a");
    expect(streamKey({ k: "webcam", id: "a" })).toBe("webcam:a");
    expect(streamKey({ k: "yt", videoId: "dQw4w9WgXcQ" })).toBe("yt:dQw4w9WgXcQ");
  });
});
