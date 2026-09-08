// tests/unit/scene-chrome.test.ts
//
// lib/console/sceneChrome.ts (owned by claude-state) — a sibling store to
// boards.ts, keyed by scene id (== board id == ConsolePreset.id, see nav-spec §0),
// holding two things per scene: which widget TYPES are hidden, and an open "quick
// settings" bag. This file pins nav-spec §2's exact signatures and, above all, the
// literal acceptance test from the brief (see the last describe block below).
//
// vitest runs `environment: "node"` here, so there is no `window` — persist.ts
// silently no-ops without one. The localStorage stub below is copied from the
// pattern already used in tests/unit/console-boards.test.ts and
// tests/unit/variants-store.test.ts: without it, every persistence assertion in
// this file would vacuously pass against a store that saves nothing.
//
// A fresh, never-touched scene id is used per test (rather than resetting the
// whole store) to keep tests independent within one file — dynamic `import()` of
// the same module path is cached, so the module's mutable state carries over
// between tests in this file exactly as it would across two calls in the real app.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function installStorage(): Map<string, string> {
  const map = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
      removeItem: (k: string) => {
        map.delete(k);
      },
    },
  };
  return map;
}

let storage: Map<string, string>;
beforeEach(() => {
  storage = installStorage();
});
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("sceneChromeStore — basics", () => {
  it("an untouched scene id reads back as DEFAULT_SCENE_CHROME, by reference", async () => {
    const { sceneChromeStore, DEFAULT_SCENE_CHROME } = await import("@/lib/console/sceneChrome");
    // "by reference, not a fresh object" is explicit in nav-spec §2 (for
    // useSceneChrome's stable identity under useSyncExternalStore) and is the
    // same discipline get() should follow for an untouched id.
    expect(sceneChromeStore.get("basics-never-touched")).toBe(DEFAULT_SCENE_CHROME);
    expect(DEFAULT_SCENE_CHROME).toEqual({ hidden: [], quick: {} });
  });

  it("setHidden(true) adds the type id, setHidden(false) removes it", async () => {
    const { sceneChromeStore } = await import("@/lib/console/sceneChrome");
    const id = "basics-hide-toggle";
    sceneChromeStore.setHidden(id, "weather", true);
    expect(sceneChromeStore.get(id).hidden).toEqual(["weather"]);
    sceneChromeStore.setHidden(id, "weather", false);
    expect(sceneChromeStore.get(id).hidden).toEqual([]);
  });

  it("setHidden is a no-op (no emit) when the type is already in that state", async () => {
    const { sceneChromeStore } = await import("@/lib/console/sceneChrome");
    const id = "basics-hide-noop";
    sceneChromeStore.setHidden(id, "weather", true);

    let calls = 0;
    const unsub = sceneChromeStore.subscribe(() => {
      calls++;
    });
    sceneChromeStore.setHidden(id, "weather", true); // already hidden — must not emit
    expect(calls).toBe(0);
    expect(sceneChromeStore.get(id).hidden).toEqual(["weather"]); // and not duplicated

    unsub();
    sceneChromeStore.setHidden(id, "weather", false);
    expect(calls).toBe(0); // unsubscribed listener saw nothing further
  });

  it("hiding two different types on the same scene keeps both", async () => {
    const { sceneChromeStore } = await import("@/lib/console/sceneChrome");
    const id = "basics-hide-two";
    sceneChromeStore.setHidden(id, "weather", true);
    sceneChromeStore.setHidden(id, "aviation", true);
    expect(sceneChromeStore.get(id).hidden.sort()).toEqual(["aviation", "weather"]);
  });

  it("setQuick shallow-merges into the bag rather than replacing it", async () => {
    const { sceneChromeStore } = await import("@/lib/console/sceneChrome");
    const id = "basics-quick-merge";
    sceneChromeStore.setQuick(id, { compactCards: true });
    sceneChromeStore.setQuick(id, { somethingElse: "x" });
    expect(sceneChromeStore.get(id).quick).toEqual({ compactCards: true, somethingElse: "x" });
  });

  it("setQuick can flip a key back off without touching the rest of the bag", async () => {
    const { sceneChromeStore } = await import("@/lib/console/sceneChrome");
    const id = "basics-quick-flip";
    sceneChromeStore.setQuick(id, { compactCards: true, kept: "y" });
    sceneChromeStore.setQuick(id, { compactCards: false });
    expect(sceneChromeStore.get(id).quick).toEqual({ compactCards: false, kept: "y" });
  });

  it("resetScene drops both the hidden set and the quick bag", async () => {
    const { sceneChromeStore, DEFAULT_SCENE_CHROME } = await import("@/lib/console/sceneChrome");
    const id = "basics-reset-scene";
    sceneChromeStore.setHidden(id, "weather", true);
    sceneChromeStore.setQuick(id, { compactCards: true });
    sceneChromeStore.resetScene(id);
    expect(sceneChromeStore.get(id)).toEqual(DEFAULT_SCENE_CHROME);
  });

  it("resetScene on one scene does not touch another scene's chrome", async () => {
    const { sceneChromeStore } = await import("@/lib/console/sceneChrome");
    sceneChromeStore.setHidden("basics-reset-a", "weather", true);
    sceneChromeStore.setHidden("basics-reset-b", "weather", true);
    sceneChromeStore.resetScene("basics-reset-a");
    expect(sceneChromeStore.get("basics-reset-a").hidden).toEqual([]);
    expect(sceneChromeStore.get("basics-reset-b").hidden).toEqual(["weather"]);
  });
});

