import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  DEFAULT_TERMINAL_SKIN,
  SKIN_ATTR,
  SKIN_BOOT_SCRIPT,
  SKIN_PERSIST_KEY,
  SKIN_PERSIST_VERSION,
  applySkin,
  coerceTerminalSkin,
  terminalSkinStore,
} from "@/lib/terminal/skin";

/**
 * The console's dark skin is opt-in: light for everyone until they press the toggle,
 * then remembered in that browser. The rules worth a test are the ones that fail
 * SILENTLY — a visitor who never chose flipping to dark, a pre-#162 dark choice coming
 * back to life, hydrate() writing a "choice" nobody made, or the before-paint script
 * throwing in a private window.
 */

/** A localStorage the store and the boot script can both read, in the node environment. */
function fakeStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (k: string) => (data.has(k) ? (data.get(k) as string) : null),
    setItem: vi.fn((k: string, v: string) => void data.set(k, v)),
    removeItem: (k: string) => void data.delete(k),
  };
}

/** The <html> element, as far as applySkin and the boot script look at it. */
function fakeRoot() {
  const attrs = new Map<string, string>();
  return {
    attrs,
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    removeAttribute: (k: string) => void attrs.delete(k),
  };
}

const DARK_ENVELOPE = JSON.stringify({ v: SKIN_PERSIST_VERSION, d: "dark" });

/** The store reaches storage through `window.localStorage` and the DOM through `document`. */
function install(storage: ReturnType<typeof fakeStorage>, root: ReturnType<typeof fakeRoot>) {
  vi.stubGlobal("window", { localStorage: storage });
  vi.stubGlobal("document", { documentElement: root });
}

describe("coerceTerminalSkin", () => {
  it("is dark only for exactly 'dark'", () => {
    expect(coerceTerminalSkin("dark")).toBe("dark");
  });

  it("is light for everything else, so a corrupt value can never turn the console dark", () => {
    for (const v of ["light", "Dark", "DARK", "", null, undefined, 0, 1, true, {}, [], "dark "]) {
      expect(coerceTerminalSkin(v)).toBe("light");
    }
  });

  it("defaults to light", () => {
    expect(DEFAULT_TERMINAL_SKIN).toBe("light");
  });
});

describe("the persistence key", () => {
  it("is v2, so the skin store that PR #162 deleted (v1) cannot be revived", () => {
    expect(SKIN_PERSIST_KEY).toBe("tn.terminal.skin.v2");
    expect(SKIN_PERSIST_KEY).not.toBe("tn.terminal.skin.v1");
  });
});

describe("applySkin", () => {
  it("sets the attribute for dark and removes it for light, never writing 'light'", () => {
    const root = fakeRoot();
    applySkin("dark", root);
    expect(root.attrs.get(SKIN_ATTR)).toBe("dark");
    applySkin("light", root);
    expect(root.attrs.has(SKIN_ATTR)).toBe(false);
    applySkin("light", root);
    expect([...root.attrs.values()]).not.toContain("light");
  });
});

