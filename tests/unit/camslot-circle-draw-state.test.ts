import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startCircleDraw, cancelCircleDraw, type MapLike } from "@/lib/console/widgets/camslot.circle";
import { aoiDrawStore, cancelDraw, isDrawing } from "@/lib/map/aoi";

// The circle gesture publishes into lib/map/aoi.ts's draw store so that "a draw
// is running" stays ONE truth: `isDrawing()` stops the polygon tool arming on
// top of it, and DrawBanner is the only always-mounted sign that the map is
// swallowing clicks.
//
// This runs in the node environment with no DOM, which the module was written
// for — `MapLike` is structurally typed and the only globals it touches are
// `window.addEventListener` / `removeEventListener`. So the fakes below are the
// whole environment, not a mock of one.

type Handler = (e: unknown) => void;

function fakeCanvas() {
  const handlers = new Map<string, Set<Handler>>();
  return {
    style: { cursor: "" },
    captured: [] as number[],
    handlers,
    addEventListener(type: string, fn: Handler) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: Handler) { handlers.get(type)?.delete(fn); },
    getBoundingClientRect() { return { left: 0, top: 0 }; },
    setPointerCapture(id: number) { this.captured.push(id); },
    fire(type: string, e: unknown) { for (const fn of [...(handlers.get(type) ?? [])]) fn(e); },
    listenerCount() { return [...handlers.values()].reduce((n, s) => n + s.size, 0); },
  };
}

function fakeMap(canvas: ReturnType<typeof fakeCanvas>) {
  const sources = new Map<string, { setData(d: unknown): void }>();
  const layers = new Set<string>();
  const dragPan = { enabled: true, enable() { this.enabled = true; }, disable() { this.enabled = false; } };
  const map: MapLike & { dragPan: typeof dragPan } = {
    getCanvas: () => canvas as unknown as HTMLCanvasElement,
    // 1px == 0.001 degrees, centred on nothing in particular: the gesture only
    // needs unproject to be monotonic so a longer drag is a larger radius.
    unproject: ([x, y]: [number, number]) => ({ lat: 32.7641 + y * 0.001, lng: -117.1577 + x * 0.001 }),
    dragPan,
    getSource: (id: string) => sources.get(id),
    addSource: (id: string) => { sources.set(id, { setData() {} }); },
    getLayer: (id: string) => (layers.has(id) ? {} : undefined),
    addLayer: (spec: unknown) => { layers.add((spec as { id: string }).id); },
    removeLayer: (id: string) => { layers.delete(id); },
    removeSource: (id: string) => { sources.delete(id); },
  };
  return map;
}

const ptr = (x: number, y: number, button = 0) => ({ button, clientX: x, clientY: y, pointerId: 1 });

let canvas: ReturnType<typeof fakeCanvas>;
let map: ReturnType<typeof fakeMap>;

beforeEach(() => {
  (globalThis as { window?: unknown }).window = {
    addEventListener() {}, removeEventListener() {},
  };
  canvas = fakeCanvas();
  map = fakeMap(canvas);
});

afterEach(() => {
  cancelCircleDraw();
  delete (globalThis as { window?: unknown }).window;
});

