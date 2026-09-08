import { describe, it, expect } from "vitest";
import { resolveTriggers } from "@/lib/notify/capability";
import type { TriggerCapability } from "@/lib/notify/types";

describe("resolveTriggers", () => {
  it("gives a source its group's kinds when it declares nothing, so a new adapter is armable with no notification code", () => {
    expect(resolveTriggers("Natural hazards", undefined).sort()).toEqual(
      ["appears", "count", "crosses", "quiet"].sort(),
    );
  });

  it("offers nothing for a group with no defaults, so an unknown group cannot silently inherit someone else's", () => {
    expect(resolveTriggers("Not a real group", undefined)).toEqual([]);
  });

  it("offers nothing at all for static infrastructure, because a port publishes no state to notice a change in", () => {
    expect(resolveTriggers("Static infrastructure", undefined)).toEqual([]);
  });

  it("implies `crosses` from a declared scalar even when the group never offered it", () => {
    const cap: TriggerCapability = {
      scalars: [{ field: "score", label: "score", domain: [0, 82] }],
    };
    expect(resolveTriggers("Synthesis", cap)).toContain("crosses");
  });

  it("implies `state` from a declared state field", () => {
    const cap: TriggerCapability = { state: { field: "status", values: ["Go", "Hold"] } };
    expect(resolveTriggers("Space", cap)).toContain("state");
  });

  it("implies `due` from a declared due field", () => {
    const cap: TriggerCapability = { due: { field: "launchTime" } };
    expect(resolveTriggers("Space", cap)).toContain("due");
  });

  it("adds a kind the group lacks", () => {
    expect(resolveTriggers("Natural hazards", { add: ["enters"] })).toContain("enters");
  });

  it("removes a kind the group wrongly claims", () => {
    expect(resolveTriggers("Natural hazards", { remove: ["appears"] })).not.toContain("appears");
  });

  it("lets `remove` beat an implied kind, so a source can declare a field for the audit and still refuse to be armed on it", () => {
    const cap: TriggerCapability = {
      state: { field: "status", values: ["Go"] },
      remove: ["state"],
    };
    expect(resolveTriggers("Space", cap)).not.toContain("state");
  });

  it("lets `remove` beat `add`, so one field cannot be both", () => {
    expect(resolveTriggers("Space", { add: ["enters"], remove: ["enters"] })).not.toContain("enters");
  });

  it("returns each kind once even when the group and a declaration both name it", () => {
    const got = resolveTriggers("Natural hazards", { add: ["appears"] });
    expect(got.filter((k) => k === "appears")).toHaveLength(1);
  });
});
