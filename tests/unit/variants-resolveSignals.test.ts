import { describe, it, expect } from "vitest";
import { resolveSignals } from "@/lib/variants/resolveSignals";
import { MAP_SIGNALS, DATA_ONLY_SIGNAL_IDS } from "@/lib/signals/registry";

describe("resolveSignals", () => {
  it("returns {} for no selection", () => {
    expect(resolveSignals(undefined)).toEqual({});
  });
  it("'*' selects every MAP id as true, and cannot reach a data-only source", () => {
    const r = resolveSignals({ groups: ["*"] });
    expect(Object.keys(r).length).toBe(MAP_SIGNALS.length);
    expect(Object.values(r).every((v) => v === true)).toBe(true);
    // "*" is the widest selector a variant can write. If it could switch on a data-only
    // source, "not a map layer" would last exactly until someone picked that variant.
    for (const id of DATA_ONLY_SIGNAL_IDS) expect(r[id]).toBeUndefined();
  });
  it("selects a group by name", () => {
    const r = resolveSignals({ groups: ["Cyber threat"] });
    expect(r["cyber-c2"]).toBe(true);
    expect(r["cyber-ransomware"]).toBe(true);
    expect(r["earthquakes"]).toBeUndefined();
  });
  it("unions ids with groups then applies exclude", () => {
    const r = resolveSignals({ groups: ["Cyber threat"], ids: ["internet-outages"], exclude: ["cyber-c2"] });
    expect(r["internet-outages"]).toBe(true);
    expect(r["cyber-ransomware"]).toBe(true);
    expect(r["cyber-c2"]).toBeUndefined();
  });
});
