// Grouping cameras by the road they watch.
//
// WHY THIS IS WORTH A PAGE FAMILY. `road` is the best-covered optional field on the
// registry: measured against the live feed on 2026-09-06, 18,387 of 20,388 cameras
// (90.2%) carry one, across 1,978 distinct country+road pairs. "I-95 traffic cameras"
// is a thing people search for and the directory had no page for it — the only routes
// into a camera were its country and its region, and a region page for Florida is 4,838
// cameras deep.
//
// Pure module. No fetching, no Next imports.

import type { Camera } from "@/lib/types";
import { REGION_PAGE_SIZE, regionPageCount, slugify } from "@/lib/seo/paths";

/**
 * How many cameras a road needs before it gets its own page.
 *
 * Below this the page is a list of one or two links that the region page already
 * carries, which is a thin-content page competing with our own better one. Measured on
 * the 2026-09-06 registry: 1,978 distinct roads, 868 with 3 or more, 589 with 5 or more.
 */
export const MIN_ROAD_CAMERAS = 3;

/**
 * Values that appear in `road` but are not roads.
 *
 * Every one of these was MEASURED on the live registry (2026-09-06 counts in brackets),
 * not imagined. They are upstream placeholders and category labels that would otherwise
 * each mint a page: US "CNTY" [236], US "City" [103] and "CITY" [49], US "N/A" [83] and
 * CA "N/A" [20], US "Local Boise" [129], US "NWC_EL" [98].
 *
 * Compared upper-cased so a feed changing its capitalisation does not reopen the hole.
 * A road that genuinely shares one of these names does not exist; a road we wrongly
 * exclude simply keeps its region page, which is the safe direction.
 */
export const NON_ROAD_VALUES = new Set([
  "N/A",
  "NA",
  "NONE",
  "NULL",
  "UNKNOWN",
  "OTHER",
  "CNTY",
  "COUNTY",
  "CITY",
  "LOCAL",
  "-",
  "--",
  "NWC_EL",
  "LOCAL BOISE",
]);

/**
 * Longest a road name may be before it is treated as prose rather than a name.
 *
 * The measured offender is the US value "for City of Tampa cameras" [207 cameras],
 * which is a fragment of a sentence that ended up in the field. A length cap plus the
 * "camera" test below catches that class without a growing blocklist.
 */
export const MAX_ROAD_NAME = 40;

/**
 * Is this `road` value usable as a page?
 *
 * Exported so a test can assert against the real registry's odd values rather than
 * against a fixture someone wrote to match the implementation.
 */
export function isPageableRoad(raw: string | undefined): boolean {
  const road = raw?.trim();
  if (!road) return false;
  if (road.length > MAX_ROAD_NAME) return false;
  if (NON_ROAD_VALUES.has(road.toUpperCase())) return false;
  // No road is named after the cameras watching it. This is what catches prose that
  // leaked into the field, e.g. "for City of Tampa cameras".
  if (/camera/i.test(road)) return false;
  // A slug has to survive; "///" slugifies to nothing and cannot be a URL.
  return slugify(road).length > 0;
}

export interface RoadGroup {
  /** The road string exactly as the upstream gave it. */
  road: string;
  slug: string;
  count: number;
  pages: number;
}

/**
 * Every pageable road in one country, biggest first.
 *
 * Roads are scoped to a country because the names are not globally unique — "1" is a
 * British Columbia highway and also a US route, and merging them would put cameras from
 * two continents on one page.
 */
export function groupByRoad(cameras: Camera[], iso2: string): RoadGroup[] {
  const want = iso2.toUpperCase();
  const counts = new Map<string, number>();
  for (const cam of cameras) {
    if (cam.country.toUpperCase() !== want) continue;
    if (!isPageableRoad(cam.road)) continue;
    const road = (cam.road as string).trim();
    counts.set(road, (counts.get(road) ?? 0) + 1);
  }

  // Two spellings of one road ("SR 20" and "SR-20") slugify the same, and merging them
  // is correct — it is one road written two ways. Counting by slug rather than by raw
  // string is what makes the page and the count agree with each other.
  const bySlug = new Map<string, { road: string; count: number }>();
  for (const [road, count] of counts) {
    const slug = slugify(road);
    const seen = bySlug.get(slug);
    if (!seen) bySlug.set(slug, { road, count });
    else {
      // Keep the spelling that labels more cameras, so the heading reads as the form
      // the operator uses most.
      bySlug.set(slug, {
        road: count > seen.count ? road : seen.road,
        count: seen.count + count,
      });
    }
  }

  return [...bySlug]
    .filter(([, v]) => v.count >= MIN_ROAD_CAMERAS)
    .map(([slug, v]) => ({ road: v.road, slug, count: v.count, pages: regionPageCount(v.count) }))
    .sort((a, b) => b.count - a.count || a.road.localeCompare(b.road, "en"));
}

/**
 * Every camera on one road of one country, matched by SLUG and sorted stably.
 *
 * Returns the canonical road string alongside, for the same reason `camerasInRegion`
 * does: the slug is lossy and the heading must show the operator's own words. Null when
 * the slug matches nothing pageable, which the route turns into a 404 rather than an
 * empty page — including for a road that exists but sits under MIN_ROAD_CAMERAS.
 */
export function camerasOnRoad(
  cameras: Camera[],
  iso2: string,
  roadSlug: string,
): { road: string; cameras: Camera[] } | null {
  const want = roadSlug.trim().toLowerCase();
  const group = groupByRoad(cameras, iso2).find((g) => g.slug === want);
  if (!group) return null;
  const inCountry = cameras.filter(
    (c) =>
      c.country.toUpperCase() === iso2.toUpperCase() &&
      isPageableRoad(c.road) &&
      slugify((c.road as string).trim()) === want,
  );
  return {
    road: group.road,
    cameras: inCountry.sort((a, b) => a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id)),
  };
}

/** Convenience for the sitemap: every pageable road across every country. */
export function allRoadGroups(cameras: Camera[]): { iso2: string; roads: RoadGroup[] }[] {
  const countries = [...new Set(cameras.map((c) => c.country.toUpperCase()))].sort();
  return countries
    .map((iso2) => ({ iso2, roads: groupByRoad(cameras, iso2) }))
    .filter((g) => g.roads.length > 0);
}

/** Page size is shared with the region listing — one answer to "how long is a listing". */
export const ROAD_PAGE_SIZE = REGION_PAGE_SIZE;
