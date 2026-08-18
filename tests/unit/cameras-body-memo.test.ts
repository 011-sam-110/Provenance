import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Camera } from "@/lib/types";

// /api/cameras is the fattest response the deployment serves — 18,948 cameras and
// 6.44 MB of JSON on prod — and it was rebuilt from scratch on every edge-cache
// miss even though the answer only changes when the registry refreshes.
//
// The memo cannot be observed from its return value: the string is identical either
// way. So what gets asserted here is the WORK. `isLiveStreamUrl` runs exactly once
// per camera per registry array, and a replaced array recomputes.

const isLiveStreamUrl = vi.fn((url?: string) => Boolean(url));
vi.mock("@/lib/proxy/hls-allowlist", () => ({
  isLiveStreamUrl: (url?: string) => isLiveStreamUrl(url),
}));

const { camerasBody, __resetCamerasBody } = await import("@/lib/cameras/body");

const cam = (id: string, over: Partial<Camera> = {}): Camera =>
  ({
    id,
    name: `Camera ${id}`,
    lat: 51.5,
    lon: -0.12,
    available: true,
    source: "tfl",
    country: "GB",
    mediaType: "jpeg",
    refreshSeconds: 300,
    license: "OGL",
    attribution: "Powered by TfL Open Data",
    ...over,
  }) as Camera;

beforeEach(() => {
  __resetCamerasBody();
  isLiveStreamUrl.mockClear();
});

describe("camerasBody", () => {
  it("serialises once for a given registry array", () => {
    const cams = [cam("a"), cam("b"), cam("c")];

    const first = camerasBody(cams);
    const second = camerasBody(cams);

    expect(second).toBe(first);
    // Three cameras, one pass — not two passes of three.
    expect(isLiveStreamUrl).toHaveBeenCalledTimes(3);
  });

  it("rebuilds when the registry publishes a new array", () => {
    const before = [cam("a")];
    const after = [cam("a"), cam("b")];

    const first = camerasBody(before);
    isLiveStreamUrl.mockClear();
    const second = camerasBody(after);

    expect(JSON.parse(first).count).toBe(1);
    expect(JSON.parse(second).count).toBe(2);
    expect(isLiveStreamUrl).toHaveBeenCalledTimes(2);
  });

  it("keys on identity, so equal-looking arrays are not confused", () => {
    // `refresh()` builds a fresh array every round. Two arrays with the same
    // contents must still be treated as different publications, because the memo
    // has no way to know the contents are equal without doing the work it exists
    // to avoid.
    const first = [cam("a")];
    const second = [cam("a")];

    camerasBody(first);
    isLiveStreamUrl.mockClear();
    camerasBody(second);

    expect(isLiveStreamUrl).toHaveBeenCalledTimes(1);
  });

  it("carries the shape the client reads, and no upstream URLs", () => {
    const body = JSON.parse(
      camerasBody([cam("a", { streamUrl: "https://wzmedia.dot.ca.gov/x.m3u8", region: "London", road: "A406" })]),
    );

    expect(body.count).toBe(1);
    expect(body.cameras[0]).toMatchObject({
      id: "a",
      name: "Camera a",
      source: "tfl",
      country: "GB",
      region: "London",
      road: "A406",
      live: true,
    });
    // The SSRF allowlist is by id; a raw upstream URL must never leave this route.
    expect(body.cameras[0]).not.toHaveProperty("streamUrl");
    expect(body.cameras[0]).not.toHaveProperty("imageUrl");
  });
});
