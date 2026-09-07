import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inspectorStore } from "@/lib/shell/inspector";
import { signalsStore } from "@/lib/signals/store";

// ConsoleShell's boot order, without React.
//
// variantStore.bootstrap() runs BEFORE inspectorStore.hydrate(), and that is
// deliberate — with an area loaded, bootstrap's writes would otherwise land on the
// AREA and replace the user's configuration with the variant's layers. But the order
// has a second edge, and it destroys data in the other direction: bootstrap writes
// World THROUGH this store, so an unguarded commit persists the pre-hydrate state —
// areas: [] — over the saved areas, and the hydrate that follows reads back the file
// it just destroyed. Measured on a preview: one reload emptied the Inspector.
//
// This lives in its own file because the gate is module state that hydrate() opens
// once. Vitest isolates per file, so the store here is genuinely un-hydrated — which
// is the whole condition under test.

const KEY = "tn.inspector.v1";

const SAVED = {
  v: 1,
  d: {
    world: {},
    loaded: null,
    areas: [
      {
        id: "area:1",
        label: "Kharkiv",
        polygon: [
          [36.0, 49.8],
          [36.5, 49.8],
          [36.5, 50.2],
          [36.0, 50.2],
        ],
        createdAt: 1,
        sources: { earthquakes: true },
      },
    ],
  },
};

function fakeWindow(store: Map<string, string>) {
  return {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  };
}

describe("inspector boot order", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map([[KEY, JSON.stringify(SAVED)]]);
    // lib/shell/persist.ts resolves window at CALL time, so installing it here is
    // enough — no import-order games needed.
    (globalThis as { window?: unknown }).window = fakeWindow(store);
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("keeps saved areas when the variant spine writes World before hydrate", () => {
    // What variantStore.bootstrap() does on every boot, before hydrate() runs.
    signalsStore.applyExact({ wildfires: true });

    inspectorStore.hydrate();

    const areas = inspectorStore.get().areas;
    expect(areas).toHaveLength(1);
    expect(areas[0]?.label).toBe("Kharkiv");
    expect(areas[0]?.sources).toEqual({ earthquakes: true });
  });

  it("persists again once hydrate has run", () => {
    inspectorStore.hydrate();
    inspectorStore.rename("area:1", "Kharkiv Oblast");

    const written = JSON.parse(store.get(KEY) as string);
    expect(written.d.areas[0].label).toBe("Kharkiv Oblast");
  });
});
