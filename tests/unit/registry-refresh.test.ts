import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Camera } from "@/lib/types";

// `mergeResults` and `withTimeout` have their own tests (registry.test.ts,
// registry-timeout.test.ts). This file is the part between them: what `refresh()` and
// `getRegistry()` do with module state — the cache, the last-good map, the shared
// in-flight round and the per-feed health — across rounds. The registry keeps that state
// at module scope, so every test re-imports it fresh.

// The sixteen hand-written adapters, replaced so a round touches no network. Each one
// answers through `feeds`, so a test can make any feed succeed, fail or hang.
const feeds = vi.hoisted(() => {
  const behaviour: Record<string, () => Promise<unknown[]>> = {};
  const calls: Record<string, number> = {};
  return {
    behaviour,
    calls,
    run(key: string) {
      calls[key] = (calls[key] ?? 0) + 1;
      return behaviour[key]();
    },
  };
});

vi.mock("@/lib/sources/tfl", () => ({ fetchRegistry: () => feeds.run("tfl") }));
vi.mock("@/lib/sources/caltrans", () => ({ fetchRegistry: () => feeds.run("caltrans") }));
vi.mock("@/lib/sources/scdot", () => ({ fetchRegistry: () => feeds.run("scdot") }));
vi.mock("@/lib/sources/digitraffic", () => ({ fetchRegistry: () => feeds.run("digitraffic") }));
vi.mock("@/lib/sources/castlerock", () => ({ fetchRegistry: () => feeds.run("castlerock") }));
vi.mock("@/lib/sources/tripcheck", () => ({ fetchRegistry: () => feeds.run("tripcheck") }));
vi.mock("@/lib/sources/drivebc", () => ({ fetchRegistry: () => feeds.run("drivebc") }));
vi.mock("@/lib/sources/nzta", () => ({ fetchRegistry: () => feeds.run("nzta") }));
vi.mock("@/lib/sources/iceland", () => ({ fetchRegistry: () => feeds.run("iceland") }));
vi.mock("@/lib/sources/estonia", () => ({ fetchRegistry: () => feeds.run("estonia") }));
vi.mock("@/lib/sources/trafficscotland", () => ({ fetchRegistry: () => feeds.run("trafficscotland") }));
vi.mock("@/lib/sources/cetsp", () => ({ fetchRegistry: () => feeds.run("cetsp") }));
vi.mock("@/lib/sources/serbia-borders", () => ({ fetchRegistry: () => feeds.run("mup-rs") }));
vi.mock("@/lib/sources/serbia-tolls", () => ({ fetchRegistry: () => feeds.run("putevi-rs") }));
vi.mock("@/lib/sources/bihamk", () => ({ fetchRegistry: () => feeds.run("bihamk") }));
vi.mock("@/lib/sources/actpr", () => ({ fetchRegistry: () => feeds.run("act-pr") }));
// Admitted feeds are committed data, and one of them would fetch for real.
vi.mock("@/lib/sources/discovered", () => ({ discoveredCameraFeeds: () => [] }));

const KEYS = [
  "tfl", "caltrans", "scdot", "digitraffic", "castlerock", "tripcheck", "drivebc", "nzta",
  "iceland", "estonia", "trafficscotland", "cetsp", "mup-rs", "putevi-rs", "bihamk", "act-pr",
];

const cam = (id: string): Camera => ({
  id, source: "x", country: "US", name: id, lat: 0, lon: 0,
  mediaType: "jpeg", refreshSeconds: 60, license: "L", attribution: "A", available: true,
});

const answer = (key: string, suffix = "") => () => Promise.resolve([cam(`${key}${suffix}`)] as unknown[]);
const down = () => Promise.reject(new Error("upstream down"));
const hang = () => new Promise<unknown[]>(() => {});

function setFeed(key: string, fn: () => Promise<unknown[]>) {
  feeds.behaviour[key] = fn;
}
function setAll(fn: (key: string) => () => Promise<unknown[]>) {
  for (const k of KEYS) setFeed(k, fn(k));
}
const callsTo = (key: string) => feeds.calls[key] ?? 0;

async function load() {
  return import("@/lib/sources/registry");
}
const ids = (cams: Camera[]) => cams.map((c) => c.id).sort();

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-08T12:00:00Z"));
  for (const k of Object.keys(feeds.calls)) delete feeds.calls[k];
  setAll((k) => answer(k));
});

afterEach(() => {
  vi.useRealTimers();
});

/** Let the shared background round that a stale `getRegistry()` started finish. */
const settle = () => vi.advanceTimersByTimeAsync(0);

describe("getRegistry — cold start", () => {
  test("every feed down and no cache: the call rejects instead of caching an empty world", async () => {
    const { getRegistry, feedHealth } = await load();
    setAll(() => down);
    await expect(getRegistry()).rejects.toThrow("all camera sources failed and no cache is available");
    expect(feedHealth()).toEqual([]);
  });

  test("that failure is not remembered: the next call after a feed recovers succeeds", async () => {
    const { getRegistry } = await load();
    setAll(() => down);
    await expect(getRegistry()).rejects.toThrow();
    setFeed("tfl", answer("tfl"));
    expect(ids(await getRegistry())).toEqual(["tfl"]);
  });

  test("two callers at once share one round: each feed is asked once", async () => {
    const { getRegistry } = await load();
    const [a, b] = await Promise.all([getRegistry(), getRegistry()]);
    expect(a).toHaveLength(KEYS.length);
    expect(b).toBe(a);
    for (const k of KEYS) expect(callsTo(k)).toBe(1);
  });
});

