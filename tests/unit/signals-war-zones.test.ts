import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RELAY_FEEDS, type RelayData } from "@/lib/relay/feeds";
import { putRelay, resetRelayStore } from "@/lib/relay/store";
import { readOutcome } from "@/lib/signals/outcome";
import { readSummary } from "@/lib/signals/summary";
import {
  WAR_ZONES_SOURCE,
  WAR_ZONE_COLORS,
  areaAnchor,
  heldChange,
  readWarZonesSummary,
  warZonesFrom,
} from "@/lib/signals/war-zones";
import type { SignalGeometry } from "@/lib/signals/types";
import { toSignalObjects } from "@/lib/map/signalObjects";
import { EMPTY_MARK_CONTEXT, markOf, pinSignals } from "@/lib/map/precisionMarks";

// The relay fixture is a real envelope captured on 2026-10-30 with
// `python -m sources push war-zones --dry-run --out` (NewsScraper sources/deepstate.py),
// trimmed to 13 of its 110 areas and 5 of its 60 attack directions. The series is whole:
// 91 days measured on provenance-1's method from DeepState's own past maps.
const env = JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "relay", "war-zones.json"), "utf8"));
const data = RELAY_FEEDS["war-zones"].schema.parse(env.data) as RelayData<"war-zones">;
const FETCHED = Date.parse(env.fetchedAt);

function inRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inside(lat: number, lon: number, g: SignalGeometry): boolean {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  return polys.some((p) => inRing(lon, lat, p[0] as number[][]) && !p.slice(1).some((h) => inRing(lon, lat, h as number[][])));
}

describe("war zones: relay -> area features", () => {
  const { features, summary } = warZonesFrom(data);

  it("draws one area per area, coloured by kind, with the contested ground hatched", () => {
    expect(features).toHaveLength(13);
    const byColor = (c: string) => features.filter((f) => f.color === c);
    expect(byColor(WAR_ZONE_COLORS.occupied)).toHaveLength(5);
    expect(byColor(WAR_ZONE_COLORS.contested)).toHaveLength(4);
    expect(byColor(WAR_ZONE_COLORS.liberated)).toHaveLength(4);
    for (const f of features) {
      expect(f.precision).toBe("area");
      expect(f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon").toBe(true);
      expect(f.fill === "hatch").toBe(f.color === WAR_ZONE_COLORS.contested);
      expect(f.link).toMatch(/^https:\/\/deepstatemap\.live\/en#9\//);
      // An area is the state of the ground, not an event: no ts for a time filter to drop it by.
      expect(f.ts).toBeUndefined();
    }
    expect(features.map((f) => f.title)).toContain("Russian-held: Occupied Crimea");
    expect(features.map((f) => f.title)).toContain("Retaken by Ukraine: Liberated 25.03");
    expect(features.filter((f) => f.title === "Russian-held")).toHaveLength(4);
  });

  it("anchors every area inside its own polygon", () => {
    for (const f of features) expect(inside(f.lat, f.lon, f.geometry!), f.title).toBe(true);
  });

  it("never reaches the pin source: each area is its shape, the contested ones hatched", () => {
    const objs = toSignalObjects(features, WAR_ZONES_SOURCE);
    expect(pinSignals(objs, EMPTY_MARK_CONTEXT)).toHaveLength(0);
    expect(new Set(objs.map((o) => markOf(o, EMPTY_MARK_CONTEXT)))).toEqual(new Set(["shape", "hatch"]));
  });

  it("summarises the held area and its change over 7, 30 and 90 days from the measured series", () => {
    expect(summary.zones).toHaveLength(1);
    const z = summary.zones[0];
    expect(z).toMatchObject({ id: "ukraine", name: "Ukraine", source: "DeepState", mapId: 1793223200, mapAt: "2026-10-28T21:33:20Z" });
    expect(z.heldKm2).toBe(117148.2);
    expect(z.contestedKm2).toBe(1695.6);
    expect(z.change7).toBe(25.6); // 117,148.2 on 28 Oct against 117,122.6 on 21 Oct
    expect(z.change30).toBe(59.1); // against 117,089.1 on 28 Sep
    expect(z.change90).toBe(123.4); // against 117,024.8 on 30 Jul
    expect(z.series).toHaveLength(91);
    expect(z.areas).toEqual({ occupied: 5, contested: 4, liberated: 4 });
    expect(z.attacks).toBe(5);
  });

  it("gives no change for a day the series lacks, never an estimate", () => {
    const rows = [
      { day: "2026-10-01", heldKm2: 10, contestedKm2: 1 },
      { day: "2026-10-08", heldKm2: 12, contestedKm2: 1 },
    ];
    expect(heldChange(rows, 7)).toBe(2);
    expect(heldChange(rows, 6)).toBeNull();
    expect(heldChange([], 7)).toBeNull();
  });

  it("anchors a crescent inside it, not at its centroid", () => {
    // A U shape: its centroid falls in the gap between the arms.
    const u: SignalGeometry = {
      type: "Polygon",
      coordinates: [[[0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3], [0, 0]]],
    };
    const a = areaAnchor(u);
    expect(inside(a.lat, a.lon, u)).toBe(true);
  });

  it("the widget's reader accepts the summary after a JSON round trip and refuses another shape", () => {
    const sent = JSON.parse(JSON.stringify(summary));
    expect(readWarZonesSummary(sent)).toEqual(summary);
    expect(readWarZonesSummary(null)).toBeNull();
    expect(readWarZonesSummary({ zones: [{ ...sent.zones[0], series: "no" }] })).toBeNull();
    expect(readWarZonesSummary({ zones: [{ ...sent.zones[0], heldKm2: "117148" }] })).toBeNull();
  });
});

describe("war zones: the source", () => {
  afterEach(() => {
    resetRelayStore();
    vi.useRealTimers();
  });

  it("says it has no snapshot yet, and draws nothing, before provenance-1 pushes one", async () => {
    const out = await WAR_ZONES_SOURCE.fetch();
    expect(out).toHaveLength(0);
    expect(readOutcome(out)).toMatchObject({ ok: false, reason: "no snapshot from provenance-1 yet" });
  });

  it("serves the pushed snapshot with its summary, dated by the read and by the map", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FETCHED + 60_000);
    putRelay("war-zones", data, FETCHED, FETCHED + 1000);
    const out = await WAR_ZONES_SOURCE.fetch();
    expect(out).toHaveLength(13);
    expect(readOutcome(out)).toMatchObject({ ok: true, at: FETCHED, sourceAt: Date.parse("2026-10-28T21:33:20Z") });
    expect(readWarZonesSummary(readSummary(out))?.zones[0].heldKm2).toBe(117148.2);
  });

  it("drops a snapshot older than the feed's 12 hours", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FETCHED + RELAY_FEEDS["war-zones"].maxAgeMs + 1);
    putRelay("war-zones", data, FETCHED, FETCHED + 1000);
    expect(await WAR_ZONES_SOURCE.fetch()).toHaveLength(0);
  });
});
