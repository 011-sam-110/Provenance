import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createSourcePreview,
  isPhoneClass,
  kindOf,
  previewAllowed,
  previewIdsForSection,
  withPreview,
  type PreviewCamera,
  type PreviewWebcam,
  type SourcePreviewOptions,
} from "@/lib/shell/sourcePreview";
import type { LayerState } from "@/lib/layers";
import type { MapSignalRead } from "@/lib/signals/mapFeedPoll";

const root = join(__dirname, "..", "..");

function feature(id: string) {
  return { id: `${id}:1`, lat: 1, lon: 2, title: id, signalId: id };
}

/** A preview with fake readers: every read is counted, and each answers after `ms`. */
function make(over: Partial<SourcePreviewOptions> = {}, replyMs = 100) {
  const reads: string[] = [];
  const reply = <T>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), replyMs));
  const store = createSourcePreview({
    readSignal: (id) => {
      reads.push(id);
      return reply<MapSignalRead>({ ok: true, features: [feature(id)], declaredOk: true });
    },
    readCameras: () => {
      reads.push("cameras");
      return reply<PreviewCamera[]>([
        { id: "c1", name: "c1", lat: 1, lon: 1, available: true, source: "x", country: "GB", live: true },
      ]);
    },
    readWebcams: () => {
      reads.push("webcams");
      return reply<PreviewWebcam[]>([{ id: "w1", title: "w", lat: 1, lon: 1 }]);
    },
    ...over,
  });
  return { store, reads };
}