describe("terminalSkinStore", () => {
  let root: ReturnType<typeof fakeRoot>;

  beforeEach(() => {
    root = fakeRoot();
    install(fakeStorage(), root);
    terminalSkinStore.hydrate(); // back to a known state: nothing stored, light
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts light", () => {
    expect(terminalSkinStore.get()).toBe("light");
    expect(root.attrs.has(SKIN_ATTR)).toBe(false);
  });

  it("hydrate() with nothing stored stays light AND writes nothing", () => {
    // Seeding the default would turn "never chose" into "chose light".
    const storage = fakeStorage();
    install(storage, root);
    terminalSkinStore.hydrate();
    expect(terminalSkinStore.get()).toBe("light");
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.data.size).toBe(0);
  });

  it("hydrate() applies a stored v2 'dark' and still writes nothing", () => {
    const storage = fakeStorage({ [SKIN_PERSIST_KEY]: DARK_ENVELOPE });
    install(storage, root);
    terminalSkinStore.hydrate();
    expect(terminalSkinStore.get()).toBe("dark");
    expect(root.attrs.get(SKIN_ATTR)).toBe("dark");
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("a stored tn.terminal.skin.v1 'dark' (from before #162) stays LIGHT", () => {
    const storage = fakeStorage({ "tn.terminal.skin.v1": JSON.stringify({ v: 1, d: "dark" }) });
    install(storage, root);
    terminalSkinStore.hydrate();
    expect(terminalSkinStore.get()).toBe("light");
    expect(root.attrs.has(SKIN_ATTR)).toBe(false);
  });

  it("a tn.ui.v1 theme of 'dark' stays light: the theme is not the skin", () => {
    const storage = fakeStorage({ "tn.ui.v1": JSON.stringify({ v: 1, d: { theme: "dark" } }) });
    install(storage, root);
    terminalSkinStore.hydrate();
    expect(terminalSkinStore.get()).toBe("light");
    expect(root.attrs.has(SKIN_ATTR)).toBe(false);
  });

  it("a stored envelope of the wrong version is ignored", () => {
    const storage = fakeStorage({ [SKIN_PERSIST_KEY]: JSON.stringify({ v: 2, d: "dark" }) });
    install(storage, root);
    terminalSkinStore.hydrate();
    expect(terminalSkinStore.get()).toBe("light");
  });

  it("toggle() applies the skin and writes {v:1,d:'dark'}", () => {
    const storage = fakeStorage();
    install(storage, root);
    terminalSkinStore.toggle();
    expect(terminalSkinStore.get()).toBe("dark");
    expect(root.attrs.get(SKIN_ATTR)).toBe("dark");
    expect(storage.data.get(SKIN_PERSIST_KEY)).toBe('{"v":1,"d":"dark"}');
    terminalSkinStore.toggle();
    expect(terminalSkinStore.get()).toBe("light");
    expect(root.attrs.has(SKIN_ATTR)).toBe(false);
    expect(storage.data.get(SKIN_PERSIST_KEY)).toBe('{"v":1,"d":"light"}');
  });

  it("set() is a no-op when nothing changes, and notifies subscribers when it does", () => {
    const storage = fakeStorage();
    install(storage, root);
    const seen = vi.fn();
    const off = terminalSkinStore.subscribe(seen);
    terminalSkinStore.set("light");
    expect(seen).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    terminalSkinStore.set("dark");
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    terminalSkinStore.set("light");
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

describe("SKIN_BOOT_SCRIPT", () => {
  function run(getItem: (k: string) => string | null) {
    const root = fakeRoot();
    const asked: string[] = [];
    const localStorage = {
      getItem: (k: string) => {
        asked.push(k);
        return getItem(k);
      },
    };
    const document = { documentElement: root };
    const fn = new Function("localStorage", "document", SKIN_BOOT_SCRIPT);
    expect(() => fn(localStorage, document)).not.toThrow();
    return { root, asked };
  }

  it("reads the same key and sets the same attribute the store does", () => {
    const { root, asked } = run(() => DARK_ENVELOPE);
    expect(asked).toEqual([SKIN_PERSIST_KEY]);
    expect(root.attrs.get(SKIN_ATTR)).toBe("dark");
  });

  it("sets the attribute only for a v2 'dark' envelope", () => {
    expect(run(() => DARK_ENVELOPE).root.attrs.get(SKIN_ATTR)).toBe("dark");
  });

  it("does nothing for light, garbage JSON, a wrong version, or an empty store", () => {
    const cases: Array<string | null> = [
      JSON.stringify({ v: SKIN_PERSIST_VERSION, d: "light" }),
      "{not json",
      "null",
      '"dark"',
      JSON.stringify({ v: SKIN_PERSIST_VERSION + 1, d: "dark" }),
      JSON.stringify({ d: "dark" }),
      JSON.stringify({ v: SKIN_PERSIST_VERSION, d: "Dark" }),
      "",
      null,
    ];
    for (const raw of cases) {
      expect(run(() => raw).root.attrs.size, `stored: ${String(raw)}`).toBe(0);
    }
  });

  it("does not throw, and does nothing, when getItem throws (private mode, a sandboxed iframe)", () => {
    const { root } = run(() => {
      throw new Error("SecurityError");
    });
    expect(root.attrs.size).toBe(0);
  });
});
