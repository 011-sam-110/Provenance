// URL shapes and human-readable copy for the crawlable camera directory.
//
// WHY THIS EXISTS: `app/camera/[id]/page.tsx` has always rendered a real, useful,
// server-rendered page per camera - live frame, place, operator, refresh cadence,
// nearest neighbours - and roughly twenty thousand of them were unreachable. There
// was no sitemap, no robots policy, no per-page metadata, and the only link into
// them came from a CLIENT component inside the console, which a crawler never runs.
// So every camera page was an orphan. This module is the pure half of the fix: URL
// shapes, slugs and page copy, kept out of the route files so they can be tested.
//
// Everything here is pure. The route files supply the data.

import type { Camera } from "@/lib/types";
import { COUNTRY_CENTROIDS } from "@/lib/signals/country-centroids.data";
import { BRAND } from "@/lib/brand";

/**
 * Hard limit on URLs in a single sitemap file, from the sitemaps.org protocol.
 * We are at ~20.3k today and one file is correct; `buildSitemap` reports when a cap
 * bites rather than truncating quietly, and a unit test fails the build if the
 * projected total ever approaches this. Splitting via `generateSitemaps` is the fix
 * at that point, not a bigger number here.
 */
export const SITEMAP_MAX_URLS = 50_000;

/** Camera links rendered on one region page before it paginates. */
export const REGION_PAGE_SIZE = 500;

/** ISO-3166 alpha-2 -> display name, from the centroid table already in the repo. */
const COUNTRY_NAMES = new Map(COUNTRY_CENTROIDS.map((c) => [c.iso2.toUpperCase(), c.name]));

/**
 * Letters that carry meaning rather than an accent, so NFD leaves them intact and
 * stripping combining marks never reaches them. Keyed by CODEPOINT rather than by
 * the literal character: this file passes through enough tooling that a raw
 * non-ASCII source literal is a real hazard, and a mangled key here would fail
 * silently as a wrong slug rather than loudly as a syntax error.
 */
const FOLD = new Map<number, string>([
  [0x00d8, "o"],  // O with stroke
  [0x00f8, "o"],  // o with stroke
  [0x00d0, "d"],  // Eth
  [0x00f0, "d"],  // eth
  [0x00de, "th"], // Thorn
  [0x00fe, "th"], // thorn
  [0x00c6, "ae"], // AE
  [0x00e6, "ae"], // ae
  [0x00df, "ss"], // sharp s
  [0x0141, "l"],  // L with stroke
  [0x0142, "l"],  // l with stroke
]);

/** Unicode "combining diacritical marks" block, which NFD splits accents into. */
const COMBINING_FIRST = 0x0300;
const COMBINING_LAST = 0x036f;

/**
 * URL-safe slug.
 *
 * Accents are folded rather than deleted, so Icelandic and Nordic region names stay
 * readable instead of collapsing into punctuation: naively dropping non-ASCII turns
 * an eth into nothing and "Sudurland" into "su-urland", which is a different, uglier
 * and unguessable URL. Decomposition handles accented Latin letters; the FOLD table
 * handles the ones decomposition cannot.
 */
