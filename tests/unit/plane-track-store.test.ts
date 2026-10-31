import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { WorldObject } from "@/lib/world";
import { isTrackId } from "@/lib/planes/trackId";
import {
  TRACK_CAPS,
  TRACK_TTL_MS,
  createTrackStore,
  flightTracks,
  ingestSnapshot,
  noteAircraftSnapshot,
  trackBody,
  trackStats,
  type TrackCaps,
} from "@/lib/planes/trackStore";
import { pointCount, type StoredTrack } from "@/lib/planes/trackLine";
import { GET } from "@/app/api/planes/track/route";

const T0 = 1_792_180_000_000;
const PULL_MS = 90_000;

function plane(id: string, lat: number, lon: number, extra: Partial<WorldObject> = {}): WorldObject {
  return { kind: "plane", id, lat, lon, altKm: 11, label: id, meta: {}, ...extra } as WorldObject;
}

const caps = (over: Partial<TrackCaps>): TrackCaps => ({ ...TRACK_CAPS, ...over });

describe("ingestSnapshot", () => {
  it("takes a snapshot once, by its instant", () => {
    const store = createTrackStore();
    expect(ingestSnapshot(store, [plane("plane:aaaaaa", 0, 0)], T0)).toBe(true);
    expect(ingestSnapshot(store, [plane("plane:aaaaaa", 0, 1)], T0)).toBe(false);
    expect(ingestSnapshot(store, [plane("plane:aaaaaa", 0, 1)], T0 - 1000)).toBe(false);
    expect(trackStats(store)).toEqual({ planes: 1, points: 1 });
  });

  it("dates a point by when the network last had it", () => {
    const store = createTrackStore();
    ingestSnapshot(store, [plane("plane:aaaaaa", 0, 0, { meta: { posAgeS: 30 } })], T0);
    expect(store.lines.get("plane:aaaaaa")!.firstHeardAt).toBe(T0 - 30_000);
  });

  it("drops a plane unheard for the set time, and keeps one heard just inside it", () => {
    const store = createTrackStore();
    ingestSnapshot(store, [plane("plane:aaaaaa", 0, 0), plane("plane:bbbbbb", 5, 5)], T0);
    const later = T0 + TRACK_CAPS.unheardMs;
    ingestSnapshot(store, [plane("plane:bbbbbb", 5, 5)], later - 1000);
    expect(store.lines.has("plane:aaaaaa")).toBe(true);
    ingestSnapshot(store, [plane("plane:bbbbbb", 5, 5)], later);
    expect(store.lines.has("plane:aaaaaa")).toBe(false);
    expect(store.lines.has("plane:bbbbbb")).toBe(true);
  });

  it("keeps 12 hours and no more of a plane still in the feed", () => {
    const store = createTrackStore();
    let lat = 0;
    let t = T0;
    const end = T0 + 13 * 3_600_000;
    // A zigzag, so thinning keeps every position.
    while (t < end) {
      lat += 0.2;
      ingestSnapshot(store, [plane("plane:aaaaaa", lat % 80, Math.round(lat * 5) % 2 ? 0.3 : 0)], t);
      t += PULL_MS;
    }
    const line = store.lines.get("plane:aaaaaa")!;
    expect(line.data[3]).toBeGreaterThanOrEqual(t - PULL_MS - TRACK_CAPS.maxAgeMs);
    expect(line.trimmed).toBe(true);
    expect(pointCount(line)).toBeLessThanOrEqual(TRACK_CAPS.maxPointsPerPlane);
  });

  it("holds the plane cap, longest-silent first", () => {
    const store = createTrackStore();
    const c = caps({ maxPlanes: 3 });
    ingestSnapshot(store, [plane("plane:aaaaa1", 0, 0), plane("plane:aaaaa2", 1, 1)], T0, c);
    ingestSnapshot(store, [plane("plane:aaaaa2", 1, 1)], T0 + PULL_MS, c);
    ingestSnapshot(store, [plane("plane:aaaaa3", 2, 2), plane("plane:aaaaa4", 3, 3)], T0 + 2 * PULL_MS, c);
    expect([...store.lines.keys()].sort()).toEqual(["plane:aaaaa2", "plane:aaaaa3", "plane:aaaaa4"]);
    expect(trackStats(store).planes).toBe(3);
  });

  it("holds the total point cap, longest-silent first", () => {
    const store = createTrackStore();
    const c = caps({ maxPoints: 40 });
    let t = T0;
    for (let i = 0; i < 30; i++) {
      t += PULL_MS;
      const row = [plane("plane:aaaaa1", i % 2, i * 0.3), plane("plane:aaaaa2", 20 + i % 2, i * 0.3)];
      ingestSnapshot(store, i < 25 ? row : [row[1]], t, c);
      expect(trackStats(store).points).toBeLessThanOrEqual(40);
    }
    expect(store.lines.has("plane:aaaaa2")).toBe(true);
  });

  it("holds the point cap for one plane", () => {
    const store = createTrackStore();
    const c = caps({ maxPointsPerPlane: 5 });
    let t = T0;
    for (let i = 0; i < 20; i++) {
      t += PULL_MS;
      ingestSnapshot(store, [plane("plane:aaaaa1", i % 2, i * 0.3)], t, c);
    }
    expect(trackStats(store).points).toBe(5);
  });

  it("feeds nothing a snapshot left out: only the rows it is handed go in", () => {
    const store = createTrackStore();
    ingestSnapshot(store, [plane("plane:aaaaa1", 0, 0)], T0);
    expect([...store.lines.keys()]).toEqual(["plane:aaaaa1"]);
    expect(trackBody(store, "plane:ffffff")).toContain('"points":[]');
  });
});

