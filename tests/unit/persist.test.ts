import { expect, test } from "vitest";
import { loadPersisted, removePersisted, savePersisted } from "@/lib/shell/persist";

// A minimal in-memory Storage shim so the round-trip + version guard are testable
// in the node vitest environment (there is no real `window.localStorage`).
function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    _map: map,
  };
}

test("round-trips a value under the matching version", () => {
  const s = fakeStorage();
  savePersisted("tn.test", 1, { railOpen: false, n: 3 }, s);
  expect(loadPersisted<{ railOpen: boolean; n: number }>("tn.test", 1, s)).toEqual({ railOpen: false, n: 3 });
});

test("returns null on a version mismatch (schema bump invalidates old data)", () => {
  const s = fakeStorage();
  savePersisted("tn.test", 1, { a: 1 }, s);
  expect(loadPersisted("tn.test", 2, s)).toBeNull();
});

test("returns null on a missing key", () => {
  const s = fakeStorage();
  expect(loadPersisted("tn.absent", 1, s)).toBeNull();
});

test("returns null (not throw) on corrupt JSON", () => {
  const s = fakeStorage();
  s._map.set("tn.bad", "{ not json");
  expect(loadPersisted("tn.bad", 1, s)).toBeNull();
});

test("no-ops silently when storage is unavailable", () => {
  // No window in node, no injected storage → load returns null, save does nothing.
  expect(() => savePersisted("tn.x", 1, { a: 1 })).not.toThrow();
  expect(loadPersisted("tn.x", 1)).toBeNull();
});

test("removePersisted deletes the key, and leaves its neighbours alone", () => {
  const s = fakeStorage();
  savePersisted("tn.test", 1, { a: 1 }, s);
  savePersisted("tn.other", 1, { b: 2 }, s);
  removePersisted("tn.test", s);
  expect(loadPersisted("tn.test", 1, s)).toBeNull();
  expect(s._map.has("tn.test")).toBe(false);
  expect(loadPersisted("tn.other", 1, s)).toEqual({ b: 2 });
});

test("removePersisted is a no-op without storage and never throws", () => {
  // No `window` in the node environment and no storage handed in.
  expect(() => removePersisted("tn.absent")).not.toThrow();
  const throwing = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {
      throw new Error("denied");
    },
  };
  expect(() => removePersisted("tn.test", throwing)).not.toThrow();
});
