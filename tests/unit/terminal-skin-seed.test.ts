import { describe, it, expect, afterEach } from "vitest";
import { coerceTerminalSkin, terminalSkinStore, DEFAULT_TERMINAL_SKIN } from "@/lib/terminal/skin";

// LIGHT IS THE DEFAULT, and the OS is not consulted.
//
// The previous rule was dark-by-default with a one-time `prefers-color-scheme`
// read, added because a working OSINT analyst wanted the light theme and never
// found the toggle. Light-by-default answers that complaint outright, which left
// the media read doing only one thing — sending anyone whose OS is dark back to
// the skin the product no longer opens in — so it was removed.
//
// What survives from that work is the half that was never about the OS: seeding
// must never WRITE. These are the failure modes this file pins, and both are
// silent:
//   * seeding over a real choice → the toggle stops working across reloads
//   * PERSISTING the seed        → a visitor who never expressed a preference is
//                                  recorded as having expressed one, and a later
//                                  change to the default can never reach them

const KEY = "tn.terminal.skin.v1";
const VERSION = 1;

interface FakeWin {
  localStorage: {
    getItem(k: string): string | null;
    setItem(k: string, v: string): void;
    removeItem(k: string): void;
  };
}

/** Install a fake `window` for the duration of one test. Returns the backing store
 *  so a test can assert on what was (or was not) written. */
function withWindow(seed?: Record<string, string>) {
  const store: Record<string, string> = { ...(seed ?? {}) };
  const win: FakeWin = {
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

describe("the default", () => {
  it("is light", () => {
    expect(DEFAULT_TERMINAL_SKIN).toBe("light");
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
  it("keeps a stored dark", () => {
    withWindow(persisted("dark"));
    terminalSkinStore.hydrate();
    expect(terminalSkinStore.get()).toBe("dark");
  });

  it("keeps a stored light", () => {
    withWindow(persisted("light"));
    terminalSkinStore.hydrate();
    expect(terminalSkinStore.get()).toBe("light");
  });

  it("falls back to the default when the stored value is corrupt", () => {
    // Seeded from "dark" first, so a hydrate that merely LEFT state alone would
    // pass this by accident. It has to actively reset.
    withWindow(persisted("dark"));
    terminalSkinStore.hydrate();
    withWindow({ [KEY]: "{not json" });
    terminalSkinStore.hydrate();
    expect(terminalSkinStore.get()).toBe(DEFAULT_TERMINAL_SKIN);
  });
});

describe("hydrate — with no stored choice, the default, and no write", () => {
  it("seeds the default", () => {
    withWindow();
    terminalSkinStore.hydrate();
    expect(terminalSkinStore.get()).toBe("light");
  });

  it("does NOT write the seed", () => {
    const store = withWindow();
    terminalSkinStore.hydrate();
    expect(terminalSkinStore.get()).toBe("light");
    expect(Object.keys(store), "hydrate persisted a preference nobody expressed").toEqual([]);
  });

  it("but an explicit toggle IS written, and then wins forever", () => {
    const store = withWindow();
    terminalSkinStore.hydrate();
    terminalSkinStore.toggle(); // light → dark, by hand
    expect(terminalSkinStore.get()).toBe("dark");
    expect(store[KEY]).toBe(JSON.stringify({ v: VERSION, d: "dark" }));

    // …and a reload does not undo it.
    withWindow({ [KEY]: store[KEY] });
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

  it("survives a window with no localStorage (old / locked-down embeds)", () => {
    (globalThis as unknown as { window?: unknown }).window = { localStorage: undefined };
    expect(() => terminalSkinStore.hydrate()).not.toThrow();
    expect(terminalSkinStore.get()).toBe(DEFAULT_TERMINAL_SKIN);
  });
});
