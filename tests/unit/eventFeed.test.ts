import { describe, it, expect } from "vitest";
import type { SignalFeature } from "@/lib/signals/types";
import { EVENT_SOURCES } from "@/lib/events/sources";
import { projectEventFeed, type FeedFilters, type FeedInput } from "@/lib/widgets/eventFeed";
import { WORLD_SCOPE, type Scope } from "@/lib/shell/scope";
import { readEventFeed, mergeEventRound } from "@/lib/widgets/useEventFeeds";

// The events widget polls /api/signals/<id>, which answers 200 even when the upstream
// failed and says so in the body (`ok:false`). Until 2026-09-14 every 200 counted as a
// good read, so a declared failure with no rows replaced the last good rows with [] and
// advanced the freshness clock. Same rule as the signal cards (signalReadSucceeded, #230).
describe("useEventFeeds round", () => {
  const quake = sf({ id: "q1" });

  it("treats a 200 that declares failure with no rows as a failed read", () => {
    expect(readEventFeed("earthquakes", { ok: false, degradedReason: "http 404", count: 0, features: [] }).ok).toBe(false);
  });

  it("still counts a partial failure that serves rows (gdacs-style) as a read", () => {
    const r = readEventFeed("gdacs", { ok: false, degradedReason: "partial: VO failed (http 404)", features: [quake] });
    expect(r.ok).toBe(true);
    expect(r.features).toHaveLength(1);
  });

  it("counts a declared-ok empty answer as a read (quiet is a real answer)", () => {
    expect(readEventFeed("tropical-cyclones", { ok: true, count: 0, features: [] }).ok).toBe(true);
  });

  it("keeps the last good rows when a source declares failure", () => {
    const prev = { earthquakes: [quake] };
    const next = mergeEventRound(prev, [readEventFeed("earthquakes", { ok: false, count: 0, features: [] })]);
    expect(next.earthquakes).toEqual([quake]);
  });
});

const QUAKE = EVENT_SOURCES.find((s) => s.id === "earthquakes")!;
const sf = (over: Partial<SignalFeature>): SignalFeature => ({
  id: "x", lat: 1, lon: 2, title: "T", signalId: "s", ...over,
});
const NOW = Date.parse("2026-06-28T12:00:00Z");
const base: FeedFilters = { types: null, minTier: "S0", sort: "severity" };

const inputs = (feats: SignalFeature[]): FeedInput[] => [{ source: QUAKE, features: feats }];

describe("projectEventFeed", () => {
  it("ranks by severity×recency and reports total vs shown", () => {
    const r = projectEventFeed(inputs([
      sf({ id: "a", props: { magnitude: 5 }, ts: "2026-06-28T10:00:00Z" }),
      sf({ id: "b", props: { magnitude: 8 }, ts: "2026-06-28T09:00:00Z" }),
    ]), WORLD_SCOPE, null, NOW, base);
    expect(r.rows.map((x) => x.id)).toEqual(["b", "a"]);
    expect(r.total).toBe(2);
    expect(r.shown).toBe(2);
  });

  it("applies the severity floor", () => {
    const r = projectEventFeed(inputs([
      sf({ id: "lo", props: { magnitude: 1 } }),
      sf({ id: "hi", props: { magnitude: 9 } }),
    ]), WORLD_SCOPE, null, NOW, { ...base, minTier: "S3" });
    expect(r.rows.map((x) => x.id)).toEqual(["hi"]);
    expect(r.total).toBe(2);
    expect(r.shown).toBe(1);
  });

  it("filters by type", () => {
    const r = projectEventFeed(inputs([sf({ id: "q", props: { magnitude: 5 } })]),
      WORLD_SCOPE, null, NOW, { ...base, types: new Set(["fire"]) });
    expect(r.shown).toBe(0);
  });

  it("trims by scope radius", () => {
    const near: Scope = { mode: "region", center: { lat: 51.5, lon: -0.12 }, radiusKm: 50, label: "London" };
    const r = projectEventFeed(inputs([
      sf({ id: "in", lat: 51.51, lon: -0.13, props: { magnitude: 5 } }),
      sf({ id: "out", lat: 35, lon: 139, props: { magnitude: 5 } }),
    ]), near, null, NOW, base);
    expect(r.rows.map((x) => x.id)).toEqual(["in"]);
  });

  it("trims by the time window (old events drop, undated stay)", () => {
    const r = projectEventFeed(inputs([
      sf({ id: "fresh", props: { magnitude: 5 }, ts: "2026-06-28T11:30:00Z" }),
      sf({ id: "old", props: { magnitude: 5 }, ts: "2026-06-01T00:00:00Z" }),
      sf({ id: "undated", props: { magnitude: 5 } }),
    ]), WORLD_SCOPE, 60 * 60 * 1000, NOW, base);
    expect(r.rows.map((x) => x.id).sort()).toEqual(["fresh", "undated"]);
  });

  it("sort=nearest orders by distance to the scope centre", () => {
    const near: Scope = { mode: "region", center: { lat: 0, lon: 0 }, radiusKm: 100000, label: "x" };
    const r = projectEventFeed(inputs([
      sf({ id: "far", lat: 10, lon: 10, props: { magnitude: 9 } }),
      sf({ id: "close", lat: 1, lon: 1, props: { magnitude: 1 } }),
    ]), near, null, NOW, { ...base, sort: "nearest" });
    expect(r.rows.map((x) => x.id)).toEqual(["close", "far"]);
  });

  it("dedups events sharing an id (e.g. GDACS multi-episode updates)", () => {
    const r = projectEventFeed(inputs([
      sf({ id: "dup", props: { magnitude: 5 } }),
      sf({ id: "dup", props: { magnitude: 5 } }),
      sf({ id: "other", props: { magnitude: 6 } }),
    ]), WORLD_SCOPE, null, NOW, base);
    expect(r.rows.map((x) => x.id)).toEqual(["other", "dup"]);
    expect(r.total).toBe(2);
    expect(r.shown).toBe(2);
  });
});
