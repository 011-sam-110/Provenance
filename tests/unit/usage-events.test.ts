// The usage events. The privacy promise is that each one carries an enumerated value and
// never a place, a name or anything typed. These tests pin the allowlist per event and
// the slug rule that turns free text into a dropped event instead of a sent one.

import { afterEach, describe, expect, it, vi } from "vitest";
import { bindBeacon, eventProperties, track, type UsageEvent } from "@/lib/analytics/track";

afterEach(() => bindBeacon(null));

const ALLOWED: Record<UsageEvent["name"], string[]> = {
  object_opened: ["kind"],
  board_switched: ["board"],
  layer_toggled: ["layer"],
  share_link_copied: ["what"],
  alert_armed: [],
};

const SAMPLES: UsageEvent[] = [
  { name: "object_opened", kind: "camera" },
  { name: "board_switched", board: "streets" },
  { name: "board_switched", board: "custom" },
  { name: "layer_toggled", layer: "cable-landings" },
  { name: "share_link_copied", what: "view" },
  { name: "alert_armed" },
];

describe("usage event properties", () => {
  it.each(SAMPLES)("$name sends only its allowlisted keys", (e) => {
    const props = eventProperties(e);
    expect(props).not.toBeNull();
    expect(Object.keys(props!).sort()).toEqual([...ALLOWED[e.name]].sort());
  });

  it("drops anything that is not a short slug, so free text cannot ride along", () => {
    expect(eventProperties({ name: "layer_toggled", layer: "My house at 51.5,-0.1" })).toBeNull();
    expect(eventProperties({ name: "board_switched", board: "my secret board" })).toBeNull();
    expect(eventProperties({ name: "layer_toggled", layer: "a".repeat(41) })).toBeNull();
  });

  it("drops an object kind the world model does not have", () => {
    expect(eventProperties({ name: "object_opened", kind: "toString" as never })).toBeNull();
  });

  it("drops a share kind outside view and layout", () => {
    expect(eventProperties({ name: "share_link_copied", what: "email" as never })).toBeNull();
  });
});

describe("track", () => {
  it("does nothing before the beacon binds", () => {
    expect(() => track({ name: "alert_armed" })).not.toThrow();
  });

  it("captures through the bound client", () => {
    const capture = vi.fn();
    bindBeacon({ capture });
    track({ name: "object_opened", kind: "plane" });
    expect(capture).toHaveBeenCalledWith("object_opened", { kind: "plane" });
  });

  it("does not capture a dropped event", () => {
    const capture = vi.fn();
    bindBeacon({ capture });
    track({ name: "layer_toggled", layer: "Not A Slug" });
    expect(capture).not.toHaveBeenCalled();
  });

  it("stops when unbound", () => {
    const capture = vi.fn();
    bindBeacon({ capture });
    bindBeacon(null);
    track({ name: "alert_armed" });
    expect(capture).not.toHaveBeenCalled();
  });

  it("never lets a failing client break the app", () => {
    bindBeacon({
      capture: () => {
        throw new Error("blocked");
      },
    });
    expect(() => track({ name: "alert_armed" })).not.toThrow();
  });
});
