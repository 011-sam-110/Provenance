import { describe, it, expect, afterEach } from "vitest";
import {
  coerceTerminalSkin,
  skinForSystemPreference,
  terminalSkinStore,
  DEFAULT_TERMINAL_SKIN,
} from "@/lib/terminal/skin";

// A working OSINT analyst asked for a light theme that already shipped, worked, and
// was the exact colour he asked for. He never found the toggle. The fix is that a
// visitor who has never expressed a preference gets asked via the browser instead of
// being handed dark by fiat — WITHOUT that ever overriding someone who did choose.
//
// The two failure modes this pins are opposites, and both are silent:
//   * seeding over a real choice   → the toggle stops working across reloads
//   * PERSISTING the seed          → the OS is consulted exactly once, ever, and a
//                                    person who later switches their system to dark
//                                    is stuck on light with no idea why

const KEY = "tn.terminal.skin.v1";
const VERSION = 1;

interface FakeWin {
  matchMedia: (q: string) => { matches: boolean };
  localStorage: {
    getItem(k: string): string | null;
    setItem(k: string, v: string): void;
    removeItem(k: string): void;
  };
}

/** Install a fake `window` for the duration of one test. Returns the backing store
 *  so a test can assert on what was (or was not) written. */
function withWindow(prefersLight: boolean, seed?: Record<string, string>) {
  const store: Record<string, string> = { ...(seed ?? {}) };
  const win: FakeWin = {
    matchMedia: (q: string) => ({ matches: /prefers-color-scheme:\s*light/.test(q) && prefersLight }),
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v; },
      removeItem: (k) => { delete store[k]; },
    },
  };
  (globalThis as unknown as { window?: FakeWin }).window = win;
  return store;
}

const persisted = (skin: string) => ({ [KEY]: JSON.stringify({ v: VERSION, d: skin }) });

afterEach(() => {
  delete (globalThis as unknown as { window?: FakeWin }).window;
});

describe("skinForSystemPreference — pure", () => {
  it("follows the OS when it asks for light, else falls back to the default", () => {
    expect(skinForSystemPreference(true)).toBe("light");
    expect(skinForSystemPreference(false)).toBe(DEFAULT_TERMINAL_SKIN);
    expect(DEFAULT_TERMINAL_SKIN).toBe("dark");
  });

  it("coerce still rejects anything that is not one of the two literals", () => {
    expect(coerceTerminalSkin("light")).toBe("light");
    expect(coerceTerminalSkin("dark")).toBe("dark");
    expect(coerceTerminalSkin("LIGHT")).toBe(DEFAULT_TERMINAL_SKIN);
    expect(coerceTerminalSkin(null)).toBe(DEFAULT_TERMINAL_SKIN);
    expect(coerceTerminalSkin({ d: "light" })).toBe(DEFAULT_TERMINAL_SKIN);
  });
});

describe("hydrate — a stored choice always wins", () => {
  it("keeps a stored dark even when the OS prefers light", () => {
    withWindow(true, persisted("dark"));
    terminalSkinStore.hydrate();
    expect(terminalSkinStore.get()).toBe("dark");
  });

  it("keeps a stored light even when the OS prefers dark", () => {
    withWindow(false, persisted("light"));
    terminalSkinStore.hydrate();
    expect(terminalSkinStore.get()).toBe("light");
  });

  it("falls back to the default when the stored value is corrupt", () => {
    withWindow(false, { [KEY]: "{not json" });
    terminalSkinStore.hydrate();
    expect(terminalSkinStore.get()).toBe(DEFAULT_TERMINAL_SKIN);
  });
});

describe("hydrate — with no stored choice, ask the OS but do not answer for them", () => {
  it("seeds light from prefers-color-scheme", () => {
    withWindow(true);
    terminalSkinStore.hydrate();
    expect(terminalSkinStore.get()).toBe("light");
  });

  it("seeds dark when the OS prefers dark", () => {
    withWindow(false);
    terminalSkinStore.hydrate();
    expect(terminalSkinStore.get()).toBe("dark");
  });

  it("does NOT write the seed — the next visit must ask again", () => {
    const store = withWindow(true);
    terminalSkinStore.hydrate();
    expect(terminalSkinStore.get()).toBe("light");
    expect(Object.keys(store), "hydrate persisted a preference nobody expressed").toEqual([]);
  });

  it("but an explicit toggle IS written, and then wins forever", () => {
    const store = withWindow(true);
    terminalSkinStore.hydrate();
    terminalSkinStore.toggle(); // light → dark, by hand
    expect(terminalSkinStore.get()).toBe("dark");
    expect(store[KEY]).toBe(JSON.stringify({ v: VERSION, d: "dark" }));

    // …and a reload with the OS still on light does not undo it.
    withWindow(true, { [KEY]: store[KEY] });
    terminalSkinStore.hydrate();
    expect(terminalSkinStore.get()).toBe("dark");
  });
});

describe("hydrate is inert where there is no browser", () => {
  it("returns the default on the server, with no window at all", () => {
    // afterEach has already removed it; this is the SSR / node path.
    terminalSkinStore.hydrate();
    expect(terminalSkinStore.get()).toBe(DEFAULT_TERMINAL_SKIN);
  });

  it("survives a window with no matchMedia (old / locked-down embeds)", () => {
    (globalThis as unknown as { window?: unknown }).window = { localStorage: undefined };
    expect(() => terminalSkinStore.hydrate()).not.toThrow();
    expect(terminalSkinStore.get()).toBe(DEFAULT_TERMINAL_SKIN);
  });
});
