import { describe, it, expect } from "vitest";
import { variantStore, resolveVariant } from "@/lib/variants/store";
import { layersStore } from "@/lib/layers";
import { signalsStore } from "@/lib/signals/store";

// Node env: persist.ts no-ops without window.localStorage, so each bootstrap
// starts from defaults — no reset hook needed.
describe("variantStore", () => {
  it("bootstraps the default explore variant when no URL/persisted state", () => {
    variantStore.bootstrap(new URLSearchParams(""));
    expect(variantStore.get().activeId).toBe("explore");
    expect(layersStore.get().cameras).toBe(true);
    expect(layersStore.get().satellites).toBe(false);
  });
  // A legacy /app?v=cyber link opens the default board. `?v=` stopped being a deep
  // link when reading it on the server turned the console into a per-request render
  // — see lib/share/url.ts. It is ignored rather than redirected away, because Next
  // spreads the incoming query into a redirect destination, so /app?v=x -> /app would
  // re-emit ?v=x and loop.
  it("ignores a legacy URL v=", () => {
    variantStore.bootstrap(new URLSearchParams("v=cyber"));
    expect(variantStore.get().activeId).toBe("explore");
  });
  it("still seeds signal divergence from the URL", () => {
    variantStore.bootstrap(new URLSearchParams("sig=cyber-c2"));
    expect(signalsStore.isOn("cyber-c2")).toBe(true);
  });
  // The fallback used to be reachable through `?v=does-not-exist`. With the board out
  // of the URL, PERSISTED state is the only way to hold an id that no longer resolves
  // — a board removed in a release, or a user variant deleted on another tab — so
  // that is what this stubs. `setActive` cannot produce one: it stores the RESOLVED
  // id, so it can only ever write a valid one.
  it("falls back to explore for an unresolvable persisted variant id", () => {
    const store = new Map<string, string>([
      ["tn.variant.v1", JSON.stringify({ v: 1, d: { activeId: "deleted-board" } })],
    ]);
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    };
    try {
      variantStore.bootstrap(new URLSearchParams(""));
      expect(variantStore.get().activeId).toBe("explore");
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }
  });
  it("resolveVariant returns a builtin by id", () => {
    expect(resolveVariant("intel").title).toBe("Intel");
  });
});

describe("override capture", () => {
  it("a real user toggle is captured as an override", () => {
    // explore preset has cameras: true — setting it false is a genuine divergence
    variantStore.bootstrap(new URLSearchParams("v=explore"));
    layersStore.set("cameras", false);
    const overrides = variantStore.get().overrides;
    expect(overrides["explore"]).toBeDefined();
    expect(overrides["explore"]!.layers?.cameras).toBe(false);
  });

  it("resetToVariant clears the override and re-seeds the preset", () => {
    // state carries explore + cameras:false override from the previous test
    variantStore.resetToVariant();
    expect(variantStore.get().overrides["explore"]).toBeUndefined();
    expect(layersStore.get().cameras).toBe(true);
  });

  it("an override is preserved per-variant across switching", () => {
    // fresh known state: explore with cameras:true
    variantStore.bootstrap(new URLSearchParams("v=explore"));
    // diverge from explore's cameras:true
    layersStore.set("cameras", false);
    expect(variantStore.get().overrides["explore"]).toBeDefined();
    // switch away to aviation (cameras:false in its preset) then back
    variantStore.setActive("aviation");
    variantStore.setActive("explore");
    // override must survive the round-trip AND be re-applied to the live store
    expect(variantStore.get().overrides["explore"]).toBeDefined();
    expect(variantStore.get().overrides["explore"]!.layers?.cameras).toBe(false);
    expect(layersStore.get().cameras).toBe(false);
  });
});
