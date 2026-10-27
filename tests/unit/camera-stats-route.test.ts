import { beforeEach, expect, test, vi } from "vitest";
import manifest from "@/public/webcams/manifest.json";

// GET /api/camera-stats: one small object for the top bar's strip. The registry and the
// play check are stubbed; the shape, the video gate and the webcam count are real.

const T0 = Date.UTC(2026, 9, 27, 4, 0, 0);

const cams = [
  { id: "c1", source: "caltrans", country: "US", refreshSeconds: 60, license: "Caltrans Terms of Use", streamUrl: "https://x/1.m3u8" },
  { id: "c2", source: "caltrans", country: "US", refreshSeconds: 60, license: "Caltrans Terms of Use", streamUrl: "https://x/2.m3u8" },
  { id: "t1", source: "tfl", country: "GB", refreshSeconds: 300, license: "OGL" },
];

const ensurePlayCheck = vi.fn();

vi.mock("@/lib/sources/registry", () => ({
  getRegistry: async () => cams,
  feedHealth: () => [
    { key: "caltrans", ok: true, count: 2, stale: false },
    { key: "tfl", ok: true, count: 1, stale: false },
  ],
  registryAt: () => T0 - 120_000,
  CAMERA_FEED_COUNT: 51,
  CAMERA_FEEDS: [],
}));

vi.mock("@/lib/liveness/playcheck.server", () => ({ ensurePlayCheck: (...a: unknown[]) => ensurePlayCheck(...a) }));

vi.mock("@/lib/liveness/playcheck", () => ({
  liveGate: () => ({ played: new Set(["c1"]) }),
  // The same gate /api/cameras uses decides video. Here: only c1 played.
  isLiveCamera: (c: { id: string }, gate: { played: Set<string> }) => gate.played.has(c.id),
  getPlayCheckSummary: () => ({
    listed: 2,
    checked: 2,
    rolling: 1,
    stalled: 0,
    error: 1,
    windowFrom: T0 - 3_600_000,
    windowTo: T0 - 300_000,
    ttffMedianMs: 1_200,
    ttffP90Ms: 1_200,
    cycleMs: 3 * 3_600_000,
    warm: false,
    byOperator: {},
  }),
}));

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  ensurePlayCheck.mockClear();
});

test("GET answers one object, each figure with its own time and source", async () => {
  const { GET } = await import("@/app/api/camera-stats/route");
  const res = await GET();
  expect(res.status).toBe(200);
  expect(res.headers.get("Cache-Control")).toMatch(/s-maxage=60/);
  const body = await res.json();

  expect(Object.keys(body).sort()).toEqual(["generatedAt", "operators", "play", "refresh", "road", "webcams"]);
  expect(body.generatedAt).toBe(T0);
  expect(body.road).toMatchObject({ at: T0 - 120_000, total: 3, video: 1, stills: 2, countries: 2, operators: 2, feeds: 51 });
  expect(body.refresh).toMatchObject({ at: T0 - 120_000, medianSeconds: 180 });
  expect(body.play).toMatchObject({ at: T0 - 300_000, checked: 2, rolling: 1, warm: false });
  expect(body.webcams).toMatchObject({ count: manifest.harvested, at: Date.parse(manifest.generatedAt) });
  // Names come from each adapter's own Source record, not from the feed key.
  expect(body.operators.rows.map((r: { key: string }) => r.key)).toEqual(["caltrans", "tfl"]);
  expect(body.operators.rows[0]).toMatchObject({ name: "Caltrans CCTV", cameras: 2, video: 1, licenceStated: true });
  expect(body.operators.rows[1].name).not.toBe("tfl");
  for (const part of ["road", "refresh", "play", "webcams", "operators"]) expect(typeof body[part].source).toBe("string");
  expect(ensurePlayCheck).toHaveBeenCalledTimes(1);
});

test("the answer carries no stream address and no visitor figure", async () => {
  const { GET } = await import("@/app/api/camera-stats/route");
  const text = await (await GET()).text();
  expect(text).not.toContain("m3u8");
  expect(text).not.toMatch(/visitor|presence|online/i);
});
