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
  RESERVED_FACET_SEGMENTS,
  SITEMAP_MAX_URLS,
  absoluteUrl,
  cameraPath,
  countryName,
  countryPath,
  placePath,
  regionPageCount,
  regionPath,
  roadPath,
  slugify,
} from "@/lib/seo/paths";
import { allRoadGroups } from "@/lib/seo/roads";
import { allPlaceGroups } from "@/lib/seo/places";

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

/**
 * Regions whose slug collides with a literal segment under `/cameras/[country]/`.
 *
 * A region named "Road" would slugify to "road", and Next resolves the static
 * `road` segment before the dynamic `[region]` one — so that region's listing would be
 * silently replaced by the road facet, while still returning a valid 200. Nothing else
 * can see that happen, which is why it is checked rather than assumed.
 *
 * Empty is the expected value. Same contract as `slugCollisions`: cheap to re-run
 * against live data, and a non-empty result is a page that has quietly disappeared.
 */
export function reservedSegmentCollisions(cameras: Camera[]): { iso2: string; region: string }[] {
  const reserved = new Set<string>(RESERVED_FACET_SEGMENTS);
  const out = new Map<string, { iso2: string; region: string }>();
  for (const cam of cameras) {
    const iso2 = cam.country.toUpperCase();
    const region = cam.region?.trim() || countryName(iso2);
    const slug = slugify(region);
    if (reserved.has(slug)) out.set(`${iso2}/${slug}`, { iso2, region });
  }
  return [...out.values()].sort((a, b) => a.iso2.localeCompare(b.iso2) || a.region.localeCompare(b.region));
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

  // Road and place listings. These are CROSS-CUTS of the same cameras rather than extra
  // content — a camera on I-95 in Florida is already reachable through its region — so
  // they sit at a lower priority than the region pages that form the main hierarchy.
  // Measured on the 2026-09-06 registry they add 852 road URLs and 1,013 place URLs to a
  // sitemap of ~20.3k, comfortably inside the 50k protocol cap.
  for (const { iso2, roads } of allRoadGroups(cameras)) {
    for (const road of roads) {
      for (let page = 1; page <= road.pages; page++) {
        entries.push({
          url: abs(roadPath(iso2, road.road, page)),
          changeFrequency: "daily",
          priority: page === 1 ? 0.5 : 0.3,
        });
      }
    }
  }

  for (const { iso2, places } of allPlaceGroups(cameras)) {
    for (const place of places) {
      for (let page = 1; page <= place.pages; page++) {
        entries.push({
          url: abs(placePath(iso2, place.name, page)),
          changeFrequency: "daily",
          priority: page === 1 ? 0.5 : 0.3,
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

export interface SitemapShard {
  /** URL-safe shard id, e.g. "core" or "cameras-us". Becomes /sitemap/<id>.xml. */
  id: string;
  /** Human label, shown only by the browser stylesheet. */
  label: string;
  entries: SitemapEntry[];
}

/** The shard holding the site's own pages rather than any one country's cameras. */
export const CORE_SHARD_ID = "core";

/**
 * Split the sitemap into an index plus one child per country.
 *
 * WHY SPLIT AT ALL — it is not size, and it is not speed. At 18.6k URLs and 2.6 MB
 * we sit at roughly a third of the 50,000-URL protocol limit and a twentieth of the
 * 50 MB one, and the single file serves in well under a second.
 *
 * It is MEASUREMENT. Search Console reports discovered-and-indexed counts PER
 * SUBMITTED SITEMAP. One file yields one aggregate number covering everything, and
 * one country dominates the corpus badly enough to hide the others inside it — the
 * US camera pages alone are the clear majority. If one country's pages index poorly
 * and another's index fine, a single figure averages the two into something that
 * describes neither. Sharding is what turns "is it indexed" from a yes/no into a
 * question you can actually answer per group.
 *
 * WHY BY COUNTRY, not by upstream feed: the shards should mirror how the pages are
 * organised and how people search, and the site's own hierarchy is already
 * /cameras -> /cameras/gb -> /cameras/gb/london. Which feed supplied a camera is an
 * implementation detail no visitor sees, and several feeds straddle borders anyway,
 * so feed-shaped shards would cut across the content rather than along it.
 *
 * Sharding is a REGROUPING, never a filter: every entry buildSitemap produces lands
 * in exactly one shard. A unit test asserts the union is identical to the flat
 * build, because the failure mode here is silent — dropping a shard loses thousands
 * of pages while every file still returns a valid 200.
 */
export function buildSitemapShards(
  cameras: Camera[],
  origin: string,
  staticPaths: string[] = [],
): { shards: SitemapShard[]; result: SitemapResult } {
  const result = buildSitemap(cameras, origin, staticPaths);

  // Bucket by the country segment of /camera/<feed>%3A<id>, resolved from the
  // registry rather than parsed out of the URL — the id format is a feed's business,
  // not ours, and a parser over it would break the day a feed changes its ids.
  const countryById = new Map<string, string>();
  for (const cam of cameras) countryById.set(absoluteUrl(origin, cameraPath(cam.id)), cam.country.toUpperCase());

  const core: SitemapEntry[] = [];
  const byCountry = new Map<string, SitemapEntry[]>();

  for (const entry of result.entries) {
    const iso2 = countryById.get(entry.url);
    if (!iso2) {
      core.push(entry);
      continue;
    }
    const bucket = byCountry.get(iso2) ?? [];
    bucket.push(entry);
    byCountry.set(iso2, bucket);
  }

  const shards: SitemapShard[] = [
    { id: CORE_SHARD_ID, label: "Site pages and directory", entries: core },
  ];

  // Biggest first, so the index reads as a summary of where the corpus actually is.
  for (const [iso2, entries] of [...byCountry].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  )) {
    shards.push({
      id: `cameras-${iso2.toLowerCase()}`,
      label: `Cameras · ${countryName(iso2)}`,
      entries,
    });
  }

  return { shards, result };
}

/** Look up one shard by id. Null (not an empty shard) when the id is unknown, so a route 404s. */
export function findShard(shards: SitemapShard[], id: string): SitemapShard | null {
  const want = id.trim().toLowerCase();
  return shards.find((s) => s.id === want) ?? null;
}
