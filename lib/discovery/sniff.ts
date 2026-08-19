/**
 * The column sniffer: given rows of somebody else's JSON, guess which key holds the
 * latitude, which holds the image, and which holds a stable id.
 *
 * WHY GUESS AT ALL. Twelve adapters in `lib/sources/` differ only in spelling —
 * `Breidd`/`lat`/`latitude`/`y`, `Slod`/`imageUrl`/`snapshot`. That is a naming
 * problem, not a modelling problem, and naming problems are what a scored heuristic
 * is for.
 *
 * HOW IT AVOIDS THE OBVIOUS WAY TO BE WRONG. Every field is scored on TWO independent
 * axes and needs both: the key's NAME must look right, and the VALUES must behave
 * right across a sample of rows. Either alone is a trap —
 *
 *   - name alone: an ArcGIS layer in Web Mercator has a column literally called `y`
 *     holding 6712004.3 metres. The name says latitude; the value is not one.
 *   - values alone: a feed carrying both a camera coordinate and the coordinate of
 *     the nearest weather station has two columns that are both valid latitudes.
 *
 * So a numeric range check kills the first, and the name check disambiguates the
 * second — and where both remain plausible the confidence drops, which is the signal
 * the review queue sorts on.
 *
 * WHAT IT CANNOT DO, AND WHY THAT IS FINE. It cannot tell that the pin is on the
 * wrong side of the motorway, that the image URL returns a "camera temporarily
 * unavailable" graphic, or that the operator is relaying somebody else's stream.
 * Those are visible to a person looking at the picture and invisible in the schema,
 * which is the entire argument for /admin/verify existing. Nothing here decides
 * anything.
 *
 * Pure and isomorphic — no fetch, no Node built-ins — so every branch is unit-testable
 * against fixtures.
 */

import type { FeedFormat, FieldMapping } from "@/lib/discovery/types";
import { countryBox, insideBox } from "@/lib/discovery/geo";

/** How many rows the value-shape checks look at. Enough to be representative, cheap. */
const SAMPLE_SIZE = 40;

/** How deep into a nested row object paths are flattened (`location.geo.lat` = 3). */
const MAX_DEPTH = 3;

/** A field assignment needs this much combined score, or it is left unassigned. */
const ACCEPT = 0.45;

/** Read a dot-path out of an object. Returns undefined for any miss, never throws. */
export function getPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/**
 * Flatten one row into dot-path -> scalar. Arrays are skipped entirely: a row's array
 * members are a different cardinality from the row, so no single dot-path addresses
 * them, and inventing `tags.0` would produce a mapping that breaks on the next row.
 */
export function flattenRow(row: unknown, maxDepth = MAX_DEPTH): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const walk = (node: unknown, prefix: string, depth: number) => {
    if (node == null || typeof node !== "object" || Array.isArray(node)) return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const path = prefix ? prefix + "." + k : k;
      if (v != null && typeof v === "object" && !Array.isArray(v)) {
        if (depth < maxDepth) walk(v, path, depth + 1);
      } else if (!Array.isArray(v)) {
        out.set(path, v);
      }
    }
  };
  walk(row, "", 1);
  return out;
}

/** Which of the three body shapes this is. Checked in order of how specific it is. */
export function sniffFormat(body: unknown): FeedFormat {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const b = body as Record<string, unknown>;
    const feats = b.features;
    if (Array.isArray(feats) && feats.length > 0) {
      const f0 = feats[0] as Record<string, unknown> | undefined;
      // ArcGIS names it `attributes` and puts a bare x/y on `geometry`; GeoJSON names
      // it `properties` and always carries `geometry.type`.
      if (f0 && "attributes" in f0) return "arcgis";
      if (f0 && "properties" in f0) return "geojson";
    }
  }
  return "json";
}

/**
 * Every array-of-objects inside `body`, longest first, as dot-paths.
 *
 * `""` means the body IS the array. Depth is bounded because some portals wrap a
 * payload four levels deep and some wrap nothing, and an unbounded walk over a 6 MB
 * response is a discovery run that never finishes.
 */
export function findRowArrays(body: unknown, minRows = 3): string[] {
  const found: Array<{ path: string; len: number }> = [];
  const walk = (node: unknown, path: string, depth: number) => {
    if (depth > 4) return;
    if (Array.isArray(node)) {
      const objects = node.filter((r) => r != null && typeof r === "object" && !Array.isArray(r));
      // Mostly-objects, not merely some: an array of coordinate pairs is an array of
      // arrays, and an array of strings is not rows.
      if (node.length >= minRows && objects.length >= node.length * 0.8) {
        found.push({ path, len: node.length });
      }
      return;
    }
    if (node == null || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      walk(v, path ? path + "." + k : k, depth + 1);
    }
  };
  walk(body, "", 0);
  found.sort((a, b) => b.len - a.len);
  return found.map((f) => f.path);
}