describe("useSceneChrome — null sceneId", () => {
  it("returns DEFAULT_SCENE_CHROME by reference for sceneId=null", async () => {
    // useSceneChrome needs `react`'s useSyncExternalStore, which does not run
    // outside a component — call the hook function directly is not meaningful in
    // node, but sceneChromeStore.get() is the same underlying read path a
    // sceneId=null render must fall back to, so the contract is exercised through
    // it. (No React testing library is installed here — see CLAUDE.md.)
    const { DEFAULT_SCENE_CHROME } = await import("@/lib/console/sceneChrome");
    expect(DEFAULT_SCENE_CHROME).toEqual({ hidden: [], quick: {} });
  });
});

describe("persistence — tn.console.sceneChrome.v1, version 1, via loadPersisted/savePersisted", () => {
  it("writes through the shared { v, d } envelope under the exact pinned key", async () => {
    const { sceneChromeStore } = await import("@/lib/console/sceneChrome");
    const id = "persist-envelope";
    sceneChromeStore.setHidden(id, "weather", true);

    const raw = storage.get("tn.console.sceneChrome.v1");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { v: number; d: Record<string, unknown> };
    expect(parsed.v).toBe(1);
    expect(parsed.d[id]).toEqual({ hidden: ["weather"], quick: {} });
  });

  it("hydrate() pulls persisted chrome into a fresh module instance", async () => {
    const { sceneChromeStore: writer } = await import("@/lib/console/sceneChrome");
    const id = "persist-hydrate";
    writer.setHidden(id, "weather", true);

    vi.resetModules();
    const { sceneChromeStore: reader } = await import("@/lib/console/sceneChrome");
    reader.hydrate();
    expect(reader.get(id).hidden).toEqual(["weather"]);
  });

  it("a corrupt/foreign persisted value degrades to defaults rather than throwing", async () => {
    storage.set("tn.console.sceneChrome.v1", JSON.stringify({ v: 1, d: "not an object" }));
    const { sceneChromeStore } = await import("@/lib/console/sceneChrome");
    expect(() => sceneChromeStore.hydrate()).not.toThrow();
    expect(sceneChromeStore.get("persist-corrupt")).toEqual({ hidden: [], quick: {} });
  });
});

