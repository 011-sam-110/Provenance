import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorldObject } from "@/lib/world";
import {
  FULL_CAPS,
  MAX_KEPT_LINES,
  capOverall,
  fullTrailOf,
  fullTrails,
  joinStoredLine,
  lineFromHistory,
  stepFullHistory,
  unwrapLongitudes,
} from "@/lib/planes/fullHistory";
import { FULL_TRAIL_KEY, fullTrailStore, parseStoredTrack, storedLineStore } from "@/lib/planes/fullTrail";
import { lineWords } from "@/lib/planes/lineWords";
import { GAP_MS, newLine, pointAt, pointCount, stepLine, type StoredTrack, type TrackLine } from "@/lib/planes/trackLine";
import { buildTrailPath, projectAhead, pushHistory } from "@/lib/planes/trail";
import { toTrailFC } from "@/lib/map/features";
import type { PlaneTrail } from "@/lib/planes/usePlanes";
import { SYNC_KEY_NAMES } from "@/lib/account/syncKeys";

const T0 = 1_792_180_000_000;
const PULL_MS = 120_000;
const ID = "plane:abc123";

function plane(lat: number, lon: number, extra: Partial<WorldObject> = {}, id = ID): WorldObject {
  return { kind: "plane", id, lat, lon, altKm: 11, heading: 90, label: id, color: "#fbbf24", meta: { velocityMs: 250 }, ...extra } as WorldObject;
}

/** A plane on a curve of 8 degrees a pull, so thinning keeps every position. */
function curve(pulls: number, from = { lat: 40, lon: 0 }) {
  const out: { lat: number; lon: number; t: number }[] = [];
  let at = from;
  for (let i = 1; i <= pulls; i++) {
    const p = projectAhead(at.lat, at.lon, i * 8, 22.5);
    at = { lat: p.lat, lon: p.lon };
    out.push({ ...at, t: T0 + i * PULL_MS });
  }
  return out;
}

describe("the tab's history", () => {
  it("grows past the 12 points the short line stops at", () => {
    let lines = new Map<string, TrackLine>();
    for (const p of curve(40)) lines = stepFullHistory(lines, [plane(p.lat, p.lon)], p.t);
    expect(pointCount(lines.get(ID)!)).toBe(40);
  });

  it("uses the same thinning as the server: a straight costs few points", () => {
    let lines = new Map<string, TrackLine>();
    let at = { lat: 40, lon: 0 };
    for (let i = 1; i <= 40; i++) {
      at = projectAhead(at.lat, at.lon, 90, 22.5);
      lines = stepFullHistory(lines, [plane(at.lat, at.lon)], T0 + i * PULL_MS);
    }
    expect(pointCount(lines.get(ID)!)).toBeLessThan(10);
  });

  it("loses a plane's line when it leaves the feed", () => {
    let lines = new Map<string, TrackLine>();
    const other = plane(10, 10, {}, "plane:ffffff");
    lines = stepFullHistory(lines, [plane(40, 0), other], T0);
    lines = stepFullHistory(lines, [other], T0 + PULL_MS);
    expect(lines.has(ID)).toBe(false);
    expect(lines.has("plane:ffffff")).toBe(true);
  });

  it("holds each line to its cap", () => {
    let lines = new Map<string, TrackLine>();
    for (const p of curve(40)) {
      lines = stepFullHistory(lines, [plane(p.lat, p.lon)], p.t, { ...FULL_CAPS, maxPointsPerPlane: 10 });
    }
    expect(pointCount(lines.get(ID)!)).toBe(10);
  });

  it("starts from the short line already drawn, so the switch shortens nothing", () => {
    let history: { lat: number; lon: number; altKm: number; t: number }[] = [];
    for (const p of curve(12)) history = pushHistory(history, { ...p, altKm: 11 }) as typeof history;
    const line = lineFromHistory(history, T0)!;
    expect(pointCount(line)).toBe(12);
    expect(pointAt(line, 0).t).toBe(T0 + PULL_MS);
    expect(lineFromHistory([], T0)).toBeNull();
  });
});

