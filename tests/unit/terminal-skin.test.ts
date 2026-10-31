import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadPersisted } from "@/lib/shell/persist";
import { SKIN_HEAD_SCRIPT } from "@/lib/terminal/skinBoot";
import {
  DEFAULT_TERMINAL_SKIN,
  SKIN_ATTR,
  SKIN_BOOT_SCRIPT,
  SKIN_PERSIST_KEY,
  SKIN_PERSIST_VERSION,
  applySkin,
  coerceTerminalSkin,
  terminalSkinStore,
  type TerminalSkin,
} from "@/lib/terminal/skin";

/**
 * The console opens dark. Settings > Display switches it to light, and that choice is
 * remembered in the browser. The rules worth a test are the ones that fail SILENTLY: a
 * saved light turning dark, a saved dark turning light, hydrate() writing a "choice" nobody
 * made, a corrupt value reaching the page, or the before-paint script throwing in a private
 * window.
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

const envelope = (d: unknown, v: number = SKIN_PERSIST_VERSION) => JSON.stringify({ v, d });
const DARK_ENVELOPE = envelope("dark");
const LIGHT_ENVELOPE = envelope("light");

/** Everything in the store that is not a saved choice, and must read as "never chose". */
const NOT_A_CHOICE: Array<string | null> = [
  "{not json",
  "null",
  '"light"',
  '"dark"',
  "[]",
  "0",
  envelope("light", SKIN_PERSIST_VERSION + 1),
  JSON.stringify({ d: "light" }),
  envelope("Light"),
  envelope("LIGHT"),
  envelope("light "),
  envelope(""),
  envelope(null),
  envelope({}),
  "",
  null,
];

/** The store reaches storage through `window.localStorage` and the DOM through `document`. */
function install(storage: ReturnType<typeof fakeStorage>, root: ReturnType<typeof fakeRoot>) {
  vi.stubGlobal("window", { localStorage: storage });
  vi.stubGlobal("document", { documentElement: root });
}

describe("coerceTerminalSkin", () => {
  it("keeps the two real values", () => {
    expect(coerceTerminalSkin("dark")).toBe("dark");
    expect(coerceTerminalSkin("light")).toBe("light");
  });

  it("is dark for everything else, so a corrupt value can never turn the console light", () => {
    for (const v of ["Light", "LIGHT", "", null, undefined, 0, 1, true, {}, [], "light "]) {
      expect(coerceTerminalSkin(v)).toBe("dark");
    }
  });

  it("defaults to dark", () => {
    expect(DEFAULT_TERMINAL_SKIN).toBe("dark");
  });
});

