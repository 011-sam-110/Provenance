// Grouping cameras by the populated place nearest to them.
//
// The place list is a generated, committed table (lib/seo/place.data.ts, from GeoNames
// cities15000). This module owns the other half: which camera belongs to which place,
// computed at request time rather than committed, so a camera added since the table was
// generated still gets a place. See the header of scripts/gen-place-table.mjs for why
// the split falls there.
//
// Pure module. No fetching, no Next imports.
//
// ATTRIBUTION: place names here are GeoNames data, CC BY 4.0. Anything that renders one
// has to credit GeoNames — the directory footer does.

import type { Camera } from "@/lib/types";
import { PLACES, type PlaceRow } from "@/lib/seo/place.data";
import { REGION_PAGE_SIZE, regionPageCount, slugify } from "@/lib/seo/paths";

/**
 * How far a camera may be from a place and still be listed under it.
 *
 * MUST match PLACE_RADIUS_KM in scripts/gen-place-table.mjs, which uses it to decide
 * which cities are worth committing at all. `place-table.test.ts` pins them together.
 *
 * 20 km is chosen to match the CLAIM the pages make, which is "cameras near X" and not
 * "cameras in X". A camera 18 km from the centre of a city is genuinely near it and is
 * genuinely not in it, and the heading has to be the weaker of the two.
 */
export const PLACE_RADIUS_KM = 20;

/**
 * How many cameras a place needs before it gets its own page. Same reasoning as
 * MIN_ROAD_CAMERAS: below this the page is thinner than the region page above it.
 */
export const MIN_PLACE_CAMERAS = 3;

/** Page size is shared with the region listing. */
export const PLACE_PAGE_SIZE = REGION_PAGE_SIZE;

/** Mirrors `haversineKm` in lib/cameras/surface.ts. */
function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** One-degree cell key. ~111 km of latitude, so a 20 km radius never leaves the 3x3. */
function cellKey(lat: number, lon: number): string {
  return `${Math.floor(lat)}|${Math.floor(lon)}`;
}

/**
 * Places bucketed by 1-degree cell.
 *
 * Built once per call to `assignPlaces` rather than at module load: the table is 1,944
 * rows, the index costs microseconds, and a module-level cache would be a second thing
 * that can go stale against a regenerated table for no measurable gain.
 */
function indexPlaces(places: readonly PlaceRow[]): Map<string, number[]> {
  const cells = new Map<string, number[]>();
  places.forEach((p, i) => {
    const key = cellKey(p.lat, p.lon);
    const bucket = cells.get(key);
    if (bucket) bucket.push(i);
    else cells.set(key, [i]);
  });
  return cells;
}

/**
 * Camera id -> index into `places`, for every camera that has a place within
 * PLACE_RADIUS_KM in ITS OWN COUNTRY.
 *
 * Country-scoped on purpose. A camera on the Detroit side of the river is 3 km from
 * Windsor, Ontario, and listing it under a Canadian city would be wrong in a way the
 * distance alone cannot see. Cameras with no place in range are simply absent from the
 * map — there is no "nearest place" fallback, because past the radius the answer is
 * "nowhere near a town" and that is the honest one.
 *
 * Ties are broken on population and then name, so the assignment is deterministic:
 * pagination that reshuffles between requests shows a crawler different content at one
 * URL, which is the failure `byNameThenId` exists to prevent in the region listing.
 */
export function assignPlaces(
  cameras: Camera[],
  places: readonly PlaceRow[] = PLACES,
): Map<string, number> {
  const cells = indexPlaces(places);
  const out = new Map<string, number>();

  for (const cam of cameras) {
    const country = cam.country.toUpperCase();
    const la = Math.floor(cam.lat);
    const lo = Math.floor(cam.lon);
    let best = -1;
    let bestKm = Infinity;

    for (let dLa = -1; dLa <= 1; dLa++) {
      for (let dLo = -1; dLo <= 1; dLo++) {
        const bucket = cells.get(`${la + dLa}|${lo + dLo}`);
        if (!bucket) continue;
        for (const i of bucket) {
          const p = places[i];
          if (p.country !== country) continue;
          const km = haversineKm(cam.lat, cam.lon, p.lat, p.lon);
          if (km > PLACE_RADIUS_KM) continue;
          if (km < bestKm) {
            best = i;
            bestKm = km;
            continue;
          }
          if (km === bestKm && best >= 0) {
            const cur = places[best];
            if (p.population > cur.population || (p.population === cur.population && p.name < cur.name)) {
              best = i;
            }
          }
        }
      }
    }

    if (best >= 0) out.set(cam.id, best);
  }

  return out;
}

/**
 * Places within `radiusKm` of a point, in the same country, nearest first.
 *
 * Pure and registry-free, which is the point: a camera page needs to know which towns it
 * sits near, and that question is answerable from the committed table alone. Asking it
 * through `assignPlaces` would drag the whole 20k registry into a per-camera render.
 */