describe("the feed", () => {
  it("sits after the cap and the staleness gate, in the snapshot function", () => {
    // A source guard, because the order is the point: `fetchAircraftOnce` holds the uncapped
    // pool, and a too-old snapshot comes back from the gate with no rows.
    const src = readFileSync("lib/sources/opensky.ts", "utf8");
    const fn = src.slice(src.indexOf("export async function fetchAircraftSnapshot"));
    expect(fn.indexOf("gateSnapshot(snapshot)")).toBeGreaterThan(-1);
    expect(fn.indexOf("noteAircraftSnapshot(gated)")).toBeGreaterThan(fn.indexOf("gateSnapshot(snapshot)"));
    expect(src.slice(0, src.indexOf("export async function fetchAircraftSnapshot"))).not.toMatch(/noteAircraftSnapshot\(/);
  });

  it("makes no request of its own", () => {
    for (const f of ["lib/planes/trackStore.ts", "lib/planes/trackLine.ts", "app/api/planes/track/route.ts"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/\bfetch\(|laneFetch|adsb\.lol\/|adsb\.fi\//);
    }
  });

  it("writes no file", () => {
    for (const f of ["lib/planes/trackStore.ts", "lib/planes/trackLine.ts", "app/api/planes/track/route.ts"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/node:fs|from "fs"|writeFile/);
    }
  });

  it("ignores an empty or undated snapshot, and never throws into the layer", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const before = trackStats(flightTracks());
    noteAircraftSnapshot({ planes: [] });
    noteAircraftSnapshot({ planes: [plane("plane:aaaaa1", 0, 0)] });
    expect(trackStats(flightTracks())).toEqual(before);
    const hostile = [{ id: "plane:aaaaa1", get lat(): number { throw new Error("no"); } }] as unknown as WorldObject[];
    expect(() => noteAircraftSnapshot({ planes: hostile, fetchedAt: Date.now() + 1e9 })).not.toThrow();
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
    flightTracks().fedAt = 0;
  });

  it("keeps one store on globalThis, whichever copy of the module asks", async () => {
    const first = flightTracks();
    vi.resetModules();
    const again = await import("@/lib/planes/trackStore");
    expect(again.flightTracks()).toBe(first);
  });
});

describe("the id", () => {
  it("takes the ids the pull mints", () => {
    expect(isTrackId("plane:e8061a")).toBe(true);
    expect(isTrackId("plane:~a1b2c3")).toBe(true);
  });
  it("refuses everything else", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "plane:",
      "plane:e8061",
      "plane:e8061aa",
      "plane:E8061A",
      "plane:g8061a",
      "e8061a",
      "ship:e8061a",
      "plane:e8061a\n",
      " plane:e8061a",
      "plane:e8061a&x=1",
      "plane:../../etc",
      42,
    ]) {
      expect(isTrackId(bad), String(bad)).toBe(false);
    }
  });
});

