import { describe, expect, it } from "vitest";
import { clipUrl, pictureTimeHeader } from "@/lib/proxy/clip";

const TFL_CLIP = "https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.04502.mp4";

describe("clipUrl", () => {
  it("serves TfL's own clip, an .mp4 on a host the proxy already allows", () => {
    expect(clipUrl(TFL_CLIP)?.toString()).toBe(TFL_CLIP);
  });

  it("refuses anything that is not an allowlisted https .mp4", () => {
    expect(clipUrl(undefined)).toBeNull();
    expect(clipUrl("")).toBeNull();
    expect(clipUrl("not a url")).toBeNull();
    // the still, not a clip
    expect(clipUrl("https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.04502.jpg")).toBeNull();
    // a stream playlist is /api/hls's business, never this route's
    expect(clipUrl("https://wzmedia.dot.ca.gov/D7/cam-1.stream/playlist.m3u8")).toBeNull();
    // right shape, a host nobody allowed
    expect(clipUrl("https://example.com/jamcams.tfl.gov.uk/00001.04502.mp4")).toBeNull();
    // right host, outside the allowed path
    expect(clipUrl("https://s3-eu-west-1.amazonaws.com/some-other-bucket/clip.mp4")).toBeNull();
    // plain http
    expect(clipUrl(TFL_CLIP.replace("https:", "http:"))).toBeNull();
  });
});

describe("pictureTimeHeader", () => {
  const now = Date.UTC(2026, 9, 24, 21, 31, 46);

  it("passes the operator's time on, normalised", () => {
    expect(pictureTimeHeader("Sat, 24 Oct 2026 21:30:51 GMT", now)).toBe("Sat, 24 Oct 2026 21:30:51 GMT");
  });

  it("drops a missing, unreadable or future time rather than pass a false age", () => {
    expect(pictureTimeHeader(null, now)).toBeNull();
    expect(pictureTimeHeader("", now)).toBeNull();
    expect(pictureTimeHeader("yesterday-ish", now)).toBeNull();
    expect(pictureTimeHeader("Sat, 24 Oct 2026 22:31:46 GMT", now)).toBeNull();
  });

  it("allows a clock a few minutes ahead of ours", () => {
    expect(pictureTimeHeader("Sat, 24 Oct 2026 21:33:46 GMT", now)).not.toBeNull();
  });
});
