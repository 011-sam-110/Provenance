import { describe, it, expect } from "vitest";
import { variantStore, resolveVariant } from "@/lib/variants/store";
import { layersStore } from "@/lib/layers";
import { signalsStore } from "@/lib/signals/store";
import { inspectorStore } from "@/lib/shell/inspector";
import { activePresetStore } from "@/lib/console/activePreset";

// Node env: persist.ts no-ops without window.localStorage, so each bootstrap
// starts from defaults — no reset hook needed.
describe("variantStore", () => {
  it("bootstraps the default explore variant when no URL/persisted state", () => {
    variantStore.bootstrap(new URLSearchParams(""));
    expect(variantStore.get().activeId).toBe("explore");
    expect(layersStore.get().livecams).toBe(true);
    expect(layersStore.get().satellites).toBe(false);
  });
  // A legacy /app?v=cyber link opens the default board. `?v=` stopped being a deep
  // link when reading it on the server turned the console into a per-request render
  // — see lib/share/url.ts. It is ignored rather than redirected away, because Next
  // spreads the incoming query into a redirect destination, so /app?v=x -> /app would
  // re-emit ?v=x and loop.
  it("ignores a legacy URL v=", () => {
    variantStore.bootstrap(new URLSearchParams("v=cyber"));
    expect(variantStore.get().activeId).toBe("explore");
  });
  it("still seeds signal divergence from the URL", () => {
    variantStore.bootstrap(new URLSearchParams("sig=cyber-ransomware"));
    expect(signalsStore.isOn("cyber-ransomware")).toBe(true);
  });
  // The fallback used to be reachable through `?v=does-not-exist`. With the board out
  // of the URL, PERSISTED state is the only way to hold an id that no longer resolves
  // — a board removed in a release, or a user variant deleted on another tab — so
  // that is what this stubs. `setActive` cannot produce one: it stores the RESOLVED
  // id, so it can only ever write a valid one.
  it("falls back to explore for an unresolvable persisted variant id", () => {
    const store = new Map<string, string>([
      ["tn.variant.v1", JSON.stringify({ v: 1, d: { activeId: "deleted-board" } })],
    ]);
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    };
    try {
      variantStore.bootstrap(new URLSearchParams(""));
      expect(variantStore.get().activeId).toBe("explore");
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }
  });
  it("resolveVariant returns a builtin by id", () => {
    expect(resolveVariant("intel").title).toBe("Intel");
  });
});

describe("override capture", () => {
  it("a real user toggle is captured as an override", () => {
    // explore preset has livecams: true — setting it false is a genuine divergence
    variantStore.bootstrap(new URLSearchParams("v=explore"));
    layersStore.set("livecams", false);
    const overrides = variantStore.get().overrides;
    expect(overrides["explore"]).toBeDefined();
    expect(overrides["explore"]!.layers?.livecams).toBe(false);
  });

  it("resetToVariant clears the override and re-seeds the preset", () => {
    // state carries explore + livecams:false override from the previous test
    variantStore.resetToVariant();
    expect(variantStore.get().overrides["explore"]).toBeUndefined();
    expect(layersStore.get().livecams).toBe(true);
  });

  it("an override is preserved per-variant across switching", () => {
    // fresh known state: explore with livecams:true
    variantStore.bootstrap(new URLSearchParams("v=explore"));
    // diverge from explore's livecams:true
    layersStore.set("livecams", false);
    expect(variantStore.get().overrides["explore"]).toBeDefined();
    // switch away to aviation (livecams:false in its preset) then back
    variantStore.setActive("aviation");
    variantStore.setActive("explore");
    // override must survive the round-trip AND be re-applied to the live store
    expect(variantStore.get().overrides["explore"]).toBeDefined();
    expect(variantStore.get().overrides["explore"]!.layers?.livecams).toBe(false);
    expect(layersStore.get().livecams).toBe(false);
  });
});

// ── Each view's own sources: the `views` field of tn.variant.v1 ───────────────────

function withStorage(seed: Record<string, unknown>, run: (store: Map<string, string>) => void) {
  const store = new Map<string, string>(Object.entries(seed).map(([k, d]) => [k, JSON.stringify({ v: 1, d })]));
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  };
  try {
    run(store);
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
}

// A saved, empty variant record. Without one, bootstrap keeps whatever the previous test
// left in module state, which is how the older tests above chain on each other.
const EMPTY_SAVED = { "tn.variant.v1": { activeId: "explore", userVariants: [], overrides: {}, layoutOverrides: {}, views: {} } };

const FULL_OFF = { livecams: false, staticcams: false, satellites: false, planes: false, ships: false, weather: false, countries: true };

