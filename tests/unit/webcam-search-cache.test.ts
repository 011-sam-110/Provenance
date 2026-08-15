import { describe, it, expect, vi, beforeEach } from "vitest";

// The cache is the ONLY thing between a busy search box and Windy's quota, which is
// undocumented (docs/API_KEYS.md records none). So the two properties that actually
// protect it — identical boxes share one upstream call, and a burst of keystrokes
// costs one request rather than one per keystroke — get a test rather than a comment.

const fetchWebcamsInBbox = vi.fn();
vi.mock("@/lib/sources/windy", () => ({
  fetchWebcamsInBbox: (...args: unknown[]) => fetchWebcamsInBbox(...args),
}));

const { searchWebcams, __resetWebcamSearchCache } = await import("@/lib/webcams/search");
const { bboxAround } = await import("@/lib/webcams/bbox");

const ok = (n: number) => ({
  webcams: Array.from({ length: n }, (_, i) => ({ id: `windy:${i}` })),
  total: n,
  dormant: false,
  note: null,
});

beforeEach(() => {
  __resetWebcamSearchCache();
  fetchWebcamsInBbox.mockReset();
});

describe("searchWebcams", () => {
  it("asks Windy once for the same box, then serves the cache", async () => {
    fetchWebcamsInBbox.mockResolvedValue(ok(3));
    const box = bboxAround(40.4168, -3.7038);
    const a = await searchWebcams(box);
    const b = await searchWebcams(box);
    expect(fetchWebcamsInBbox).toHaveBeenCalledTimes(1);
    expect(a.total).toBe(3);
    expect(b.total).toBe(3);
  });

  it("collapses a burst of concurrent searches into ONE upstream call", async () => {
    // This is the keystroke case: several components or debounce edges firing at
    // once must not each spend a request.
    let release: (v: unknown) => void = () => {};
    fetchWebcamsInBbox.mockReturnValue(new Promise((r) => { release = r; }));
    const box = bboxAround(51.5074, -0.1278);
    const all = Promise.all([searchWebcams(box), searchWebcams(box), searchWebcams(box)]);
    release(ok(7));
    const results = await all;
    expect(fetchWebcamsInBbox).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.total)).toEqual([7, 7, 7]);
  });

  it("treats boxes a few metres apart as the same box", async () => {
    fetchWebcamsInBbox.mockResolvedValue(ok(2));
    await searchWebcams([40.5512, -3.5011, 40.3009, -3.8502]);
    await searchWebcams([40.5514, -3.5013, 40.3011, -3.8504]);
    expect(fetchWebcamsInBbox).toHaveBeenCalledTimes(1);
  });

  it("still separates genuinely different places", async () => {
    fetchWebcamsInBbox.mockResolvedValue(ok(1));
    await searchWebcams(bboxAround(40.4168, -3.7038));
    await searchWebcams(bboxAround(35.6768, 139.7638));
    expect(fetchWebcamsInBbox).toHaveBeenCalledTimes(2);
  });

  it("does NOT cache a failure — one bad moment must not become a ten-minute outage", async () => {
    fetchWebcamsInBbox.mockResolvedValueOnce({
      webcams: [], total: 0, dormant: false, note: "Could not reach Windy for this area.",
    });
    const box = bboxAround(48.8566, 2.3522);
    const first = await searchWebcams(box);
    expect(first.note).not.toBeNull();

    fetchWebcamsInBbox.mockResolvedValueOnce(ok(4));
    const second = await searchWebcams(box);
    expect(fetchWebcamsInBbox).toHaveBeenCalledTimes(2);
    expect(second.total).toBe(4);
  });

  it("does NOT cache a dormant answer — the key can be configured under us", async () => {
    fetchWebcamsInBbox.mockResolvedValueOnce({
      webcams: [], total: 0, dormant: true, note: "no key",
    });
    const box = bboxAround(52.52, 13.405);
    await searchWebcams(box);
    fetchWebcamsInBbox.mockResolvedValueOnce(ok(9));
    const second = await searchWebcams(box);
    expect(fetchWebcamsInBbox).toHaveBeenCalledTimes(2);
    expect(second.total).toBe(9);
  });

  it("never rejects — a thrown upstream becomes an honest empty answer", async () => {
    fetchWebcamsInBbox.mockRejectedValue(new Error("socket hang up"));
    const r = await searchWebcams(bboxAround(1, 1));
    expect(r.webcams).toEqual([]);
    expect(r.note).toBeTruthy();
  });
});
