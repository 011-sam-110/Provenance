// tests/unit/terminal-mode.test.ts
//
// The store is module-level singleton state, so every test resets it back to the
// default first — vitest shares one module instance across the tests in this file.
import { describe, it, expect, beforeEach } from "vitest";
import {
  coerceTerminalMode,
  DEFAULT_TERMINAL_MODE,
  terminalModeStore,
  type TerminalMode,
} from "@/lib/terminal/mode";

beforeEach(() => {
  terminalModeStore.set(DEFAULT_TERMINAL_MODE);
});

describe("coerceTerminalMode", () => {
  it("keeps both valid modes", () => {
    expect(coerceTerminalMode("console")).toBe("console");
    expect(coerceTerminalMode("wall")).toBe("wall");
  });

  it("defaults to console", () => {
    expect(DEFAULT_TERMINAL_MODE).toBe("console");
  });

  it("rejects the capitalised design labels", () => {
    // "CONSOLE"/"WALL" are what the chrome prints, not what it stores. If those were
    // accepted a label could round-trip into localStorage as if it were state.
    expect(coerceTerminalMode("WALL")).toBe("console");
    expect(coerceTerminalMode("Wall")).toBe("console");
    expect(coerceTerminalMode("CONSOLE")).toBe("console");
  });

  it("rejects nullish input (a storage miss reads as null)", () => {
    expect(coerceTerminalMode(null)).toBe("console");
    expect(coerceTerminalMode(undefined)).toBe("console");
  });

  it("rejects non-strings", () => {
    expect(coerceTerminalMode(0)).toBe("console");
    expect(coerceTerminalMode(1)).toBe("console");
    expect(coerceTerminalMode(NaN)).toBe("console");
    expect(coerceTerminalMode(true)).toBe("console");
    expect(coerceTerminalMode(false)).toBe("console");
    expect(coerceTerminalMode({})).toBe("console");
    expect(coerceTerminalMode({ mode: "wall" })).toBe("console");
    expect(coerceTerminalMode(["wall"])).toBe("console");
    expect(coerceTerminalMode(() => "wall")).toBe("console");
  });

  it("rejects near-misses and whitespace", () => {
    expect(coerceTerminalMode("")).toBe("console");
    expect(coerceTerminalMode(" wall")).toBe("console");
    expect(coerceTerminalMode("wall ")).toBe("console");
    expect(coerceTerminalMode("walls")).toBe("console");
    expect(coerceTerminalMode("explore")).toBe("console"); // the ViewMode value, not ours
  });

  it("is pure — the same input always gives the same answer", () => {
    const inputs: unknown[] = ["wall", "console", "WALL", null, 7, {}];
    const first = inputs.map(coerceTerminalMode);
    expect(inputs.map(coerceTerminalMode)).toEqual(first);
  });
});

describe("terminalModeStore", () => {
  it("starts on the default", () => {
    expect(terminalModeStore.get()).toBe(DEFAULT_TERMINAL_MODE);
  });

  it("set() moves the mode and notifies subscribers", () => {
    const seen: TerminalMode[] = [];
    const unsub = terminalModeStore.subscribe(() => seen.push(terminalModeStore.get()));

    terminalModeStore.set("wall");
    expect(terminalModeStore.get()).toBe("wall");
    // The listener must observe the NEW value: state is assigned before emit(), so a
    // useSyncExternalStore consumer reading get() in its callback sees the update.
    expect(seen).toEqual(["wall"]);

    unsub();
  });

  it("set() to the current mode is a no-op and emits nothing", () => {
    let calls = 0;
    const unsub = terminalModeStore.subscribe(() => {
      calls += 1;
    });

    terminalModeStore.set("console"); // already console (beforeEach)
    expect(calls).toBe(0);
    expect(terminalModeStore.get()).toBe("console");

    unsub();
  });

  it("toggle() flips both ways and emits each time", () => {
    const seen: TerminalMode[] = [];
    const unsub = terminalModeStore.subscribe(() => seen.push(terminalModeStore.get()));

    terminalModeStore.toggle();
    expect(terminalModeStore.get()).toBe("wall");
    terminalModeStore.toggle();
    expect(terminalModeStore.get()).toBe("console");
    expect(seen).toEqual(["wall", "console"]);

    unsub();
  });

  it("fans out to every subscriber", () => {
    let a = 0;
    let b = 0;
    const unsubA = terminalModeStore.subscribe(() => {
      a += 1;
    });
    const unsubB = terminalModeStore.subscribe(() => {
      b += 1;
    });

    terminalModeStore.set("wall");
    expect([a, b]).toEqual([1, 1]);

    unsubA();
    unsubB();
  });

  it("unsubscribe stops notifications without disturbing the others", () => {
    let dead = 0;
    let live = 0;
    const unsubDead = terminalModeStore.subscribe(() => {
      dead += 1;
    });
    const unsubLive = terminalModeStore.subscribe(() => {
      live += 1;
    });

    unsubDead();
    terminalModeStore.set("wall");
    expect(dead).toBe(0);
    expect(live).toBe(1);

    unsubLive();
  });

  it("unsubscribing twice is safe", () => {
    const unsub = terminalModeStore.subscribe(() => {});
    unsub();
    expect(() => unsub()).not.toThrow();
  });

  it("hydrate() is safe with no storage and falls back to the default", () => {
    // The node vitest environment has no `window`, which is the same situation as an
    // SSR pass or a browser with storage blocked: loadPersisted returns null and the
    // store must land on CONSOLE rather than throwing or holding a stale mode.
    terminalModeStore.set("wall");
    expect(() => terminalModeStore.hydrate()).not.toThrow();
    expect(terminalModeStore.get()).toBe(DEFAULT_TERMINAL_MODE);
  });
});
