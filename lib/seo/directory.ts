// Grouping and sitemap assembly for the camera directory.
//
// The registry is a flat array of ~20k cameras. A crawler needs a path to each one,
// and no page should carry twenty thousand links, so this builds the three-level
// hierarchy the route files render:
//
//     /cameras  ->  /cameras/gb  ->  /cameras/gb/london  ->  /camera/tfl%3A...
//
// Measured against prod on 2026-08-14: 20,246 cameras, 8 countries, 39 distinct
// country/region groups, every camera carrying a region. The largest single region
// is US/Florida at 4,838, which is why region pages paginate.
//
// Pure module. No fetching, no Next imports.

import type { Camera } from "@/lib/types";
import {
  REGION_PAGE_SIZE,
  SITEMAP_MAX_URLS,
  absoluteUrl,
  cameraPath,
  countryName,
  countryPath,
  regionPageCount,
  regionPath,
  slugify,
} from "@/lib/seo/paths";

export interface RegionGroup {
  /** The region string exactly as the upstream feed gave it. */
  region: string;
  slug: string;
  count: number;
  pages: number;
}

export interface CountryGroup {
  iso2: string;
  name: string;
  count: number;
  regions: RegionGroup[];
}

/**
 * Stable ordering for anything paginated.
 *
 * Pagination that reshuffles between requests shows a crawler different content at
 * the same URL on every visit, which is worse than not paginating at all. Name is
 * the human-meaningful key and id is the tiebreak that makes it total.
 */
function byNameThenId(a: Camera, b: Camera): number {
  return a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id);
}

