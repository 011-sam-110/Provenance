import { describe, it, expect } from "vitest";
import { PERSISTENT_PANELS, persistentPanelsFor } from "@/lib/shell/panelRegistry";
import { BUILTIN_VARIANTS } from "@/lib/variants/builtins";

// The rail spent the whole console era registered but unmounted. These lock in the
// two facts that made it invisible: it must be in the persistent set, and every
// built-in variant must actually ask for it.
describe("persistentPanelsFor", () => {
  it("keeps the layer rail as persistent chrome", () => {
    expect(PERSISTENT_PANELS).toContain("layerRail");
  });

  it("returns only visible persistent panels, in PERSISTENT_PANELS order", () => {
    expect(persistentPanelsFor([{ panel: "layerRail", visible: true }])).toEqual(["layerRail"]);
    expect(persistentPanelsFor([{ panel: "layerRail", visible: false }])).toEqual([]);
  });

  it("ignores dockable panels — they are the workspace's job, not the chrome's", () => {
    expect(
      persistentPanelsFor([
        { panel: "markets", visible: true },
        { panel: "coverage", visible: true },
        { panel: "layerRail", visible: true },
      ]),
    ).toEqual(["layerRail"]);
  });

  it("excludes the fixed-footer tickers the console's bottom dock would collide with", () => {
    expect(
      persistentPanelsFor([
        { panel: "freshness", visible: true },
        { panel: "news", visible: true },
      ]),
    ).toEqual([]);
  });

  it("mounts the rail for every built-in variant", () => {
    for (const v of BUILTIN_VARIANTS) {
      expect(persistentPanelsFor(v.panels), `variant "${v.id}" has no layer rail`).toEqual(["layerRail"]);
    }
  });
});