/** Take up to `n` rows, evenly spread, so a sorted feed is not judged on its head. */
function sample<T>(rows: T[], n = SAMPLE_SIZE): T[] {
  if (rows.length <= n) return rows;
  const step = rows.length / n;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(rows[Math.floor(i * step)]);
  return out;
}

/** Name-pattern scores. Ordered: the first pattern that matches wins its score. */
const NAME_PATTERNS: Record<keyof FieldMapping, Array<[RegExp, number]>> = {
  lat: [
    [/^(?:.*\.)?(?:__lat|lat|latitude|wgs84_?lat|lat_?wgs84|y_?coord|coord_?y)$/i, 1],
    [/lat/i, 0.7],
    [/^(?:.*\.)?y$/i, 0.45],
  ],
  lon: [
    [/^(?:.*\.)?(?:__lon|lon|lng|long|longitude|wgs84_?lon|lon_?wgs84|x_?coord|coord_?x)$/i, 1],
    [/^(?:.*\.)?(?:lon|lng)/i, 0.7],
    [/^(?:.*\.)?x$/i, 0.45],
  ],
  imageUrl: [
    [/^(?:.*\.)?(?:image_?url|imageurl|snapshot|still|photo_?url|thumbnail_?url|jpeg_?url)$/i, 1],
    [/(?:image|snapshot|still|photo|jpe?g|thumb)/i, 0.7],
    [/(?:url|href|src|link)/i, 0.3],
  ],
  streamUrl: [
    [/^(?:.*\.)?(?:stream_?url|video_?url|hls_?url|m3u8|rtsp_?url)$/i, 1],
    [/(?:stream|video|hls|m3u8|mp4)/i, 0.7],
  ],
  id: [
    [/^(?:.*\.)?(?:id|uuid|guid|objectid|camera_?id|cam_?id|device_?id|site_?id)$/i, 1],
    [/(?:_id|id$|^no$|^nr$|code|key|slug)/i, 0.6],
  ],
  name: [
    [/^(?:.*\.)?(?:name|title|camera_?name|location_?name|site_?name|display_?name)$/i, 1],
    [/(?:name|title|label|location|site|junction|description|caption)/i, 0.6],
  ],
  road: [
    [/^(?:.*\.)?(?:road|roadway|route|highway|road_?name|route_?name|corridor)$/i, 1],
    [/(?:road|route|highway|motorway|street|carriageway)/i, 0.6],
  ],
  region: [
    [/^(?:.*\.)?(?:region|area|county|district|state|province|municipality|city|town)$/i, 1],
    [/(?:region|area|county|district|borough)/i, 0.6],
  ],
  direction: [
    [/^(?:.*\.)?(?:direction|bearing|heading|orientation|facing|view_?direction)$/i, 1],
    [/(?:direction|bearing|heading|facing)/i, 0.6],
  ],
};

function nameScore(field: keyof FieldMapping, path: string): number {
  for (const [re, score] of NAME_PATTERNS[field]) if (re.test(path)) return score;
  return 0;
}

const asNumber = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const asString = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" ? String(v) : null;

/**
 * Value-shape score for a coordinate column.
 *
 * The variance floor is the load-bearing part. A column of identical latitudes is
 * either a country centroid repeated per row or a default that was never filled in,
 * and both put every camera in one place — a failure that looks completely fine in a
 * count and completely broken on a map.
 */
function coordScore(values: unknown[], limit: number): number {
  const nums = values.map(asNumber).filter((n): n is number => n != null);
  if (nums.length < values.length * 0.8 || nums.length < 3) return 0;
  const inRange = nums.filter((n) => n >= -limit && n <= limit);
  if (inRange.length < nums.length * 0.95) return 0;
  // All-zero is the other common null-island default and it passes a range check.
  const nonZero = inRange.filter((n) => Math.abs(n) > 1e-6);
  if (nonZero.length < inRange.length * 0.5) return 0;
  const distinct = new Set(inRange.map((n) => n.toFixed(4))).size;
  if (distinct < Math.min(3, inRange.length)) return 0;
  const spread = Math.max(...inRange) - Math.min(...inRange);
  // A real camera network spans some ground; a spread under ~100 m in degrees is a
  // constant with float noise, not a set of locations.
  return spread > 0.001 ? 1 : 0.3;
}