/** Countries by size (biggest first), each with its regions A-Z. */
export function groupByCountry(cameras: Camera[]): CountryGroup[] {
  const countries = new Map<string, Map<string, number>>();

  for (const cam of cameras) {
    const iso2 = cam.country.toUpperCase();
    const region = cam.region?.trim() || countryName(iso2);
    const regions = countries.get(iso2) ?? new Map<string, number>();
    regions.set(region, (regions.get(region) ?? 0) + 1);
    countries.set(iso2, regions);
  }

  return [...countries]
    .map(([iso2, regions]) => ({
      iso2,
      name: countryName(iso2),
      count: [...regions.values()].reduce((a, b) => a + b, 0),
      regions: [...regions]
        .map(([region, count]) => ({
          region,
          slug: slugify(region),
          count,
          pages: regionPageCount(count),
        }))
        .sort((a, b) => a.region.localeCompare(b.region, "en")),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "en"));
}

/** Every camera in a country, sorted stably. `iso2` may be upper or lower case. */
export function camerasInCountry(cameras: Camera[], iso2: string): Camera[] {
  const want = iso2.toUpperCase();
  return cameras.filter((c) => c.country.toUpperCase() === want).sort(byNameThenId);
}

/**
 * Every camera in one region of one country, matched by SLUG.
 *
 * Returns the canonical region string alongside, because the slug is lossy and the
 * page heading must show the upstream's own words ("Lower Mainland", not
 * "lower-mainland"). Null when the slug matches nothing, which the route turns into
 * a 404 rather than an empty page.
 */
export function camerasInRegion(
  cameras: Camera[],
  iso2: string,
  regionSlug: string,
): { region: string; cameras: Camera[] } | null {
  const inCountry = camerasInCountry(cameras, iso2);
  const wanted = regionSlug.toLowerCase();
  const matched = inCountry.filter((c) => slugify(c.region?.trim() || countryName(iso2)) === wanted);
  if (matched.length === 0) return null;
  return { region: matched[0].region?.trim() || countryName(iso2), cameras: matched };
}

/** One page of a sorted list. `page` is 1-based; out-of-range gives an empty slice. */
export function pageSlice<T>(items: T[], page: number, size = REGION_PAGE_SIZE): T[] {
  return items.slice((page - 1) * size, page * size);
}

/**
 * Detects two different region names that slugify to the same URL.
 *
 * If it ever returns a non-empty array, two regions are fighting over one page and
 * whichever sorts first silently swallows the other's cameras. A unit test asserts
 * this is empty for a representative set; the real defence is that it is cheap to
 * re-run against live data.
 */
export function slugCollisions(cameras: Camera[]): { iso2: string; slug: string; regions: string[] }[] {
  const seen = new Map<string, Set<string>>();
  for (const cam of cameras) {
    const iso2 = cam.country.toUpperCase();
    const region = cam.region?.trim() || countryName(iso2);
    const key = `${iso2}/${slugify(region)}`;
    const set = seen.get(key) ?? new Set<string>();
    set.add(region);
    seen.set(key, set);
  }
  return [...seen]
    .filter(([, regions]) => regions.size > 1)
    .map(([key, regions]) => {
      const [iso2, slug] = key.split("/");
      return { iso2, slug, regions: [...regions].sort() };
    });
}

export type ChangeFrequency = "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";

export interface SitemapEntry {
  url: string;
  lastModified?: Date;
  changeFrequency?: ChangeFrequency;
  priority?: number;
}

export interface SitemapResult {
  entries: SitemapEntry[];
  /** How many URLs we wanted to publish, before any cap. */
  total: number;
  /** How many the protocol limit forced us to drop. Zero is the expected value. */
  dropped: number;
  /** Cameras left out because they are currently unavailable. */
  skippedUnavailable: number;
}

/**
 * Assembles the whole sitemap.
 *
 * Two deliberate choices worth knowing about:
 *
 * 1. **Unavailable cameras are left out.** A sitemap is an invitation to crawl, and
 *    inviting a crawler to a page whose whole point is a picture that is not loading
 *    earns a thin-content impression we only get to make once. They stay linked in
 *    the directory, so they are still reachable and the coverage numbers stay honest
 *    - they are simply not advertised. `available` flips back on its own, and the
 *    sitemap revalidates daily, so this self-heals with no intervention.
 *
 * 2. **No `lastModified` on a camera unless the feed told us one.** Stamping every
 *    entry with "now" claims twenty thousand pages changed today, every day, which
 *    is noise a crawler learns to discount. `changeFrequency` already carries the
 *    "this image is always moving" fact.
 */
export function buildSitemap(cameras: Camera[], origin: string, staticPaths: string[] = []): SitemapResult {
  const abs = (p: string) => absoluteUrl(origin, p);
  const entries: SitemapEntry[] = [];

  entries.push({ url: abs("/"), changeFrequency: "hourly", priority: 1 });
  for (const path of staticPaths) {
    entries.push({ url: abs(path), changeFrequency: "weekly", priority: 0.6 });
  }
  entries.push({ url: abs("/cameras"), changeFrequency: "daily", priority: 0.8 });

  const groups = groupByCountry(cameras);
  for (const country of groups) {
    entries.push({ url: abs(countryPath(country.iso2)), changeFrequency: "daily", priority: 0.7 });
    for (const region of country.regions) {
      for (let page = 1; page <= region.pages; page++) {
        entries.push({
          url: abs(regionPath(country.iso2, region.region, page)),
          changeFrequency: "daily",
          priority: page === 1 ? 0.6 : 0.4,
        });
      }
    }
  }

  const publishable = cameras.filter((c) => c.available);
  const skippedUnavailable = cameras.length - publishable.length;

  for (const cam of [...publishable].sort(byNameThenId)) {
    const sampled = cam.lastSampledAt ? new Date(cam.lastSampledAt) : undefined;
    entries.push({
      url: abs(cameraPath(cam.id)),
      lastModified: sampled && !Number.isNaN(sampled.getTime()) ? sampled : undefined,
      changeFrequency: "hourly",
      priority: 0.5,
    });
  }

  const total = entries.length;
  const dropped = Math.max(0, total - SITEMAP_MAX_URLS);
  return { entries: dropped ? entries.slice(0, SITEMAP_MAX_URLS) : entries, total, dropped, skippedUnavailable };
}