describe("the overall cap", () => {
  const caps = { maxPointsPerPlane: 500, maxTotalPoints: 1000 };

  function lineOf(n: number, seed = 0): TrackLine {
    const line = newLine({ lat: seed, lon: 0, altKm: 0, t: T0 });
    for (let i = 1; i < n; i++) line.data.push(seed, i, 0, T0 + i);
    return line;
  }
  const total = (lines: Map<string, TrackLine>) => [...lines.values()].reduce((s, l) => s + pointCount(l), 0);

  it("does nothing under the cap", () => {
    const lines = new Map([["a", lineOf(400)], ["b", lineOf(400)]]);
    capOverall(lines, new Set(), caps);
    expect(total(lines)).toBe(800);
  });

  it("cuts the long lines first and leaves the short ones whole", () => {
    const lines = new Map([["a", lineOf(900)], ["b", lineOf(300)], ["c", lineOf(20)]]);
    capOverall(lines, new Set(), caps);
    expect(total(lines)).toBeLessThanOrEqual(900);
    expect(pointCount(lines.get("c")!)).toBe(20);
    expect(pointCount(lines.get("b")!)).toBe(300);
    expect(pointCount(lines.get("a")!)).toBeGreaterThan(300);
  });

  it("keeps each line's newest points", () => {
    const lines = new Map([["a", lineOf(1500)]]);
    capOverall(lines, new Set(), caps);
    const a = lines.get("a")!;
    expect(pointAt(a, pointCount(a) - 1).t).toBe(T0 + 1499);
    expect(a.trimmed).toBe(true);
  });

  it("spares a line a click loaded", () => {
    const lines = new Map([["a", lineOf(500)], ["b", lineOf(800)], ["c", lineOf(800)]]);
    capOverall(lines, new Set(["a"]), caps);
    expect(pointCount(lines.get("a")!)).toBe(500);
    expect(total(lines)).toBeLessThanOrEqual(900);
  });

  it("holds when every plane has a long line, at today's plane count", () => {
    const lines = new Map<string, TrackLine>();
    for (let i = 0; i < 3000; i++) lines.set(`p${i}`, lineOf(40, i % 80));
    capOverall(lines, new Set(), FULL_CAPS);
    expect(total(lines)).toBeLessThanOrEqual(FULL_CAPS.maxTotalPoints);
  });

  it("leaves room for the most lines it spares", () => {
    expect(MAX_KEPT_LINES * FULL_CAPS.maxPointsPerPlane).toBeLessThan(FULL_CAPS.maxTotalPoints / 2);
  });
});

function stored(over: Partial<StoredTrack>): StoredTrack {
  return { id: ID, firstHeardAt: T0, lastHeardAt: T0 + 1000 * PULL_MS, trimmed: false, points: [], breaks: [], ...over };
}