describe("the persistence key", () => {
  it("is v2: this key's saved lights were chosen on purpose, and they stay", () => {
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
    terminalSkinStore.hydrate(); // back to a known state: nothing stored, dark
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts dark", () => {
    expect(terminalSkinStore.get()).toBe("dark");
    expect(root.attrs.get(SKIN_ATTR)).toBe("dark");
  });

  it("hydrate() with nothing stored stays dark AND writes nothing", () => {
    // Seeding the default would turn "never chose" into "chose dark".
    const storage = fakeStorage();
    install(storage, root);
    terminalSkinStore.hydrate();
    expect(terminalSkinStore.get()).toBe("dark");
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.data.size).toBe(0);
  });

  it("hydrate() keeps a stored 'light', takes the attribute off, and writes nothing", () => {
    const storage = fakeStorage({ [SKIN_PERSIST_KEY]: LIGHT_ENVELOPE });
    install(storage, root);
    terminalSkinStore.hydrate();
    expect(terminalSkinStore.get()).toBe("light");
    expect(root.attrs.has(SKIN_ATTR)).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("hydrate() keeps a stored 'dark' and writes nothing", () => {
    const storage = fakeStorage({ [SKIN_PERSIST_KEY]: DARK_ENVELOPE });
    install(storage, root);
    terminalSkinStore.hydrate();
    expect(terminalSkinStore.get()).toBe("dark");
    expect(root.attrs.get(SKIN_ATTR)).toBe("dark");
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("anything else in the key is the default, and stays in the key", () => {
    for (const raw of NOT_A_CHOICE) {
      if (raw === null) continue;
      const storage = fakeStorage({ [SKIN_PERSIST_KEY]: raw });
      install(storage, root);
      terminalSkinStore.hydrate();
      expect(terminalSkinStore.get(), `stored: ${raw}`).toBe("dark");
      expect(storage.setItem).not.toHaveBeenCalled();
    }
  });

  it("a stored tn.terminal.skin.v1 (from before #162) is not read at all", () => {
    for (const d of ["dark", "light"]) {
      const storage = fakeStorage({ "tn.terminal.skin.v1": JSON.stringify({ v: 1, d }) });
      install(storage, root);
      terminalSkinStore.hydrate();
      expect(terminalSkinStore.get()).toBe("dark");
    }
  });

  it("a tn.ui.v1 theme of 'light' stays dark: the theme is not the skin", () => {
    const storage = fakeStorage({ "tn.ui.v1": JSON.stringify({ v: 1, d: { theme: "light" } }) });
    install(storage, root);
    terminalSkinStore.hydrate();
    expect(terminalSkinStore.get()).toBe("dark");
    expect(root.attrs.get(SKIN_ATTR)).toBe("dark");
  });

  it("storage that throws means dark, with no error (private mode, a sandboxed iframe)", () => {
    const refusing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => undefined,
    };
    vi.stubGlobal("window", { localStorage: refusing });
    vi.stubGlobal("document", { documentElement: root });
    expect(() => terminalSkinStore.hydrate()).not.toThrow();
    expect(terminalSkinStore.get()).toBe("dark");
    // The choice cannot be saved, and it still applies to this page.
    expect(() => terminalSkinStore.set("light")).not.toThrow();
    expect(terminalSkinStore.get()).toBe("light");
    expect(root.attrs.has(SKIN_ATTR)).toBe(false);
  });

  it("set() applies the skin and writes the envelope, both ways", () => {
    const storage = fakeStorage();
    install(storage, root);
    terminalSkinStore.set("light");
    expect(terminalSkinStore.get()).toBe("light");
    expect(root.attrs.has(SKIN_ATTR)).toBe(false);
    expect(storage.data.get(SKIN_PERSIST_KEY)).toBe('{"v":1,"d":"light"}');
    terminalSkinStore.set("dark");
    expect(terminalSkinStore.get()).toBe("dark");
    expect(root.attrs.get(SKIN_ATTR)).toBe("dark");
    expect(storage.data.get(SKIN_PERSIST_KEY)).toBe('{"v":1,"d":"dark"}');
  });

  it("set() is a no-op when nothing changes, and notifies subscribers when it does", () => {
    const storage = fakeStorage();
    install(storage, root);
    const seen = vi.fn();
    const off = terminalSkinStore.subscribe(seen);
    terminalSkinStore.set("dark");
    expect(seen).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    terminalSkinStore.set("light");
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    terminalSkinStore.set("dark");
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

  it("leaves the attribute off only for a saved 'light'", () => {
    expect(run(() => LIGHT_ENVELOPE).root.attrs.size).toBe(0);
  });

  it("is dark for a saved 'dark', garbage JSON, a wrong version, or an empty store", () => {
    expect(run(() => DARK_ENVELOPE).root.attrs.get(SKIN_ATTR)).toBe("dark");
    for (const raw of NOT_A_CHOICE) {
      expect(run(() => raw).root.attrs.get(SKIN_ATTR), `stored: ${String(raw)}`).toBe("dark");
    }
  });

  it("is dark, with no error, when getItem throws (private mode, a sandboxed iframe)", () => {
    const { root } = run(() => {
      throw new Error("SecurityError");
    });
    expect(root.attrs.get(SKIN_ATTR)).toBe("dark");
  });

  it("is dark, with no error, when there is no localStorage at all", () => {
    const root = fakeRoot();
    const fn = new Function("localStorage", "document", SKIN_BOOT_SCRIPT);
    expect(() => fn(undefined, { documentElement: root })).not.toThrow();
    expect(root.attrs.get(SKIN_ATTR)).toBe("dark");
  });

  it("agrees with the store on every value, so the first paint and hydrate() cannot differ", () => {
    for (const raw of [LIGHT_ENVELOPE, DARK_ENVELOPE, ...NOT_A_CHOICE]) {
      const storage = { getItem: () => raw, setItem: () => undefined, removeItem: () => undefined };
      const saved = loadPersisted<TerminalSkin>(SKIN_PERSIST_KEY, SKIN_PERSIST_VERSION, storage);
      const painted = run(() => raw).root.attrs.get(SKIN_ATTR) === "dark" ? "dark" : "light";
      expect(painted, `stored: ${String(raw)}`).toBe(coerceTerminalSkin(saved));
    }
  });

  it("leaves no variable behind on the page", () => {
    // An inline script's `var` is a property of window. This one runs on every load of /app.
    expect(SKIN_BOOT_SCRIPT.startsWith("(function(){")).toBe(true);
    expect(SKIN_BOOT_SCRIPT.endsWith("})()")).toBe(true);
  });
});

describe("SKIN_HEAD_SCRIPT", () => {
  function runAt(pathname: string, saved: string | null = null) {
    const root = fakeRoot();
    const fn = new Function("location", "localStorage", "document", SKIN_HEAD_SCRIPT);
    expect(() => fn({ pathname }, { getItem: () => saved }, { documentElement: root })).not.toThrow();
    return root.attrs.get(SKIN_ATTR);
  }

  it("decides on /app exactly as the boot script does", () => {
    expect(runAt("/app")).toBe("dark");
    expect(runAt("/app", DARK_ENVELOPE)).toBe("dark");
    expect(runAt("/app", LIGHT_ENVELOPE)).toBeUndefined();
    expect(runAt("/app", "{not json")).toBe("dark");
  });

  it("does nothing anywhere else, whatever is saved: the landing page must not go dark", () => {
    for (const path of ["/", "/privacy", "/eye", "/camera/x", "/application", "/app/x"]) {
      expect(runAt(path), path).toBeUndefined();
      expect(runAt(path, DARK_ENVELOPE), path).toBeUndefined();
    }
  });

  it("is in the root layout's <head>, before any body exists", () => {
    const layout = readFileSync(resolve(__dirname, "..", "..", "app", "layout.tsx"), "utf8");
    const head = layout.slice(layout.indexOf("<head>"), layout.indexOf("</head>"));
    expect(head).toContain("__html: SKIN_HEAD_SCRIPT");
    expect(layout.indexOf("</head>")).toBeLessThan(layout.indexOf("<body>"));
  });

  it("the server layouts take it from skinBoot, because skin.ts is a client module", () => {
    // A server layout importing a value from a "use client" file gets a client reference.
    const root = resolve(__dirname, "..", "..");
    expect(readFileSync(resolve(root, "lib", "terminal", "skinBoot.ts"), "utf8")).not.toMatch(/^"use client"/m);
    for (const file of [["app", "layout.tsx"], ["app", "(console)", "app", "layout.tsx"]]) {
      const src = readFileSync(resolve(root, ...file), "utf8");
      expect(src, file.join("/")).toContain('from "@/lib/terminal/skinBoot"');
      expect(src, file.join("/")).not.toContain('from "@/lib/terminal/skin"');
    }
  });
});
