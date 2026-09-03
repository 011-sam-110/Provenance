/**
 * Loader for the naked-eye star catalogue behind the marketing hero globe.
 *
 * The dataset (`public/sky/naked-eye.json`) is generated offline by
 * `scripts/gen-sky.mjs` from HYG v4.4 and committed — this module never talks to
 * an upstream, it only parses and serves what is already on disk. That keeps the
 * split honest: THIS file owns "is the JSON well-formed", `lib/sky/astro.ts` owns
 * "where does a well-formed star belong on screen".
 *
 * WHY A FLAT Float64Array rather than an array of objects. 8,920 stars x 4
 * numbers is a hot per-frame read (every star, every redraw, while the hero
 * scroll-rotates the globe) — one contiguous typed array is friendlier to the
 * engine and to the GC than 8,920 short-lived object allocations, and it is the
 * same shape the JSON already ships in, so parsing is a straight copy rather than
 * a reshape. `names` stays a Map keyed by star ordinal: only ~1,600 of the 8,920
 * rows have one, so an array here would be mostly holes.
 *
 * WHY `parseSkyCatalogue` IS SEPARATE FROM `loadSkyCatalogue`. The parser is pure
 * and throws — that is what makes it unit-testable against the real committed
 * file with node:fs, no fetch mock, no DOM. The loader is the only impure part:
 * it fetches, it caches, and per this repo's dormant-safe rule (see
 * `lib/signals/nuclear.ts`) it must never let a bad or missing catalogue break
 * the page — so it is the one place any thrown error is caught and swallowed to
 * `null`. A missing sky must degrade to no sky.
 */

export const SKY_CATALOGUE_URL = "/sky/naked-eye.json";

/** [raDeg, decDeg, vmag, colourIndexBV] — must track `_provenance.columns`. */
const ROW_LEN = 4;

export type StarName = { n?: string; b?: string; c?: string; hr?: number; hip?: number };

export type SkyProvenance = {
  dataset: string;
  author: string;
  source: string;
  licence: string;
  retrieved: string;
  equinox: string;
  magnitudeLimit: number;
  rows: number;
};

export type SkyCatalogue = {
  /** Flat [raDeg, decDeg, vmag, ci] x count, brightest first. */
  readonly data: Float64Array;
  readonly count: number;
  readonly names: ReadonlyMap<number, StarName>;
  readonly provenance: SkyProvenance;
  /** Convenience accessors, index is the star ordinal not the array offset. */
  raDeg(i: number): number;
  decDeg(i: number): number;
  mag(i: number): number;
  colourIndex(i: number): number;
  nameFor(i: number): StarName | null;
};

const REQUIRED_PROVENANCE_KEYS = [
  "dataset",
  "author",
  "source",
  "licence",
  "retrieved",
  "equinox",
  "magnitudeLimit",
  "rows",
] as const;