describe("joining a stored line", () => {
  /** The tab's own line, from pull 5 on. */
  function tabLine() {
    const path = curve(8);
    const line = newLine({ lat: path[4].lat, lon: path[4].lon, altKm: 11, t: path[4].t });
    for (const p of path.slice(5)) stepLine(line, { ...p, altKm: 11 }, 500);
    return { line, path };
  }
  const wire = (ps: { lat: number; lon: number; t: number }[]): StoredTrack["points"] => ps.map((p) => [p.lat, p.lon, 11, p.t]);

  it("puts the older stored points behind the tab's own, with no jump", () => {
    const { line, path } = tabLine();
    const used = joinStoredLine(line, stored({ points: wire(path), firstHeardAt: path[0].t, lastHeardAt: path[7].t }));
    expect(used).toBe(4);
    expect(pointCount(line)).toBe(8);
    // Each point is the next one along the path: no point twice, none out of order.
    for (let i = 0; i < 8; i++) expect(pointAt(line, i).t).toBe(path[i].t);
    expect(line.breaks).toEqual([]);
    expect(line.firstHeardAt).toBe(path[0].t);
  });

  it("joins a thinned straight that runs past the tab's first point, with no gap", () => {
    // The server kept one straight from pull 1 to pull 8; the tab first heard the plane on pull 5.
    const { line, path } = tabLine();
    const used = joinStoredLine(line, stored({ points: wire([path[0], path[7]]), lastHeardAt: path[7].t }));
    expect(used).toBe(1);
    expect(line.breaks).toEqual([]);
    expect(pointAt(line, 0).t).toBe(path[0].t);
  });

  it("keeps a gap the server recorded, older than the join", () => {
    const { line, path } = tabLine();
    joinStoredLine(line, stored({ points: wire(path.slice(0, 4)), breaks: [2], lastHeardAt: path[3].t }));
    expect(line.breaks).toEqual([2]);
  });

  it("makes the join itself a gap when the point after it starts a part", () => {
    const { line, path } = tabLine();
    joinStoredLine(line, stored({ points: wire([path[0], path[1], path[5]]), breaks: [2], lastHeardAt: path[5].t }));
    expect(line.breaks).toEqual([2]);
  });

  it("makes the join a gap when the server has not heard it for as long as a gap", () => {
    const { line, path } = tabLine();
    joinStoredLine(line, stored({ points: wire(path.slice(0, 2)), lastHeardAt: path[4].t - GAP_MS }));
    expect(line.breaks).toEqual([2]);
  });

  it("does not make the join a gap on a shorter silence", () => {
    const { line, path } = tabLine();
    joinStoredLine(line, stored({ points: wire(path.slice(0, 4)), lastHeardAt: path[3].t }));
    expect(line.breaks).toEqual([]);
  });

  it("moves the tab's own breaks along", () => {
    const { line, path } = tabLine();
    line.breaks = [2];
    joinStoredLine(line, stored({ points: wire(path.slice(0, 4)), lastHeardAt: path[3].t }));
    expect(line.breaks).toEqual([6]);
  });

  it("uses nothing when the tab's line is already older", () => {
    const { line, path } = tabLine();
    const before = pointCount(line);
    expect(joinStoredLine(line, stored({ points: wire(path.slice(6)) }))).toBe(0);
    expect(pointCount(line)).toBe(before);
    expect(line.firstHeardAt).toBe(path[4].t);
  });

  it("is quiet for an unknown plane", () => {
    const { line } = tabLine();
    expect(joinStoredLine(line, stored({ firstHeardAt: null, lastHeardAt: null }))).toBe(0);
    expect(line.breaks).toEqual([]);
  });

  it("holds the joined line to the cap", () => {
    const { line, path } = tabLine();
    joinStoredLine(line, stored({ points: wire(path.slice(0, 4)), lastHeardAt: path[3].t }), 6);
    expect(pointCount(line)).toBe(6);
    expect(line.trimmed).toBe(true);
  });

  it("goes on growing after the join", () => {
    const { line, path } = tabLine();
    joinStoredLine(line, stored({ points: wire(path.slice(0, 4)), lastHeardAt: path[3].t }));
    const next = curve(9)[8];
    stepLine(line, { ...next, altKm: 11 }, 500);
    expect(pointAt(line, pointCount(line) - 1).t).toBe(next.t);
  });
});

