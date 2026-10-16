import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { variantStore } from "@/lib/variants/store";
import { inspectorStore } from "@/lib/shell/inspector";
import { shellLayoutStore } from "@/lib/console/store";
import { activePresetStore } from "@/lib/console/activePreset";
import { isFirstRun, seedBoard } from "@/lib/console/bootSeed";
import { composeViewState } from "@/lib/share/deepLink";
import { encodeViewState } from "@/lib/share/url";
import { MAP_SIGNALS } from "@/lib/signals/registry";

// ConsoleShell's boot, without React: someone opens a shared `/app?sig=` link in a
// browser that has never opened the console. That is the person a share link is for.
//
// Two defects met here. The first-run seed, applyPreset("overview"), wrote World's
// signal set AFTER variantStore.bootstrap had applied `sig`, so the shared layers came
// up off. Then composeViewState, which the URL writer calls on every store change,
// never wrote `sig`, so the address bar lost it too and a reload could not recover it.
//
// One boot per file on purpose: see boot-reload-keeps-signals.test.ts.

const stubMap = {
  getCenter: () => ({ lat: 1, lng: 2 }),
  getZoom: () => 3,
} as unknown as import("maplibre-gl").Map;

function fakeWindow(store: Map<string, string>) {
  return {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  };
}

describe("a ?sig= link opened on a first visit", () => {
  beforeAll(() => {
    (globalThis as { window?: unknown }).window = fakeWindow(new Map());
    const params = new URLSearchParams("sig=earthquakes,volcanoes");
    const restored = variantStore.bootstrap(params);
    inspectorStore.hydrate();
    shellLayoutStore.hydrate();
    activePresetStore.hydrate();
    seedBoard(params, isFirstRun({ restoredVariant: restored, activeBoard: activePresetStore.get() }));
  });

  afterAll(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("names two real map signals (a typo here would make every assertion below vacuous)", () => {
    const ids = new Set(MAP_SIGNALS.map((s) => s.id));
    expect(ids.has("earthquakes")).toBe(true);
    expect(ids.has("volcanoes")).toBe(true);
  });

  it("still seeds the default board, because this is a true first run", () => {
    expect(activePresetStore.get()).toBe("overview");
  });

  it("turns both shared layers on", () => {
    const world = inspectorStore.get().world;
    expect(world.earthquakes).toBe(true);
    expect(world.volcanoes).toBe(true);
  });

  it("keeps sig in the URL the writer composes", () => {
    const state = composeViewState(stubMap);
    expect(state.sig).toEqual(expect.arrayContaining(["earthquakes", "volcanoes"]));
    const qs = new URLSearchParams(encodeViewState(state));
    expect(qs.get("sig")?.split(",").sort()).toEqual(["earthquakes", "volcanoes"]);
  });

  it("composes World's set into sig, not a layer that is on only inside an area", () => {
    // An area's sources are per-browser. Writing them into sig would put a ring-scoped
    // source across the whole globe on the next boot, through variantStore's sig path.
    const id = inspectorStore.add([[36.0, 49.8], [36.5, 49.8], [36.5, 50.2], [36.0, 50.2]], "Kharkiv")!;
    inspectorStore.edit(id);
    inspectorStore.setSource("wildfires", true);
    inspectorStore.edit(null);
    expect(composeViewState(stubMap).sig ?? []).not.toContain("wildfires");
  });
});