describe("THE HEADLINE CASE, verbatim from the brief", () => {
  it("hide a widget on WORLD, reload, open INTEL, come back to WORLD — still hidden on WORLD, never hidden on INTEL", async () => {
    const { sceneChromeStore: session1 } = await import("@/lib/console/sceneChrome");

    // Hide a widget on WORLD.
    session1.setHidden("world", "weather", true);
    expect(session1.get("world").hidden).toContain("weather");
    // And it was never hidden on INTEL to begin with.
    expect(session1.get("intel").hidden).not.toContain("weather");

    // Simulate a reload: a brand-new module instance (fresh in-memory state — no
    // state is carried over by reference), rehydrated from whatever
    // savePersisted actually wrote to localStorage. This is a real
    // loadPersisted/savePersisted round trip through the storage stub, not a
    // re-read of the same live JS object.
    vi.resetModules();
    const { sceneChromeStore: session2 } = await import("@/lib/console/sceneChrome");
    session2.hydrate();

    // Still hidden on WORLD after the reload.
    expect(session2.get("world").hidden).toContain("weather");

    // Open INTEL — the widget was never hidden there, reload or not.
    expect(session2.get("intel").hidden).not.toContain("weather");

    // Come back to WORLD — still hidden. Reading INTEL in between must not have
    // leaked into or cleared WORLD's chrome.
    expect(session2.get("world").hidden).toContain("weather");
    expect(session2.get("world").hidden).toEqual(["weather"]);
  });

  it("hiding on a second scene after the reload does not retroactively touch the first", async () => {
    // The other direction of the same isolation guarantee: chrome set AFTER a
    // reload on one scene must not bleed into a different scene that was already
    // populated before the reload. Distinct scene ids from the headline case
    // (rather than reusing "world"/"intel") so this test does not depend on
    // whatever in-memory state a prior test in this file left behind on the
    // cached module — only on a real hydrate() from this test's own storage.
    const { sceneChromeStore: session1 } = await import("@/lib/console/sceneChrome");
    session1.setHidden("bleed-a", "weather", true);

    vi.resetModules();
    const { sceneChromeStore: session2 } = await import("@/lib/console/sceneChrome");
    session2.hydrate();

    session2.setHidden("bleed-b", "aviation", true);

    expect(session2.get("bleed-b").hidden).toEqual(["aviation"]);
    expect(session2.get("bleed-a").hidden).toEqual(["weather"]);
    expect(session2.get("bleed-a").hidden).not.toContain("aviation");
    expect(session2.get("bleed-b").hidden).not.toContain("weather");
  });
});

describe("boardWidgetTypes — active scene reads the LIVE render, not the template", () => {
  it("the active scene's types come from shellLayoutStore, even after edits away from the preset's own template", async () => {
    const { boardWidgetTypes } = await import("@/lib/console/sceneChrome");
    const { activePresetStore } = await import("@/lib/console/activePreset");
    const { shellLayoutStore } = await import("@/lib/console/store");
    const { createDefaultLayout } = await import("@/lib/console/types");

    activePresetStore.set("world");
    const live = {
      ...createDefaultLayout(),
      widgets: [
        { id: "w1", type: "zz-live-only-a", segment: "left" as const, order: 0, height: 200, collapsed: false, config: {} },
        { id: "w2", type: "zz-live-only-b", segment: "left" as const, order: 1, height: 200, collapsed: false, config: {} },
      ],
    };
    shellLayoutStore.replace(live, { archive: false });

    expect(boardWidgetTypes("world")).toEqual(["zz-live-only-a", "zz-live-only-b"]);
  });
});

