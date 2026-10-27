import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PLAYCHECK_CONCURRENCY,
  PLAYCHECK_CYCLE_MS,
  PLAYCHECK_FRESH_MS,
  PLAYCHECK_HOST_GAP_MS,
  __resetPlayCheck,
  checkStream,
  decodePlayResults,
  encodePlayResults,
  getPlayCheckSummary,
  isDue,
  isLiveCamera,
  liveCameraIds,
  median,
  orderForCycle,
  percentile,
  playResults,
  playsNow,
  recordPlayResult,
  runPlayCheck,
  startPlayCheckLoop,
  summarisePlayCheck,
  videoCameras,
  type HlsFetch,
  type PlayResult,
  type VideoCamera,
} from "@/lib/liveness/playcheck";
import { playCheckEnabled } from "@/lib/liveness/playcheck.server";

// The play check decides which cameras the map calls video. Until 2026-10-27 that was
// "the URL passes the allowlist", and a pair-read of 150 such cameras found 39 that never
// played. These tests hold the new rule (allowlisted AND rolling at a check younger than
// two cycles), the checker's verdicts, its pacing, the summary maths and the saved file.

const CALTRANS = "https://wzmedia.dot.ca.gov/D3/80_a.stream/playlist.m3u8";
const SCDOT = "https://s7.us-east-1.skyvdn.com/rtplive/R1_001/playlist.m3u8";
const NOT_ALLOWED = "https://example.com/live/playlist.m3u8";
const T0 = 1_800_000_000_000;

const rolling = (checkedAt: number, source = "caltrans", ttffMs = 400): PlayResult => ({
  checkedAt,
  verdict: "rolling",
  reason: "playlist advanced between reads",
  source,
  ttffMs,
});
const failed = (checkedAt: number, verdict: "stalled" | "error", source = "caltrans"): PlayResult => ({
  checkedAt,
  verdict,
  reason: verdict === "error" ? "http 404" : "playlist did not advance between reads: stalled",
  source,
});

/** A media playlist at sequence `seq`, three 2-second segments. */
function media(seq: number, opts: { end?: boolean; segs?: number } = {}): string {
  const n = opts.segs ?? 3;
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:2", `#EXT-X-MEDIA-SEQUENCE:${seq}`];
  for (let i = 0; i < n; i++) lines.push("#EXTINF:2.0,", `media_${seq + i}.ts`);
  if (opts.end) lines.push("#EXT-X-ENDLIST");
  return lines.join("\n");
}
const master = (variant: string) => `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n${variant}\n`;

type Spec = { status?: number; body?: string };

/**
 * A scripted upstream keyed by path. A function route gets the call number for that
 * path, so the second read of a playlist can differ from the first.
 */
function upstream(routes: Record<string, Spec | ((n: number) => Spec)>, onCall?: () => void) {
  const calls: { url: string; referer: string | undefined }[] = [];
  const counts = new Map<string, number>();
  const fetch: HlsFetch = async (url, referer) => {
    calls.push({ url: url.toString(), referer });
    onCall?.();
    const n = counts.get(url.pathname) ?? 0;
    counts.set(url.pathname, n + 1);
    const route = routes[url.pathname];
    if (!route) return new Response("not found", { status: 404 });
    const spec = typeof route === "function" ? route(n) : route;
    return new Response(spec.body ?? "", { status: spec.status ?? 200 });
  };
  return { fetch, calls };
}

beforeEach(() => __resetPlayCheck());
afterEach(() => {
  __resetPlayCheck();
  vi.useRealTimers();
});

