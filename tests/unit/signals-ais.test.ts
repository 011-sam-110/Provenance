import { describe, expect, it, test } from "vitest";
// Live-captured AISStream PositionReports (chokepoint boxes), plus one null-coord edge row.
import fixture from "@/tests/fixtures/ais-vessels.json";
import {
  AIS_CAP,
  fairShareCap,
  liveVessels,
  navStatusLabel,
  normalizeAis,
  pruneHeard,
  reconnectDelay,
  snapshotRule,
  vesselFeature,
  VESSEL_TTL_MS,
  WARM_MS,
  type AisVessel,
} from "@/lib/signals/ais";
import type { SignalFeature } from "@/lib/signals/types";

test("normalizes AIS vessels, skipping rows with no position", () => {
  const out = normalizeAis(fixture as never);
  expect(out).toHaveLength(6); // 6 located vessels; the MMSI=0 / null-coord row is skipped
  expect(new Set(out.map((f) => f.signalId))).toEqual(new Set(["ais"]));

  const maersk = out.find((f) => f.id === "ais:219179000")!;
  expect(maersk.title).toBe("MAERSK TRIESTE");
  expect(maersk.lat).toBeCloseTo(50.42163);
  expect(maersk.lon).toBeCloseTo(-0.46898);
  expect(maersk.props?.speed).toBe("13.5 kt");
  expect(maersk.props?.course).toBe("259°");
  expect(maersk.props?.status).toBe("under way (engine)");
  expect(maersk.color).toBe("#0d9488"); // moving → teal
  expect(maersk.ts).toBe("2026-06-27T09:24:09.000Z");
});

test("stationary vessels render slate; moving render teal", () => {
  const out = normalizeAis(fixture as never);
  const anchored = out.find((f) => f.id === "ais:271002308")!; // SINAN PASA, Sog 0
  expect(anchored.color).toBe("#64748b");
  expect(anchored.props?.speed).toBe("0.0 kt");

  const moving = out.find((f) => f.id === "ais:538011030")!; // FIYUH, Sog 5
  expect(moving.color).toBe("#0d9488");
});

test("a vessel feature carries the ship's own static fields, each only when present", () => {
  const base: AisVessel = { MMSI: 230108270, ShipName: "VALBORG", latitude: 60.1712, longitude: 24.9621, Sog: 0, Cog: 330 };
  const f = vesselFeature({
    ...base,
    callSign: "OFNR", imo: 5375462, lengthM: 30, beamM: 7, draughtM: 2.4, eta: "09-18T19:00Z",
  })!;
  expect(f.props).toMatchObject({ mmsi: 230108270, callSign: "OFNR", imo: 5375462, lengthM: 30, beamM: 7, draughtM: 2.4, eta: "09-18T19:00Z" });
  const bare = vesselFeature(base)!;
  for (const k of ["callSign", "imo", "lengthM", "beamM", "draughtM", "eta"]) expect(k in bare.props!, k).toBe(false);
});

test("nav-status codes map to human labels", () => {
  expect(navStatusLabel(0)).toBe("under way (engine)");
  expect(navStatusLabel(1)).toBe("at anchor");
  expect(navStatusLabel(5)).toBe("moored");
  expect(navStatusLabel(99)).toBe("—");
  expect(navStatusLabel(null)).toBe("—");
});

describe("fairShareCap", () => {
  const f = (id: string, chokepoint: string, ts: string): SignalFeature => ({
    id, lat: 0, lon: 0, title: id, signalId: "ais", ts, props: { chokepoint },
  });

  it("gives a quiet chokepoint its share when a busy one could fill the cap alone", () => {
    const busy = Array.from({ length: 10 }, (_, i) => f(`c${i}`, "English Channel", `2026-10-16T19:00:${String(i).padStart(2, "0")}Z`));
    const quiet = [f("h1", "Strait of Hormuz", "2026-10-16T18:00:00Z")];
    const out = fairShareCap([...busy, ...quiet], 4);
    expect(out).toHaveLength(4);
    expect(out.map((x) => x.id)).toContain("h1");
    // The busy strait keeps its most recent reports.
    expect(out.filter((x) => x.props?.chokepoint === "English Channel").map((x) => x.id)).toEqual(["c9", "c8", "c7"]);
  });

  it("does nothing under the cap", () => {
    const one = [f("a", "Bosphorus", "2026-10-16T19:00:00Z")];
    expect(fairShareCap(one, AIS_CAP)).toEqual(one);
  });
});

describe("the heard-vessel map", () => {
  const v = (mmsi: number): AisVessel => ({ MMSI: mmsi, latitude: 50, longitude: 0 });

  it("returns only vessels heard inside the TTL, and prunes the rest", () => {
    const now = 1_800_000_000_000;
    const heard = new Map([
      [1, { vessel: v(1), heardAt: now - 60_000 }],
      [2, { vessel: v(2), heardAt: now - VESSEL_TTL_MS - 1 }],
    ]);
    expect(liveVessels(heard, now).map((x) => x.MMSI)).toEqual([1]);
    pruneHeard(heard, now);
    expect([...heard.keys()]).toEqual([1]);
  });
});

describe("reconnectDelay", () => {
  it("backs off from about 2 s and never passes about 5 min", () => {
    expect(reconnectDelay(0, 0.5)).toBe(2000);
    expect(reconnectDelay(3, 0.5)).toBe(16_000);
    expect(reconnectDelay(50, 1)).toBeLessThanOrEqual(5 * 60_000 * 1.25);
    expect(reconnectDelay(0, 0)).toBeLessThan(reconnectDelay(0, 1));
  });
});

describe("snapshotRule", () => {
  it("says the map is still filling for the first minutes after the stream opens", () => {
    const now = 1_800_000_000_000;
    expect(snapshotRule(now - 10_000, now)).toMatch(/still filling/);
    expect(snapshotRule(now - WARM_MS - 1, now)).toMatch(/last 20 min/);
  });
});
