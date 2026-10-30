import { describe, expect, it } from "vitest";
import { markSummary, readSummary } from "@/lib/signals/summary";
import { markOutcome, readOutcome } from "@/lib/signals/outcome";

describe("a layer summary rides on the feature array", () => {
  it("reads back what was attached", () => {
    const rows = markSummary([{ id: "a" }], { heldKm2: 117148 });
    expect(readSummary(rows)).toEqual({ heldKm2: 117148 });
  });

  it("is undefined when the adapter published none", () => {
    expect(readSummary([{ id: "a" }])).toBeUndefined();
    expect(readSummary(null)).toBeUndefined();
  });

  it("stays out of the JSON of the array itself and of each row", () => {
    const rows = markSummary([{ id: "a" }], { x: 1 });
    expect(JSON.stringify(rows)).toBe('[{"id":"a"}]');
  });

  it("does not disturb the outcome on the same array", () => {
    const rows = markOutcome(markSummary([{ id: "a" }], { x: 1 }), { ok: true, at: 5 });
    expect(readOutcome(rows)?.ok).toBe(true);
    expect(readSummary(rows)).toEqual({ x: 1 });
  });
});
