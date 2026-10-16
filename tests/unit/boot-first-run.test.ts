import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { variantStore } from "@/lib/variants/store";
import { inspectorStore } from "@/lib/shell/inspector";
import { shellLayoutStore } from "@/lib/console/store";
import { activePresetStore } from "@/lib/console/activePreset";
import { presetById, presetMapState } from "@/lib/console/presets";
import { isFirstRun, seedBoard } from "@/lib/console/bootSeed";
import { MAP_SIGNALS } from "@/lib/signals/registry";

// ConsoleShell's boot, without React: the TRUE first run, nothing saved at all.
//
// The seed was narrowed so it stops firing on every reload of the Globe board. This
// file pins the other side of that change: a browser with no saved state still opens
// on the default board, with the default board's map.
//
// One boot per file on purpose: see boot-reload-keeps-signals.test.ts.

function fakeWindow(store: Map<string, string>) {
  return {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  };
}

describe("the first boot in a browser with nothing saved", () => {
  let firstRun = false;

  beforeAll(() => {
    (globalThis as { window?: unknown }).window = fakeWindow(new Map());
    const params = new URLSearchParams("");
    const restored = variantStore.bootstrap(params);
    inspectorStore.hydrate();
    shellLayoutStore.hydrate();
    activePresetStore.hydrate();
    firstRun = isFirstRun({ restoredVariant: restored, activeBoard: activePresetStore.get() });
    seedBoard(params, firstRun);
  });

  afterAll(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("is read as a first run", () => {
    expect(firstRun).toBe(true);
  });

  it("opens the default board", () => {
    expect(activePresetStore.get()).toBe("overview");
    expect(shellLayoutStore.get().stage).toBe(presetById("overview")!.build().stage);
  });

  it("drives the globe to the default board's map", () => {
    const want = presetMapState("overview")!;
    const world = inspectorStore.get().world;
    for (const [k, on] of Object.entries(want.core)) expect(world[k], k).toBe(on);
    for (const s of MAP_SIGNALS) expect(world[s.id] === true, s.id).toBe(want.signals[s.id] === true);
  });
});
