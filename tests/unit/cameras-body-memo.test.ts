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
  isHlsAllowed: () => ({ ok: true }),
}));

const { camerasBody, __resetCamerasBody } = await import("@/lib/cameras/body");
const { __resetPlayCheck, liveCameraIds, recordPlayResult } = await import("@/lib/liveness/playcheck");

const rolling = { checkedAt: Date.now(), verdict: "rolling" as const, reason: "advanced", source: "tfl" };

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
  __resetPlayCheck();
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
    recordPlayResult("a", rolling);
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

  it("calls a camera live only when its stream played at the last check", () => {
    // Since 2026-10-27 an allowlisted URL is not enough (lib/liveness/playcheck.ts).
    recordPlayResult("played", rolling);
    recordPlayResult("stalled", { ...rolling, verdict: "stalled" });
    const url = "https://wzmedia.dot.ca.gov/x.m3u8";
    const body = JSON.parse(
      camerasBody([cam("played", { streamUrl: url }), cam("stalled", { streamUrl: url }), cam("unchecked", { streamUrl: url })]),
    );
    expect(body.cameras.map((c: { id: string; live: boolean }) => [c.id, c.live])).toEqual([
      ["played", true],
      ["stalled", false],
      ["unchecked", false],
    ]);
  });

  it("rebuilds when the set of cameras that played changes, and not before", () => {
    const cams = [cam("a", { streamUrl: "https://wzmedia.dot.ca.gov/x.m3u8" })];
    const first = camerasBody(cams);
    expect(JSON.parse(first).cameras[0].live).toBe(false);
    // A write that leaves the live set as it was keeps the memo: no work is redone.
    recordPlayResult("a", { ...rolling, verdict: "error" });
    isLiveStreamUrl.mockClear();
    expect(camerasBody(cams)).toBe(first);
    expect(isLiveStreamUrl).toHaveBeenCalledTimes(0);
    recordPlayResult("a", rolling);
    isLiveStreamUrl.mockClear();
    const second = camerasBody(cams, liveCameraIds());
    expect(JSON.parse(second).cameras[0].live).toBe(true);
    expect(isLiveStreamUrl).toHaveBeenCalledTimes(1);
  });
});