describe("the live gate", () => {
  it("is live only when the stream is allowlisted AND its fresh verdict is rolling", () => {
    expect(playsNow(CALTRANS, rolling(T0), T0 + 1000)).toBe(true);
    expect(playsNow(NOT_ALLOWED, rolling(T0), T0 + 1000)).toBe(false);
    expect(playsNow(CALTRANS, failed(T0, "stalled"), T0 + 1000)).toBe(false);
    expect(playsNow(CALTRANS, failed(T0, "error"), T0 + 1000)).toBe(false);
    // Never checked is unknown, and unknown is not live.
    expect(playsNow(CALTRANS, undefined, T0)).toBe(false);
  });

  it("expires a rolling verdict after two cycles", () => {
    expect(playsNow(CALTRANS, rolling(T0), T0 + PLAYCHECK_FRESH_MS - 1)).toBe(true);
    expect(playsNow(CALTRANS, rolling(T0), T0 + PLAYCHECK_FRESH_MS)).toBe(false);
  });

  it("applies the same rule through the shared state the routes read", () => {
    recordPlayResult("caltrans:a", rolling(T0));
    recordPlayResult("caltrans:b", failed(T0, "error"));
    const ids = liveCameraIds(T0 + 1000);
    expect(isLiveCamera({ id: "caltrans:a", streamUrl: CALTRANS }, ids)).toBe(true);
    expect(isLiveCamera({ id: "caltrans:b", streamUrl: CALTRANS }, ids)).toBe(false);
    expect(isLiveCamera({ id: "caltrans:c", streamUrl: CALTRANS }, ids)).toBe(false);
    // A rolling id whose stream no longer passes the allowlist is not live either.
    expect(isLiveCamera({ id: "caltrans:a", streamUrl: NOT_ALLOWED }, ids)).toBe(false);
    expect(isLiveCamera({ id: "caltrans:a" }, ids)).toBe(false);
  });

  it("drops a camera from the live set when its verdict ages out, with no new write", () => {
    recordPlayResult("caltrans:a", rolling(T0));
    expect(liveCameraIds(T0 + PLAYCHECK_FRESH_MS - 1).has("caltrans:a")).toBe(true);
    expect(liveCameraIds(T0 + PLAYCHECK_FRESH_MS).has("caltrans:a")).toBe(false);
  });

  it("keeps the live set's identity while its members do not change", () => {
    // lib/cameras/body.ts memoises the camera body on this Set by identity.
    recordPlayResult("caltrans:a", rolling(T0));
    const first = liveCameraIds(T0 + 1);
    recordPlayResult("caltrans:a", rolling(T0 + 10)); // a repeat verdict
    recordPlayResult("caltrans:b", failed(T0 + 10, "error")); // a non-member changed
    expect(liveCameraIds(T0 + 20)).toBe(first);
    recordPlayResult("caltrans:b", rolling(T0 + 30)); // a new member
    const second = liveCameraIds(T0 + 40);
    expect(second).not.toBe(first);
    expect([...second].sort()).toEqual(["caltrans:a", "caltrans:b"]);
  });

  it("lists as video cameras only those whose stream passes the allowlist", () => {
    const cams = videoCameras([
      { id: "caltrans:a", source: "caltrans", streamUrl: CALTRANS },
      { id: "x:b", source: "x", streamUrl: NOT_ALLOWED },
      { id: "tfl:c", source: "tfl" },
    ]);
    expect(cams.map((c) => c.id)).toEqual(["caltrans:a"]);
  });
});

