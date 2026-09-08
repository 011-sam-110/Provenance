// Defer a MapLibre style operation until MapLibre will accept it.
//
// Lifted out of components/WorldMap.tsx so it can be held by a test at all: vitest
// here is `environment: "node"` and collects `tests/unit/**/*.test.ts` only, so a
// helper living inside a .tsx that imports maplibre-gl cannot be reached. It was a
// module-private function there, and the defect below survived precisely because
// nothing could see it.

/**
 * The slice of `maplibregl.Map` this needs. Structural on purpose — a real Map
 * satisfies it, and so does a fake that reproduces a measured event sequence.
 */
export interface StyleReadyMap {
  /** `boolean | void` matches MapLibre exactly: `Map.isStyleLoaded()` warns and
   *  returns nothing when the map has no style at all, so a plain `boolean` here
   *  would refuse the real Map. Every read below is a truthiness test. */
  isStyleLoaded(): boolean | void;
  on(type: "styledata" | "idle", listener: () => void): unknown;
  off(type: "styledata" | "idle", listener: () => void): unknown;
}

/**
 * Run `fn` once the map's style will accept a style operation.
 *
 * MapLibre's `setProjection` (and other style ops) throw "Style is not done
 * loading" if called mid-load — and that throw, uncaught, crashes the whole app
 * (React error boundary). On first mount and during a basemap `setStyle` the style
 * is briefly not ready, so any caller that can fire at an arbitrary time (the
 * view-mode → projection sync) MUST defer through this guard.
 *
 * ── WAIT ON `idle` AS WELL AS `styledata`, AND THE SECOND ONE IS NOT BELT AND
 * BRACES. It is the whole reason the 2D/3D switch did nothing.
 *
 * `map.isStyleLoaded()` is `Style.loaded()`, which is much stricter than the
 * condition a style op actually needs: it is false unless the style document is
 * loaded AND no source was updated AND every tile manager has finished AND every
 * image has arrived. `setProjection` only needs the first of those — MapLibre's own
 * `_checkLoaded()` tests `style._loaded` alone. On this console something is nearly
 * always in flight (19k camera features, the webcam tiles, planes and satellites on
 * a refresh), so the strict test says "not ready" constantly.
 *
 * That over-strict gate would only have cost a delay. What made it permanent is that
 * the retry listened on `styledata` alone — an event about the style DOCUMENT, which
 * does not fire when a SOURCE finishes its tiles. Measured in a browser against
 * /app: at the callback `isStyleLoaded()` was false, and the styledata count was
 * identical before and after the click. Nothing ever woke the deferred call, so the
 * projection change was dropped for good and the globe never flattened.
 *
 * `idle` is the edge that closes it: MapLibre fires it once it has finished
 * rendering and settled, which is exactly when the strict test finally passes. This
 * app already trusts it for that reading — see `map.once("idle", () =>
 * markMapReady())` in WorldMap.tsx.
 */
export function whenStyleReady(map: StyleReadyMap, fn: () => void): void {
  if (map.isStyleLoaded()) {
    fn();
    return;
  }
  const onReady = () => {
    // Both events fire repeatedly while the map is still working; re-check rather
    // than trusting either one to mean "ready".
    if (!map.isStyleLoaded()) return;
    map.off("styledata", onReady);
    map.off("idle", onReady);
    fn();
  };
  map.on("styledata", onReady);
  map.on("idle", onReady);
}
