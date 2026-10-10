import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  FILL,
  SHRINK_EASE,
  SPHERE_CAP,
  fillTimes,
  layoutTiles,
  logLerp,
} from "@/lib/marketing/cameraSphere";
import { SPHERE_STILLS } from "@/lib/marketing/sphere-stills.data";

describe("camera sphere timing", () => {
  it("lights screen 1 at 0 s, screen 2 at 0.5 s and screen 3 at 0.875 s", () => {
    const t = fillTimes(4);
    expect(t[0]).toBe(0);
    expect(t[1]).toBeCloseTo(0.5, 9);
    expect(t[2]).toBeCloseTo(0.875, 9);
    expect(t[3]).toBeCloseTo(0.875 + 0.375 * 0.85, 9);
  });

  it("never lets a gap fall under the floor", () => {
    const t = fillTimes(200);
    for (let i = 3; i < t.length; i++) expect(t[i] - t[i - 1]).toBeGreaterThanOrEqual(FILL.floor - 1e-9);
  });

  it("eases from 0 to 1 and shrinks on a log scale", () => {
    expect(SHRINK_EASE(0)).toBeCloseTo(0, 6);
    expect(SHRINK_EASE(1)).toBeCloseTo(1, 6);
    expect(logLerp(900, 30, 0.5)).toBeCloseTo(Math.sqrt(900 * 30), 6);
  });
});

describe("camera sphere layout", () => {
  it("puts the first screen dead centre and fills outwards", () => {
    const tiles = layoutTiles({ stillCount: 35 });
    expect(tiles[0].lat).toBe(0);
    expect(tiles[0].lon).toBe(0);
    for (let i = 1; i < tiles.length; i++) expect(tiles[i].t0).toBeGreaterThanOrEqual(tiles[i - 1].t0);
  });

  it("covers only the visible half on the front layout", () => {
    for (const t of layoutTiles({ stillCount: 35 })) expect(t.ang).toBeLessThanOrEqual(SPHERE_CAP + 17 * 0.7 + 1e-9);
  });

  it("closes every row of a full ball on itself, with no overlaps", () => {
    const tiles = layoutTiles({ stillCount: 35, coverage: "full" });
    const rows = new Map<number, number[]>();
    for (const t of tiles) rows.set(t.lat, [...(rows.get(t.lat) ?? []), t.lon]);
    for (const [lat, lons] of rows) {
      lons.sort((a, b) => a - b);
      const room = 17 * 1.125;
      for (let i = 1; i < lons.length; i++) {
        const arc = (lons[i] - lons[i - 1]) * Math.cos((lat * Math.PI) / 180);
        expect(arc).toBeGreaterThanOrEqual(room * Math.cos(((Math.abs(lat) + 6.4) * Math.PI) / 180) - 1e-6);
      }
    }
    expect(tiles.length).toBeGreaterThan(layoutTiles({ stillCount: 35 }).length);
  });

  it("is the same on every visit", () => {
    expect(layoutTiles({ stillCount: 35 })).toEqual(layoutTiles({ stillCount: 35 }));
  });
});

describe("camera sphere stills", () => {
  it("serves every listed still from this origin", () => {
    for (const s of SPHERE_STILLS) {
      expect(s.src.startsWith("/marketing/sphere/")).toBe(true);
      expect(existsSync(join(process.cwd(), "public", s.src))).toBe(true);
    }
  });
});
