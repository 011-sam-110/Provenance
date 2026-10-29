import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SETTLE_MS, createSourceHover, litIdsForSection } from "@/lib/shell/sourceHover";

describe("createSourceHover", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("nothing applies before the 80 ms settle", () => {
    expect(SETTLE_MS).toBe(80);
    const store = createSourceHover();
    const seen: string[][] = [];
    store.subscribe((ids) => seen.push([...ids]));
    store.hold(["earthquakes"]);
    vi.advanceTimersByTime(79);
    expect(store.get()).toEqual([]);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(store.get()).toEqual(["earthquakes"]);
    expect(seen).toEqual([["earthquakes"]]);
  });

  test("sweeping across rows settles once, on the last one", () => {
    const store = createSourceHover();
    const seen: string[][] = [];
    store.subscribe((ids) => seen.push([...ids]));
    // leave A, enter B, 20 ms apart, the way a pointer sweeps down the list
    const a = store.hold(["a"]);
    vi.advanceTimersByTime(20);
    a();
    const b = store.hold(["b"]);
    vi.advanceTimersByTime(20);
    b();
    store.hold(["c"]);
    vi.advanceTimersByTime(80);
    expect(seen).toEqual([["c"]]);
  });

  test("the newest hold wins, and a stale release is ignored", () => {
    const store = createSourceHover();
    const releaseA = store.hold(["a"]);
    store.hold(["b"]);
    releaseA(); // the pointer already left A; B must stay
    vi.advanceTimersByTime(80);
    expect(store.get()).toEqual(["b"]);
  });

  test("a release clears after the settle, not at once", () => {
    const store = createSourceHover();
    const release = store.hold(["a"]);
    vi.advanceTimersByTime(80);
    expect(store.get()).toEqual(["a"]);
    release();
    vi.advanceTimersByTime(79);
    expect(store.get()).toEqual(["a"]);
    vi.advanceTimersByTime(1);
    expect(store.get()).toEqual([]);
  });

  test("moving from one row to the next inside the pause never shows the gap", () => {
    const store = createSourceHover();
    const seen: string[][] = [];
    const releaseA = store.hold(["a"]);
    vi.advanceTimersByTime(80);
    store.subscribe((ids) => seen.push([...ids]));
    releaseA();
    vi.advanceTimersByTime(10);
    store.hold(["b"]);
    vi.advanceTimersByTime(200);
    expect(seen).toEqual([["b"]]);
  });

  test("no notify when the settled ids are the same", () => {
    const store = createSourceHover();
    const seen: string[][] = [];
    store.subscribe((ids) => seen.push([...ids]));
    const release = store.hold(["a", "b"]);
    vi.advanceTimersByTime(80);
    release();
    store.hold(["a", "b"]);
    vi.advanceTimersByTime(80);
    expect(seen).toEqual([["a", "b"]]);
    // clearing an already clear store tells nobody either
    const other = createSourceHover();
    const none: string[][] = [];
    other.subscribe((ids) => none.push([...ids]));
    other.hold([])();
    vi.advanceTimersByTime(80);
    expect(none).toEqual([]);
  });

  test("an unsubscribed listener hears nothing", () => {
    const store = createSourceHover();
    const seen: string[][] = [];
    const off = store.subscribe((ids) => seen.push([...ids]));
    off();
    store.hold(["a"]);
    vi.advanceTimersByTime(80);
    expect(seen).toEqual([]);
    expect(store.get()).toEqual(["a"]);
  });

  test("the timer functions can be injected", () => {
    const fired: Array<() => void> = [];
    const store = createSourceHover({
      settleMs: 5,
      setTimer: (fn, ms) => {
        expect(ms).toBe(5);
        fired.push(fn);
        return fired.length;
      },
      clearTimer: () => {},
    });
    store.hold(["a"]);
    fired[fired.length - 1]();
    expect(store.get()).toEqual(["a"]);
  });
});

describe("litIdsForSection", () => {
  const rows = [
    { id: "earthquakes" },
    { id: "wildfires" },
    { id: "news", widgetOnly: true },
    { id: "volcanoes" },
  ];

  test("keeps the rows that are on, in order", () => {
    expect(litIdsForSection(rows, (id) => id !== "wildfires")).toEqual(["earthquakes", "volcanoes"]);
  });

  test("skips a switched-off row and a widget-only row even when it reads as on", () => {
    expect(litIdsForSection(rows, () => true)).toEqual(["earthquakes", "wildfires", "volcanoes"]);
    expect(litIdsForSection(rows, () => false)).toEqual([]);
  });
});
