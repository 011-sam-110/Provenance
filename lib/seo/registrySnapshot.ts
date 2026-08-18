// Cached, page-shaped reads of the camera registry for the SEO pages.
//
// WHY THIS FILE EXISTS — it is not a speed optimisation, it is a caching BUG FIX.
//
// `/camera/[id]` declares `revalidate = 3600` and the region pages declare
// `revalidate = 86400`, and neither declaration was taking effect. Measured against
// production on 2026-08-18, four consecutive requests for the same camera page:
//
//     X-Vercel-Cache: MISS  (x4),  Age: 0  (x4)
//     Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate
//     and no X-Nextjs-Prerender header at all
//
// The build agrees: neither route appears in `.next/prerender-manifest.json`, under
// `routes` or under `dynamicRoutes`. They are fully dynamic. Every request renders
// from scratch, and the sitemap advertises 18,766 URLs to every crawler that asks.
//
// THE MECHANISM. From the Next.js caching docs: "if a route has a fetch request that
// is not cached, this will opt the route out of the Full Route Cache", and "during
// rendering, if a Dynamic API or a fetch option of { cache: 'no-store' } is
// discovered, Next.js will switch to dynamically rendering the whole route". Next 15
// changed the `fetch` default from `force-cache` to `no-store`, and none of the 23
// fetch call sites in `lib/sources/*` opt back in. So any render that reaches a live
// upstream call is dynamic, and `getRegistry()` reaches one whenever its 5-minute
// module cache is cold — which, on a fresh serverless isolate, is always.
//
// WHY SOME PAGES ESCAPED, AND WHY THAT IS NOT LUCK YOU CAN RELY ON. `/cameras/[country]`
// survives because its `generateStaticParams` calls `getRegistry()` during "collecting
// page data", so the module cache is already warm by the time the page renders and no
// fetch happens. That makes the static/dynamic decision a RACE on build ordering, not
// a property of the code — and the race is visibly non-deterministic: `/cameras` is
// prerendered on the production deployment (X-Nextjs-Prerender: 1, Age 76902) and came
// out dynamic in the local build of the same commit.
//
// THE FIX. `unstable_cache` runs its callback in a swapped work-unit store, so an
// uncached fetch inside it cannot mark the surrounding render dynamic — which is
// exactly what the docs mean by "enabling pages to be prerendered during next build".
// Reading the registry through here removes the race: the pages are static-eligible
// whether or not anything warmed the module cache first.
//
// TWO RULES FOR ANYTHING ADDED BELOW.
//
//   1. KEEP ENTRIES SMALL. These are stored in the same incremental cache that backs
//      ISR, and Vercel caps a Data Cache entry at 2 MB. The whole registry is ~6.4 MB
//      of JSON, so it must never be cached whole; every reader here returns only the
//      rows its page renders. The region reader is keyed by page number for this
//      reason — US/Florida alone is 4,838 cameras, and REGION_PAGE_SIZE bounds a
//      cached slice at 500 rows.
//   2. NEVER CALL A DYNAMIC API IN A CALLBACK. `headers()`, `cookies()` and friends
//      throw inside `unstable_cache`. That is the same property that makes this work.
//
// The `revalidate` on each reader matches the `revalidate` its page declares, so the
// data and the rendered HTML expire together rather than the page pinning an older
// snapshot than it claims.

import { unstable_cache } from "next/cache";
import type { Camera } from "@/lib/types";
import { REGISTRY_TTL_MS, getRegistry } from "@/lib/sources/registry";
import { findById, nearest } from "@/lib/sources/select";
import { camerasInRegion, groupByCountry, pageSlice, type CountryGroup } from "@/lib/seo/directory";
import { REGION_PAGE_SIZE } from "@/lib/seo/paths";

/** Matches `revalidate` on app/cameras/**. The directory moves at the speed of a feed being added. */
const DIRECTORY_TTL_SECONDS = 86_400;

