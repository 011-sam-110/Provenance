import { beforeEach, describe, expect, it } from "vitest";
import {
  applyViewSet,
  hasData,
  onIds,
  sameSources,
  sameViewSet,
  shouldOffer,
  sourceLine,
  viewSetFromWorld,
  worldFromViewSet,
  type ViewSet,
} from "@/lib/console/viewSources";
import { inspectorStore } from "@/lib/shell/inspector";
import { DEFAULT_STATE } from "@/lib/layers";

// A view's whole-map sources, and the one-time "Use same sources from <view>" offer.
// Node environment: the stores are module state, so each test starts by writing World.

const BORDERS_ONLY: ViewSet = {
  layers: { livecams: false, staticcams: false, satellites: false, planes: false, ships: false, weather: false, countries: true },
  signals: [],
};
const GLOBE_BUSY: ViewSet = {
  layers: { ...BORDERS_ONLY.layers, planes: true },
  signals: ["earthquakes", "wildfires"],
};
const STREETS: ViewSet = {
  layers: { ...BORDERS_ONLY.layers, livecams: true, staticcams: true },
  signals: [],
};

function setWorld(v: ViewSet) {
  inspectorStore.replaceWorldSources(worldFromViewSet(v));
}

describe("viewSetFromWorld", () => {
  it("floors a World that has never been written to the layer defaults", () => {
    const v = viewSetFromWorld({});
    expect(Object.keys(v.layers).sort()).toEqual(Object.keys(DEFAULT_STATE).sort());
    for (const [k, on] of Object.entries(DEFAULT_STATE)) expect(v.layers[k]).toBe(on);
    expect(v.signals).toEqual([]);
  });

  it("keeps a written layer and only the signals that are on", () => {
    const v = viewSetFromWorld({ planes: false, livecams: true, earthquakes: true, wildfires: false });
    expect(v.layers.planes).toBe(false);
    expect(v.layers.livecams).toBe(true);
    expect(v.signals).toEqual(["earthquakes"]);
  });

  it("lists signals in registry order, not the order they were switched on", () => {
    const a = viewSetFromWorld({ wildfires: true, earthquakes: true });
    const b = viewSetFromWorld({ earthquakes: true, wildfires: true });
    expect(a.signals).toEqual(b.signals);
  });

  it("ignores a key that is not a map signal", () => {
    expect(viewSetFromWorld({ "not-a-layer": true }).signals).toEqual([]);
  });
});

describe("sameViewSet", () => {
  it("is true for equal sets and ignores signal order", () => {
    expect(sameViewSet(GLOBE_BUSY, { ...GLOBE_BUSY, signals: ["wildfires", "earthquakes"] })).toBe(true);
  });
  it("sees a layer difference", () => {
    expect(sameViewSet(GLOBE_BUSY, { ...GLOBE_BUSY, layers: { ...GLOBE_BUSY.layers, planes: false } })).toBe(false);
  });
  it("sees a signal difference, in either direction", () => {
    expect(sameViewSet(GLOBE_BUSY, { ...GLOBE_BUSY, signals: ["earthquakes"] })).toBe(false);
    expect(sameViewSet({ ...GLOBE_BUSY, signals: ["earthquakes"] }, GLOBE_BUSY)).toBe(false);
  });
  it("reads a layer a set does not name as its default", () => {
    expect(sameViewSet({ layers: {}, signals: [] }, viewSetFromWorld({}))).toBe(true);
  });
  it("treats a missing set as equal only to a missing set", () => {
    expect(sameViewSet(null, undefined)).toBe(true);
    expect(sameViewSet(null, GLOBE_BUSY)).toBe(false);
    expect(sameViewSet(GLOBE_BUSY, undefined)).toBe(false);
  });
});

describe("hasData and onIds", () => {
  it("borders alone is nothing", () => {
    expect(hasData(BORDERS_ONLY)).toBe(false);
    expect(onIds(BORDERS_ONLY)).toEqual([]);
  });
  it("one layer, or one signal, is something", () => {
    expect(hasData(STREETS)).toBe(true);
    expect(hasData({ ...BORDERS_ONLY, signals: ["earthquakes"] })).toBe(true);
  });
  it("lists layers then signals and never Borders & names", () => {
    expect(onIds(GLOBE_BUSY)).toEqual(["planes", "earthquakes", "wildfires"]);
  });
});

describe("sourceLine", () => {
  it("names one source", () => {
    expect(sourceLine(["Planes"])).toBe("Planes");
  });
  it("names up to three", () => {
    expect(sourceLine(["Planes", "Earthquakes"])).toBe("Planes, Earthquakes");
    expect(sourceLine(["Planes", "Earthquakes", "Wildfires"])).toBe("Planes, Earthquakes, Wildfires");
  });
  it("counts the rest beyond three", () => {
    const seven = ["Planes", "Earthquakes", "Wildfires", "Storms", "Volcanoes", "Cables", "Ships"];
    expect(sourceLine(seven)).toBe("Planes, Earthquakes, Wildfires and 4 more");
    expect(sourceLine([...seven.slice(0, 4)])).toBe("Planes, Earthquakes, Wildfires and 1 more");
  });
});