describe("the circle gesture publishes into the shared draw state", () => {
  it("reports itself as an active circle the moment it arms, so the polygon tool cannot arm on top", () => {
    expect(isDrawing()).toBe(false);
    startCircleDraw(map, { onFinish: () => {} });
    const d = aoiDrawStore.get();
    expect(d.active).toBe(true);
    expect(d.tool).toBe("circle");
    // Armed but not pressed: no centre yet, which is what makes DrawBanner show
    // "press on the map and drag out from the centre" rather than a radius.
    expect(d.center).toBeUndefined();
    expect(isDrawing()).toBe(true);
  });

  it("publishes the centre as a [lon, lat] TUPLE on the press, not the LatLon it uses internally", () => {
    startCircleDraw(map, { onFinish: () => {} });
    canvas.fire("pointerdown", ptr(0, 0));
    const d = aoiDrawStore.get();
    // The order is the trap: DrawState.center is [lon, lat] while this module
    // passes { lat, lon } around, so a straight hand-over puts the circle on the
    // wrong side of the planet and the banner reads a latitude as a longitude.
    expect(d.center).toEqual([-117.1577, 32.7641]);
    expect(d.radiusKm).toBe(0);
  });

  it("publishes a rising radius on every move, not just on release", () => {
    startCircleDraw(map, { onFinish: () => {} });
    canvas.fire("pointerdown", ptr(0, 0));
    canvas.fire("pointermove", ptr(0, 20));
    const near = aoiDrawStore.get().radiusKm ?? 0;
    canvas.fire("pointermove", ptr(0, 60));
    const far = aoiDrawStore.get().radiusKm ?? 0;
    // Withholding these until release is what leaves the banner stuck on the
    // press prompt for the whole drag, which reads as a dead tool.
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(near);
  });

  it("returns the shared state to idle when the gesture completes", () => {
    let ring: [number, number][] | null = null;
    startCircleDraw(map, { onFinish: (r) => { ring = r; } });
    canvas.fire("pointerdown", ptr(0, 0));
    canvas.fire("pointermove", ptr(0, 60));
    // Asserted BEFORE the release, so this test cannot pass by the state never
    // having been active at all — "ends idle" is trivially true of a gesture
    // that never published.
    expect(aoiDrawStore.get().active).toBe(true);
    canvas.fire("pointerup", ptr(0, 60));
    expect(ring).not.toBeNull();
    expect(aoiDrawStore.get().active).toBe(false);
    expect(isDrawing()).toBe(false);
  });

  it("returns it to idle on Escape too, and hands the map back", () => {
    startCircleDraw(map, { onFinish: () => {} });
    canvas.fire("pointerdown", ptr(0, 0));
    canvas.fire("pointermove", ptr(0, 60));
    expect(map.dragPan.enabled).toBe(false);
    // Same guard as above: prove it was published before proving it was cleared.
    expect(aoiDrawStore.get().active).toBe(true);
    cancelCircleDraw();
    expect(aoiDrawStore.get().active).toBe(false);
    // The teardown is what re-enables panning; leaving it disabled is the
    // failure where the map is alive but refuses to move.
    expect(map.dragPan.enabled).toBe(true);
    expect(canvas.listenerCount()).toBe(0);
  });

  it("clears the shared state AFTER its own teardown, never before", () => {
    // Ordering matters because the shared state going idle is what unmounts the
    // banner. If it cleared first, there would be a window with no banner and a
    // map still swallowing clicks.
    startCircleDraw(map, { onFinish: () => {} });
    canvas.fire("pointerdown", ptr(0, 0));
    let panWhenCleared: boolean | null = null;
    const off = aoiDrawStore.subscribe(() => {
      if (!aoiDrawStore.get().active && panWhenCleared === null) panWhenCleared = map.dragPan.enabled;
    });
    cancelCircleDraw();
    off();
    expect(panWhenCleared).toBe(true);
  });
});

describe("the banner's Cancel reaches the circle gesture", () => {
  it("tears the gesture down and hands the map back", () => {
    startCircleDraw(map, { onFinish: () => {} });
    canvas.fire("pointerdown", ptr(0, 0));
    canvas.fire("pointermove", ptr(0, 60));
    expect(map.dragPan.enabled).toBe(false);
    expect(aoiDrawStore.get().active).toBe(true);

    // This is exactly what DrawBanner's button calls. Before `onCancel` existed
    // it reached only `cancelActive`, which none but aoi.ts's own startDraw
    // sets, so for a circle it did nothing at all: the banner stayed up and the
    // map went on swallowing clicks behind a visible Cancel that was a lie.
    cancelDraw();

    expect(aoiDrawStore.get().active).toBe(false);
    expect(map.dragPan.enabled).toBe(true);
    expect(canvas.listenerCount()).toBe(0);
  });

  it("is safe to cancel twice, which is what makes the re-entrancy ordering harmless", () => {
    // aoi.ts reads and clears `externalCancel` BEFORE invoking it, so a teardown
    // that republishes its way to idle cannot re-enter cancelDraw and run twice.
    // That ordering is defensive rather than load-bearing HERE, and this test
    // says which: this gesture's teardown is idempotent (`teardown` is null once
    // it has run), so a second call is a no-op regardless. What this pins is the
    // idempotence the ordering leans on — if that were ever lost, the ordering in
    // aoi.ts would become the only thing standing between a stray notification
    // and a double teardown.
    startCircleDraw(map, { onFinish: () => {} });
    canvas.fire("pointerdown", ptr(0, 0));
    cancelDraw();
    expect(() => cancelDraw()).not.toThrow();
    expect(() => cancelCircleDraw()).not.toThrow();
    expect(map.dragPan.enabled).toBe(true);
  });

  // NOT TESTED HERE, and stated rather than quietly skipped: that cancelDraw runs
  // the external teardown even when `cancelActive` throws (the try/finally, not a
  // chained `cancelActive?.(); externalCancel?.()`). `cancelActive` is private to
  // aoi.ts and set only by its own `startDraw`, which needs a real MapLibre map
  // and a live style — neither of which exists in this node-environment suite. The
  // precondition cannot be built here, so the assertion is not made here.
});
