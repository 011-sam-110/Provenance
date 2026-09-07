import { beforeEach, describe, expect, it } from "vitest";
import { watchingStore, watchingFeatures } from "@/lib/console/widgets/camslot.watching";

const at = (key: string) => (key === "cam:missing" ? null : { lat: 1, lon: 2 });

describe("watchingStore", () => {
  beforeEach(() => { watchingStore.reset(); });

  it("collects assigned and on-air keys across tiles", () => {
    watchingStore.setTile("t1", [{ k: "cam", id: "a" }, { k: "cam", id: "b" }], { k: "cam", id: "a" });
    watchingStore.setTile("t2", [{ k: "cam", id: "c" }], { k: "cam", id: "c" });
    const s = watchingStore.get();
    expect([...s.assigned].sort()).toEqual(["cam:a", "cam:b", "cam:c"]);
    expect([...s.onAir].sort()).toEqual(["cam:a", "cam:c"]);
  });

  it("forgets a tile that is removed", () => {
    watchingStore.setTile("t1", [{ k: "cam", id: "a" }], { k: "cam", id: "a" });
    watchingStore.dropTile("t1");
    expect(watchingStore.get().assigned.size).toBe(0);
  });

  it("notifies subscribers when a tile rotates", () => {
    let hits = 0;
    const off = watchingStore.subscribe(() => { hits++; });
    watchingStore.setTile("t1", [{ k: "cam", id: "a" }, { k: "cam", id: "b" }], { k: "cam", id: "a" });
    watchingStore.setTile("t1", [{ k: "cam", id: "a" }, { k: "cam", id: "b" }], { k: "cam", id: "b" });
    off();
    expect(hits).toBeGreaterThanOrEqual(2);
  });

  it("returns an IDENTICAL snapshot when nothing changed", () => {
    // useSyncExternalStore loops forever if get() derives a fresh object each call.
    expect(watchingStore.get()).toBe(watchingStore.get());
  });
});

describe("watchingFeatures", () => {
  it("marks an on-air camera as on-air and an assigned one as assigned", () => {
    const state = { assigned: new Set(["cam:a", "cam:b"]), onAir: new Set(["cam:a"]) };
    const f = watchingFeatures(state, at);
    const byKey = Object.fromEntries(f.map((x) => [x.properties!.key, x.properties!.onair]));
    expect(byKey["cam:a"]).toBe(1);
    expect(byKey["cam:b"]).toBe(0);
  });

  it("drops a camera whose position is unknown rather than placing it at 0,0", () => {
    const state = { assigned: new Set(["cam:missing"]), onAir: new Set<string>() };
    expect(watchingFeatures(state, at)).toEqual([]);
  });

  it("never emits an on-air key that is not also assigned", () => {
    const state = { assigned: new Set(["cam:a"]), onAir: new Set(["cam:a", "cam:ghost"]) };
    expect(watchingFeatures(state, at).map((x) => x.properties!.key)).toEqual(["cam:a"]);
  });
});