describe("createSourcePreview", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("nothing is read before 250 ms of rest, and one read after", async () => {
    const { store, reads } = make();
    store.want(["earthquakes"]);
    expect(store.status("earthquakes")).toBe("waiting");
    await vi.advanceTimersByTimeAsync(249);
    expect(reads).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(reads).toEqual(["earthquakes"]);
    expect(store.status("earthquakes")).toBe("loading");
    await vi.advanceTimersByTimeAsync(100);
    expect(store.status("earthquakes")).toBe("ready");
    expect(store.data("earthquakes")).toEqual([feature("earthquakes")]);
  });

  test("immediate reads at once", async () => {
    const { store, reads } = make();
    store.want(["earthquakes"], { immediate: true });
    expect(reads).toEqual(["earthquakes"]);
    expect(store.status("earthquakes")).toBe("loading");
  });

  test("an immediate want also pulls a read that was waiting for its rest", async () => {
    const { store, reads } = make();
    store.want(["earthquakes"]);
    await vi.advanceTimersByTimeAsync(100);
    store.want(["earthquakes"], { immediate: true });
    expect(reads).toEqual(["earthquakes"]);
  });

  test("a sweep reads nothing", async () => {
    const { store, reads } = make();
    store.want(["a"]);
    await vi.advanceTimersByTimeAsync(60);
    store.want(["b"]);
    await vi.advanceTimersByTimeAsync(60);
    store.want([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(reads).toEqual([]);
    expect(store.status("a")).toBe("idle");
    expect(store.status("b")).toBe("idle");
  });

  test("cached for 5 minutes: no second read, then a re-read after the TTL", async () => {
    const { store, reads } = make();
    store.want(["earthquakes"], { immediate: true });
    await vi.advanceTimersByTimeAsync(100);
    store.want([]);
    store.want(["earthquakes"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(reads).toEqual(["earthquakes"]);
    expect(store.status("earthquakes")).toBe("ready");
    await vi.advanceTimersByTimeAsync(300_000);
    expect(store.data("earthquakes")).toBeUndefined();
    store.want([]);
    store.want(["earthquakes"], { immediate: true });
    expect(reads).toEqual(["earthquakes", "earthquakes"]);
  });

  test("keeps the last 12 sources: the 13th read drops the oldest", async () => {
    const { store } = make({}, 10);
    const ids = Array.from({ length: 13 }, (_, i) => `s${i}`);
    for (const id of ids) {
      store.want([id], { immediate: true });
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(store.data("s0")).toBeUndefined();
    for (const id of ids.slice(1)) expect(store.data(id), id).toBeDefined();
  });

  test("a heading that wants more than 12 keeps all of them while they are wanted", async () => {
    const { store } = make({}, 10);
    const ids = Array.from({ length: 13 }, (_, i) => `s${i}`);
    store.want(ids, { immediate: true });
    await vi.advanceTimersByTimeAsync(50);
    for (const id of ids) expect(store.data(id), id).toBeDefined();
  });

  test("two wants for the same id give one read", async () => {
    const { store, reads } = make();
    store.want(["earthquakes"], { immediate: true });
    store.want(["earthquakes"], { immediate: true });
    store.want(["earthquakes", "wildfires"], { immediate: true });
    expect(reads).toEqual(["earthquakes", "wildfires"]);
  });

  test("a want([]) in the middle of a read still fills the cache and the status", async () => {
    const { store, reads } = make();
    store.want(["earthquakes"], { immediate: true });
    await vi.advanceTimersByTimeAsync(40);
    store.want([]);
    expect(store.wanted()).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    expect(reads).toEqual(["earthquakes"]);
    expect(store.status("earthquakes")).toBe("ready");
    expect(store.data("earthquakes")).toBeDefined();
  });

  test("a read that never answers is a failure after 20 s, and is asked again after 30 s", async () => {
    let call = 0;
    const store = createSourcePreview({
      readSignal: () => {
        call += 1;
        return new Promise<MapSignalRead>(() => {});
      },
      readCameras: () => new Promise(() => {}),
      readWebcams: () => new Promise(() => {}),
    });
    store.want(["earthquakes"], { immediate: true });
    expect(store.status("earthquakes")).toBe("loading");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(store.status("earthquakes")).toBe("failed");
    // Held for 30 s: another hover straight away does not read.
    store.want([]);
    store.want(["earthquakes"], { immediate: true });
    expect(call).toBe(1);
    await vi.advanceTimersByTimeAsync(30_000);
    store.want([]);
    store.want(["earthquakes"], { immediate: true });
    expect(call).toBe(2);
  });

  test("a failed read says failed; an empty read says empty", async () => {
    const { store } = make({
      readSignal: (id) =>
        Promise.resolve<MapSignalRead>(
          id === "bad"
            ? { ok: false, reason: "HTTP 500" }
            : { ok: true, features: [], declaredOk: true },
        ),
    });
    store.want(["bad", "quiet"], { immediate: true });
    await vi.advanceTimersByTimeAsync(10);
    expect(store.status("bad")).toBe("failed");
    expect(store.status("quiet")).toBe("empty");
  });

  test("a throwing reader is a failure, not an exception", async () => {
    const { store } = make({ readSignal: () => Promise.reject(new Error("offline")) });
    store.want(["earthquakes"], { immediate: true });
    await vi.advanceTimersByTimeAsync(10);
    expect(store.status("earthquakes")).toBe("failed");
  });

  test("an id the map already draws is never read, and is not wanted", async () => {
    const { store, reads } = make();
    store.want(["earthquakes", "wildfires"], { immediate: true, isDrawn: (id) => id === "earthquakes" });
    expect(reads).toEqual(["wildfires"]);
    expect(store.wanted()).toEqual(["wildfires"]);
  });

  test("cameras on a phone are unavailable and make no read; on desktop they read once for both tiers", async () => {
    const phone = make();
    phone.store.want(["livecams", "staticcams"], { immediate: true, phone: true });
    expect(phone.reads).toEqual([]);
    expect(phone.store.status("livecams")).toBe("unavailable");
    expect(phone.store.status("staticcams")).toBe("unavailable");

    const desk = make();
    desk.store.want(["livecams", "staticcams"], { immediate: true, phone: false });
    expect(desk.reads).toEqual(["cameras"]);
    await vi.advanceTimersByTimeAsync(100);
    expect(desk.store.status("livecams")).toBe("ready");
    expect(desk.store.status("staticcams")).toBe("ready");
    expect(desk.store.data("cameras")).toHaveLength(1);
  });

  test("a signal still previews on a phone", async () => {
    const { store, reads } = make();
    store.want(["earthquakes"], { immediate: true, phone: true });
    expect(reads).toEqual(["earthquakes"]);
  });

  test("cameras already loaded elsewhere need no read", async () => {
    const { store, reads } = make();
    store.want(["livecams"], { immediate: true, have: () => true });
    expect(reads).toEqual([]);
    expect(store.status("livecams")).toBe("ready");
  });

  test("Static cams reads the webcam catalogue only once the map has zoomed in", async () => {
    const away = make();
    away.store.want(["staticcams"], { immediate: true, webcamsArmed: false });
    expect(away.reads).toEqual(["cameras"]);
    const near = make();
    near.store.want(["staticcams"], { immediate: true, webcamsArmed: true });
    expect(near.reads).toEqual(["cameras", "webcams"]);
    await vi.advanceTimersByTimeAsync(100);
    expect(near.store.data("webcams")).toHaveLength(1);
  });

  test("planes and satellites are fed by WorldMap: waiting, loading after the rest, then whatever it reports", async () => {
    const { store, reads } = make();
    store.want(["planes"]);
    expect(store.status("planes")).toBe("waiting");
    await vi.advanceTimersByTimeAsync(250);
    expect(store.status("planes")).toBe("loading");
    store.setStatus("planes", "ready");
    expect(store.status("planes")).toBe("ready");
    expect(reads).toEqual([]);
    // Kept for 5 minutes: the next hover is ready at once.
    store.want([]);
    store.want(["planes"]);
    expect(store.status("planes")).toBe("ready");
  });

  test("a feed that never answers is failed after 20 s", async () => {
    const { store } = make();
    store.want(["satellites"], { immediate: true });
    expect(store.status("satellites")).toBe("loading");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(store.status("satellites")).toBe("failed");
  });

  test("Borders & names has nothing to read and is ready while wanted", () => {
    const { store, reads } = make();
    store.want(["countries"]);
    expect(store.status("countries")).toBe("ready");
    expect(reads).toEqual([]);
    store.want([]);
    expect(store.status("countries")).toBe("idle");
  });

  test("subscribers hear status changes, and unsubscribing stops them", async () => {
    const { store } = make();
    let n = 0;
    const off = store.subscribe(() => (n += 1));
    store.want(["earthquakes"], { immediate: true });
    await vi.advanceTimersByTimeAsync(100);
    expect(n).toBeGreaterThanOrEqual(2);
    off();
    const before = n;
    store.want([]);
    expect(n).toBe(before);
  });

  test("shown() is the status only while the id is wanted, so a leftover read paints no spinner", async () => {
    const { store } = make();
    store.want(["earthquakes"], { immediate: true });
    expect(store.shown("earthquakes")).toBe("loading");
    store.want([]);
    expect(store.status("earthquakes")).toBe("loading"); // still reading, into the cache
    expect(store.shown("earthquakes")).toBe("idle");
    await vi.advanceTimersByTimeAsync(100);
    store.want(["earthquakes"]);
    expect(store.shown("earthquakes")).toBe("ready");
  });

  test("frame subscribers run once per animation frame however many changes landed in it", async () => {
    const frames: Array<() => void> = [];
    const { store } = make({
      requestFrame: (fn) => {
        frames.push(fn);
        return frames.length;
      },
      cancelFrame: () => {},
    });
    let drawn = 0;
    store.subscribeFrame(() => (drawn += 1));
    // Nothing has happened: no frame is asked for.
    expect(frames).toHaveLength(0);
    store.want(["a", "b", "c"], { immediate: true }); // several changes in one go
    store.want(["a", "b", "c", "d"], { immediate: true });
    expect(frames).toHaveLength(1);
    expect(drawn).toBe(0);
    frames.shift()!();
    expect(drawn).toBe(1);
    // Reads that land together are one more frame, not one each.
    await vi.advanceTimersByTimeAsync(100);
    expect(frames).toHaveLength(1);
    frames.shift()!();
    expect(drawn).toBe(2);
    // poke asks for a frame when something a subscriber reads has changed elsewhere.
    store.poke();
    store.poke();
    expect(frames).toHaveLength(1);
  });

  test("the last frame subscriber to leave cancels a pending frame, and with none there is no frame at all", () => {
    const cancelled: unknown[] = [];
    const frames: Array<() => void> = [];
    const { store } = make({
      requestFrame: (fn) => {
        frames.push(fn);
        return "handle";
      },
      cancelFrame: (h) => cancelled.push(h),
    });
    store.want(["a"], { immediate: true });
    expect(frames).toHaveLength(0); // nobody is listening
    const off = store.subscribeFrame(() => {});
    store.poke();
    expect(frames).toHaveLength(1);
    off();
    expect(cancelled).toEqual(["handle"]);
  });

  test("wanted() keeps its identity while the set does not change", () => {
    const { store } = make();
    store.want(["a", "b"]);
    const first = store.wanted();
    store.want(["a", "b"]);
    expect(store.wanted()).toBe(first);
  });
});

describe("the pure helpers", () => {
  test("kindOf", () => {
    expect(kindOf("livecams")).toBe("cameras");
    expect(kindOf("staticcams")).toBe("cameras");
    expect(kindOf("planes")).toBe("planes");
    expect(kindOf("satellites")).toBe("satellites");
    expect(kindOf("countries")).toBe("countries");
    expect(kindOf("earthquakes")).toBe("signal");
  });

  test("isPhoneClass is a coarse pointer on a screen of at most 900 px", () => {
    expect(isPhoneClass({ coarsePointer: true, width: 390 })).toBe(true);
    expect(isPhoneClass({ coarsePointer: true, width: 900 })).toBe(true);
    expect(isPhoneClass({ coarsePointer: true, width: 901 })).toBe(false);
    expect(isPhoneClass({ coarsePointer: false, width: 390 })).toBe(false);
  });

  test("previewAllowed refuses only the camera kind on a phone", () => {
    expect(previewAllowed("livecams", { phone: true })).toBe(false);
    expect(previewAllowed("staticcams", { phone: true })).toBe(false);
    expect(previewAllowed("livecams", { phone: false })).toBe(true);
    for (const id of ["earthquakes", "planes", "satellites", "countries"]) {
      expect(previewAllowed(id, { phone: true }), id).toBe(true);
    }
  });

  test("previewIdsForSection takes every row with a map layer, on or off", () => {
    expect(
      previewIdsForSection([{ id: "a" }, { id: "news", widgetOnly: true }, { id: "b" }]),
    ).toEqual(["a", "b"]);
  });

  test("withPreview forces the previewed core keys on and leaves the original alone", () => {
    const layers = { livecams: false, staticcams: false, planes: false, satellites: true, countries: false } as unknown as LayerState;
    const out = withPreview(layers, ["planes", "countries"]) as unknown as Record<string, boolean>;
    expect(out.planes).toBe(true);
    expect(out.countries).toBe(true);
    expect(out.satellites).toBe(true);
    expect(out.livecams).toBe(false);
    expect((layers as unknown as Record<string, boolean>).planes).toBe(false);
    // Nothing to force: the same object comes back.
    expect(withPreview(layers, [])).toBe(layers);
    // A key that is not a layer is ignored.
    expect((withPreview(layers, ["earthquakes"]) as unknown as Record<string, boolean>).earthquakes).toBeUndefined();
  });
});

describe("a preview writes nothing that outlives it", () => {
  // THE ONE HARD RULE of lib/shell/sourcePreview.ts. These two files are the whole of
  // the preview's data path, and neither may import a store: the layer toggles, the
  // saved board, the layout, the link, the counts and the freshness chips all belong to
  // something that is switched on.
  const FORBIDDEN = [
    "layersStore",
    "signalsStore",
    "variantStore",
    "inspectorStore",
    "shellLayoutStore",
    "metricsStore",
    "freshnessStore",
    "signalCountsStore",
    "signalFreshnessStore",
    "loadedCamerasStore",
    "loadedWebcamsStore",
    "coverageStore",
    "scheduleUrlWrite",
  ];

  for (const file of ["lib/shell/sourcePreview.ts", "lib/map/signalObjects.ts"]) {
    test(`${file} imports none of them`, () => {
      const src = readFileSync(join(root, file), "utf8");
      const imports = src.split("\n").filter((l) => /^\s*(import|export)\b.*\bfrom\b|^\s*import\s+["']/.test(l)).join("\n");
      for (const name of FORBIDDEN) expect(imports, `${file} imports ${name}`).not.toContain(name);
      // And it does not call one either.
      const code = src
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join("\n");
      for (const name of FORBIDDEN) expect(code, `${file} uses ${name}`).not.toContain(name);
    });
  }
});
