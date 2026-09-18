import { describe, it, expect } from "vitest";
import { needsKeyNote } from "@/lib/console/widgets/signals.detail";
import type { CapabilityState } from "@/lib/sources/keyRequirements";

// Regression for widget-inventory finding W7 (2026-09-12, `.claude/local/WIDGETS_INVENTARIO.md`):
// the detail panel's footer note ("needs an API key") was gated on a hand-maintained id set
// that had drifted from the real registry ids. Measured against the live table in
// lib/sources/keyRequirements.ts: the old set was `["acled", "firms", "aisstream", "openaq",
// "reliefweb", "entsoe"]`. Only "reliefweb" matched a real signal id. "acled" named a layer
// removed on 2026-09-05; "firms", "aisstream" and "openaq" were upstream/vendor names, not
// the registry ids (fire-active, ais, air-quality-stations); "entsoe" should have been
// grid-load. So a locked fire-active, ais, air-quality-stations or grid-load could sit empty
// with no explanation. `needsKeyNote` fixes the class of bug by reading the live capability
// status (the same one the rail badge and the widget body already use) instead of a second,
// hand-copied list of ids.

const OLD_KEYED = new Set(["acled", "firms", "aisstream", "openaq", "reliefweb", "entsoe"]);
const REAL_LOCKABLE_IDS = ["fire-active", "ais", "air-quality-stations", "grid-load", "reliefweb"];

const status = (state: CapabilityState) => ({ state });

describe("needsKeyNote", () => {
  it("shows the note when the live status says locked", () => {
    expect(needsKeyNote(status("locked"))).toBe(true);
  });

  it.each(["keyless", "configured", "refused", "upgradable", "enhanced"] as CapabilityState[])(
    "stays silent for '%s' — only a genuinely locked layer gets the note",
    (state) => {
      expect(needsKeyNote(status(state))).toBe(false);
    },
  );

  it("is silent while /api/status has not loaded yet", () => {
    expect(needsKeyNote(null)).toBe(false);
    expect(needsKeyNote(undefined)).toBe(false);
  });

  it("is id-agnostic by construction — the old bug cannot recur by id drift", () => {
    // Every real key-gated layer gets the same honest note once locked, regardless of
    // whether its id happens to be spelled like an old hand-copied list.
    for (const id of REAL_LOCKABLE_IDS) {
      expect(needsKeyNote(status("locked")), `id ${id} should show the note when locked`).toBe(true);
    }
  });

  it("documents which real ids the old hand-maintained set actually had wrong", () => {
    const wrong = REAL_LOCKABLE_IDS.filter((id) => !OLD_KEYED.has(id));
    expect(wrong.sort()).toEqual(["air-quality-stations", "ais", "fire-active", "grid-load"]);
    // The one id the old set happened to spell correctly.
    expect(OLD_KEYED.has("reliefweb")).toBe(true);
  });
});
