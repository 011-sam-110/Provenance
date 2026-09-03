/**
 * The hero globe's current camera, published for the star renderer behind it.
 *
 * Why a plain module-level store and not React state or context: CLAUDE.md's
 * "Shape" section is explicit that `components/marketing/*` has ONE scroll
 * subscriber (`ScrollGround.tsx`) publishing CSS custom properties, and "nothing
 * else may add a scroll listener and nothing may set React state per frame." The
 * camera changes on every animation frame — the spin loop calls `map.jumpTo`
 * ~60 times a second — so routing it through `useState` would mean a React
 * re-render per frame for a value no component actually renders text or markup
 * from; it is read imperatively, inside another `requestAnimationFrame` loop, by
 * a canvas/WebGL layer that repaints itself. A mutable module binding is the
 * correct shape for "the last writer wins, readers poll it": no listeners to
 * leak, no re-renders to suppress, no provider tree to thread through a
 * `<canvas>`.
 *
 * The star layer must still work with no globe mounted (the closing section of
 * the landing page shows the same sky with nothing spinning in front of it), so
 * `getHeroView` returns `null` rather than a stale or default orientation — a
 * caller has to decide what "no globe" means, this module will not guess.
 */

export type HeroView = {
  /** Globe centre longitude, degrees east. */
  readonly lngDeg: number;
  /** Globe centre latitude, degrees north. */
  readonly latDeg: number;
  /** Map bearing, degrees. 0 is north-up. */
  readonly bearingDeg: number;
  /** Map pitch, degrees. 0 is looking straight down the view axis. */
  readonly pitchDeg: number;
};

let current: HeroView | null = null;

/**
 * Longitude into `[-180, 180)`.
 *
 * MapLibre wraps the value it reports back from `getCenter()`, but the spin
 * loop drives the centre by repeatedly adding 0.035 deg with no cap of its own,
 * so this store cannot assume the number it is handed is already in range —
 * after ten minutes of ambient spin that add-forever produces numbers in the
 * thousands. Normalising here, once, means every reader gets a small, stable
 * angle regardless of how long the globe has been running.
 */
function wrapLng(deg: number): number {
  const wrapped = ((deg + 180) % 360 + 360) % 360 - 180;
  // The modulo chain above lands exactly on +180 for inputs like 180 or -180;
  // fold that single boundary case down to -180 so the range is truly half-open.
  return wrapped === 180 ? -180 : wrapped;
}

/** Called by HeroGlobe on every frame it moves. Pass null on unmount. */
export function setHeroView(view: HeroView | null): void {
  if (view === null) {
    current = null;
    return;
  }
  // Frozen + copied so a caller who kept their object (or the one they read
  // back) cannot mutate it later and have that leak into what this store holds.
  current = Object.freeze({
    lngDeg: wrapLng(view.lngDeg),
    latDeg: view.latDeg,
    bearingDeg: view.bearingDeg,
    pitchDeg: view.pitchDeg,
  });
}

/**
 * Returns null when no globe is mounted — e.g. the closing section of the
 * landing page, which shows the same sky with no globe in front of it.
 */
export function getHeroView(): HeroView | null {
  return current;
}