describe("the drawn line", () => {
  it("ends with the plane and the same point ahead as the short line", () => {
    const line = newLine({ lat: 40, lon: 0, altKm: 11, t: T0 });
    stepLine(line, { lat: 40, lon: 0.3, altKm: 11, t: T0 + PULL_MS }, 500);
    const o = plane(40, 0.3);
    const trail = fullTrailOf(line, o);
    const short = buildTrailPath([{ lat: 40, lon: 0, altKm: 11 }], { lat: 40, lon: 0.3, altKm: 11 }, 90, 250);
    expect(trail.points).toEqual(short.map((p) => [p.lat, p.lon, p.altKm]));
  });

  it("runs on to the plane when a small step was skipped", () => {
    const line = newLine({ lat: 40, lon: 0, altKm: 11, t: T0 });
    const trail = fullTrailOf(line, plane(40, 0.001));
    expect(trail.points.length).toBe(3);
    expect(trail.points[0][1]).toBe(0);
    expect(trail.points[1][1]).toBe(0.001);
  });

  it("gives every plane in the snapshot one line and leaves one out if it has none", () => {
    const lines = new Map([[ID, newLine({ lat: 40, lon: 0, altKm: 11, t: T0 })]]);
    const trails = fullTrails(lines, [plane(40, 0), plane(1, 1, {}, "plane:ffffff")]);
    expect(trails.map((t) => t.id)).toEqual([ID]);
  });

  it("keeps longitudes continuous across the 180th meridian", () => {
    const points: [number, number, number][] = [[10, 179, 0], [10, -179, 0], [10, -177, 0], [10, 179, 0]];
    unwrapLongitudes(points);
    expect(points.map((p) => p[1])).toEqual([179, 181, 183, 179]);
  });

  it("leaves a line that does not cross alone", () => {
    const points: [number, number, number][] = [[10, -3, 0], [10, 2, 0], [10, 7, 0]];
    unwrapLongitudes(points);
    expect(points.map((p) => p[1])).toEqual([-3, 2, 7]);
  });

  it("does not draw across a gap, and a lone point draws nothing", () => {
    const trail: PlaneTrail = {
      id: ID,
      color: "#fbbf24",
      points: [[1, 1, 0], [2, 2, 0], [3, 3, 0], [4, 4, 0], [5, 5, 0], [6, 6, 0]],
      breaks: [2, 3],
    };
    const [feature] = toTrailFC([trail]).features;
    expect(feature.geometry).toEqual({
      type: "MultiLineString",
      coordinates: [
        [[1, 1], [2, 2]],
        [[4, 4], [5, 5], [6, 6]],
      ],
    });
  });

  it("draws a line with no breaks as it always has", () => {
    const trail: PlaneTrail = { id: ID, color: "#fbbf24", points: [[1, 1, 0], [2, 2, 0]] };
    expect(toTrailFC([trail]).features[0]).toEqual({
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[1, 1], [2, 2]] },
      properties: { id: ID, color: "#fbbf24" },
    });
  });
});

describe("the switch", () => {
  it("is off by default and stays out of the account's synced keys", () => {
    expect(fullTrailStore.get()).toBe(false);
    expect(SYNC_KEY_NAMES).not.toContain(FULL_TRAIL_KEY);
  });

  it("is off in the map's preview feed", () => {
    const src = readFileSync("components/WorldMap.tsx", "utf8");
    expect(src).toContain("<PlanesFeed onData={setPlanesLayer} fullTrail />");
    expect(src).toContain("<PlanesFeed onData={onPreviewPlanes} unscoped />");
  });
});

