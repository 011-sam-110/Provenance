import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { variantStore } from "@/lib/variants/store";
import { inspectorStore } from "@/lib/shell/inspector";
import { shellLayoutStore } from "@/lib/console/store";
import { activePresetStore } from "@/lib/console/activePreset";
import { presetById } from "@/lib/console/presets";
import { isFirstRun, seedBoard } from "@/lib/console/bootSeed";

// ConsoleShell's boot, without React: a RETURNING user on the Globe board reloads.
//
// The defect this file exists for. The board step ran `applyPreset("overview")` on
// every boot "while the board carries no widgets" as a first-run seed, and Globe
// carries no widgets by design. So for anyone on Globe it ran on EVERY reload, after
// variantStore.bootstrap had put the saved toggles back, and switched them all off.
// captureOverride then saved that loss over tn.variant.v1. Measured on prod: one
// reload turned every saved signal toggle off.
//
// One boot per file on purpose: the stores are module state and vitest isolates per
// file, so this file's stores are genuinely un-booted when the boot below runs.

const OVERVIEW = presetById("overview")!.build();

function fakeWindow(store: Map<string, string>) {
  return {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  };
}

describe("a reload on the Globe board", () => {
  let store: Map<string, string>;

  beforeAll(() => {
    store = new Map([
      // The user switched two signal layers on and planes off: saved as a delta
      // against the Explore variant, which is how World's toggles persist.
      ["tn.variant.v1", JSON.stringify({ v: 1, d: {
        activeId: "explore", userVariants: [], layoutOverrides: {},
        overrides: { explore: { layers: { planes: false }, signals: { earthquakes: true, volcanoes: true } } },
      } })],
      ["tn.console.activePreset.v1", JSON.stringify({ v: 1, d: "overview" })],
      ["tn.console.v1", JSON.stringify({ v: 1, d: OVERVIEW })],
    ]);
    (globalThis as { window?: unknown }).window = fakeWindow(store);

    // The order ConsoleShell's hydrate effect runs them in.
    const params = new URLSearchParams("");
    const restored = variantStore.bootstrap(params);
    inspectorStore.hydrate();
    shellLayoutStore.hydrate();
    activePresetStore.hydrate();
    seedBoard(params, isFirstRun({ restoredVariant: restored, activeBoard: activePresetStore.get() }));
  });

  afterAll(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("starts from a board with no widgets, which is the condition that used to fire the seed", () => {
    expect(OVERVIEW.widgets).toHaveLength(0);
    expect(shellLayoutStore.get().widgets).toHaveLength(0);
  });

  it("keeps the saved signal toggles on the globe", () => {
    const world = inspectorStore.get().world;
    expect(world.earthquakes).toBe(true);
    expect(world.volcanoes).toBe(true);
  });

  it("keeps the saved core-layer toggles too", () => {
    const world = inspectorStore.get().world;
    expect(world.planes).toBe(false); // the user's choice
    expect(world.livecams).toBe(true); // the Explore variant's own default
  });

  it("does not save a wiped set over the user's toggles", () => {
    const saved = JSON.parse(store.get("tn.variant.v1") as string);
    expect(saved.d.overrides.explore.signals).toEqual({ earthquakes: true, volcanoes: true });
  });

  it("stays on the board the user was on", () => {
    expect(activePresetStore.get()).toBe("overview");
  });
});
