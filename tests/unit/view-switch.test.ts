import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { variantStore } from "@/lib/variants/store";
import { inspectorStore } from "@/lib/shell/inspector";
import { shellLayoutStore } from "@/lib/console/store";
import { activePresetStore } from "@/lib/console/activePreset";
import { isFirstRun, seedBoard } from "@/lib/console/bootSeed";
import { applyPreset, resetActiveBoard } from "@/lib/console/presets";
import { layersStore } from "@/lib/layers";
import { signalsStore } from "@/lib/signals/store";

function fakeWindow(store: Map<string, string>) {
  return {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  };
}

function wrap(d: unknown) {
  return JSON.stringify({ v: 1, d });
}

type Saved = {
  views?: Record<string, { layers: Record<string, boolean>; signals: string[] }>;
  overrides?: Record<string, unknown>;
};

/**
 * ConsoleShell's hydrate effect, without React, in its order: read the saved board id,
 * variantStore.bootstrap, inspector hydrate, layout hydrate, active-board hydrate,
 * seedBoard, bootDone. Returns what tn.variant.v1 held just before bootDone.
 */
function boot(store: Map<string, string>, search: string): { viewsBeforeBootDone: string[] } {
  const params = new URLSearchParams(search);
  const board = activePresetStore.saved();
  const restored = variantStore.bootstrap(params, board);
  inspectorStore.hydrate();
  shellLayoutStore.hydrate();
  activePresetStore.hydrate();
  seedBoard(params, isFirstRun({ restoredVariant: restored, activeBoard: activePresetStore.get() }));
  const viewsBeforeBootDone = Object.keys(savedVariant(store).views ?? {});
  variantStore.bootDone();
  return { viewsBeforeBootDone };
}

function savedVariant(store: Map<string, string>): Saved {
  const raw = store.get("tn.variant.v1");
  return raw ? (JSON.parse(raw) as { d: Saved }).d : {};
}

const world = () => inspectorStore.get().world;
const nav = { track: false } as const;

// Each view's own sources, end to end without React. One boot per file on purpose (the
// stores are module state, and the registry is never imported inside a test body: see
// no-registry-import-in-test-body.test.ts), so the scenarios below run in order on ONE
// browser, the way a person would use it. Migration and links have their own files.

const store = new Map<string, string>();
let first: { viewsBeforeBootDone: string[] };

beforeAll(() => {
  (globalThis as { window?: unknown }).window = fakeWindow(store);
  first = boot(store, "");
});

afterAll(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("a first visit", () => {
  it("writes no view before bootDone, then files the board it opened on", () => {
    expect(first.viewsBeforeBootDone).toEqual([]);
    expect(activePresetStore.get()).toBe("overview");
    const views = savedVariant(store).views ?? {};
    expect(Object.keys(views)).toEqual(["overview"]);
    // Globe starts with borders only.
    expect(views.overview.signals).toEqual([]);
    expect(views.overview.layers).toMatchObject({ livecams: false, staticcams: false, planes: false, countries: true });
  });

  it("still writes the old `overrides` field for older builds", () => {
    signalsStore.set("earthquakes", true);
    expect(savedVariant(store).overrides).toMatchObject({ explore: { signals: { earthquakes: true } } });
    signalsStore.set("earthquakes", false);
  });

  it("a toggle made while an area is being edited does not touch the view", () => {
    const id = inspectorStore.add([[0, 0], [0, 1], [1, 1], [1, 0]], "Box")!;
    inspectorStore.edit(id);
    signalsStore.set("wildfires", true); // lands on the area
    inspectorStore.edit(null);
    expect((savedVariant(store).views ?? {}).overview.signals).toEqual([]);
    inspectorStore.remove(id);
  });

  it("Globe's toggles survive Globe -> Streets -> Globe, and Streets seeds its own cameras", () => {
    signalsStore.set("earthquakes", true);
    signalsStore.set("wildfires", true);
    layersStore.set("planes", true);

    applyPreset("streets", nav);
    expect(world().earthquakes).not.toBe(true);
    expect(world().wildfires).not.toBe(true);
    expect(world().planes).toBe(false);
    expect(world().livecams).toBe(true); // Streets' first visit: its own template
    expect(world().staticcams).toBe(true);

    applyPreset("overview", nav);
    expect(world().earthquakes).toBe(true);
    expect(world().wildfires).toBe(true);
    expect(world().planes).toBe(true);
    expect(world().livecams).toBe(false);
  });

  it("Streets keeps its own changes too, and both are filed", () => {
    applyPreset("streets", nav);
    layersStore.set("staticcams", false);
    signalsStore.set("volcanoes", true);
    applyPreset("overview", nav);
    applyPreset("streets", nav);
    expect(world().staticcams).toBe(false);
    expect(world().livecams).toBe(true);
    expect(world().volcanoes).toBe(true);
    expect(world().earthquakes).not.toBe(true);

    const views = savedVariant(store).views ?? {};
    expect(views.overview.signals.sort()).toEqual(["earthquakes", "wildfires"]);
    expect(views.streets.signals).toEqual(["volcanoes"]);
    expect(views.streets.layers.staticcams).toBe(false);
  });

  it("re-selecting the open board changes nothing", () => {
    applyPreset("streets", nav);
    expect(world().volcanoes).toBe(true);
  });
});

describe("a reload", () => {
  it("brings back each view's own set (and the open board)", () => {
    // A page that had just loaded would not hold the last visit's World. Put something
    // else there (a link's sig replaces the signals exactly; bootstrap runs under its
    // guard, so nothing is filed), so a reload that restored nothing would show.
    variantStore.bootstrap(new URLSearchParams("sig=cables"), null);
    expect(world().volcanoes).not.toBe(true);
    boot(store, "");
    expect(activePresetStore.get()).toBe("streets");
    expect(world().volcanoes).toBe(true);
    expect(world().earthquakes).not.toBe(true);
    expect(world().staticcams).toBe(false);
    expect(world().cables).not.toBe(true);
    applyPreset("overview", nav);
    expect(world().earthquakes).toBe(true);
    expect(world().wildfires).toBe(true);
    expect(world().volcanoes).not.toBe(true);
  });

  it("a ?preset= naming the board already open leaves its sources alone", () => {
    applyPreset("streets", nav);
    variantStore.bootstrap(new URLSearchParams("sig=cables"), null);
    boot(store, "preset=streets");
    expect(world().volcanoes).toBe(true);
    expect(world().staticcams).toBe(false);
  });
});

describe("Reset", () => {
  it("forgets the view and seeds the template again", () => {
    applyPreset("streets", nav);
    resetActiveBoard();
    expect(world().livecams).toBe(true);
    expect(world().staticcams).toBe(true);
    expect(world().volcanoes).not.toBe(true);
    expect((savedVariant(store).views ?? {}).streets.signals).toEqual([]);
    // Globe was not touched by Streets' reset.
    applyPreset("overview", nav);
    expect(world().earthquakes).toBe(true);
  });
});