describe("the stored-line store", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    storedLineStore.clear();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    storedLineStore.clear();
  });
  const settled = () => new Promise((r) => setTimeout(r, 0));

  it("asks once, and encodes the id", async () => {
    fetchMock.mockResolvedValue(ok(stored({ points: [[1, 1, 0, T0]] })));
    storedLineStore.request(ID);
    storedLineStore.request(ID);
    await settled();
    storedLineStore.request(ID);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/planes/track?id=plane%3Aabc123");
    expect(storedLineStore.get(ID)?.status).toBe("ready");
    expect(storedLineStore.loadedIds().has(ID)).toBe(true);
  });

  it("does not ask for an id that is not a plane's", () => {
    storedLineStore.request("sat:25544");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storedLineStore.get("sat:25544")).toBeNull();
  });

  it("remembers an empty answer: an unknown plane is quiet, with no second ask", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValue(ok(stored({ firstHeardAt: null, lastHeardAt: null })));
    storedLineStore.request(ID);
    await settled();
    storedLineStore.request(ID);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(storedLineStore.get(ID)?.status).toBe("ready");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("logs a failure, and lets it be asked again", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    storedLineStore.request(ID);
    await settled();
    expect(storedLineStore.get(ID)?.status).toBe("failed");
    expect(warn).toHaveBeenCalledOnce();
    fetchMock.mockResolvedValueOnce(ok(stored({})));
    storedLineStore.request(ID);
    await settled();
    expect(storedLineStore.get(ID)?.status).toBe("ready");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("forgets a plane that left the feed, so it asks again when it comes back", async () => {
    fetchMock.mockImplementation(async () => ok(stored({})));
    storedLineStore.request(ID);
    await settled();
    storedLineStore.retain(new Set());
    expect(storedLineStore.get(ID)).toBeNull();
    storedLineStore.request(ID);
    await settled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("spares at most MAX_KEPT_LINES lines, the oldest click out first", async () => {
    fetchMock.mockImplementation(async (url: string) => ok(stored({ id: decodeURIComponent(url.split("=")[1]) })));
    const ids = Array.from({ length: MAX_KEPT_LINES + 3 }, (_, i) => `plane:${i.toString(16).padStart(6, "0")}`);
    for (const id of ids) storedLineStore.request(id);
    await settled();
    expect(storedLineStore.loadedIds().size).toBe(MAX_KEPT_LINES);
    expect(storedLineStore.get(ids[0])).toBeNull();
    expect(storedLineStore.get(ids[ids.length - 1])?.status).toBe("ready");
  });

  it("tells its listeners when an answer lands", async () => {
    fetchMock.mockResolvedValue(ok(stored({})));
    const heard = vi.fn();
    const off = storedLineStore.subscribe(heard);
    storedLineStore.request(ID);
    await settled();
    off();
    expect(heard.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("parseStoredTrack", () => {
  it("accepts the route's body", () => {
    const body = stored({ points: [[1, 2, 3, T0], [2, 3, 4, T0 + 1]], breaks: [1] });
    expect(parseStoredTrack(JSON.parse(JSON.stringify(body)), ID)).toEqual(body);
  });
  it("refuses another plane's body, a bad point or a break outside the line", () => {
    expect(parseStoredTrack(stored({}), "plane:ffffff")).toBeNull();
    expect(parseStoredTrack(null, ID)).toBeNull();
    expect(parseStoredTrack({ id: ID }, ID)).toBeNull();
    expect(parseStoredTrack({ ...stored({}), points: [[1, 2, "3", T0]] }, ID)).toBeNull();
    expect(parseStoredTrack({ ...stored({}), points: [[1, 2, 3]] }, ID)).toBeNull();
    expect(parseStoredTrack(stored({ points: [[1, 1, 0, T0]], breaks: [5] }), ID)).toBeNull();
  });
});

describe("the words", () => {
  const all = [
    lineWords({ status: "loading" }),
    lineWords({ status: "failed" }),
    // `from` is set once the tab's own line was joined to it, an empty answer included.
    lineWords({ status: "ready", track: stored({ firstHeardAt: null, lastHeardAt: null }), from: T0 }),
    lineWords({ status: "ready", track: stored({}), from: null }),
    lineWords({ status: "ready", track: stored({ trimmed: true }), from: T0 }),
  ];
  const sources = () =>
    ["lib/planes/lineWords.ts", "components/shell/inspector/tools/SettingsTool.tsx"].map((f) => readFileSync(f, "utf8"));

  it("say when the line starts", () => {
    expect(all[0]).toContain("from when we first heard it");
    expect(all[3]).toContain("from when we first heard it");
    expect(all[2]).toContain("from when this tab first heard it");
  });

  it("say that a gap is a gap", () => {
    expect(all[3]).toContain("Gaps are where we have no position for it");
    expect(all[4]).toContain("Gaps are where we have no position for it");
  });

  it("never claim the take-off or a whole flight", () => {
    for (const w of all) {
      expect(w).not.toMatch(/take-?\s?off|took off|since departure|complete|entire|whole flight|full route|all of its/i);
    }
  });

  it("say the setting's line in the words the plan gave", () => {
    const settings = sources()[1];
    expect(settings).toContain('label="Full flight trail"');
    expect(settings).toContain("Keeps each plane's whole line. Click a plane to load it from when we first heard it.");
    // The word "take-off" appears in this file's comment, never in a string the row shows.
    expect(settings).not.toMatch(/sub="[^"]*take-?off/i);
  });

  it("use no em dash", () => {
    for (const w of all) expect(w).not.toMatch(/[—–]/);
  });
});