/**
 * Matches `revalidate` on app/camera/[id]/page.tsx, and is DERIVED rather than typed.
 *
 * Sampo's call, 2026-08-18: track the registry's own refresh rather than the hour the
 * page used to declare. `available` - the "not answering at the last check" line - is
 * the one field on that page that genuinely moves, and an hour of it was more slack
 * than the saving was worth. At the registry's own cadence the page is never staler
 * than the data behind it, which is the tightest window that means anything: a shorter
 * one would re-render to fetch a snapshot that had not changed.
 */
const CAMERA_TTL_SECONDS = REGISTRY_TTL_MS / 1_000;

/**
 * Everything `/cameras` and `/cameras/[country]` render, in one small object.
 *
 * Counts are computed here rather than in the pages so the whole 19k array stays on
 * this side of the cache boundary — the pages receive ~40 country/region rows.
 */
export interface DirectorySnapshot {
  groups: CountryGroup[];
  /** Every camera in the registry, including the ones not currently answering. */
  total: number;
  /** How many were answering at the last refresh. */
  available: number;
  /** Regions summed across all countries. */
  regionCount: number;
}

export const getDirectory = unstable_cache(
  async (): Promise<DirectorySnapshot> => {
    const cameras = await getRegistry().catch(() => []);
    const groups = groupByCountry(cameras);
    return {
      groups,
      total: cameras.length,
      available: cameras.filter((c) => c.available).length,
      regionCount: groups.reduce((n, g) => n + g.regions.length, 0),
    };
  },
  ["seo", "directory"],
  { revalidate: DIRECTORY_TTL_SECONDS },
);

/** One row of a region listing — only the four fields the page actually prints. */
export interface RegionCameraRow {
  id: string;
  name: string;
  road?: string;
  available: boolean;
}

export interface RegionPageSnapshot {
  /** The upstream's own wording for the region, not the slug. */
  region: string;
  /** Cameras in the whole region, which is what the pager and the lede count. */
  total: number;
  /** Just this page's slice. */
  cameras: RegionCameraRow[];
}

/**
 * One page of one region.
 *
 * `unstable_cache` folds a cached function's ARGUMENTS into its cache key, so the
 * three parameters below shard the entries; the key parts only namespace them.
 * Returns null for a slug that matches no camera, which the route turns into a 404 —
 * the same contract `camerasInRegion` already has.
 */
export const getRegionPage = unstable_cache(
  async (country: string, regionSlug: string, page: number): Promise<RegionPageSnapshot | null> => {
    const cameras = await getRegistry().catch(() => []);
    const hit = camerasInRegion(cameras, country, regionSlug);
    if (!hit) return null;
    return {
      region: hit.region,
      total: hit.cameras.length,
      cameras: pageSlice(hit.cameras, page, REGION_PAGE_SIZE).map((c) => ({
        id: c.id,
        name: c.name,
        road: c.road,
        available: c.available,
      })),
    };
  },
  ["seo", "region"],
  { revalidate: DIRECTORY_TTL_SECONDS },
);

/** A neighbour link on a camera page: the two fields it prints, and the distance. */
export interface NearbyCamera {
  id: string;
  name: string;
  km: number;
}

export interface CameraPageSnapshot {
  camera: Camera;
  nearby: NearbyCamera[];
}

/**
 * One camera plus its six nearest neighbours.
 *
 * Deliberately NOT wrapped in a `.catch(() => [])`. `getRegistry()` throws only when
 * the registry is cold AND every feed failed, and the page's existing behaviour for
 * that case is to surface the error rather than claim the camera does not exist —
 * a 404 would tell a crawler to drop a page that is fine.
 *
 * `generateMetadata` and the page body both read through here, so the pair now costs
 * one cache entry between them instead of resolving the camera twice.
 */
export const getCameraPage = unstable_cache(
  async (id: string): Promise<CameraPageSnapshot | null> => {
    const cameras = await getRegistry();
    const camera = findById(cameras, id);
    if (!camera) return null;
    const nearby = nearest(cameras, camera.lat, camera.lon, 8)
      .filter((n) => n.camera.id !== camera.id)
      .slice(0, 6)
      .map((n) => ({ id: n.camera.id, name: n.camera.name, km: n.km }));
    return { camera, nearby };
  },
  ["seo", "camera"],
  { revalidate: CAMERA_TTL_SECONDS },
);
