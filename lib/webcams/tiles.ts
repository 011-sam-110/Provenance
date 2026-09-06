import type { Box } from "@/lib/webcams/harvest";

// The on-disk format for a harvested webcam tile, and the pure codec both sides use.
//
// WHY NOT AN ARRAY OF OBJECTS. The obvious shape — one JSON object per webcam — spends
// about 80 bytes per row on repeated key names alone. Measured on the first 84 tiles of
// the real harvest: 8.6 MB for 33% of the catalogue, i.e. ~26 MB for all of it, of
// which roughly 5.6 MB is the strings "title", "country", "categories"… written out
// 70,000 times. These tiles are COMMITTED and regenerated on a schedule, so that cost
// is paid again in git history on every refresh.
//
// Positional rows remove it completely, and `detailUrl` goes with them: it is
// `https://www.windy.com/webcams/{id}` for every row, so storing it is 45 bytes each to
// say the same thing 70,000 times. `webcamUrl()` rebuilds it.
//
// Coordinates are rounded to five decimals. That is ~1 m at the equator — far finer
// than a webcam's own idea of where it is — and it stops a float like
// -3.7038000000000001 costing 19 bytes to say -3.7038.

/** Column order for a row. Changing this is a format break — see TILE_VERSION. */
export const TILE_COLUMNS = [
  "id",
  "title",
  "lat",
  "lon",
  "country",
  "region",
  "city",
  "available",
  "categories",
] as const;

/**
 * Bumped when TILE_COLUMNS changes. A reader that finds an unexpected version returns
 * nothing rather than mis-parsing positionally — a silently shifted column would put
 * every pin on the map at the wrong coordinate, which is worse than an empty layer.
 */
export const TILE_VERSION = 1;

/** One webcam as stored: positional, in TILE_COLUMNS order. */
export type TileRow = [
  id: number,
  title: string,
  lat: number,
  lon: number,
  country: string,
  region: string,
  city: string,
  available: 0 | 1,
  categories: string,
];

export interface WebcamTile {
  v: number;
  k: string;
  box: Box;
  /** Epoch ms this tile was last read from upstream. */
  at: number;
  w: TileRow[];
}

/** One webcam as the app uses it. Mirrors the marker shape /api/webcams already ships. */
export interface TileWebcam {
  id: string;
  title: string;
  lat: number;
  lon: number;
  country?: string;
  region?: string;
  city?: string;
  categories: string[];
  available: boolean;
  detailUrl: string;
}

/** The canonical Windy page for a webcam. Rebuilt rather than stored — see above. */
export function webcamUrl(numericId: number | string): string {
  return `https://www.windy.com/webcams/${numericId}`;
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

export function encodeRow(w: TileWebcam): TileRow {
  // Ids arrive as `windy:1359321680`; only the number is stored.
  const numeric = Number(String(w.id).replace(/^windy:/, ""));
  return [
    numeric,
    w.title ?? "",
    round5(w.lat),
    round5(w.lon),
    w.country ?? "",
    w.region ?? "",
    w.city ?? "",
    w.available ? 1 : 0,
    (w.categories ?? []).join("|"),
  ];
}

/**
 * One stored row back to a webcam, or null if it cannot be trusted.
 *
 * A row with an unusable coordinate is DROPPED rather than defaulted to 0,0 — the
 * repo already carries the cost of that mistake elsewhere, and a pin in the Gulf of
 * Guinea is a wrong answer presented as a right one.
 */
export function decodeRow(row: TileRow): TileWebcam | null {
  if (!Array.isArray(row) || row.length < TILE_COLUMNS.length) return null;
  const [id, title, lat, lon, country, region, city, available, categories] = row;
  if (!Number.isFinite(id) || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return {
    id: `windy:${id}`,
    title: title || `Webcam ${id}`,
    lat,
    lon,
    country: country || undefined,
    region: region || undefined,
    city: city || undefined,
    categories: categories ? String(categories).split("|").filter(Boolean) : [],
    available: available === 1,
    detailUrl: webcamUrl(id),
  };
}

/** Decode a whole tile, skipping rows that cannot be trusted. Never throws. */
export function decodeTile(tile: unknown): TileWebcam[] {
  const t = tile as WebcamTile | null;
  if (!t || typeof t !== "object" || !Array.isArray(t.w)) return [];
  if (t.v !== TILE_VERSION) return [];
  const out: TileWebcam[] = [];
  for (const row of t.w) {
    const w = decodeRow(row);
    if (w) out.push(w);
  }
  return out;
}

// --- the manifest -------------------------------------------------------------------

export interface ManifestTile {
  k: string;
  box: Box;
  /** Rows in this tile. */
  n: number;
  /** Epoch ms of the last successful read. */
  at: number;
}

export interface WebcamManifest {
  version: number;
  generatedAt: string;
  /** What Windy says exists globally, so a caller can say "N of M" instead of just N. */
  worldTotal: number;
  harvested: number;
  leaves: number;
  tiles: ManifestTile[];
}

/** Do two boxes overlap at all? Used to pick the tiles a viewport needs. */
export function boxesIntersect(a: Box, b: Box): boolean {
  const [aN, aE, aS, aW] = a;
  const [bN, bE, bS, bW] = b;
  return !(aS > bN || aN < bS || aW > bE || aE < bW);
}

/**
 * The tiles a viewport needs, nearest-first.
 *
 * Ordered by distance from the viewport centre so a progressive loader paints what the
 * user is looking at before it paints the edges. Ties break on key, so the order is
 * deterministic and a test can assert it.
 */
export function tilesForViewport(tiles: readonly ManifestTile[], view: Box): ManifestTile[] {
  const [n, e, s, w] = view;
  const cLat = (n + s) / 2;
  const cLon = (e + w) / 2;
  const dist = (t: ManifestTile) => {
    const tLat = (t.box[0] + t.box[2]) / 2;
    const tLon = (t.box[1] + t.box[3]) / 2;
    return (tLat - cLat) ** 2 + (tLon - cLon) ** 2;
  };
  return tiles
    .filter((t) => t.n > 0 && boxesIntersect(t.box, view))
    .sort((a, b) => dist(a) - dist(b) || a.k.localeCompare(b.k));
}

/**
 * How complete the harvested catalogue is, for honest reporting.
 *
 * `harvested` can exceed `worldTotal` because adjacent leaf boxes share an edge and a
 * webcam sitting exactly on one is returned for both. Clamping to 1 keeps the layer
 * from claiming more than exists; the caller deduplicates by id when merging.
 */
export function manifestCoverage(m: Pick<WebcamManifest, "harvested" | "worldTotal">): number {
  if (!m.worldTotal) return 0;
  return Math.min(1, m.harvested / m.worldTotal);
}

/**
 * Merge decoded tiles into one deduplicated list.
 *
 * Deduplication is not optional: the quadtree's leaves share edges, so a webcam on a
 * boundary is genuinely present in two tiles and would otherwise be drawn twice and
 * counted twice.
 */
export function mergeTiles(batches: readonly TileWebcam[][]): TileWebcam[] {
  const seen = new Set<string>();
  const out: TileWebcam[] = [];
  for (const batch of batches) {
    for (const w of batch) {
      if (seen.has(w.id)) continue;
      seen.add(w.id);
      out.push(w);
    }
  }
  return out;
}