const MEDIA_EXT = /\.(?:jpe?g|png|gif|webp|avif)(?:$|\?)/i;
const STREAM_EXT = /\.(?:m3u8|mp4|mpd|ts)(?:$|\?)|^rtsps?:/i;

function urlScore(values: unknown[], kind: "image" | "stream"): number {
  const strs = values.map(asString).filter((s): s is string => s != null);
  if (strs.length < values.length * 0.5 || strs.length === 0) return 0;
  const urls = strs.filter((s) => /^(?:https?:|rtsps?:|\/\/|\/)/i.test(s));
  if (urls.length < strs.length * 0.8) return 0;
  const ext = kind === "image" ? MEDIA_EXT : STREAM_EXT;
  const matching = urls.filter((s) => ext.test(s)).length / urls.length;
  // A URL with no extension can still be a snapshot endpoint (`/camera?id=4`), so an
  // extensionless column is plausible rather than disqualified.
  return matching > 0.5 ? 1 : matching > 0 ? 0.6 : 0.35;
}

/** Unique, present, and not a float — the properties an id has and a name does not. */
function idScore(values: unknown[]): number {
  const strs = values.map(asString).filter((s): s is string => s != null);
  if (strs.length < values.length) return 0;
  const distinct = new Set(strs).size;
  if (distinct < strs.length) return 0; // a repeated id is not an id
  const looksFloat = strs.filter((s) => /^-?\d+\.\d+$/.test(s)).length;
  if (looksFloat > strs.length * 0.5) return 0; // that is a coordinate, not a key
  return 1;
}

/** Present, wordy, and mostly distinct — a label a person would read. */
function nameValueScore(values: unknown[]): number {
  const strs = values.map(asString).filter((s): s is string => s != null);
  if (strs.length < values.length * 0.9 || strs.length === 0) return 0;
  const distinct = new Set(strs).size / strs.length;
  const avgLen = strs.reduce((a, s) => a + s.length, 0) / strs.length;
  if (avgLen < 3 || avgLen > 120) return 0.2;
  // Pure digits are an id someone called "name"; they read as nothing on a map.
  const numeric = strs.filter((s) => /^\d+$/.test(s)).length / strs.length;
  if (numeric > 0.8) return 0.1;
  return 0.4 + 0.6 * distinct;
}

function textScore(values: unknown[]): number {
  const strs = values.map(asString).filter((s): s is string => s != null);
  if (strs.length < values.length * 0.5 || strs.length === 0) return 0;
  const avgLen = strs.reduce((a, s) => a + s.length, 0) / strs.length;
  return avgLen >= 1 && avgLen <= 80 ? 1 : 0.3;
}

export interface SniffResult {
  mapping: Partial<FieldMapping>;
  /** Per-field combined score, for explaining a low confidence in the review UI. */
  scores: Partial<Record<keyof FieldMapping, number>>;
  /** 0..1 over the fields the registry actually requires. Ordering hint only. */
  confidence: number;
  /**
   * How any field that the NAME check could not assign was resolved instead. Shown to
   * the reviewer, because "the coordinate columns were identified by which assignment
   * lands inside the country" is a materially weaker claim than "the column is called
   * latitude", and the reviewer is the only one who can price that difference.
   */
  notes: string[];
}

export interface SniffOptions {
  /**
   * ISO-3166 alpha-2 the feed is expected to cover, from the catalogue entry.
   *
   * Only used to break a tie the column NAMES could not: see `resolveCoordinatePair`.
   * A wrong hint costs a candidate (the pair fails to fit and stays unassigned), never
   * a wrong pin.
   */
  country?: string;
}

const VALUE_SCORERS: Record<keyof FieldMapping, (vals: unknown[]) => number> = {
  lat: (v) => coordScore(v, 90),
  lon: (v) => coordScore(v, 180),
  imageUrl: (v) => urlScore(v, "image"),
  streamUrl: (v) => urlScore(v, "stream"),
  id: idScore,
  name: nameValueScore,
  road: textScore,
  region: textScore,
  direction: textScore,
};

/** Fields without which a row cannot become a `Camera`. Drives `confidence`. */
const REQUIRED: Array<keyof FieldMapping> = ["lat", "lon", "name", "id"];

const ALL_FIELDS = Object.keys(NAME_PATTERNS) as Array<keyof FieldMapping>;