describe("the summary", () => {
  it("takes the median (mean of the middle pair) and a nearest-rank p90", () => {
    expect(median([])).toBeNull();
    expect(median([300, 100, 200])).toBe(200);
    expect(median([100, 200, 300, 400])).toBe(250);
    expect(percentile([], 90)).toBeNull();
    expect(percentile([100, 200, 300, 400], 90)).toBe(400);
    const tens = Array.from({ length: 10 }, (_, i) => (i + 1) * 100);
    expect(median(tens)).toBe(550);
    expect(percentile(tens, 90)).toBe(900);
    expect(percentile([700], 90)).toBe(700);
  });

  it("counts listed, checked and each verdict, overall and per operator", () => {
    const cams: VideoCamera[] = [
      { id: "caltrans:a", source: "caltrans", streamUrl: CALTRANS },
      { id: "caltrans:b", source: "caltrans", streamUrl: CALTRANS },
      { id: "caltrans:c", source: "caltrans", streamUrl: CALTRANS },
      { id: "caltrans:d", source: "caltrans", streamUrl: CALTRANS },
      { id: "scdot:a", source: "scdot", streamUrl: SCDOT },
      { id: "scdot:b", source: "scdot", streamUrl: SCDOT },
    ];
    const now = T0 + 60_000;
    const results = new Map<string, PlayResult>([
      ["caltrans:a", rolling(T0, "caltrans", 300)],
      ["caltrans:b", failed(T0 + 1000, "error")],
      ["caltrans:c", rolling(now - PLAYCHECK_FRESH_MS - 1, "caltrans", 50)], // too old: unknown
      ["scdot:a", rolling(T0 + 2000, "scdot", 500)],
      ["scdot:b", failed(T0 + 3000, "stalled", "scdot")],
      ["gone:z", rolling(T0, "gone")], // not in the registry any more: not counted
    ]);
    const s = summarisePlayCheck(cams, results, now);
    expect(s).toMatchObject({ listed: 6, checked: 4, rolling: 2, stalled: 1, error: 1 });
    expect(s.windowFrom).toBe(T0);
    expect(s.windowTo).toBe(T0 + 3000);
    expect(s.ttffMedianMs).toBe(400);
    expect(s.ttffP90Ms).toBe(500);
    expect(s.byOperator).toEqual({
      caltrans: { listed: 4, checked: 2, rolling: 1, stalled: 0, error: 1 },
      scdot: { listed: 2, checked: 2, rolling: 1, stalled: 1, error: 0 },
    });
  });

  it("reports nothing measured as nulls, not zeros dressed as times", () => {
    const s = getPlayCheckSummary([{ id: "caltrans:a", source: "caltrans", streamUrl: CALTRANS }], T0);
    expect(s).toMatchObject({ listed: 1, checked: 0, rolling: 0, windowFrom: null, windowTo: null });
    expect(s.ttffMedianMs).toBeNull();
    expect(s.ttffP90Ms).toBeNull();
  });
});

