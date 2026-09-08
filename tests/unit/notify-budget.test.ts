import { describe, it, expect } from "vitest";
import { applyBudget, MAX_PER_AREA_HOUR, WINDOW_MS } from "@/lib/notify/budget";
import type { NotifyEvent } from "@/lib/notify/types";

const events = (n: number, at = 1_000): NotifyEvent[] =>
  Array.from({ length: n }, (_, i) => ({
    ruleId: "rule:1", areaId: "area:1", sourceId: "earthquakes",
    kind: "appears" as const, rowId: `r${i}`, text: `t${i}`, at,
  }));

describe("applyBudget", () => {
  it("sends everything under the ceiling", () => {
    const { send, held } = applyBudget(events(5), [], 1_000);
    expect(send).toHaveLength(5);
    expect(held).toBe(0);
  });

  it("sends up to the ceiling and holds the rest", () => {
    const { send, held } = applyBudget(events(MAX_PER_AREA_HOUR + 6), [], 1_000);
    expect(send).toHaveLength(MAX_PER_AREA_HOUR);
    expect(held).toBe(6);
  });

  it("counts sends already made inside the window", () => {
    const already = Array.from({ length: MAX_PER_AREA_HOUR - 2 }, () => 900);
    const { send, held } = applyBudget(events(5), already, 1_000);
    expect(send).toHaveLength(2);
    expect(held).toBe(3);
  });

  it("forgets sends that fell out of the rolling window, so the ceiling is per hour and not for ever", () => {
    const old = Array.from({ length: MAX_PER_AREA_HOUR }, () => 1_000);
    const { send } = applyBudget(events(3), old, 1_000 + WINDOW_MS + 1);
    expect(send).toHaveLength(3);
  });

  it("RETURNS A CLOSING LINE naming how many were held, because suppression nobody was told about is the worst outcome available", () => {
    const { closing } = applyBudget(events(MAX_PER_AREA_HOUR + 6), [], 1_000);
    expect(closing).toContain("6");
    expect(closing).toMatch(/held/i);
  });

  it("returns no closing line when nothing was held", () => {
    expect(applyBudget(events(2), [], 1_000).closing).toBeNull();
  });

  it("records the timestamps of what it actually sent, so the next call's window is right", () => {
    const { nextSent } = applyBudget(events(3, 1_234), [], 1_234);
    expect(nextSent.filter((t) => t === 1_234)).toHaveLength(3);
  });

  it("does not let the closing line itself consume budget, or a storm would silence its own warning", () => {
    const { send, nextSent } = applyBudget(events(MAX_PER_AREA_HOUR + 6), [], 1_000);
    expect(nextSent).toHaveLength(send.length);
  });
});

describe("applyBudget — G4 reaches the closing line too", () => {
  it("names the area by its LABEL, because this is the one message wording.ts does not build and an area id is not a place name", () => {
    const { closing } = applyBudget(events(MAX_PER_AREA_HOUR + 1), [], 1_000, "Soho");
    expect(closing).toContain("Soho");
    expect(closing).not.toContain("area:1");
  });
});
