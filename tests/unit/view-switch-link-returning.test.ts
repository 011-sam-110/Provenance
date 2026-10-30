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

// A RETURNING browser (one set saved before views existed, last on Globe) opens a link
// to Streets. The link's sources go to Streets; Globe keeps the set it had. One boot per
// file: see view-switch.test.ts.

const store = new Map<string, string>([
  ["tn.variant.v1", wrap({
    activeId: "explore", userVariants: [], layoutOverrides: {},
    overrides: { explore: { signals: { wildfires: true } } },
  })],
  ["tn.console.activePreset.v1", wrap("overview")],
]);

beforeAll(() => {
  (globalThis as { window?: unknown }).window = fakeWindow(store);
  boot(store, "preset=streets&sig=earthquakes");
});

afterAll(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("a shared link to Streets, opened by a browser last on Globe", () => {
  it("moves to Streets and files the link's sources there", () => {
    expect(activePresetStore.get()).toBe("streets");
    const views = savedVariant(store).views ?? {};
    expect(views.streets.signals).toEqual(["earthquakes"]);
    expect(world().earthquakes).toBe(true);
    expect(world().wildfires).not.toBe(true);
  });

  it("files Globe's own set before the link moved the board, so it is not lost", () => {
    const views = savedVariant(store).views ?? {};
    expect(views.overview.signals).toEqual(["wildfires"]);
  });

  it("Globe still has it when the person goes back", () => {
    applyPreset("overview", nav);
    expect(world().wildfires).toBe(true);
    expect(world().earthquakes).not.toBe(true);
  });
});
