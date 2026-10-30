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

// A shared `/app?preset=streets&sig=...` link opened in a browser that has never opened
// the console: it opens the view the link was copied from, and the link's sources are
// filed under THAT view only. One boot per file: see view-switch.test.ts.

const store = new Map<string, string>();

beforeAll(() => {
  (globalThis as { window?: unknown }).window = fakeWindow(store);
  boot(store, "preset=streets&sig=earthquakes,volcanoes");
});

afterAll(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("a shared link to Streets, opened on a first visit", () => {
  it("opens Streets", () => {
    expect(activePresetStore.get()).toBe("streets");
  });

  it("puts the link's sources on Streets", () => {
    expect(world().earthquakes).toBe(true);
    expect(world().volcanoes).toBe(true);
    expect(world().livecams).toBe(true); // Streets' own template under them
  });

  it("files them under Streets and under no other view", () => {
    const views = savedVariant(store).views ?? {};
    expect(Object.keys(views)).toEqual(["streets"]);
    expect(views.streets.signals.sort()).toEqual(["earthquakes", "volcanoes"]);
  });

  it("leaves Globe at its own default", () => {
    applyPreset("overview", nav);
    expect(world().earthquakes).not.toBe(true);
    expect(world().volcanoes).not.toBe(true);
    expect(world().livecams).toBe(false);
  });
});
