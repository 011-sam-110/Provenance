import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLOCKS_PERSIST_KEY, clockStore } from "@/lib/console/clockStore";
import { DEFAULT_CLOCK_CODES, MAX_CLOCKS } from "@/lib/console/clockZones";

// The store reads and writes through lib/shell/persist.ts, which looks for
// window.localStorage. The node environment has none, so each test hands it a Map.
function installStorage() {
  const map = new Map<string, string>();
  const ls = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
  (globalThis as unknown as { window: unknown }).window = { localStorage: ls };
  return map;
}

let storage: Map<string, string>;

beforeEach(() => {
  storage = installStorage();
  clockStore.reset();
  storage.clear();
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("clockStore", () => {
  it("starts on the defaults, and the server snapshot is that same list", () => {
    expect(clockStore.get()).toBe(DEFAULT_CLOCK_CODES);
  });

  it("adds a clock and saves the codes in the order they were added", () => {
    clockStore.add("GRU");
    expect(clockStore.get()).toEqual([...DEFAULT_CLOCK_CODES, "GRU"]);
    const saved = JSON.parse(storage.get(CLOCKS_PERSIST_KEY) as string);
    expect(saved).toEqual({ v: 1, d: [...DEFAULT_CLOCK_CODES, "GRU"] });
  });

  it("ignores an unknown code and a repeat", () => {
    clockStore.add("ZZZ");
    clockStore.add("LHR");
    expect(clockStore.get()).toBe(DEFAULT_CLOCK_CODES);
    expect(storage.has(CLOCKS_PERSIST_KEY)).toBe(false);
  });

  it("stops at eight", () => {
    clockStore.add("GRU");
    expect(clockStore.get()).toHaveLength(MAX_CLOCKS);
    clockStore.add("SFO");
    expect(clockStore.get()).toHaveLength(MAX_CLOCKS);
    expect(clockStore.get()).not.toContain("SFO");
  });

  it("removes a clock, but the last one stays", () => {
    for (const c of ["JFK", "LHR", "DXB", "SIN", "HND", "SYD"]) clockStore.remove(c);
    expect(clockStore.get()).toEqual(["LAX"]);
    clockStore.remove("LAX");
    expect(clockStore.get()).toEqual(["LAX"]);
  });

  it("reset returns to the defaults and removes the key", () => {
    clockStore.add("GRU");
    expect(storage.has(CLOCKS_PERSIST_KEY)).toBe(true);
    clockStore.reset();
    expect(clockStore.get()).toBe(DEFAULT_CLOCK_CODES);
    expect(storage.has(CLOCKS_PERSIST_KEY)).toBe(false);
  });

  it("hydrates what was saved, and NEVER writes while doing it", () => {
    storage.set(CLOCKS_PERSIST_KEY, JSON.stringify({ v: 1, d: ["hnd", "GRU", "ZZZ"] }));
    clockStore.hydrate();
    expect(clockStore.get()).toEqual(["HND", "GRU"]);
    // The stored text is exactly what we put there: hydrate did not tidy it.
    expect(storage.get(CLOCKS_PERSIST_KEY)).toBe(JSON.stringify({ v: 1, d: ["hnd", "GRU", "ZZZ"] }));
  });

  it("hydrating with nothing saved keeps the defaults and writes nothing", () => {
    clockStore.hydrate();
    expect(clockStore.get()).toBe(DEFAULT_CLOCK_CODES);
    expect(storage.has(CLOCKS_PERSIST_KEY)).toBe(false);
  });

  it("falls back to the defaults for a stale version or garbage", () => {
    storage.set(CLOCKS_PERSIST_KEY, JSON.stringify({ v: 2, d: ["HND"] }));
    clockStore.hydrate();
    expect(clockStore.get()).toBe(DEFAULT_CLOCK_CODES);
    storage.set(CLOCKS_PERSIST_KEY, "{not json");
    clockStore.hydrate();
    expect(clockStore.get()).toBe(DEFAULT_CLOCK_CODES);
    storage.set(CLOCKS_PERSIST_KEY, JSON.stringify({ v: 1, d: "LHR" }));
    clockStore.hydrate();
    expect(clockStore.get()).toEqual([...DEFAULT_CLOCK_CODES]);
  });

  it("tells subscribers when the list changes, and stops after unsubscribe", () => {
    let calls = 0;
    const off = clockStore.subscribe(() => calls++);
    clockStore.add("GRU");
    expect(calls).toBe(1);
    clockStore.add("GRU"); // a repeat changes nothing
    expect(calls).toBe(1);
    off();
    clockStore.remove("GRU");
    expect(calls).toBe(1);
  });
});
