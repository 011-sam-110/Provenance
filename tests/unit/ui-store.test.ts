import { describe, it, expect } from "vitest";
import { uiStore } from "@/lib/shell/ui";

describe("uiStore (theme only)", () => {
  it("no longer exposes railOpen / newsTicker", () => {
    expect("railOpen" in uiStore.get()).toBe(false);
    expect("newsTicker" in uiStore.get()).toBe(false);
    expect((uiStore as Record<string, unknown>).toggleRail).toBeUndefined();
  });
  it("has ONE theme, and no way to leave it", () => {
    // Was "toggles theme", and it toggled to dark. Dark is gone from the product:
    // the token block, the Settings segment and the palette command all went. The
    // type is a single-member union so this cannot regress silently, and this asserts
    // the runtime half — the toggler is not merely unreachable, it is not there.
    expect(uiStore.get().theme).toBe("light");
    expect((uiStore as Record<string, unknown>).toggleTheme).toBeUndefined();
  });

  it("REFUSES a stored dark from before the toggle was removed", () => {
    // localStorage outlives a deploy. Applying a stored "dark" would stamp
    // data-theme="dark" against a stylesheet that no longer defines those tokens —
    // an unreadable console for exactly the people who had used the old toggle.
    //
    // The environment is "node", so there is no window: this hands hydrate() a fake
    // one holding the value a returning user's browser actually has. Restored in a
    // finally so a failure here cannot leak a window into the rest of the file.
    const store = new Map([["tn.ui.v1", JSON.stringify({ v: 1, d: { theme: "dark" } })]]);
    const g = globalThis as { window?: unknown };
    const had = "window" in g;
    g.window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
      },
    };
    try {
      uiStore.hydrate();
      expect(uiStore.get().theme).toBe("light");
    } finally {
      if (!had) delete g.window;
    }
  });
});