describe("views: migration and bootstrap", () => {
  it("expands retired layer keys and signal ids inside a saved view", () => {
    withStorage(
      {
        "tn.variant.v1": {
          activeId: "explore", userVariants: [], overrides: {}, layoutOverrides: {},
          // `cameras` was the old road-camera key (now both camera tiers); `emsc-quakes`
          // is a retired signal id that became `earthquakes`.
          views: { streets: { layers: { cameras: true, planes: false }, signals: ["emsc-quakes"] } },
        },
      },
      () => {
        variantStore.bootstrap(new URLSearchParams(""), "streets");
        const v = variantStore.viewSet("streets")!;
        expect(v.layers.livecams).toBe(true);
        expect(v.layers.staticcams).toBe(true);
        expect(v.layers.planes).toBe(false);
        expect(v.signals).toEqual(["earthquakes"]);
        expect("cameras" in v.layers).toBe(false);
      },
    );
  });

  it("drops a malformed view and keeps the good ones", () => {
    withStorage(
      {
        "tn.variant.v1": {
          activeId: "explore", userVariants: [], overrides: {}, layoutOverrides: {},
          views: {
            good: { layers: FULL_OFF, signals: ["earthquakes"] },
            notAnObject: "streets",
            noLayers: { signals: [] },
            layersAnArray: { layers: [true], signals: [] },
            signalsNotAList: { layers: FULL_OFF, signals: "earthquakes" },
            signalsNotStrings: { layers: FULL_OFF, signals: [1, 2] },
            nothing: null,
          },
        },
      },
      () => {
        variantStore.bootstrap(new URLSearchParams(""), null);
        expect(Object.keys(variantStore.get().views ?? {})).toEqual(["good"]);
      },
    );
  });

  it("applies the board's own view on boot, not the variant's delta", () => {
    withStorage(
      {
        "tn.variant.v1": {
          activeId: "explore", userVariants: [], layoutOverrides: {},
          overrides: { explore: { layers: { planes: false }, signals: { volcanoes: true } } },
          views: { streets: { layers: { ...FULL_OFF, livecams: true }, signals: ["wildfires"] } },
        },
      },
      () => {
        variantStore.bootstrap(new URLSearchParams(""), "streets");
        const w = inspectorStore.get().world;
        expect(w.livecams).toBe(true);
        expect(w.wildfires).toBe(true);
        expect(w.volcanoes).not.toBe(true);
        expect(w.planes).toBe(false);
      },
    );
  });

  it("lets a link's ?sig= replace the view's signals exactly", () => {
    withStorage(
      {
        "tn.variant.v1": {
          activeId: "explore", userVariants: [], overrides: {}, layoutOverrides: {},
          views: { streets: { layers: { ...FULL_OFF, livecams: true }, signals: ["wildfires"] } },
        },
      },
      () => {
        variantStore.bootstrap(new URLSearchParams("sig=earthquakes"), "streets");
        const w = inspectorStore.get().world;
        expect(w.earthquakes).toBe(true);
        expect(w.wildfires).not.toBe(true);
        expect(w.livecams).toBe(true);
      },
    );
  });
});

describe("views: capture", () => {
  it("files World's set under the open board once bootDone has run, not before", () => {
    withStorage(EMPTY_SAVED, (store) => {
      activePresetStore.set("streets");
      variantStore.bootstrap(new URLSearchParams(""), null);
      layersStore.set("planes", true); // before bootDone: not filed
      expect(variantStore.viewSet("streets")).toBeNull();
      variantStore.bootDone();
      expect(variantStore.viewSet("streets")?.layers.planes).toBe(true);
      layersStore.set("planes", false);
      expect(variantStore.viewSet("streets")?.layers.planes).toBe(false);
      expect(JSON.parse(store.get("tn.variant.v1")!).d.views.streets.layers.planes).toBe(false);
    });
  });

  it("reads WORLD, whichever context the Sources rail is pointed at", () => {
    withStorage(EMPTY_SAVED, () => {
      activePresetStore.set("streets");
      variantStore.bootstrap(new URLSearchParams(""), null);
      variantStore.bootDone();
      signalsStore.set("volcanoes", true); // World
      const id = inspectorStore.add([[0, 0], [0, 1], [1, 1], [1, 0]], "Box")!;
      inspectorStore.edit(id);
      signalsStore.set("wildfires", true); // lands on the AREA
      layersStore.set("planes", false); // also the area
      // The view is World's set, unchanged by what happened inside the area.
      const v = variantStore.viewSet("streets")!;
      expect(v.signals).toEqual(["volcanoes"]);
      expect(v.layers.planes).toBe(true);
      inspectorStore.edit(null);
      inspectorStore.remove(id);
    });
  });

  it("forgetView drops one view and leaves the rest", () => {
    withStorage(EMPTY_SAVED, () => {
      activePresetStore.set("streets");
      variantStore.bootstrap(new URLSearchParams(""), null);
      variantStore.bootDone();
      activePresetStore.set("news");
      layersStore.set("planes", false);
      expect(variantStore.viewSet("news")).not.toBeNull();
      variantStore.forgetView("streets");
      expect(variantStore.viewSet("streets")).toBeNull();
      expect(variantStore.viewSet("news")).not.toBeNull();
    });
  });
});
