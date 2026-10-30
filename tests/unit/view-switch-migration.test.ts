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

// A browser that saved BEFORE views existed holds one set, in `overrides`. It must come
// back on the board the user was last on, and on no other. One boot per file: see
// view-switch.test.ts.

const store = new Map<string, string>([
  ["tn.variant.v1", wrap({
    activeId: "explore", userVariants: [], layoutOverrides: {},
    overrides: { explore: { layers: { planes: false, livecams: true }, signals: { earthquakes: true, volcanoes: true } } },
  })],
  ["tn.console.activePreset.v1", wrap("streets")],
]);
let booted: { viewsBeforeBootDone: string[] };

beforeAll(() => {
  (globalThis as { window?: unknown }).window = fakeWindow(store);
  booted = boot(store, "");
});

afterAll(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("migration from the old single set", () => {
  it("writes no view before bootDone", () => {
    expect(booted.viewsBeforeBootDone).toEqual([]);
  });

  it("files the old set under the board the user was last on, and under no other", () => {
    expect(activePresetStore.get()).toBe("streets");
    const views = savedVariant(store).views ?? {};
    expect(Object.keys(views)).toEqual(["streets"]);
    expect(views.streets.signals.sort()).toEqual(["earthquakes", "volcanoes"]);
    expect(views.streets.layers.planes).toBe(false);
    expect(world().earthquakes).toBe(true);
  });

  it("still holds the old set in `overrides`, untouched", () => {
    expect(savedVariant(store).overrides).toMatchObject({
      explore: { signals: { earthquakes: true, volcanoes: true } },
    });
  });

  it("starts the other view from its default", () => {
    applyPreset("overview", nav);
    expect(world().earthquakes).not.toBe(true);
    expect(world().volcanoes).not.toBe(true);
    expect(world().livecams).toBe(false);
    expect(world().countries).toBe(true);
  });

  it("and brings the migrated set back when the user returns", () => {
    applyPreset("streets", nav);
    expect(world().earthquakes).toBe(true);
    expect(world().volcanoes).toBe(true);
    expect(world().planes).toBe(false);
  });
});
