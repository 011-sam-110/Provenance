import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  MARK_KEY_PERSIST_KEY,
  MARK_KEY_PERSIST_VERSION,
  coerceFolded,
  markKeyPlacement,
  markKeyStore,
} from "@/lib/map/markKey";

/**
 * The Marks key folds to a chip and remembers it in this browser. The rules worth a test
 * are the ones that fail SILENTLY: a visitor who never pressed the button getting a
 * "choice" written for them, a corrupt value hiding the key, and the placement maths that
 * keeps the key clear of the HUD (top left) and of the compass and the i (bottom right).
 */

function fakeStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (k: string) => (data.has(k) ? (data.get(k) as string) : null),
    setItem: vi.fn((k: string, v: string) => void data.set(k, v)),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe("coerceFolded", () => {
  it("is folded only for exactly true", () => {
    expect(coerceFolded(true)).toBe(true);
  });

  it("is open for everything else, so a corrupt value can never hide the key", () => {
    for (const v of [false, "true", 1, 0, "", null, undefined, {}, []]) {
      expect(coerceFolded(v)).toBe(false);
    }
  });
});

describe("the persistence key", () => {
  it("is tn.map.legend.v1 at version 1", () => {
    expect(MARK_KEY_PERSIST_KEY).toBe("tn.map.legend.v1");
    expect(MARK_KEY_PERSIST_VERSION).toBe(1);
  });
});

describe("markKeyStore", () => {
  let storage: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    storage = fakeStorage();
    vi.stubGlobal("window", { localStorage: storage });
    markKeyStore.set(false);
    storage.setItem.mockClear();
    storage.data.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts open", () => {
    expect(markKeyStore.get()).toBe(false);
  });

  it("hydrate() reads a saved fold and NEVER writes", () => {
    storage.data.set(MARK_KEY_PERSIST_KEY, JSON.stringify({ v: 1, d: true }));
    markKeyStore.hydrate();
    expect(markKeyStore.get()).toBe(true);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("hydrate() on a browser that never chose leaves the key open and writes nothing", () => {
    markKeyStore.hydrate();
    expect(markKeyStore.get()).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.data.has(MARK_KEY_PERSIST_KEY)).toBe(false);
  });

  it("hydrate() ignores a stale version and a foreign value", () => {
    storage.data.set(MARK_KEY_PERSIST_KEY, JSON.stringify({ v: 2, d: true }));
    markKeyStore.hydrate();
    expect(markKeyStore.get()).toBe(false);
    storage.data.set(MARK_KEY_PERSIST_KEY, JSON.stringify({ v: 1, d: "yes" }));
    markKeyStore.hydrate();
    expect(markKeyStore.get()).toBe(false);
  });

  it("toggle() writes the v1 envelope and a second toggle opens it again", () => {
    markKeyStore.toggle();
    expect(markKeyStore.get()).toBe(true);
    expect(storage.data.get(MARK_KEY_PERSIST_KEY)).toBe('{"v":1,"d":true}');
    markKeyStore.toggle();
    expect(markKeyStore.get()).toBe(false);
    expect(storage.data.get(MARK_KEY_PERSIST_KEY)).toBe('{"v":1,"d":false}');
  });

  it("set() to the current value writes nothing and tells nobody", () => {
    const seen = vi.fn();
    const off = markKeyStore.subscribe(seen);
    markKeyStore.set(false);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(seen).not.toHaveBeenCalled();
    markKeyStore.set(true);
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    markKeyStore.set(false);
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

describe("markKeyPlacement", () => {
  const groupTop = 760;

  it("sits side by side with the HUD on a desktop map: top 10px, never below it", () => {
    // 1440: a 1366px map, the full HUD 356px wide at left 14.
    const p = markKeyPlacement({
      mapW: 1366,
      mapH: 800,
      hud: { left: 14, top: 14, right: 370, bottom: 190 },
      groupTop,
      openW: 250,
    });
    expect(p.belowHud).toBe(false);
    expect(p.top).toBe(10);
  });

  it("drops just below the HUD on a phone, where the two would overlap", () => {
    // 390: a 370px map, the full HUD 356px wide.
    const p = markKeyPlacement({
      mapW: 370,
      mapH: 388,
      hud: { left: 14, top: 14, right: 370, bottom: 190 },
      groupTop: 340,
      openW: 150,
    });
    expect(p.belowHud).toBe(true);
    expect(p.top).toBe(190 + 8);
  });

  it("stays at the top on a phone while the HUD is off", () => {
    const p = markKeyPlacement({ mapW: 370, mapH: 388, hud: null, groupTop: 340, openW: 150 });
    expect(p.belowHud).toBe(false);
    expect(p.top).toBe(10);
  });

  it("stays at the top when a narrow HUD leaves room beside the key", () => {
    const p = markKeyPlacement({
      mapW: 370,
      mapH: 388,
      hud: { left: 14, top: 14, right: 150, bottom: 60 },
      groupTop: 340,
      openW: 150,
    });
    expect(p.belowHud).toBe(false);
  });

  it("stops 8px above the bottom-right controls", () => {
    const p = markKeyPlacement({ mapW: 1366, mapH: 800, hud: null, groupTop, openW: 250 });
    expect(p.maxHeight).toBe(groupTop - 8 - 10);
  });

  it("never reports a negative height when the controls are higher than the key's top", () => {
    const p = markKeyPlacement({
      mapW: 370,
      mapH: 388,
      hud: { left: 14, top: 14, right: 370, bottom: 330 },
      groupTop: 340,
      openW: 150,
    });
    expect(p.maxHeight).toBe(0);
  });

  it("falls back to the map's own bottom when there is no control group to clear", () => {
    const p = markKeyPlacement({ mapW: 1366, mapH: 800, hud: null, groupTop: Number.NaN, openW: 250 });
    expect(p.maxHeight).toBe(800 - 10 - 8 - 10);
  });

  it("honours a different inset and gap", () => {
    const p = markKeyPlacement({
      mapW: 370,
      mapH: 388,
      hud: { left: 14, top: 14, right: 370, bottom: 100 },
      groupTop: 340,
      openW: 150,
      inset: 12,
      gap: 4,
    });
    expect(p.top).toBe(104);
    expect(p.maxHeight).toBe(340 - 4 - 104);
  });
});
