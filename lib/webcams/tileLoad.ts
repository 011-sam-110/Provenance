import { decodeTile, mergeTiles, tilesForViewport, type ManifestTile, type TileWebcam, type WebcamManifest } from "@/lib/webcams/tiles";
import type { Box } from "@/lib/webcams/harvest";

// Loads the harvested webcam catalogue into the map, progressively.
//
// The catalogue is 196 static tiles under public/webcams/ holding 70,698 webcams —
// 8.2 MB raw, 2.0 MB gzipped. They are plain files on the CDN, so this costs no
// serverless invocation at all, unlike the /api/webcams sample it replaces.
//
// WHY PROGRESSIVE AND NOT ONE FILE. A single 2 MB body has to arrive completely before
// anything is drawn. Tiles arrive independently, so the map paints the first few
// thousand webcams almost immediately and fills in behind them. The manifest is ordered
// densest-first (the plan sorts leaves deepest-first), so the tiles that matter most
// land first.
//
// WHY THE CALLBACK IS BATCHED. The consumer is React state feeding a MapLibre GeoJSON
// source, and every emission rebuilds a FeatureCollection over everything loaded so
// far. Calling back once per tile would mean 196 renders, each one rebuilding a
// collection that grows towards 70,698 features — quadratic work on the main thread of
// a console this repo has already had to profile for idle cost. Batching turns that
// into a bounded number of flushes.

export const MANIFEST_URL = "/webcams/manifest.json";
export const tileUrl = (k: string) => `/webcams/t/${k}.json`;

/** Tiles fetched in parallel. Small: these are CDN hits, not upstream API calls. */
export const TILE_CONCURRENCY = 6;

/** Flush to the consumer after this many tiles, or after FLUSH_MS, whichever first. */
export const FLUSH_EVERY_TILES = 12;
export const FLUSH_MS = 400;

/** Pure: has enough accumulated to be worth a re-render? */
export function shouldFlush(pendingTiles: number, msSinceFlush: number, done: boolean): boolean {
  if (done) return pendingTiles > 0;
  return pendingTiles >= FLUSH_EVERY_TILES || (pendingTiles > 0 && msSinceFlush >= FLUSH_MS);
}

export interface LoadProgress {
  /** Webcams available so far, deduplicated. */
  webcams: TileWebcam[];
  tilesLoaded: number;
  tilesTotal: number;
  /** Windy's own global count, so a caller can say "N of M" rather than just N. */
  worldTotal: number;
  done: boolean;
}

export interface LoadOptions {
  fetchJson: (url: string) => Promise<unknown>;
  onProgress: (p: LoadProgress) => void;
  /** Returns false to stop — the consumer unmounted. */
  alive?: () => boolean;
  /** Restrict to tiles overlapping this box. Defaults to the whole world. */
  viewport?: Box;
  now?: () => number;
  concurrency?: number;
}

/**
 * Fetch the manifest and every tile it lists, reporting progress as they arrive.
 *
 * Never throws and never rejects on a bad tile: a tile that 404s or decodes to nothing
 * is skipped and the rest still load. A missing MANIFEST is the one hard stop — it
 * means the catalogue has not been harvested into this deployment, and the caller falls
 * back to /api/webcams rather than showing an empty layer.
 */
export async function loadWebcamCatalogue(opts: LoadOptions): Promise<LoadProgress | null> {
  const {
    fetchJson,
    onProgress,
    alive = () => true,
    viewport,
    now = () => Date.now(),
    concurrency = TILE_CONCURRENCY,
  } = opts;

  let manifest: WebcamManifest;
  try {
    manifest = (await fetchJson(MANIFEST_URL)) as WebcamManifest;
    if (!manifest || !Array.isArray(manifest.tiles)) return null;
  } catch {
    return null;
  }
  if (!alive()) return null;

  const wanted: ManifestTile[] = viewport
    ? tilesForViewport(manifest.tiles, viewport)
    : manifest.tiles.filter((t) => t.n > 0);

  const batches: TileWebcam[][] = [];
  let pending = 0;
  let loaded = 0;
  let lastFlush = now();

  const emit = (done: boolean) => {
    onProgress({
      webcams: mergeTiles(batches),
      tilesLoaded: loaded,
      tilesTotal: wanted.length,
      worldTotal: manifest.worldTotal ?? 0,
      done,
    });
    pending = 0;
    lastFlush = now();
  };

  let cursor = 0;
  const worker = async () => {
    while (cursor < wanted.length && alive()) {
      const tile = wanted[cursor++];
      try {
        const rows = decodeTile(await fetchJson(tileUrl(tile.k)));
        if (rows.length > 0) batches.push(rows);
      } catch {
        // A tile that fails is a hole in coverage, not a failure of the layer. The
        // manifest still reports what SHOULD be there, so the gap is visible in the
        // loaded/total ratio rather than being silently absorbed.
      }
      loaded++;
      pending++;
      if (shouldFlush(pending, now() - lastFlush, false)) emit(false);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, wanted.length) }, worker));

  if (!alive()) return null;
  const final: LoadProgress = {
    webcams: mergeTiles(batches),
    tilesLoaded: loaded,
    tilesTotal: wanted.length,
    worldTotal: manifest.worldTotal ?? 0,
    done: true,
  };
  onProgress(final);
  return final;
}
