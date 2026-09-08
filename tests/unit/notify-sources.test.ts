import { describe, it, expect } from "vitest";
import { toObservedRow, armableSources, triggersFor } from "@/lib/notify/sources";
import { SIGNALS } from "@/lib/signals/registry";
import type { SignalFeature } from "@/lib/signals/types";

const feature = (over: Partial<SignalFeature> = {}): SignalFeature => ({
  id: "usgs:nc1", lat: 35.6, lon: -117.6, title: "M5.4 — Ridgecrest",
  signalId: "earthquakes", props: { magnitude: 5.4 }, ...over,
});

describe("toObservedRow", () => {
  it("carries the anchor and the title through unchanged", () => {
    const r = toObservedRow(feature());
    expect(r).toMatchObject({ id: "usgs:nc1", lat: 35.6, lon: -117.6, title: "M5.4 — Ridgecrest" });
  });

  it("reads the scalar from the field the SOURCE named, not a hardcoded one", () => {
    expect(toObservedRow(feature(), "magnitude").scalars).toEqual({ magnitude: 5.4 });
  });

  it("reads a non-magnitude metric field, because props.magnitude is overloaded across sources", () => {
    const f = feature({ props: { windKt: 92, magnitude: 3 } });
    expect(toObservedRow(f, "windKt").scalars).toEqual({ windKt: 92 });
  });

  it("carries NO scalars when the source declares no metric, so `crosses` has nothing to read and is honestly unavailable", () => {
    expect(toObservedRow(feature()).scalars).toEqual({});
  });

  it("omits a non-numeric or absent value rather than coercing it, because 0 is a level a rule can cross", () => {
    expect(toObservedRow(feature({ props: { magnitude: "5.4" } }), "magnitude").scalars).toEqual({});
    expect(toObservedRow(feature({ props: {} }), "magnitude").scalars).toEqual({});
    expect(toObservedRow(feature({ props: { magnitude: NaN } }), "magnitude").scalars).toEqual({});
  });

  it("passes a timestamp through as dueAt, and omits the key entirely when there is none", () => {
    expect(toObservedRow(feature({ ts: "2026-09-08T00:00:00Z" })).dueAt).toBe("2026-09-08T00:00:00Z");
    expect("dueAt" in toObservedRow(feature())).toBe(false);
  });
});

describe("armableSources", () => {
  it("offers every registered source, including the data-only one — not being a map layer does not make it unwatchable", () => {
    expect(armableSources()).toHaveLength(SIGNALS.length);
    expect(armableSources().some((s) => s.id === "instability")).toBe(true);
  });

  it("passes each source's REAL metric domain through, so the composer clamps to it instead of guessing", () => {
    const withMetric = SIGNALS.find((s) => s.metric);
    if (!withMetric) throw new Error("fixture assumption gone: no registered source declares a metric");
    const offered = armableSources().find((s) => s.id === withMetric.id);
    expect(offered?.metric).toEqual({
      field: withMetric.metric!.field,
      domain: withMetric.metric!.domain,
      unit: withMetric.metric!.unit,
    });
  });

  it("leaves `metric` absent for a source that declares none", () => {
    const without = SIGNALS.find((s) => !s.metric);
    if (!without) throw new Error("fixture assumption gone: every source declares a metric");
    expect(armableSources().find((s) => s.id === without.id)?.metric).toBeUndefined();
  });
});

describe("triggersFor — layer 3 has the last word", () => {
  it("offers NOTHING for OSM reference data, because a position and its tags carry no state to notice a change in", () => {
    for (const id of ["nuclear", "ports", "airports", "cables", "cable-landings"]) {
      expect(triggersFor(id), `${id} should back no trigger`).toEqual([]);
    }
  });

  it("still offers real triggers for the LIVE members of the same Infrastructure group, so the refusal is per source and not a group-wide blackout", () => {
    expect(triggersFor("grid-load").length).toBeGreaterThan(0);
    expect(triggersFor("internet-outages").length).toBeGreaterThan(0);
  });

  it("offers `crosses` only where the source declares a metric to compare", () => {
    expect(triggersFor("earthquakes")).toContain("crosses"); // declares one
    expect(triggersFor("launches")).not.toContain("crosses"); // declares none
  });

  it("returns nothing for an id no source carries, rather than a default set", () => {
    expect(triggersFor("not-a-source")).toEqual([]);
  });
});