describe("one check", () => {
  const cam: VideoCamera = { id: "caltrans:a", source: "caltrans", streamUrl: CALTRANS };
  const clock = () => {
    let t = T0;
    return {
      now: () => t,
      advance: (ms: number) => {
        t += ms;
      },
    };
  };

  it("is rolling when the playlist advances and the newest segment answers", async () => {
    const c = clock();
    const up = upstream(
      {
        "/D3/80_a.stream/playlist.m3u8": { body: master("chunklist_w1.m3u8") },
        "/D3/80_a.stream/chunklist_w1.m3u8": (n) => ({ body: media(100 + n) }),
        "/D3/80_a.stream/media_103.ts": { body: "bytes" },
      },
      () => c.advance(100), // every request takes 100 ms
    );
    const sleeps: number[] = [];
    const r = await checkStream(cam, {
      fetch: up.fetch,
      now: c.now,
      sleep: async (ms) => {
        sleeps.push(ms);
        c.advance(ms);
      },
    });
    expect(r.verdict).toBe("rolling");
    expect(r.source).toBe("caltrans");
    // Master + media playlist + segment = 300 ms. The deliberate wait between the two
    // reads is not something a visitor sits through, so it is not in the figure.
    expect(r.ttffMs).toBe(300);
    expect(sleeps).toEqual([4500]); // one target duration (2 s, floored at 4 s) + 0.5 s
    // The newest segment of the SECOND read, resolved against the variant.
    expect(up.calls.at(-1)?.url).toBe("https://wzmedia.dot.ca.gov/D3/80_a.stream/media_103.ts");
  });

  it("asks with the allowlist rule's Referer, as /api/hls does", async () => {
    const up = upstream({ "/D3/80_a.stream/playlist.m3u8": { status: 403 } });
    await checkStream(cam, { fetch: up.fetch, now: () => T0, sleep: async () => undefined });
    expect(up.calls[0].referer).toBe("https://cwwp2.dot.ca.gov/");
  });

  it("names an HTTP failure as an error with its status", async () => {
    const up = upstream({});
    const r = await checkStream(cam, { fetch: up.fetch, now: () => T0, sleep: async () => undefined });
    expect(r).toMatchObject({ verdict: "error", reason: "http 404" });
    expect(r.ttffMs).toBeUndefined();
  });

  it("names a thrown fetch as an error, never a throw", async () => {
    const fetch: HlsFetch = async () => {
      throw new TypeError("fetch failed");
    };
    const r = await checkStream(cam, { fetch, now: () => T0, sleep: async () => undefined });
    expect(r.verdict).toBe("error");
    expect(r.reason).toContain("fetch failed");
  });

  it("calls a playlist that did not move stalled", async () => {
    const up = upstream({ "/D3/80_a.stream/playlist.m3u8": { body: media(7) } });
    const r = await checkStream(cam, { fetch: up.fetch, now: () => T0, sleep: async () => undefined });
    expect(r.verdict).toBe("stalled");
  });

  it("calls a finished recording stalled, not rolling", async () => {
    const up = upstream({ "/D3/80_a.stream/playlist.m3u8": (n) => ({ body: media(7 + n, { end: true }) }) });
    const r = await checkStream(cam, { fetch: up.fetch, now: () => T0, sleep: async () => undefined });
    expect(r.verdict).toBe("stalled");
    expect(r.reason).toContain("ENDLIST");
  });

  it("is an error when the playlist moves but its segment does not answer", async () => {
    const up = upstream({ "/D3/80_a.stream/playlist.m3u8": (n) => ({ body: media(7 + n) }) });
    const r = await checkStream(cam, { fetch: up.fetch, now: () => T0, sleep: async () => undefined });
    expect(r).toMatchObject({ verdict: "error", reason: "segment http 404" });
  });

  it("is an error when a segment sits on a host the proxy would refuse", async () => {
    const up = upstream({
      "/D3/80_a.stream/playlist.m3u8": (n) => ({
        body: media(7 + n).replace(/media_(\d+)\.ts/g, "https://cdn.example.com/media_$1.ts"),
      }),
    });
    const r = await checkStream(cam, { fetch: up.fetch, now: () => T0, sleep: async () => undefined });
    expect(r.verdict).toBe("error");
    expect(r.reason).toContain("not allowlisted");
  });

  it("is an error for a body that is not a playlist", async () => {
    const up = upstream({ "/D3/80_a.stream/playlist.m3u8": { body: "<html>blocked</html>" } });
    const r = await checkStream(cam, { fetch: up.fetch, now: () => T0, sleep: async () => undefined });
    expect(r).toMatchObject({ verdict: "error", reason: "response was not an HLS playlist" });
  });
});

