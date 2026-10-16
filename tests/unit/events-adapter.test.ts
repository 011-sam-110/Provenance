import { describe, it, expect } from "vitest";
import type { SignalFeature } from "@/lib/signals/types";
import { EVENT_SOURCES } from "@/lib/events/sources";
import { toEvent, rankEvents } from "@/lib/events/adapter";

const QUAKE = EVENT_SOURCES.find((s) => s.id === "earthquakes")!;
const CYC = EVENT_SOURCES.find((s) => s.id === "tropical-cyclones")!;

const sf = (over: Partial<SignalFeature>): SignalFeature => ({
  id: "x", lat: 1, lon: 2, title: "T", signalId: "s", ...over,
});

describe("EVENT_SOURCES", () => {
  it("seeds the 3 curated event ids", () => {
    expect(EVENT_SOURCES.map((s) => s.id)).toEqual([
      "earthquakes", "gdacs", "tropical-cyclones",
    ]);
  });
});

describe("toEvent", () => {
  it("maps a quake feature into a NormalizedEvent with native M magnitude", () => {
    const e = toEvent(
      sf({ id: "usgs:1", title: "M5.8 - 9 km N of Anza, CA", lat: 33.6, lon: -116.7,
           ts: "2026-06-28T00:00:00Z", props: { magnitude: 5.8, place: "9 km N of Anza, CA" } }),
      QUAKE,
    );
    expect(e.type).toBe("quake");
    expect(e.place.name).toBe("9 km N of Anza, CA");
    expect(e.geo).toEqual({ lat: 33.6, lon: -116.7, precision: "EXACT" });
    expect(e.occurredAt).toBe("2026-06-28T00:00:00Z");
    expect(e.severity.tier).toBe("S2");      // 5.8 → S2
    expect(e.severity.raw).toBe(5.8);
    expect(e.magnitude).toEqual({ value: 5.8, unit: "M" });
    expect(e.source.attribution).toBe("USGS, EMSC and national seismic agencies");
  });

  it("omits native magnitude for a source with no known unit (no MW mislabel)", () => {
    const e = toEvent(sf({ title: "Tropical Storm Alpha", props: { magnitude: 7 } }), CYC);
    expect(e.type).toBe("cyclone");
    expect(e.magnitude).toBeUndefined();     // CYC has no magnitudeUnit
    expect(e.severity.tier).toBe("S3");      // 7 → S3
  });

  it("treats a missing magnitude as 0 / S0 and a missing ts as null", () => {
    const e = toEvent(sf({ title: "Quiet" }), QUAKE);
    expect(e.severity.raw).toBe(0);
    expect(e.severity.tier).toBe("S0");
    expect(e.occurredAt).toBeNull();
  });
});

describe("rankEvents", () => {
  it("sorts by severity tier desc, then newest-first", () => {
    const rows = rankEvents([
      toEvent(sf({ id: "a", ts: "2026-06-27T00:00:00Z", props: { magnitude: 5 } }), QUAKE),
      toEvent(sf({ id: "b", ts: "2026-06-26T00:00:00Z", props: { magnitude: 8 } }), QUAKE),
      toEvent(sf({ id: "c", ts: "2026-06-28T00:00:00Z", props: { magnitude: 8 } }), QUAKE),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["c", "b", "a"]); // S4 newest, S4 older, then S2
  });
  it("orders undated events after dated ones of the same tier", () => {
    const rows = rankEvents([
      toEvent(sf({ id: "undated", props: { magnitude: 5 } }), QUAKE),
      toEvent(sf({ id: "dated", ts: "2026-06-28T00:00:00Z", props: { magnitude: 5 } }), QUAKE),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["dated", "undated"]);
  });
});