export function placesNear(
  lat: number,
  lon: number,
  iso2: string,
  radiusKm = PLACE_RADIUS_KM,
  places: readonly PlaceRow[] = PLACES,
): { place: PlaceRow; km: number }[] {
  const country = iso2.toUpperCase();
  const cells = indexPlaces(places);
  const la = Math.floor(lat);
  const lo = Math.floor(lon);
  // A radius wider than a cell needs a wider sweep, or a town two cells away is missed.
  const reach = Math.max(1, Math.ceil(radiusKm / 111));
  const out: { place: PlaceRow; km: number }[] = [];

  for (let dLa = -reach; dLa <= reach; dLa++) {
    for (let dLo = -reach; dLo <= reach; dLo++) {
      const bucket = cells.get(`${la + dLa}|${lo + dLo}`);
      if (!bucket) continue;
      for (const i of bucket) {
        const p = places[i];
        if (p.country !== country) continue;
        const km = haversineKm(lat, lon, p.lat, p.lon);
        if (km <= radiusKm) out.push({ place: p, km });
      }
    }
  }

  return out.sort((a, b) => a.km - b.km || b.place.population - a.place.population);
}

/** The single place a camera at this point belongs to, or null past the radius. */
export function nearestPlace(lat: number, lon: number, iso2: string): PlaceRow | null {
  return placesNear(lat, lon, iso2)[0]?.place ?? null;
}

export interface PlaceGroup {
  /** GeoNames' own name for the place. */
  name: string;
  slug: string;
  iso2: string;
  lat: number;
  lon: number;
  count: number;
  pages: number;
}

/**
 * Every pageable place in one country, biggest first.
 *
 * Two places in one country whose names slugify alike are MERGED under the first, the
 * same way `groupByRoad` merges two spellings — but unlike roads that is a genuine
 * collision rather than a spelling variant, so `placeSlugCollisions` exists to make it
 * visible rather than leaving it silent.
 */
export function groupByPlace(
  cameras: Camera[],
  iso2: string,
  places: readonly PlaceRow[] = PLACES,
  // Precomputed assignment, for callers that group more than one country. Measured on
  // the 2026-09-06 registry: assigning 20,388 cameras costs ~170 ms, so recomputing it
  // per country turned an all-country pass into 2.3 s of the same arithmetic six times.
  assigned: Map<string, number> = assignPlaces(cameras, places),
): PlaceGroup[] {
  const want = iso2.toUpperCase();
  const counts = new Map<number, number>();

  for (const cam of cameras) {
    if (cam.country.toUpperCase() !== want) continue;
    const i = assigned.get(cam.id);
    if (i === undefined) continue;
    counts.set(i, (counts.get(i) ?? 0) + 1);
  }

  const bySlug = new Map<string, PlaceGroup>();
  for (const [i, count] of counts) {
    const p = places[i];
    const slug = slugify(p.name);
    if (!slug) continue;
    const seen = bySlug.get(slug);
    if (seen) {
      seen.count += count;
      seen.pages = regionPageCount(seen.count);
      continue;
    }
    bySlug.set(slug, {
      name: p.name,
      slug,
      iso2: p.country,
      lat: p.lat,
      lon: p.lon,
      count,
      pages: regionPageCount(count),
    });
  }

  return [...bySlug.values()]
    .filter((g) => g.count >= MIN_PLACE_CAMERAS)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "en"));
}

/**
 * Every camera near one place, matched by SLUG and sorted stably. Null when the slug
 * matches nothing pageable, which the route turns into a 404.
 */
export function camerasInPlace(
  cameras: Camera[],
  iso2: string,
  placeSlug: string,
  places: readonly PlaceRow[] = PLACES,
): { place: PlaceGroup; cameras: Camera[] } | null {
  const want = placeSlug.trim().toLowerCase();
  // One assignment pass, shared with the grouping below. Computing it twice was the
  // whole cost of this function.
  const assigned = assignPlaces(cameras, places);
  const group = groupByPlace(cameras, iso2, places, assigned).find((g) => g.slug === want);
  if (!group) return null;

  const matched = cameras.filter((c) => {
    if (c.country.toUpperCase() !== iso2.toUpperCase()) return false;
    const i = assigned.get(c.id);
    return i !== undefined && slugify(places[i].name) === want;
  });

  return {
    place: group,
    cameras: matched.sort((a, b) => a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id)),
  };
}

/**
 * Every pageable place across every country, from ONE assignment pass.
 *
 * The sitemap's entry point. Grouping country by country through `groupByPlace` would
 * repeat the 170 ms assignment once per country for no benefit.
 */
export function allPlaceGroups(
  cameras: Camera[],
  places: readonly PlaceRow[] = PLACES,
): { iso2: string; places: PlaceGroup[] }[] {
  const assigned = assignPlaces(cameras, places);
  const countries = [...new Set(cameras.map((c) => c.country.toUpperCase()))].sort();
  return countries
    .map((iso2) => ({ iso2, places: groupByPlace(cameras, iso2, places, assigned) }))
    .filter((g) => g.places.length > 0);
}

/**
 * Two different place names in one country that slugify to the same URL.
 *
 * Unlike the road version this is a real collision, not a spelling variant, so it is
 * surfaced rather than silently merged. A non-empty result means one page is carrying
 * two towns' cameras under one town's name.
 */
export function placeSlugCollisions(
  places: readonly PlaceRow[] = PLACES,
): { iso2: string; slug: string; names: string[] }[] {
  const seen = new Map<string, Set<string>>();
  for (const p of places) {
    const key = `${p.country}/${slugify(p.name)}`;
    const set = seen.get(key) ?? new Set<string>();
    set.add(p.name);
    seen.set(key, set);
  }
  return [...seen]
    .filter(([, names]) => names.size > 1)
    .map(([key, names]) => {
      const [iso2, slug] = key.split("/");
      return { iso2, slug, names: [...names].sort() };
    });
}