describe("a pass over many cameras", () => {
  /** n cameras on each of two hosts, each with its own advancing playlist. */
  function fleet(n: number) {
    const cams: VideoCamera[] = [];
    const routes: Record<string, (k: number) => Spec> = {};
    for (let i = 0; i < n; i++) {
      cams.push({ id: `caltrans:${i}`, source: "caltrans", streamUrl: `https://wzmedia.dot.ca.gov/c${i}/playlist.m3u8` });
      cams.push({ id: `scdot:${i}`, source: "scdot", streamUrl: `https://s7.us-east-1.skyvdn.com/rtplive/s${i}/playlist.m3u8` });
      routes[`/c${i}/playlist.m3u8`] = (k) => ({ body: media(10 + k) });
      routes[`/rtplive/s${i}/playlist.m3u8`] = (k) => ({ body: media(10 + k) });
      routes[`/c${i}/media_13.ts`] = () => ({ body: "x" });
      routes[`/rtplive/s${i}/media_13.ts`] = () => ({ body: "x" });
    }
    return { cams, routes };
  }

  it("never has more than six checks in flight, and spaces requests to one host", async () => {
    vi.useFakeTimers({ now: T0 });
    const { cams, routes } = fleet(10);
    const starts = new Map<string, number[]>();
    const open = new Set<string>();
    let maxOpen = 0;
    const base = upstream(routes);
    const fetch: HlsFetch = async (url, referer) => {
      const host = url.hostname;
      starts.set(host, [...(starts.get(host) ?? []), Date.now()]);
      const id = cams.find((c) => url.pathname.startsWith(new URL(c.streamUrl).pathname.replace("playlist.m3u8", "")))!.id;
      open.add(id);
      maxOpen = Math.max(maxOpen, open.size);
      await new Promise((r) => setTimeout(r, 50));
      return base.fetch(url, referer);
    };
    const p = runPlayCheck(cams, {
      fetch,
      now: Date.now,
      sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
      onResult: (id) => open.delete(id),
    });
    await vi.runAllTimersAsync();
    const results = await p;

    expect(results.size).toBe(20);
    expect([...results.values()].every((r) => r.verdict === "rolling")).toBe(true);
    expect(maxOpen).toBe(PLAYCHECK_CONCURRENCY);
    for (const [, times] of starts) {
      for (let i = 1; i < times.length; i++) {
        expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(PLAYCHECK_HOST_GAP_MS);
      }
    }
  });

  it("orders a cycle: unchecked first, one host at a time in turn, then oldest result first", () => {
    const a = (i: number): VideoCamera => ({ id: `a${i}`, source: "caltrans", streamUrl: `https://wzmedia.dot.ca.gov/a${i}/playlist.m3u8` });
    const b = (i: number): VideoCamera => ({ id: `b${i}`, source: "scdot", streamUrl: `https://s7.us-east-1.skyvdn.com/rtplive/b${i}/playlist.m3u8` });
    const cams = [a(0), a(1), a(2), a(3), b(0), b(1)];
    const results = new Map<string, PlayResult>([
      ["a0", rolling(T0 + 500)],
      ["a1", rolling(T0 + 100)],
    ]);
    const order = orderForCycle(cams, results, T0 + 1000).map((c) => c.id);
    expect(order).toEqual(["a2", "b0", "a3", "b1", "a1", "a0"]);
  });
});

describe("the saved file", () => {
  it("round-trips, and drops rows too old to count or dated after the save", () => {
    const results = new Map<string, PlayResult>([
      ["caltrans:a", rolling(T0, "caltrans", 321)],
      ["caltrans:b", failed(T0, "error")],
      ["caltrans:old", rolling(T0 - PLAYCHECK_FRESH_MS - 5)],
      ["caltrans:future", rolling(T0 + 10_000)],
    ]);
    const text = encodePlayResults(results, T0 + 1000);
    const back = decodePlayResults(text, T0 + 2000);
    expect(back?.savedAt).toBe(T0 + 1000);
    expect([...back!.results.keys()].sort()).toEqual(["caltrans:a", "caltrans:b"]);
    expect(back!.results.get("caltrans:a")).toEqual(rolling(T0, "caltrans", 321));
    expect(back!.results.get("caltrans:b")).toEqual(failed(T0, "error"));
  });

  it("refuses what is not a saved file, and skips malformed rows", () => {
    expect(decodePlayResults("not json", T0)).toBeNull();
    expect(decodePlayResults(JSON.stringify({ version: 2, savedAt: T0, rows: {} }), T0)).toBeNull();
    const text = JSON.stringify({
      version: 1,
      savedAt: T0,
      rows: { good: [T0, "rolling", "ok", "caltrans", 10], bad: [T0, "maybe", "?", "caltrans", null], short: [T0] },
    });
    expect([...decodePlayResults(text, T0)!.results.keys()]).toEqual(["good"]);
  });
});

