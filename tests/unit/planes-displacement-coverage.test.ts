import { describe, test, expect } from "vitest";
import type { WorldObject } from "@/lib/world";
import { capPlanes, toAircraftSnapshot, MAX_PLANES } from "@/lib/sources/opensky";
import { normalizeDisplacement, UNHCR_PAGE_LIMIT } from "@/lib/signals/displacement";
import { readCoverage, coverageCountLabel, coverageNote } from "@/lib/signals/coverage";

// ---------------------------------------------------------------------------
// Two layers were still publishing a truncation as if it were a measurement:
//
//   planes        a LOCAL render cap (MAX_PLANES = 3,000) over a whole-Earth
//                 snapshot of ~11.7k positioned aircraft — `{count: 3000}` was
//                 the cap, not the sky.
//   displacement  an UPSTREAM page limit (`?limit=1000`) we could saturate
//                 without noticing, in which case the country count is a lower
//                 bound and not a total.
//
// These tests pin the coverage record each one now declares.
// ---------------------------------------------------------------------------

const plane = (id: string, onGround: boolean): WorldObject => ({
  kind: "plane",
  id,
  lat: 0,
  lon: 0,
  altKm: 0,
  heading: 0,
  label: id,
  color: "#000",
  icon: "plane-airliner",
  typeLabel: "Airliner",
  meta: { onGround },
});

describe("capPlanes — the render cap is disclosed, not silent", () => {
  const fleet = (n: number, onGround = false) =>
    Array.from({ length: n }, (_, i) => plane(`p${i}`, onGround));

  test("declares what the cap hid, with an exact denominator", () => {
    const c = readCoverage(capPlanes(fleet(11705), MAX_PLANES))!;
    expect(c).toMatchObject({
      returned: 3000,
      available: 11705,
      capped: true,
      cap: 3000,
      noun: "aircraft",
    });
    // OpenSky's global endpoint takes no page limit, so the total is measured, not bounded.
    expect(c.availableExact).toBe(true);
    expect(c.upstreamLimit).toBeUndefined();
  });

  test("the count a UI prints carries its denominator", () => {
    const c = readCoverage(capPlanes(fleet(11705), MAX_PLANES));
    expect(coverageCountLabel(c)).toBe("3,000 of 11,705");
    expect(coverageNote(c)).toContain("a cap of 3,000 hides 8,705");
  });

  test("an under-cap snapshot is honestly reported as complete", () => {
    const c = readCoverage(capPlanes(fleet(120), MAX_PLANES))!;
    expect(c).toMatchObject({ returned: 120, available: 120, capped: false });
    expect(c.cap).toBeUndefined();
    expect(coverageCountLabel(c)).toBe("120");
    expect(coverageNote(c)).toBeUndefined();
  });

  test("still keeps airborne aircraft ahead of ground ones when the cap bites", () => {
    const objs = [plane("g1", true), plane("a1", false), plane("g2", true), plane("a2", false)];
    const capped = capPlanes(objs, 2);
    expect(capped).toHaveLength(2);
    expect(capped.every((o) => (o.meta as { onGround?: boolean }).onGround === false)).toBe(true);
  });

  test("does not mutate or annotate the caller's array", () => {
    const src = fleet(10);
    const out = capPlanes(src, 4);
    expect(src).toHaveLength(10);
    expect(readCoverage(src)).toBeUndefined();
    expect(out).toHaveLength(4);
  });
});

describe("toAircraftSnapshot — coverage survives the Data Cache round trip", () => {
  test("lifts the side-channel record into a real JSON field", () => {
    const capped = capPlanes(Array.from({ length: 9000 }, (_, i) => plane(`p${i}`, false)), MAX_PLANES);
    // The Data Cache stores JSON: a symbol-keyed property would be dropped here,
    // which is exactly how a capped payload used to arrive looking uncapped.
    const roundTripped = JSON.parse(JSON.stringify(toAircraftSnapshot(capped)));
    expect(roundTripped.planes).toHaveLength(3000);
    expect(roundTripped.coverage).toMatchObject({
      returned: 3000,
      available: 9000,
      capped: true,
      cap: 3000,
    });
  });

  test("omits coverage entirely when none was declared (never invents 'complete')", () => {
    expect(toAircraftSnapshot([]).coverage).toBeUndefined();
  });
});

describe("normalizeDisplacement — the UNHCR page limit is disclosed", () => {
  const row = (iso3: string, refugees: number) => ({
    coa_iso: iso3,
    coa_name: iso3,
    refugees,
    asylum_seekers: 0,
    idps: 0,
    year: 2025,
  });

  test("an unsaturated page is reported as complete", () => {
    const c = readCoverage(normalizeDisplacement([row("USA", 10), row("DEU", 20)]))!;
    expect(c).toMatchObject({
      returned: 2,
      available: 2,
      capped: false,
      availableExact: true,
    });
    expect(coverageNote(c)).toBeUndefined();
  });

  test("a saturated page makes the country count a LOWER BOUND", () => {
    const rows = [row("USA", 10), row("DEU", 20), row("FRA", 30)];
    const c = readCoverage(normalizeDisplacement(rows, 3))!;
    expect(c).toMatchObject({
      returned: 3,
      capped: true,
      availableExact: false,
      upstreamLimit: 3,
      noun: "countries of asylum",
    });
    expect(coverageCountLabel(c)).toBe("3 of 3+");
    expect(coverageNote(c)).toContain("the real total is higher and unknown");
  });

  test("rows dropped for having no centroid still count toward saturation", () => {
    // UNHCR pads the page with aggregate rows ("-", "UNK") that we cannot plot.
    // They are page rows upstream sent us, so they must not hide a saturated page.
    const rows = [row("USA", 10), row("-", 999), row("ZZZ", 999)];
    const c = readCoverage(normalizeDisplacement(rows, 3))!;
    expect(c.returned).toBe(1);
    expect(c.capped).toBe(true);
    expect(c.availableExact).toBe(false);
  });

  test("the declared page limit is the one the adapter actually requests", () => {
    expect(UNHCR_PAGE_LIMIT).toBe(1000);
  });
});
