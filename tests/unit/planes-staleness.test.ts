/**
 * Unit tests for the aircraft-layer staleness gate (lib/sources/opensky.ts).
 *
 * Aircraft move, so a served-stale snapshot without its age would be a
 * fabrication ("live" positions that are actually old), and a snapshot old
 * enough isn't merely late — showing it draws ghosts, not traffic. These tests
 * pin the three-way honesty contract: fresh -> serve; stale-but-usable -> serve
 * WITH age; too old (or never fetched) -> do not serve.
 *
 * NO network calls — decideStaleness/gateSnapshot are pure functions of
 * (fetchedAt, now), never touching fetch/unstable_cache.
 */

import { describe, test, expect } from "vitest";
import {
  decideStaleness,
  gateSnapshot,
  FRESH_CEILING_MS,
  STALE_CEILING_MS,
  type AircraftSnapshot,
} from "@/lib/sources/opensky";
import type { WorldObject } from "@/lib/world";

const plane = (id: string): WorldObject => ({
  kind: "plane",
  id,
  lat: 51.5,
  lon: -0.1,
  altKm: 10,
  heading: 90,
  label: id,
  color: "#000",
  icon: "plane-airliner",
  typeLabel: "Airliner",
  meta: {},
});

describe("decideStaleness — fresh / stale-but-usable / too-old", () => {
  const NOW = 1_000_000_000_000; // fixed instant, arbitrary

  test("never fetched (undefined) → do not serve, distinct reason", () => {
    expect(decideStaleness(undefined, NOW)).toEqual({ serve: false, reason: "never-fetched" });
  });

  test("never fetched (null) → do not serve, distinct reason", () => {
    expect(decideStaleness(null, NOW)).toEqual({ serve: false, reason: "never-fetched" });
  });

  test("age 0 (just fetched) → fresh, serve with no caveat", () => {
    expect(decideStaleness(NOW, NOW)).toEqual({ serve: true, stale: false });
  });

  test("age exactly at the fresh ceiling → still fresh (inclusive boundary)", () => {
    const fetchedAt = NOW - FRESH_CEILING_MS;
    expect(decideStaleness(fetchedAt, NOW)).toEqual({ serve: true, stale: false });
  });

  test("age one ms past the fresh ceiling → stale-but-usable, carries age", () => {
    const fetchedAt = NOW - (FRESH_CEILING_MS + 1);
    const decision = decideStaleness(fetchedAt, NOW);
    expect(decision).toEqual({ serve: true, stale: true, ageMs: FRESH_CEILING_MS + 1 });
  });

  test("age exactly at the stale ceiling → still serve, disclosed (inclusive boundary)", () => {
    const fetchedAt = NOW - STALE_CEILING_MS;
    expect(decideStaleness(fetchedAt, NOW)).toEqual({ serve: true, stale: true, ageMs: STALE_CEILING_MS });
  });

  test("age one ms past the stale ceiling → too old, do not serve", () => {
    const fetchedAt = NOW - (STALE_CEILING_MS + 1);
    const decision = decideStaleness(fetchedAt, NOW);
    expect(decision).toEqual({ serve: false, reason: "too-old", ageMs: STALE_CEILING_MS + 1 });
  });

  test("wildly stale (hours old) → too old, do not serve", () => {
    const fetchedAt = NOW - 3 * 60 * 60 * 1000; // 3 hours
    const decision = decideStaleness(fetchedAt, NOW);
    expect(decision.serve).toBe(false);
    expect(decision).toMatchObject({ reason: "too-old" });
  });

  test("a fetchedAt from the future (clock skew) never produces a negative age", () => {
    const decision = decideStaleness(NOW + 60_000, NOW);
    expect(decision).toEqual({ serve: true, stale: false });
  });

  test("custom ceilings are honoured (not hardcoded to the module defaults)", () => {
    const fetchedAt = NOW - 5_000;
    expect(decideStaleness(fetchedAt, NOW, 1_000, 10_000)).toEqual({
      serve: true,
      stale: true,
      ageMs: 5_000,
    });
    expect(decideStaleness(fetchedAt, NOW, 1_000, 4_000)).toEqual({
      serve: false,
      reason: "too-old",
      ageMs: 5_000,
    });
  });
});

describe("gateSnapshot — applies the decision to a real snapshot", () => {
  const NOW = 1_000_000_000_000;

  test("fresh snapshot passes through unchanged, no staleness field", () => {
    const snapshot: AircraftSnapshot = { planes: [plane("a")], fetchedAt: NOW - 10_000 };
    const gated = gateSnapshot(snapshot, NOW);
    expect(gated.planes).toHaveLength(1);
    expect(gated.staleness).toBeUndefined();
  });

  test("stale-but-usable snapshot is served WITH its age, planes intact", () => {
    const fetchedAt = NOW - (FRESH_CEILING_MS + 60_000);
    const snapshot: AircraftSnapshot = { planes: [plane("a"), plane("b")], fetchedAt };
    const gated = gateSnapshot(snapshot, NOW);
    expect(gated.planes).toHaveLength(2);
    expect(gated.staleness).toEqual({ stale: true, ageMs: FRESH_CEILING_MS + 60_000 });
  });

  test("too-old snapshot is withheld — empty planes, reason disclosed, no coverage", () => {
    const fetchedAt = NOW - (STALE_CEILING_MS + 1);
    const snapshot: AircraftSnapshot = {
      planes: [plane("a"), plane("b"), plane("c")],
      coverage: { returned: 3, available: 3, availableExact: true, capped: false },
      fetchedAt,
    };
    const gated = gateSnapshot(snapshot, NOW);
    expect(gated.planes).toEqual([]);
    expect(gated.coverage).toBeUndefined();
    expect(gated.staleness).toEqual({ reason: "too-old", ageMs: STALE_CEILING_MS + 1 });
  });

  test("never-fetched snapshot (no fetchedAt) is withheld with no staleness noise", () => {
    const snapshot: AircraftSnapshot = { planes: [] };
    const gated = gateSnapshot(snapshot, NOW);
    expect(gated.planes).toEqual([]);
    expect(gated.staleness).toBeUndefined();
  });

  test("defaults `now` to the current clock when omitted", () => {
    const snapshot: AircraftSnapshot = { planes: [plane("a")], fetchedAt: Date.now() };
    const gated = gateSnapshot(snapshot);
    expect(gated.planes).toHaveLength(1);
    expect(gated.staleness).toBeUndefined();
  });
});
