import { describe, expect, it } from "vitest";
import { BASEMAPS } from "@/lib/basemaps";
import {
  RAIL_BASEMAP_LABEL,
  RAIL_GROUPS,
  mapRailStore,
  modeForStage,
  railBasemapKeys,
  railEdge,
  railHoldsOpen,
  railStep,
  stageForMode,
  toggleGroup,
} from "@/lib/console/mapRail";

// vitest here is node-environment and collects .ts only — there is no React
// testing library, so a component test is impossible. Everything the rail has to
// get right therefore lives in lib/console/mapRail.ts as a pure function, and
// this file is where those invariants are held.

describe("toggleGroup — one group open at a time", () => {
  it("opens from closed", () => {
    expect(toggleGroup(null, "view")).toBe("view");
  });

  it("closes when the open group is clicked again", () => {
    expect(toggleGroup("view", "view")).toBe(null);
  });

  it("replaces rather than stacking", () => {
    // The invariant that makes the rail a rail. Asserted over every ordered pair
    // rather than one example, so a future special case cannot slip through.
    for (const a of RAIL_GROUPS) {
      for (const b of RAIL_GROUPS) {
        if (a === b) continue;
        expect(toggleGroup(a, b)).toBe(b);
      }
    }
  });
});

describe("railStep / railEdge — roving tabindex arithmetic", () => {
  it("wraps forwards off the end", () => {
    expect(railStep("view", 1)).toBe("search");
  });

  it("wraps backwards off the start", () => {
    expect(railStep("search", -1)).toBe("view");
  });

  it("returns to where it started after a full lap in each direction", () => {
    for (const g of RAIL_GROUPS) {
      let f = g;
      let b = g;
      for (let i = 0; i < RAIL_GROUPS.length; i++) {
        f = railStep(f, 1);
        b = railStep(b, -1);
      }
      expect(f).toBe(g);
      expect(b).toBe(g);
    }
  });

  it("Home and End hit the real ends", () => {
    expect(railEdge("first")).toBe(RAIL_GROUPS[0]);
    expect(railEdge("last")).toBe(RAIL_GROUPS[RAIL_GROUPS.length - 1]);
  });
});

describe("railHoldsOpen — the outside-click guard", () => {
  // Draw and Cameras exist to make the user click ON THE MAP. Closing the flyout
  // on that click would take the vertex counter and Cancel with it, at the one
  // moment they are needed. This is that rule.
  it("holds the flyout open while a draw is running", () => {
    expect(railHoldsOpen(true, false)).toBe(true);
  });

  it("holds the flyout open while camera picking is armed", () => {
    expect(railHoldsOpen(false, true)).toBe(true);
  });

  it("closes normally when the map is not armed", () => {
    expect(railHoldsOpen(false, false)).toBe(false);
  });
});

describe("stageForMode / modeForStage", () => {
  it("round-trips both real modes", () => {
    expect(modeForStage(stageForMode("3d"))).toBe("3d");
    expect(modeForStage(stageForMode("2d"))).toBe("2d");
  });

  it("maps 3D to the globe stage and 2D to the flat one", () => {
    expect(stageForMode("3d")).toBe("map3d");
    expect(stageForMode("2d")).toBe("map2d");
  });

  it("returns null for the legacy clock stage rather than guessing", () => {
    expect(modeForStage("clock")).toBe(null);
  });
});

describe("RAIL_BASEMAP_LABEL", () => {
  // A drift guard. Adding a sixth basemap must fail HERE, loudly, rather than
  // rendering a chip with no label on the View strip.
  it("labels every registered basemap and invents none", () => {
    expect(Object.keys(RAIL_BASEMAP_LABEL).sort()).toEqual(Object.keys(BASEMAPS).sort());
  });

  it("gives every label a non-empty short form", () => {
    for (const k of railBasemapKeys()) {
      expect(RAIL_BASEMAP_LABEL[k].length).toBeGreaterThan(0);
    }
  });

  it("iterates in the registry's own order, which lib/basemaps.ts says is load-bearing", () => {
    expect(railBasemapKeys()).toEqual(Object.keys(BASEMAPS));
  });
});

describe("mapRailStore", () => {
  it("notifies on a real change", () => {
    mapRailStore.close();
    let hits = 0;
    const off = mapRailStore.subscribe(() => hits++);
    mapRailStore.open("draw");
    expect(hits).toBe(1);
    expect(mapRailStore.get()).toBe("draw");
    off();
    mapRailStore.close();
  });

  it("does not emit on a redundant close", () => {
    mapRailStore.close();
    let hits = 0;
    const off = mapRailStore.subscribe(() => hits++);
    mapRailStore.close();
    expect(hits).toBe(0);
    off();
  });

  it("toggle closes the group that is already open", () => {
    mapRailStore.open("cameras");
    mapRailStore.toggle("cameras");
    expect(mapRailStore.get()).toBe(null);
  });
});

describe("the basemap chips", () => {
  // THIS BLOCK USED TO GUARD A DARK/LIGHT PAIR BUTTON. Dark and Light shared one
  // chip so the strip stayed lateral, and the guard that mattered was that
  // collapsing them lost nothing — the pair plus the standalone chips had to account
  // for every registered basemap. Both of those basemaps have left the registry with
  // the console's dark skin, so there is no pair; what survives is the half of that
  // guard which still means something.
  it("every registered basemap gets a chip, and the strip invents none", () => {
    expect(railBasemapKeys().sort()).toEqual(Object.keys(BASEMAPS).sort());
  });

  it("no basemap the pair button used to hide is still in the registry", () => {
    // Pins the removal itself. `?base=dark` and `?base=positron` were published
    // values in shared links; they are meant to fail lib/share/url.ts's guard now and
    // fall back to the default, which only works while these two are genuinely gone.
    expect(Object.keys(BASEMAPS)).not.toContain("dark");
    expect(Object.keys(BASEMAPS)).not.toContain("positron");
  });
});