/**
 * Assign every field to a dot-path, or leave it unassigned.
 *
 * A path is claimed by at most one field, best score first, because the same column
 * cannot be both the latitude and the longitude — and without that rule a feed whose
 * only coordinate key is `y` gets it assigned to both and every camera lands on the
 * 45-degree diagonal.
 */
export function sniffMapping(rows: unknown[], opts: SniffOptions = {}): SniffResult {
  const rowSample = sample(rows.filter((r) => r != null && typeof r === "object"));
  if (rowSample.length === 0) return { mapping: {}, scores: {}, confidence: 0, notes: [] };

  const flat = rowSample.map((r) => flattenRow(r));
  const paths = new Set<string>();
  for (const f of flat) for (const k of f.keys()) paths.add(k);
  const valuesAt = (path: string) => flat.map((f) => f.get(path));

  const ranked: Array<{ field: keyof FieldMapping; path: string; score: number }> = [];
  for (const field of ALL_FIELDS) {
    for (const path of paths) {
      const ns = nameScore(field, path);
      if (ns === 0) continue; // never assign a field to a key whose name says nothing
      const vs = VALUE_SCORERS[field](valuesAt(path));
      if (vs === 0) continue;
      // Geometric mean: both axes must be non-trivial for the pair to rank.
      ranked.push({ field, path, score: Math.sqrt(ns * vs) });
    }
  }
  ranked.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  const mapping: Partial<FieldMapping> = {};
  const scores: Partial<Record<keyof FieldMapping, number>> = {};
  const takenPaths = new Set<string>();
  const notes: string[] = [];
  const claim = (field: keyof FieldMapping, path: string, score: number) => {
    mapping[field] = path;
    scores[field] = Number(score.toFixed(3));
    takenPaths.add(path);
  };
  for (const r of ranked) {
    if (r.score < ACCEPT) continue;
    if (mapping[r.field] || takenPaths.has(r.path)) continue;
    claim(r.field, r.path, r.score);
  }

  // ── fallbacks, for feeds whose column names are not in English ────────────────
  //
  // Every adapter in this repo that needed hand-written field names needed them for
  // the same reason: the operator names its columns in its own language. Iceland's
  // image column is `Slod` ("path") and its latitude is `Breidd` ("breadth"). A
  // name-only sniffer discovers nothing outside the anglophone web, which would make
  // this pipeline useless for exactly the coverage the product lacks.
  //
  // Each fallback below leans on a signal that does NOT depend on the language of the
  // key, and each records a note, because a field resolved this way is a weaker claim
  // than one whose name said what it was.

  if (!mapping.imageUrl && !mapping.streamUrl) {
    const media = resolveMediaByValue(paths, takenPaths, valuesAt);
    if (media) {
      claim(media.field, media.path, media.score);
      notes.push(
        "The " + media.field + " column was identified by its values (" + media.path +
          " holds media URLs), not by its name.",
      );
    }
  }

  if (!mapping.lat || !mapping.lon) {
    const pair = resolveCoordinatePair(paths, takenPaths, valuesAt, countryBox(opts.country));
    if (pair) {
      // Both are claimed together or not at all: half a coordinate is not a location.
      delete mapping.lat;
      delete mapping.lon;
      claim("lat", pair.lat, pair.score);
      claim("lon", pair.lon, pair.score);
      notes.push(
        "The coordinate columns were identified by which assignment puts the cameras inside " +
          (opts.country ?? "the declared country") + " (" + pair.lat + "/" + pair.lon +
          "), not by their names. The reverse assignment does not fit.",
      );
    }
  }

  if (!mapping.id) {
    const id = resolveIdByValue(paths, takenPaths, valuesAt);
    if (id) {
      claim("id", id, 0.5);
      notes.push("The id column (" + id + ") was identified by being unique in every row, not by its name.");
    }
  }

  if (!mapping.name) {
    const name = resolveNameByValue(paths, takenPaths, valuesAt);
    if (name) {
      claim("name", name, 0.5);
      notes.push("The name column (" + name + ") was identified by its values, not by its name.");
    }
  }

  // ── confidence ────────────────────────────────────────────────────────────────
  //
  // Zero unless the feed can actually become cameras. A partial mapping scoring 0.48
  // sorts above a complete one scoring 0.45 in the review queue, which is precisely
  // backwards: a feed with no latitude does not produce a worse camera, it produces
  // no camera at all. So the required set is a gate first and an average second.
  const hasMedia = Boolean(mapping.imageUrl || mapping.streamUrl);
  const complete = REQUIRED.every((f) => mapping[f]);
  if (!hasMedia || !complete) return { mapping, scores, confidence: 0, notes };
  const base = REQUIRED.map((f) => scores[f] ?? 0).reduce((a, b) => a + b, 0) / REQUIRED.length;
  const mediaScore = scores.imageUrl ?? scores.streamUrl ?? 0;
  const confidence = Number((base * (0.7 + 0.3 * mediaScore)).toFixed(3));

  return { mapping, scores, confidence, notes };
}

