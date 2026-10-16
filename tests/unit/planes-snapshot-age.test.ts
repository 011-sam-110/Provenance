/**
 * The planes freshness chip reads the age of the DATA, not of the poll.
 *
 * Until 2026-10-16 WorldMap stamped the "planes" freshness record every time the
 * 12 s poll returned, against a 12 s cadence, while the server re-pulled upstream
 * only every 240 s. Prod served snapshots up to 297 s old under a "live" chip. The
 * record is now stamped at the snapshot's own `fetchedAt`, against the 90 s window.
 */

import { describe, expect, it } from "vitest";
import { snapshotInstant } from "@/lib/planes/usePlanes";
import { classifyFreshness, type SourceRecord } from "@/lib/freshness";
import { getCatalogSource } from "@/lib/sources/catalog";

describe("snapshotInstant", () => {
  it("reads the absolute fetchedAt the /api/planes body carries", () => {
    expect(snapshotInstant({ fetchedAt: 1_792_180_000_000 })).toBe(1_792_180_000_000);
  });

  it("returns null when the body carries no usable instant, so the caller falls back to now", () => {
    expect(snapshotInstant({})).toBeNull();
    expect(snapshotInstant({ fetchedAt: "1792180000000" })).toBeNull();
    expect(snapshotInstant({ fetchedAt: 0 })).toBeNull();
    expect(snapshotInstant({ fetchedAt: Number.NaN })).toBeNull();
  });
});

describe("the planes chip cadence is the upstream window, not the client poll", () => {
  const NOW = 1_792_180_000_000;
  const rec = (ageMs: number): SourceRecord => ({
    id: "planes",
    label: "Planes",
    count: 3000,
    ok: true,
    lastUpdate: NOW - ageMs,
    refreshMs: getCatalogSource("planes")!.refreshMs,
    local: false,
  });

  it("declares 90 s in the catalog", () => {
    expect(getCatalogSource("planes")!.refreshMs).toBe(90_000);
  });

  it("calls a snapshot pulled 2 minutes ago live, and one pulled 10 minutes ago stale", () => {
    expect(classifyFreshness(rec(120_000), NOW)).toBe("live");
    expect(classifyFreshness(rec(10 * 60_000), NOW)).toBe("stale");
  });
});