function fail(reason: string): never {
  throw new Error(`parseSkyCatalogue: ${reason}`);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * PURE. Throws a descriptive Error on malformed input. Must be node-testable —
 * no fetch, no DOM — so `tests/unit/sky-catalog.test.ts` can read
 * `public/sky/naked-eye.json` straight off disk and run it through here.
 */
export function parseSkyCatalogue(json: unknown): SkyCatalogue {
  if (typeof json !== "object" || json === null) {
    fail(`expected an object at the top level, got ${json === null ? "null" : typeof json}`);
  }
  const root = json as Record<string, unknown>;

  const provRaw = root._provenance;
  if (typeof provRaw !== "object" || provRaw === null) fail('missing "_provenance" block');
  const prov = provRaw as Record<string, unknown>;
  for (const key of REQUIRED_PROVENANCE_KEYS) {
    if (!(key in prov)) fail(`"_provenance" is missing "${key}"`);
  }
  if (!isFiniteNumber(prov.magnitudeLimit)) fail('"_provenance.magnitudeLimit" must be a finite number');
  if (!isFiniteNumber(prov.rows)) fail('"_provenance.rows" must be a finite number');

  const provenance: SkyProvenance = {
    dataset: String(prov.dataset),
    author: String(prov.author),
    source: String(prov.source),
    licence: String(prov.licence),
    retrieved: String(prov.retrieved),
    equinox: String(prov.equinox),
    magnitudeLimit: prov.magnitudeLimit,
    rows: prov.rows,
  };

  const starsRaw = root.stars;
  if (!Array.isArray(starsRaw)) fail('"stars" must be an array');
  const count = starsRaw.length;
  const data = new Float64Array(count * ROW_LEN);

  for (let i = 0; i < count; i++) {
    const row = starsRaw[i];
    if (!Array.isArray(row) || row.length !== ROW_LEN) {
      fail(`stars[${i}] must be a ${ROW_LEN}-element [raDeg, decDeg, vmag, ci] array, got ${JSON.stringify(row)}`);
    }
    const [ra, dec, vmag, ci] = row as unknown[];
    if (![ra, dec, vmag, ci].every(isFiniteNumber)) {
      fail(`stars[${i}] has a non-finite or non-numeric value: ${JSON.stringify(row)}`);
    }
    const raN = ra as number;
    const decN = dec as number;
    if (!(raN >= 0 && raN < 360)) fail(`stars[${i}] has ra=${raN}, outside [0, 360)`);
    if (!(Math.abs(decN) <= 90)) fail(`stars[${i}] has dec=${decN}, outside [-90, 90]`);
    const off = i * ROW_LEN;
    data[off] = raN;
    data[off + 1] = decN;
    data[off + 2] = vmag as number;
    data[off + 3] = ci as number;
  }

  const namesRaw = root.names;
  if (typeof namesRaw !== "object" || namesRaw === null) fail('"names" must be an object');
  const names = new Map<number, StarName>();
  for (const [key, value] of Object.entries(namesRaw as Record<string, unknown>)) {
    const idx = Number(key);
    if (!Number.isInteger(idx)) fail(`"names" has a non-integer key: "${key}"`);
    if (typeof value !== "object" || value === null) fail(`names["${key}"] must be an object`);
    names.set(idx, value as StarName);
  }

  return {
    data,
    count,
    names,
    provenance,
    raDeg: (i) => data[i * ROW_LEN],
    decDeg: (i) => data[i * ROW_LEN + 1],
    mag: (i) => data[i * ROW_LEN + 2],
    colourIndex: (i) => data[i * ROW_LEN + 3],
    nameFor: (i) => names.get(i) ?? null,
  };
}

let cached: Promise<SkyCatalogue | null> | null = null;

/**
 * Fetches `SKY_CATALOGUE_URL` once and caches the promise so N callers in the
 * same page load (the hero, any future sky-picker UI, …) cost one request.
 * Never throws to the caller: no `fetch` (SSR, an ancient environment), a non-2xx
 * response and a malformed body are all folded into `null` here, because this
 * repo's rule is that every fetch is dormant-safe — a missing sky must degrade to
 * no sky, never to a broken page.
 */
export function loadSkyCatalogue(): Promise<SkyCatalogue | null> {
  if (typeof fetch !== "function") return Promise.resolve(null);
  cached ??= fetch(SKY_CATALOGUE_URL)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`sky catalogue: HTTP ${r.status}`))))
    .then(parseSkyCatalogue)
    .catch(() => null);
  return cached;
}

/** Test/HMR seam — drops the memoised catalogue so the next caller refetches. */
export function resetSkyCatalogueCache(): void {
  cached = null;
}

/**
 * Derived from provenance so the on-page credit line cannot drift from the data
 * it describes (see `lib/signals/nuclear.ts` for the same convention). The
 * licence field carries a trailing "(url)" for the footer's benefit elsewhere;
 * trimmed here so the credit line reads as a short, quotable name.
 */
export function skyAttribution(p: SkyProvenance): string {
  const licence = p.licence.split("(")[0].trim();
  return `Stars: ${p.dataset} (${licence})`;
}
