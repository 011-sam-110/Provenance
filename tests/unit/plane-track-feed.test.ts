import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flightTracks, trackBody } from "@/lib/planes/trackStore";
import { pointCount } from "@/lib/planes/trackLine";
import { MAX_PLANES, fetchAircraftSnapshot } from "@/lib/sources/opensky";
import { laneFetch } from "@/lib/http/hostLane";

// THE GATING PATH. These run the real pull (`fetchAircraftOnce`) with only the network stubbed, and
// `next/cache` passed through, so "the store gets the whole pool, before the cap" is measured where
// it happens. A plane outside the served 3,000 must still grow its line, because the served sample
// moves from pull to pull and a line fed from it has holes.

vi.mock("next/cache", () => ({ unstable_cache: <T>(fn: T) => fn }));
vi.mock("@/lib/http/hostLane", () => ({ laneFetch: vi.fn() }));

const POOL = MAX_PLANES + 500;
const PULL_MS = 120_000;

function row(i: number, step: number) {
  return {
    hex: (i + 0x100000).toString(16),
    flight: `T${i}`,
    t: "B738",
    category: "A3",
    alt_baro: 35000,
    gs: 450,
    track: 90,
    // All in one 10 degree cell, so the cap cuts them by a hash of the id and nothing else, and
    // a turn each pull, so thinning keeps every position.
    lat: 45 + ((i % 50) * 0.05) + (step % 2) * 0.2,
    lon: 5 + ((i % 40) * 0.05) + step * 0.2,
    seen_pos: 1,
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("the feed from the pull", () => {
  let step = 0;
  let fiRows: unknown[] = [];
  const adsbLolCalls = () => vi.mocked(laneFetch).mock.calls.filter(([u]) => String(u).includes("adsb.lol")).length;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_792_180_000_000);
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    step = 0;
    fiRows = [];
    const store = flightTracks();
    store.lines.clear();
    store.bodies.clear();
    store.fedAt = 0;
    vi.mocked(laneFetch).mockReset();
    vi.mocked(laneFetch).mockImplementation(async (url: string) => {
      if (url.includes("adsb.lol")) return json({ ac: Array.from({ length: POOL }, (_, i) => row(i, step)) });
      return json({ ac: fiRows });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    const store = flightTracks();
    store.lines.clear();
    store.bodies.clear();
    store.fedAt = 0;
  });

  async function pull() {
    const snapshot = await fetchAircraftSnapshot();
    step += 1;
    vi.setSystemTime(Date.now() + PULL_MS);
    return snapshot;
  }

  it("grows the line of a plane outside the served 3,000", async () => {
    const first = await pull();
    const second = await pull();
    await pull();
    expect(first.planes.length).toBe(MAX_PLANES);
    expect(second.planes.length).toBe(MAX_PLANES);

    const served = new Set(second.planes.map((p) => p.id));
    const store = flightTracks();
    expect(store.lines.size).toBe(POOL);
    const left = [...store.lines.keys()].filter((id) => !served.has(id));
    expect(left.length).toBe(POOL - MAX_PLANES);
    for (const id of left.slice(0, 20)) {
      expect(pointCount(store.lines.get(id)!)).toBe(3);
      expect(JSON.parse(trackBody(store, id)).points).toHaveLength(3);
    }
  });

  it("asks adsb.lol for nothing extra: one request a pull", async () => {
    await pull();
    await pull();
    await pull();
    expect(adsbLolCalls()).toBe(3);
  });

  it("takes adsb.fi's gap fill, and not its military rows", async () => {
    fiRows = [
      { hex: "abc001", flight: "CIVIL1", lat: 41, lon: 29, alt_baro: 30000, gs: 400, track: 10, seen_pos: 1 },
      { hex: "abc002", flight: "MIL1", dbFlags: 1, lat: 41.5, lon: 29, alt_baro: 30000, gs: 400, track: 10, seen_pos: 1 },
    ];
    await pull();
    const store = flightTracks();
    expect(store.lines.has("plane:abc001")).toBe(true);
    expect(store.lines.has("plane:abc002")).toBe(false);
  });

  it("feeds nothing from a pull that failed", async () => {
    await pull();
    const before = pointCount(flightTracks().lines.get("plane:100000")!);
    vi.mocked(laneFetch).mockImplementation(async () => json({}, 500));
    const snapshot = await pull();
    expect(snapshot.planes).toEqual([]);
    expect(pointCount(flightTracks().lines.get("plane:100000")!)).toBe(before);
  });

  it("dates the line by the snapshot's own instant", async () => {
    const first = await pull();
    const line = flightTracks().lines.get(first.planes[0].id)!;
    // The row's `seen_pos` of 1 s comes off the instant the snapshot was stamped with.
    expect(line.firstHeardAt).toBe(first.fetchedAt! - 1000);
  });
});