type ValuesAt = (path: string) => unknown[];

/**
 * A column of URLs ending `.jpg` IS an image column whatever it is called.
 *
 * This is the one place a value signal is allowed to stand alone, because a file
 * extension is not ambiguous the way a number is. It is restricted to the case where
 * NO media column was found by name, so a feed that publishes both a thumbnail and a
 * full frame still gets the one the name check preferred.
 */
function resolveMediaByValue(
  paths: Set<string>,
  taken: Set<string>,
  valuesAt: ValuesAt,
): { field: "imageUrl" | "streamUrl"; path: string; score: number } | null {
  const found: Array<{ field: "imageUrl" | "streamUrl"; path: string; score: number }> = [];
  for (const path of [...paths].sort()) {
    if (taken.has(path)) continue;
    const strs = valuesAt(path)
      .map(asString)
      .filter((s): s is string => s != null);
    if (strs.length < 3) continue;
    const urls = strs.filter((s) => /^(?:https?:|\/\/|\/)/i.test(s));
    if (urls.length < strs.length * 0.9) continue;
    const images = urls.filter((s) => MEDIA_EXT.test(s)).length / urls.length;
    const streams = urls.filter((s) => STREAM_EXT.test(s)).length / urls.length;
    if (images > 0.9) found.push({ field: "imageUrl", path, score: 0.7 });
    else if (streams > 0.9) found.push({ field: "streamUrl", path, score: 0.7 });
  }
  // Images before streams, then alphabetical — deterministic across runs so the same
  // feed produces the same descriptor and a diff means something changed upstream.
  found.sort((a, b) => (a.field === b.field ? a.path.localeCompare(b.path) : a.field === "imageUrl" ? -1 : 1));
  return found[0] ?? null;
}

/**
 * Resolve latitude and longitude by asking which assignment lands in the right country.
 *
 * The reason this is safe when a bare value check is not: a swap is DECIDABLE. Given a
 * country box, exactly one of (A,B) and (B,A) puts the cameras on the right piece of
 * ground, and the other puts them in the sea. So the pair is accepted only when it
 * fits and its reverse does not — an ambiguous pair (a country box straddling the
 * diagonal, or a feed spanning half the planet) is left unassigned for a human.
 *
 * With no country hint this returns null. That is deliberate: the alternative is
 * guessing an axis order, and a confidently wrong pin is the exact failure the whole
 * review step exists to prevent.
 */
export function resolveCoordinatePair(
  paths: Set<string>,
  taken: Set<string>,
  valuesAt: ValuesAt,
  box: [number, number, number, number] | undefined,
): { lat: string; lon: string; score: number } | null {
  if (!box) return null;

  const numeric: Array<{ path: string; nums: number[] }> = [];
  for (const path of [...paths].sort()) {
    if (taken.has(path)) continue;
    const raw = valuesAt(path);
    const nums = raw.map(asNumber).filter((n): n is number => n != null);
    if (nums.length < raw.length * 0.9 || nums.length < 3) continue;
    if (coordScore(raw, 180) === 0) continue; // no variance, or all-zero, or out of range
    numeric.push({ path, nums });
  }

  const fit = (lat: number[], lon: number[]) => {
    const n = Math.min(lat.length, lon.length);
    if (n === 0) return 0;
    let hit = 0;
    for (let i = 0; i < n; i++) if (insideBox(lat[i], lon[i], box)) hit++;
    return hit / n;
  };

  let best: { lat: string; lon: string; score: number } | null = null;
  for (const a of numeric) {
    for (const b of numeric) {
      if (a.path === b.path) continue;
      const forward = fit(a.nums, b.nums);
      if (forward < 0.9) continue;
      const reverse = fit(b.nums, a.nums);
      if (reverse >= 0.5) continue; // both orders plausible — refuse rather than pick
      if (!best || forward > best.score) best = { lat: a.path, lon: b.path, score: forward * 0.8 };
    }
  }
  return best;
}