describe("the background loop", () => {
  const cams = [
    { id: "caltrans:a", source: "caltrans", streamUrl: "https://wzmedia.dot.ca.gov/a/playlist.m3u8" },
    { id: "caltrans:b", source: "caltrans", streamUrl: "https://wzmedia.dot.ca.gov/b/playlist.m3u8" },
    { id: "tfl:c", source: "tfl" },
  ];
  const routes = {
    "/a/playlist.m3u8": (k: number) => ({ body: media(1 + k) }),
    "/a/media_4.ts": () => ({ body: "x" }),
    // b answers 404: once checked, it must not be live.
  };
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const hits = (calls: { url: string }[], path: string) => calls.filter((c) => c.url.includes(path)).length;

  it("loads saved results first, checks only what is due, and re-checks a camera a cycle later", async () => {
    vi.useFakeTimers({ now: T0 });
    const up = upstream(routes);
    const saves: number[] = [];
    startPlayCheckLoop({
      getCameras: async () => cams,
      fetch: up.fetch,
      now: Date.now,
      sleep,
      load: () =>
        new Map([
          ["caltrans:b", rolling(T0 - 1000)], // saved by the last process a second ago
          ["caltrans:old", rolling(T0 - PLAYCHECK_FRESH_MS - 1)], // too old to load
        ]),
      save: (r) => saves.push(r.size),
      cycleMs: 3_600_000,
      passEveryMs: 600_000,
    });
    // Loaded synchronously, so the response that started the loop already carries it.
    expect(liveCameraIds(T0).has("caltrans:b")).toBe(true);
    expect(playResults().has("caltrans:old")).toBe(false);

    await vi.advanceTimersByTimeAsync(60_000);
    // a was never checked, so it is checked now. b was checked a second before the
    // restart, so it is not due, and it stays live on its saved result.
    expect(playResults().get("caltrans:a")?.verdict).toBe("rolling");
    expect(hits(up.calls, "/b/")).toBe(0);
    expect([...liveCameraIds(Date.now())].sort()).toEqual(["caltrans:a", "caltrans:b"]);
    expect(saves.at(-1)).toBe(2);

    // Passes that find nothing due ask nobody.
    await vi.advanceTimersByTimeAsync(1_800_000);
    expect(hits(up.calls, "/a/")).toBe(3);

    // A cycle after b's saved check, b is due, and its 404 takes it off the map.
    await vi.advanceTimersByTimeAsync(1_800_000);
    expect(hits(up.calls, "/b/")).toBe(1);
    expect(playResults().get("caltrans:b")?.verdict).toBe("error");
    expect(liveCameraIds(Date.now()).has("caltrans:b")).toBe(false);
  });

  it("checks a camera the registry lists late at the next pass, not a cycle later", async () => {
    vi.useFakeTimers({ now: T0 });
    let list = cams.slice(0, 1);
    const up = upstream({
      ...routes,
      "/b/playlist.m3u8": (k: number) => ({ body: media(1 + k) }),
      "/b/media_4.ts": () => ({ body: "x" }),
    });
    startPlayCheckLoop({
      getCameras: async () => list,
      fetch: up.fetch,
      now: Date.now,
      sleep,
      passEveryMs: 600_000,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(playResults().has("caltrans:b")).toBe(false);
    list = cams; // a cold adapter (North Macedonia's) answers one refresh late
    await vi.advanceTimersByTimeAsync(600_000);
    expect(playResults().get("caltrans:b")?.verdict).toBe("rolling");
  });

  it("starts once per process however many routes ask", async () => {
    vi.useFakeTimers({ now: T0 });
    let passes = 0;
    const deps = {
      getCameras: async () => {
        passes++;
        return [];
      },
      fetch: upstream({}).fetch,
      now: Date.now,
      sleep: async () => undefined,
    };
    startPlayCheckLoop(deps);
    startPlayCheckLoop(deps);
    startPlayCheckLoop(deps);
    await vi.advanceTimersByTimeAsync(1000);
    expect(passes).toBe(1);
  });

  it("is due when never checked or a cycle old, and not before", () => {
    expect(isDue(undefined, T0)).toBe(true);
    expect(isDue(rolling(T0), T0 + PLAYCHECK_CYCLE_MS - 1)).toBe(false);
    expect(isDue(rolling(T0), T0 + PLAYCHECK_CYCLE_MS)).toBe(true);
  });
});

describe("when the server starts the loop", () => {
  it("is off for next build, the unit tests, and PLAYCHECK=off", () => {
    expect(playCheckEnabled({})).toBe(true);
    expect(playCheckEnabled({ PLAYCHECK: "off" })).toBe(false);
    expect(playCheckEnabled({ NEXT_PHASE: "phase-production-build" })).toBe(false);
    expect(playCheckEnabled({ VITEST: "true" })).toBe(false);
  });
});