describe("getRegistry — warm cache", () => {
  test("inside the TTL it answers from cache and asks no feed again", async () => {
    const { getRegistry, REGISTRY_TTL_MS } = await load();
    await getRegistry();
    vi.setSystemTime(Date.now() + REGISTRY_TTL_MS - 1);
    await getRegistry();
    await settle();
    for (const k of KEYS) expect(callsTo(k)).toBe(1);
  });

  test("past the TTL it serves the old set at once and refreshes behind the call", async () => {
    const { getRegistry, REGISTRY_TTL_MS } = await load();
    const first = await getRegistry();
    setFeed("tfl", answer("tfl", "-v2"));
    vi.setSystemTime(Date.now() + REGISTRY_TTL_MS);

    expect(await getRegistry()).toBe(first); // the stale answer, not a wait
    await settle();
    expect(ids(await getRegistry())).toContain("tfl-v2");
    expect(ids(await getRegistry())).not.toContain("tfl");
  });

  test("one feed fails on the next round: its last-good cameras stay and its health says stale", async () => {
    const { getRegistry, feedHealth, REGISTRY_TTL_MS } = await load();
    await getRegistry();
    setFeed("tfl", down);
    vi.setSystemTime(Date.now() + REGISTRY_TTL_MS);
    await getRegistry();
    await settle();

    expect(ids(await getRegistry())).toEqual(ids(KEYS.map((k) => cam(k))));
    expect(feedHealth().find((h) => h.key === "tfl")).toEqual({ key: "tfl", ok: false, count: 1, stale: true });
    expect(feedHealth().filter((h) => h.ok)).toHaveLength(KEYS.length - 1);
  });

  test("a feed that failed on the first round and returns later is added, not stuck absent", async () => {
    const { getRegistry, feedHealth, REGISTRY_TTL_MS } = await load();
    setFeed("nzta", down);
    expect(await getRegistry()).toHaveLength(KEYS.length - 1);
    expect(feedHealth().find((h) => h.key === "nzta")).toEqual({ key: "nzta", ok: false, count: 0, stale: false });

    setFeed("nzta", answer("nzta"));
    vi.setSystemTime(Date.now() + REGISTRY_TTL_MS);
    await getRegistry();
    await settle();
    expect(await getRegistry()).toHaveLength(KEYS.length);
  });

  test("every feed fails at once: the whole old set is kept, every feed reads stale, and it backs off", async () => {
    // Nothing answered, but last-good survives per feed, so the merged set is not empty
    // and the round is recorded like any other: the world does not shrink, /api/coverage
    // says every feed is stale instead of calling the old figures fresh, and the cache
    // age moves so the next call inside the TTL does not hammer the dead upstreams.
    const { getRegistry, feedHealth, REGISTRY_TTL_MS } = await load();
    const first = await getRegistry();
    setAll(() => down);
    vi.setSystemTime(Date.now() + REGISTRY_TTL_MS);

    expect(await getRegistry()).toBe(first);
    await settle();

    expect(ids(await getRegistry())).toEqual(ids(first));
    expect(feedHealth()).toHaveLength(KEYS.length);
    expect(feedHealth().every((h) => !h.ok && h.stale && h.count === 1)).toBe(true);
    expect(callsTo("tfl")).toBe(2); // the first round, then the one failed round
  });
});

describe("refresh — per-feed budget", () => {
  test("a feed that never answers is cut off at the default budget, and the rest are served", async () => {
    const { getRegistry, feedHealth, DEFAULT_UPSTREAM_TIMEOUT_MS } = await load();
    setFeed("caltrans", hang);
    let done = false;
    const pending = getRegistry().then((c) => ((done = true), c));

    await vi.advanceTimersByTimeAsync(DEFAULT_UPSTREAM_TIMEOUT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);

    expect(await pending).toHaveLength(KEYS.length - 1);
    expect(feedHealth().find((h) => h.key === "caltrans")).toEqual({ key: "caltrans", ok: false, count: 0, stale: false });
  });

  test("Castle Rock gets its own 60 s budget: the round waits for it past the default", async () => {
    const { getRegistry, DEFAULT_UPSTREAM_TIMEOUT_MS, CAMERA_FEEDS } = await load();
    expect(CAMERA_FEEDS.find((f) => f.key === "castlerock")?.budgetMs).toBe(60_000);
    let release: (c: unknown[]) => void = () => {};
    setFeed("castlerock", () => new Promise<unknown[]>((r) => (release = r)));
    let done = false;
    const pending = getRegistry().then((c) => ((done = true), c));

    await vi.advanceTimersByTimeAsync(DEFAULT_UPSTREAM_TIMEOUT_MS + 1);
    expect(done).toBe(false);
    release([cam("castlerock")]);
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
    expect(ids(await pending)).toContain("castlerock");
  });
});