/** A column present and unique in every row, preferring the terse one over the wordy. */
function resolveIdByValue(paths: Set<string>, taken: Set<string>, valuesAt: ValuesAt): string | null {
  const cands: Array<{ path: string; avgLen: number }> = [];
  for (const path of [...paths].sort()) {
    if (taken.has(path)) continue;
    const raw = valuesAt(path);
    const strs = raw.map(asString).filter((s): s is string => s != null);
    if (strs.length !== raw.length || strs.length < 3) continue;
    if (new Set(strs).size !== strs.length) continue;
    if (strs.some((s) => /\s/.test(s) || /^https?:/i.test(s))) continue;
    if (strs.filter((s) => /^-?\d+\.\d+$/.test(s)).length > strs.length * 0.5) continue; // a coordinate
    const avgLen = strs.reduce((a, s) => a + s.length, 0) / strs.length;
    if (avgLen > 40) continue;
    cands.push({ path, avgLen });
  }
  cands.sort((a, b) => a.avgLen - b.avgLen || a.path.localeCompare(b.path));
  return cands[0]?.path ?? null;
}

/** A wordy, mostly-distinct string column — what a person would read off a pin. */
function resolveNameByValue(paths: Set<string>, taken: Set<string>, valuesAt: ValuesAt): string | null {
  let best: { path: string; score: number } | null = null;
  for (const path of [...paths].sort()) {
    if (taken.has(path)) continue;
    const raw = valuesAt(path);
    const strs = raw.map(asString).filter((s): s is string => s != null);
    if (strs.length < raw.length * 0.9 || strs.length < 3) continue;
    if (strs.some((s) => /^https?:/i.test(s))) continue;
    const score = nameValueScore(raw);
    if (score < 0.6) continue;
    if (!best || score > best.score) best = { path, score };
  }
  return best?.path ?? null;
}

/** The synthetic geometry keys the two feature formats are flattened onto. */
export const GEOMETRY_LAT = "__lat";
export const GEOMETRY_LON = "__lon";

/**
 * GeoJSON and ArcGIS carry the coordinate OUTSIDE the property bag, so their features
 * are flattened into one object first and the geometry is written to synthetic
 * `__lat`/`__lon` keys. The mapping that comes back therefore addresses a row shape
 * this module produced, which is why `lib/sources/discovered.ts` re-flattens the same
 * way rather than reading the raw feature.
 */
export function flattenFeature(feature: unknown, format: FeedFormat): Record<string, unknown> | null {
  if (feature == null || typeof feature !== "object") return null;
  const f = feature as Record<string, unknown>;
  if (format === "geojson") {
    const props = (f.properties as Record<string, unknown>) ?? {};
    const geom = f.geometry as Record<string, unknown> | undefined;
    const coords = geom?.coordinates;
    const out: Record<string, unknown> = { ...props };
    if (Array.isArray(coords) && coords.length >= 2) {
      // GeoJSON is [lon, lat]. Getting this pair backwards is the single most common
      // way a map ends up with every pin in the sea, so it is stated, not remembered.
      out[GEOMETRY_LON] = coords[0];
      out[GEOMETRY_LAT] = coords[1];
    }
    if (f.id != null && out.id == null) out.id = f.id;
    return out;
  }
  if (format === "arcgis") {
    const attrs = (f.attributes as Record<string, unknown>) ?? {};
    const geom = f.geometry as Record<string, unknown> | undefined;
    const out: Record<string, unknown> = { ...attrs };
    // ArcGIS `geometry.x`/`y` are in the layer's spatial reference. Only WGS84 degrees
    // survive the range check in `coordScore`; a Web Mercator layer scores zero and is
    // held for a human rather than silently reprojected on a guess.
    if (geom && typeof geom.x === "number" && typeof geom.y === "number") {
      out[GEOMETRY_LON] = geom.x;
      out[GEOMETRY_LAT] = geom.y;
    }
    return out;
  }
  return f;
}

/** Pull the row array a mapping was sniffed against out of a fresh response body. */
export function extractRows(body: unknown, format: FeedFormat, rowsPath?: string): Record<string, unknown>[] {
  if (format === "geojson" || format === "arcgis") {
    const feats = getPath(body, "features");
    if (!Array.isArray(feats)) return [];
    return feats
      .map((f) => flattenFeature(f, format))
      .filter((r): r is Record<string, unknown> => r != null);
  }
  const raw = rowsPath ? getPath(body, rowsPath) : body;
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is Record<string, unknown> => r != null && typeof r === "object" && !Array.isArray(r));
}