describe("GET /api/planes/track", () => {
  const ask = (query: string) => GET(new Request(`http://localhost/api/planes/track${query}`));

  it("answers a bad or missing id with a 400 that no cache keeps", async () => {
    for (const q of ["", "?id=", "?id=plane:zzz", "?id=plane%3Ae8061a%26x", "?id[]=plane:e8061a"]) {
      const res = await ask(q);
      expect(res.status, q).toBe(400);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("answers an unknown plane with an empty line, not an error", async () => {
    const res = await ask("?id=plane%3A000000");
    expect(res.status).toBe(200);
    const body = (await res.json()) as StoredTrack;
    expect(body).toEqual({ id: "plane:000000", firstHeardAt: null, lastHeardAt: null, trimmed: false, points: [], breaks: [] });
  });

  it("answers a known plane with its line and when we first heard it", async () => {
    const store = flightTracks();
    const at = (store.fedAt || T0) + PULL_MS;
    ingestSnapshot(store, [plane("plane:abc123", 10, 10)], at);
    const res = await ask("?id=plane:abc123");
    const body = (await res.json()) as StoredTrack;
    expect(body.firstHeardAt).toBe(at);
    expect(body.points).toEqual([[10, 10, 11, at]]);
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  it("asks the shared caches to hold it for half a pull, and never longer than a pull", async () => {
    const res = await ask("?id=plane%3A000000");
    const seconds = TRACK_TTL_MS / 1000;
    expect(res.headers.get("cache-control")).toBe(`public, s-maxage=${seconds}, stale-while-revalidate=${seconds}`);
    expect(res.headers.get("cdn-cache-control")).toBe(`public, s-maxage=${seconds}, stale-while-revalidate=${seconds}`);
    expect(TRACK_TTL_MS * 2).toBeLessThanOrEqual(PULL_MS);
  });
});

describe("trackBody", () => {
  it("builds a popular plane once a snapshot", () => {
    const store = createTrackStore();
    ingestSnapshot(store, [plane("plane:abc123", 1, 1)], T0);
    const spy = vi.spyOn(JSON, "stringify");
    const one = trackBody(store, "plane:abc123");
    const two = trackBody(store, "plane:abc123");
    expect(two).toBe(one);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    ingestSnapshot(store, [plane("plane:abc123", 1, 2)], T0 + PULL_MS);
    expect(store.bodies.size).toBe(0);
    expect(trackBody(store, "plane:abc123")).not.toBe(one);
  });

  it("holds nothing for a plane it does not know, so made-up ids grow nothing", () => {
    const store = createTrackStore();
    for (let i = 0; i < 2000; i++) trackBody(store, `plane:${i.toString(16).padStart(6, "0")}`);
    expect(store.bodies.size).toBe(0);
    expect(store.lines.size).toBe(0);
  });

  it("holds a bounded number of replies", () => {
    const store = createTrackStore();
    const planes = Array.from({ length: 200 }, (_, i) => plane(`plane:${i.toString(16).padStart(6, "0")}`, 1, 1));
    ingestSnapshot(store, planes, T0);
    for (const p of planes) trackBody(store, p.id);
    expect(store.bodies.size).toBeLessThanOrEqual(64);
  });
});
