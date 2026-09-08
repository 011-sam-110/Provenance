import { describe, it, expect } from "vitest";
import { SIGNALS } from "@/lib/signals/registry";
import { GROUP_TRIGGERS } from "@/lib/notify/groups";

// GROUP_TRIGGERS is keyed by `SignalSource.group`, a free-text string. Nothing in the
// type system ties the two together, so a group named here that no source carries is
// dead code, and a group a source carries that is missing here silently resolves to
// NOTHING — the source becomes unarmable with no error anywhere. Both directions have
// to be asserted, because each is invisible from the other side.

const groupsInUse = new Set(SIGNALS.map((s) => s.group));

describe("GROUP_TRIGGERS covers the registry", () => {
  it("names every group a registered source actually carries, or that source can be armed on nothing", () => {
    const missing = [...groupsInUse].filter((g) => !(g in GROUP_TRIGGERS)).sort();
    expect(missing, `groups with no entry: ${missing.join(", ")}`).toEqual([]);
  });

  it("names no group that no source carries, because a dead key reads as deliberate coverage", () => {
    const dead = Object.keys(GROUP_TRIGGERS).filter((g) => !groupsInUse.has(g)).sort();
    expect(dead, `keys matching no source: ${dead.join(", ")}`).toEqual([]);
  });
});