describe("shouldOffer", () => {
  it("offers a different set that has data", () => {
    expect(shouldOffer(GLOBE_BUSY, STREETS)).toBe(true);
  });
  it("does not offer a set equal to this view's", () => {
    expect(shouldOffer(GLOBE_BUSY, GLOBE_BUSY)).toBe(false);
  });
  it("does not offer a view that has only Borders & names on (Leon OK'd this)", () => {
    expect(shouldOffer(BORDERS_ONLY, STREETS)).toBe(false);
  });
});

describe("applyViewSet", () => {
  it("makes World exactly the view's set, dropping what it did not have", () => {
    inspectorStore.replaceWorldSources({ ...worldFromViewSet(STREETS), cables: true });
    applyViewSet(GLOBE_BUSY);
    const w = inspectorStore.get().world;
    expect(viewSetFromWorld(w)).toEqual(GLOBE_BUSY);
    expect(w.cables).toBeUndefined();
  });
});

describe("the sameSources offer", () => {
  beforeEach(() => {
    sameSources.clear();
    setWorld(STREETS); // "here" is Streets
  });

  it("offers the view you left when it differs and has data", () => {
    sameSources.offer("overview", "streets", GLOBE_BUSY);
    const { offer, undo } = sameSources.get();
    expect(offer).toMatchObject({ here: "streets", from: "overview" });
    expect(undo).toBeNull();
  });

  it("makes no offer for a pair that does not qualify, and clears an older one", () => {
    sameSources.offer("overview", "streets", GLOBE_BUSY);
    expect(sameSources.get().offer).not.toBeNull();
    sameSources.offer("overview", "streets", BORDERS_ONLY);
    expect(sameSources.get().offer).toBeNull();
    sameSources.offer("overview", "streets", STREETS);
    expect(sameSources.get().offer).toBeNull();
  });

  it("copy: this view's World becomes an exact copy, and Undo takes the button's place", () => {
    sameSources.offer("overview", "streets", GLOBE_BUSY);
    sameSources.copy();
    expect(viewSetFromWorld(inspectorStore.get().world)).toEqual(GLOBE_BUSY);
    const { offer, undo } = sameSources.get();
    expect(offer).toBeNull();
    expect(undo).toMatchObject({ here: "streets", from: "overview" });
    expect(sameViewSet(undo!.previous, STREETS)).toBe(true);
  });

  it("copy does nothing without an offer", () => {
    const before = inspectorStore.get().world;
    sameSources.copy();
    expect(inspectorStore.get().world).toBe(before);
  });

  it("undo: this view's own set comes back, and so does the button", () => {
    sameSources.offer("overview", "streets", GLOBE_BUSY);
    sameSources.copy();
    sameSources.undo();
    expect(viewSetFromWorld(inspectorStore.get().world)).toEqual(STREETS);
    const { offer, undo } = sameSources.get();
    expect(undo).toBeNull();
    expect(offer).toMatchObject({ here: "streets", from: "overview" });
  });

  it("the offer survives the copy-undo round trip being pressed again", () => {
    sameSources.offer("overview", "streets", GLOBE_BUSY);
    sameSources.copy();
    sameSources.undo();
    sameSources.copy();
    expect(viewSetFromWorld(inspectorStore.get().world)).toEqual(GLOBE_BUSY);
    expect(sameSources.get().undo).not.toBeNull();
  });

  it("dismiss hides the button and leaves World alone", () => {
    sameSources.offer("overview", "streets", GLOBE_BUSY);
    const world = inspectorStore.get().world;
    sameSources.dismiss();
    expect(sameSources.get().offer).toBeNull();
    expect(inspectorStore.get().world).toBe(world);
  });

  it("any source change in this view clears the offer", () => {
    sameSources.offer("overview", "streets", GLOBE_BUSY);
    inspectorStore.setSource("planes", true);
    expect(sameSources.get().offer).toBeNull();
  });

  it("any source change clears the Undo note too", () => {
    sameSources.offer("overview", "streets", GLOBE_BUSY);
    sameSources.copy();
    expect(sameSources.get().undo).not.toBeNull();
    inspectorStore.setSource("volcanoes", true);
    expect(sameSources.get().undo).toBeNull();
  });

  it("an area edit does not change World, so it leaves the offer", () => {
    sameSources.offer("overview", "streets", GLOBE_BUSY);
    const id = inspectorStore.add(
      [[0, 0], [0, 1], [1, 1], [1, 0]],
      "Test area",
    );
    expect(id).not.toBeNull();
    expect(sameSources.get().offer).not.toBeNull();
    inspectorStore.remove(id!);
  });

  it("closeUndo drops the note and keeps nothing else", () => {
    sameSources.offer("overview", "streets", GLOBE_BUSY);
    sameSources.copy();
    sameSources.closeUndo();
    expect(sameSources.get()).toMatchObject({ offer: null, undo: null });
  });

  it("clear drops both", () => {
    sameSources.offer("overview", "streets", GLOBE_BUSY);
    sameSources.clear();
    expect(sameSources.get()).toMatchObject({ offer: null, undo: null });
  });
});
