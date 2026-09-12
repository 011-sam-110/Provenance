import { describe, it, expect } from "vitest";
import { signalReadSucceeded } from "@/lib/console/signals/useSignalFeed";
import { diff, EMPTY_OBSERVATION } from "@/lib/notify/engine";
import type { AreaRule } from "@/lib/notify/types";

// Payload shapes are what production /api/signals/<id> returned on 2026-09-12.
describe("signalReadSucceeded — a 200 is not a successful read", () => {
  it("refuses a declared failure with nothing in it (reliefweb/grid-load \"no key\", fire-active \"http 400\")", () => {
    expect(signalReadSucceeded({ ok: false, degradedReason: "no key", count: 0 }, 0)).toBe(false);
  });

  it("refuses an undeclared outcome with nothing in it", () => {
    expect(signalReadSucceeded({ count: 0 }, 0)).toBe(false);
    expect(signalReadSucceeded(null, 0)).toBe(false);
  });

  it("accepts an upstream that answered, with or without rows", () => {
    expect(signalReadSucceeded({ ok: true, count: 0 }, 0)).toBe(true);
    expect(signalReadSucceeded({ ok: true, count: 12 }, 12)).toBe(true);
  });

  it("keeps a failure that still carries rows as it was, until partial/last-good has a state", () => {
    // gdacs: "partial: VO failed (http 404)" with 36 current events.
    expect(signalReadSucceeded({ ok: false, count: 36 }, 36)).toBe(true);
  });
});

describe("what that means for a `quiet` rule", () => {
  const RING: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const quiet: AreaRule = {
    id: "rule:q", areaId: "area:1", sourceId: "cyber-ransomware",
    params: { kind: "quiet", silentMs: 30 * 60_000 },
    channels: { browser: true, telegram: false, discord: false },
    enabled: true, createdAt: 0,
  };

  it("announces a source that last read 31 minutes ago and now answers {ok:false, count:0}", () => {
    const lastGood = 1_000;
    const now = lastGood + 31 * 60_000;
    const ok = signalReadSucceeded({ ok: false, degradedReason: "http 404", count: 0 }, 0);
    // readNotifyFeed passes `ok` through and uses updatedAt, which a failed read does not advance.
    const { events } = diff({ ...EMPTY_OBSERVATION, lastOk: lastGood }, [], RING, [quiet], { ok, lastOk: lastGood }, now);
    expect(events.map((e) => e.kind)).toEqual(["quiet"]);
  });
});