export function slugify(value: string): string {
  let out = "";
  for (const ch of value.normalize("NFD")) {
    const cp = ch.codePointAt(0) as number;
    if (cp >= COMBINING_FIRST && cp <= COMBINING_LAST) continue;
    out += FOLD.get(cp) ?? ch;
  }
  return out
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Display name for a country code; falls back to the code so nothing renders blank. */
export function countryName(iso2: string): string {
  return COUNTRY_NAMES.get(iso2.toUpperCase()) ?? iso2.toUpperCase();
}

/**
 * Canonical path for one camera.
 *
 * The id is `${source}:${nativeId}`, and the console has always linked it
 * percent-encoded. Next also serves the raw-colon form, which is the same page at a
 * second URL - a duplicate. Every link we emit, plus the `canonical` on the page
 * itself, uses this one shape so there is a single answer.
 */
export function cameraPath(id: string): string {
  return `/camera/${encodeURIComponent(id)}`;
}

/** Directory root. */
export const CAMERAS_ROOT = "/cameras";

export function countryPath(iso2: string): string {
  return `${CAMERAS_ROOT}/${iso2.toLowerCase()}`;
}

/** Region listing. Page 1 is the bare path, so it has exactly one URL and not two. */
export function regionPath(iso2: string, region: string, page = 1): string {
  const base = `${countryPath(iso2)}/${slugify(region)}`;
  return page > 1 ? `${base}/${page}` : base;
}

/**
 * The two literal segments that sit beside `[region]` under `/cameras/[country]/`.
 *
 * Next resolves a static segment before a dynamic one, so `/cameras/us/road/i-95` reaches
 * the road route and never `[region]`. The hazard is the mirror image: a region whose
 * name slugified to "road" or "place" would become unreachable, its page silently
 * replaced by an empty facet listing. There is no such region today across the 45 in the
 * registry, and `seo-facets.test.ts` fails if one ever appears — which is the only
 * warning anyone would get, because the broken page still returns a valid 200.
 */
export const RESERVED_FACET_SEGMENTS = ["road", "place"] as const;

/** Road listing. Page 1 is the bare path, matching `regionPath`. */
export function roadPath(iso2: string, road: string, page = 1): string {
  const base = `${countryPath(iso2)}/road/${slugify(road)}`;
  return page > 1 ? `${base}/${page}` : base;
}

/** Place listing. Page 1 is the bare path, matching `regionPath`. */
export function placePath(iso2: string, place: string, page = 1): string {
  const base = `${countryPath(iso2)}/place/${slugify(place)}`;
  return page > 1 ? `${base}/${page}` : base;
}

/** Absolute URL against a known origin, for sitemap entries and canonicals. */
export function absoluteUrl(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, "")}${path}`;
}

/** How many pages a region of `count` cameras needs (always at least 1). */
export function regionPageCount(count: number, pageSize = REGION_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(count / pageSize));
}

/**
 * Reads the page number out of a listing route's optional catch-all segment.
 *
 * Returns null for anything that is not a plain page number, so the route 404s instead
 * of quietly serving page 1 at an unlimited number of junk URLs — which would be an
 * infinite crawl space pointing at duplicate content.
 *
 * Shared by the region, road and place listings. It was written once per route until
 * there were three of them, and three copies of a crawl-space guard is three chances
 * for one of them to be relaxed on its own.
 */
export function parsePageParam(paging: string[] | undefined): number | null {
  if (!paging || paging.length === 0) return 1;
  if (paging.length > 1) return null;
  const raw = paging[0];
  if (!/^[1-9][0-9]*$/.test(raw)) return null;
  return Number(raw);
}

/** "London, United Kingdom" - the place line reused across titles and headings. */
export function placeLabel(cam: Pick<Camera, "region" | "country">): string {
  const country = countryName(cam.country);
  return cam.region ? `${cam.region}, ${country}` : country;
}

/**
 * The <title>. There is no title template on the root layout, so this returns the
 * complete string including the brand suffix.
 *
 * Shape is deliberate: the camera's own name first (the distinguishing part, and the
 * part a search result is scanned for), then what the page IS, then where. Twenty
 * thousand pages sharing one site-wide title was the single biggest reason none of
 * them could rank - to a crawler they were duplicates of one another.
 */
export function cameraTitle(cam: Pick<Camera, "name" | "region" | "country">): string {
  return `${cam.name} - live traffic camera, ${placeLabel(cam)} | ${BRAND.name}`;
}

/**
 * The meta description, and the sentence an answer engine is most likely to lift.
 *
 * Written to survive being quoted with no surrounding page: it names the camera, the
 * place, the operator and the cadence, and it never says "this feed" or "as above".
 * Nothing in it is a claim we cannot back - the cadence is the camera's declared
 * `refreshSeconds`, and the operator is its own required attribution string.
 */
export function cameraDescription(
  cam: Pick<Camera, "name" | "region" | "country" | "refreshSeconds" | "attribution">,
): string {
  return (
    `Live view from the ${cam.name} traffic camera in ${placeLabel(cam)}. ` +
    `The image refreshes ${describeCadence(cam.refreshSeconds)}, direct from ${cam.attribution}.`
  );
}

/** "every 30 seconds" / "every 5 minutes" - plain English, never a bare integer. */
export function describeCadence(seconds: number): string {
  if (seconds < 60) return `every ${Math.round(seconds)} seconds`;
  const mins = Math.round(seconds / 60);
  return mins === 1 ? "every minute" : `every ${mins} minutes`;
}

/** Thousands-separated count, so "4838 cameras" never appears in a title. */
export function formatCount(n: number): string {
  return n.toLocaleString("en-GB");
}

export function countryTitle(iso2: string, count: number): string {
  return `Live traffic cameras in ${countryName(iso2)} (${formatCount(count)}) | ${BRAND.name}`;
}

export function regionTitle(iso2: string, region: string, count: number, page: number): string {
  const suffix = page > 1 ? ` - page ${page}` : "";
  return `Live traffic cameras in ${region}, ${countryName(iso2)} (${formatCount(count)})${suffix} | ${BRAND.name}`;
}

export function roadTitle(iso2: string, road: string, count: number, page: number): string {
  const suffix = page > 1 ? ` - page ${page}` : "";
  return `${road} traffic cameras (${formatCount(count)}), ${countryName(iso2)}${suffix} | ${BRAND.name}`;
}

/**
 * "near", never "in".
 *
 * A place page collects every camera within PLACE_RADIUS_KM of the town centre, so some
 * of them are outside the town. "in" would be a claim the radius cannot support, and it
 * is the kind of overclaim a crawler is happy with and a reader is not.
 */
export function placeTitle(iso2: string, place: string, count: number, page: number): string {
  const suffix = page > 1 ? ` - page ${page}` : "";
  return `Live traffic cameras near ${place}, ${countryName(iso2)} (${formatCount(count)})${suffix} | ${BRAND.name}`;
}

export function roadDescription(iso2: string, road: string, count: number): string {
  return (
    `Live views from ${formatCount(count)} traffic ${count === 1 ? "camera" : "cameras"} on ${road} ` +
    `in ${countryName(iso2)}, each refreshed direct from the agency that operates it.`
  );
}

export function placeDescription(iso2: string, place: string, count: number, radiusKm: number): string {
  return (
    `Live views from ${formatCount(count)} traffic ${count === 1 ? "camera" : "cameras"} within ` +
    `${radiusKm} km of ${place}, ${countryName(iso2)}, each refreshed direct from the agency that operates it.`
  );
}