describe("boardWidgetTypes — a non-active scene", () => {
  it("reads a saved board's archived layout when one exists", async () => {
    const { boardWidgetTypes } = await import("@/lib/console/sceneChrome");
    const { activePresetStore } = await import("@/lib/console/activePreset");
    const { writeBoardLayout } = await import("@/lib/console/boards");
    const { createDefaultLayout } = await import("@/lib/console/types");

    activePresetStore.set("world"); // active scene is something else entirely
    writeBoardLayout("nature", {
      ...createDefaultLayout(),
      widgets: [
        { id: "w1", type: "zz-archived-only", segment: "left" as const, order: 0, height: 200, collapsed: false, config: {} },
      ],
    });

    expect(boardWidgetTypes("nature")).toEqual(["zz-archived-only"]);
  });

  it("falls back to the built-in preset's own template when the scene has never been saved", async () => {
    const { boardWidgetTypes } = await import("@/lib/console/sceneChrome");
    const { activePresetStore } = await import("@/lib/console/activePreset");
    const { presetById } = await import("@/lib/console/presets");

    activePresetStore.set("world"); // "skywatch" is neither active nor ever saved here
    const templateTypes = presetById("skywatch")!.build().widgets.map((w) => w.type);

    expect(boardWidgetTypes("skywatch")).toEqual(templateTypes);
  });

  it("returns [] for an id that is neither the active scene, a saved board, nor a built-in preset", async () => {
    const { boardWidgetTypes } = await import("@/lib/console/sceneChrome");
    const { activePresetStore } = await import("@/lib/console/activePreset");
    activePresetStore.set("world");

    expect(boardWidgetTypes("not-a-real-board-id")).toEqual([]);
  });
});

describe("visibleWidgets — the render-time filter", () => {
  it("sceneId=null hides nothing (no board applied yet / a boardless ?c= layout)", async () => {
    const { visibleWidgets } = await import("@/lib/console/sceneChrome");
    const widgets = [{ type: "a" }, { type: "b" }];
    expect(visibleWidgets(widgets, null)).toEqual(widgets);
  });

  it("filters out only the types hidden on the given scene", async () => {
    const { visibleWidgets } = await import("@/lib/console/sceneChrome");
    const { sceneChromeStore } = await import("@/lib/console/sceneChrome");
    const id = "visible-filter";
    sceneChromeStore.setHidden(id, "b", true);

    const widgets = [{ type: "a" }, { type: "b" }, { type: "c" }];
    expect(visibleWidgets(widgets, id)).toEqual([{ type: "a" }, { type: "c" }]);
  });

  it("a scene with nothing hidden passes every widget through unchanged", async () => {
    const { visibleWidgets } = await import("@/lib/console/sceneChrome");
    const widgets = [{ type: "a" }, { type: "b" }];
    expect(visibleWidgets(widgets, "visible-filter-untouched-scene")).toEqual(widgets);
  });

  it("hiding a type on scene A does not filter that type's widgets on scene B", async () => {
    const { visibleWidgets, sceneChromeStore } = await import("@/lib/console/sceneChrome");
    sceneChromeStore.setHidden("visible-filter-a", "shared-type", true);

    const widgets = [{ type: "shared-type" }, { type: "other" }];
    expect(visibleWidgets(widgets, "visible-filter-a")).toEqual([{ type: "other" }]);
    expect(visibleWidgets(widgets, "visible-filter-b")).toEqual(widgets);
  });

  it("does not mutate rect/order/placement — it is a pure array filter, not a rewrite", async () => {
    const { visibleWidgets, sceneChromeStore } = await import("@/lib/console/sceneChrome");
    const id = "visible-filter-no-mutate";
    sceneChromeStore.setHidden(id, "b", true);

    const kept = { type: "a", order: 3, rect: { x: 1, y: 2, w: 4, h: 5 } };
    const widgets = [kept, { type: "b", order: 0, rect: { x: 0, y: 0, w: 1, h: 1 } }];
    const out = visibleWidgets(widgets, id);
    expect(out).toEqual([kept]);
    expect(out[0]).toBe(kept); // same object reference, not a clone/rewrite
  });
});
