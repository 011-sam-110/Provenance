// lib/news/places.ts
// Turning "Bayeux, Normandy, France" into coordinates, and refusing to when we cannot.
//
// The scraper reads a place name out of an article; it does NOT produce coordinates,
// and its own geocoding milestone is unbuilt. This app already talks to Photon
// (Komoot's keyless OSM geocoder) for the console's place search, so the missing step
// is here rather than there — see app/api/geocode/route.ts for the same upstream.
//
// THREE RULES, AND NONE OF THEM ARE STYLE.
//
// 1. A GEOCODER IS A GUESS. "Springfield" matches dozens of places and Photon will
//    happily rank one first. So the query carries the context the extractor gave, and
//    any result that is not in the country the article named is REFUSED rather than
//    pinned — checked against Photon's ISO country code, because the labels are
//    localised and the scraper stores a code. A refused story stays in the rail; it
//    just does not get a dot.
//
// 2. WHAT WE PINNED IS PUBLISHED. `resolvedTo` carries Photon's own label for the
//    match, so a reader can see that "Bayeux" became "Bayeux, Calvados, France" and
//    judge it. A pin whose basis is invisible is the GDELT failure again.
//
// 3. PHOTON IS A COMMUNITY SERVER AND WE ARE A GUEST. Lookups are capped per cycle,
//    spaced out, and cached for the life of the process — a place does not move, so a
//    name is asked about exactly once. Steady state is near zero requests.
import { normalizePhoton, type GeocodeResult } from "@/lib/geo/geocode";
import type { NewsEvent } from "@/lib/news/ingest";

const PHOTON = "https://photon.komoot.io/api";
const UA = "Provenance/2.0 (+https://provenance-online.com)";
const REFERER = "https://provenance-online.com";

/** Per fetch() cycle. The cache makes this a first-sighting cost, not a recurring one. */
export const MAX_LOOKUPS_PER_CYCLE = 12;
/** Spacing between lookups. Deliberate politeness, not a rate limit we were given. */
export const LOOKUP_GAP_MS = 250;
/** Entries held. ~2,000 place names covers far more than MAX_ITEMS stories can name. */
export const MAX_CACHE_ENTRIES = 2_000;
/**
 * How long "Photon knows no such place" is believed. A positive answer never expires
 * inside a process — the place has not moved — but a negative one is re-asked
 * eventually, because the miss may be a gap in OSM that someone has since filled.
 */
export const NEGATIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ResolvedPlace {
  lat: number;
  lon: number;
  /** Photon's own label for the match. Published, so the guess is inspectable. */
  label: string;
  /** OSM class/value for the match, e.g. "city", "village", "country". */
  type?: string;
  /** ISO 3166-1 alpha-2 for the match, upper-cased. What the country guard checks. */
  countryCode?: string;
}

// --- pure: what we ask, and what we accept back ----------------------------------

/**
 * The geocoder query for one extracted event, or null when there is nothing to ask.
 *
 * Context is included because it is the only thing that disambiguates: Photon ranks
 * "Bayeux" globally, but "Bayeux, Normandy" has one sensible answer. Duplicate parts are
 * dropped so "Paris, Paris" does not become a worse query than "Paris".
 *
 * AN ISO COUNTRY CODE IS NOT ASKED, ONLY CHECKED. The scraper stores "FR", and a bare
 * two-letter token is at best noise in a search string and at worst a match of its own
 * ("IN", "IT"). Measured against Photon on 2026-09-16, "Bayeux, Normandy, FR" and
 * "Bayeux, Normandy" return an identical top three, so dropping it costs nothing and
 * the code does its real work in pickPlace() instead. A sender that ships a country
 * NAME still gets it included — that is a genuine disambiguator.
 */
export function placeQuery(event: NewsEvent | null): string | null {
  if (!event || !event.isPhysical) return null;
  const name = event.placeName?.trim();
  if (!name) return null;

  const country = event.placeCountry?.trim();
  const parts = [name];
  for (const part of [event.placeWithin, country && /^[A-Za-z]{2}$/.test(country) ? null : country]) {
    const p = part?.trim();
    if (p && !parts.some((held) => held.toLowerCase() === p.toLowerCase())) parts.push(p);
  }
  return parts.join(", ");
}

/** Cache key. Case- and spacing-insensitive so two spellings share one lookup. */
export function placeKey(query: string): string {
  return query.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Choose a result, or refuse. Pure, so the refusal rule is testable without a network.
 *
 * The one hard check is the country: if the article named a country and the match is in
 * a different one, the geocoder has found a different place with the same name and we
 * have no business pinning it. This is the cheap half of the ambiguity problem — it
 * cannot catch two Springfields in the same country, which is why `resolvedTo` is
 * published beside every pin rather than trusted silently.
 *
 * THE COMPARISON HAS TWO FORMS AND THE FIRST ONE IS THE REAL ONE. The scraper stores
 * an ISO alpha-2 code, not a name — its own schema check requires two letters — so a
 * real row carries "FR". Photon labels are LOCALISED, so the match reads "Bayeux,
 * Calvados, France" in one query and "Normandie" or "Deutschland" in the next. Matching
 * a code against a label therefore refuses every real pin, which is exactly what the
 * first cut of this did: it only passed a harness that helpfully sent "France".
 *
 * So a two-letter value is compared against Photon's own `countrycode`, and anything
 * longer falls back to a label search — that path is for a hand-written fixture or a
 * future sender that ships names, and it is deliberately the weaker of the two.
 */
export function pickPlace(results: GeocodeResult[], event: NewsEvent | null): ResolvedPlace | null {
  const stated = event?.placeCountry?.trim();
  const iso = stated && /^[A-Za-z]{2}$/.test(stated) ? stated.toUpperCase() : null;
  const name = stated && !iso ? stated.toLowerCase() : null;

  for (const r of results) {
    // A match with no country code cannot clear an ISO check. Refusing is the right
    // direction: an unplaced story stays in the rail, a misplaced one is a false pin.
    if (iso && r.countryCode !== iso) continue;
    if (name && !r.name.toLowerCase().includes(name)) continue;
    return { lat: r.lat, lon: r.lon, label: r.name, type: r.type, countryCode: r.countryCode };
  }
  return null;
}

// --- the cache, and the budgeted lookup ------------------------------------------

interface CacheEntry {
  at: number;
  place: ResolvedPlace | null;
}

/**
 * Same globalThis pattern, and for the same reason, as lib/news/scrapedStore.ts: Next
 * bundles route handlers separately, so a module-level Map would be one cache per
 * bundle. Here that would only cost extra Photon requests rather than losing data,
 * but "extra requests to someone else's free server" is exactly what this file exists
 * to avoid.
 */
const CACHE = Symbol.for("provenance.news.placeCache");
const globalCache = globalThis as unknown as { [CACHE]?: Map<string, CacheEntry> };

function cache(): Map<string, CacheEntry> {
  const existing = globalCache[CACHE];
  if (existing) return existing;
  const fresh = new Map<string, CacheEntry>();
  globalCache[CACHE] = fresh;
  return fresh;
}

function cached(key: string, nowMs: number): CacheEntry | undefined {
  const hit = cache().get(key);
  if (!hit) return undefined;
  // A positive answer never expires; a negative one is re-asked after the TTL.
  if (hit.place === null && nowMs - hit.at > NEGATIVE_TTL_MS) return undefined;
  return hit;
}

function remember(key: string, place: ResolvedPlace | null, nowMs: number): void {
  const map = cache();
  map.delete(key); // re-insert so Map's insertion order is a usable LRU
  map.set(key, { at: nowMs, place });
  while (map.size > MAX_CACHE_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One Photon lookup. Dormant-safe: any failure resolves to null, and a FAILURE is
 * deliberately not cached — only an empty-but-successful answer is. Caching a timeout
 * as "no such place" would blind us to a place for a week over one bad minute.
 */
async function lookup(query: string, event: NewsEvent | null): Promise<ResolvedPlace | null | undefined> {
  const url = new URL(PHOTON);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "5");
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": UA, Referer: REFERER },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return undefined;
    return pickPlace(normalizePhoton(await res.json(), 5), event);
  } catch {
    return undefined;
  }
}

export interface ResolveInput {
  /** The extracted event to place. */
  event: NewsEvent | null;
}

export interface ResolveOutcome {
  /** query key → the place, or null where the geocoder refused/had nothing. */
  places: Map<string, ResolvedPlace | null>;
  /** Names asked about upstream this cycle. */
  lookups: number;
  /** Names that had to wait for a later cycle because the budget ran out. */
  deferred: number;
}

/**
 * Resolve a batch of events, cache-first and budget-limited.
 *
 * Nothing here throws, and a cycle that resolves nothing is a normal outcome — the
 * layer simply publishes the pins it already has. Names past the budget are counted
 * as `deferred` and picked up next cycle, so a backfill of a thousand stories fills
 * the map in over a few hours instead of hammering Photon in one burst.
 */
export async function resolvePlaces(
  events: Array<NewsEvent | null>,
  nowMs = Date.now(),
  budget = MAX_LOOKUPS_PER_CYCLE,
): Promise<ResolveOutcome> {
  const places = new Map<string, ResolvedPlace | null>();
  // Deduplicate first: twenty stories about one city are one lookup, and the budget
  // is spent on twenty DIFFERENT places rather than twenty copies of the same one.
  const pending = new Map<string, NewsEvent | null>();

  for (const event of events) {
    const query = placeQuery(event);
    if (!query) continue;
    const key = placeKey(query);
    if (places.has(key) || pending.has(key)) continue;
    const hit = cached(key, nowMs);
    if (hit) places.set(key, hit.place);
    else pending.set(key, event);
  }

  let lookups = 0;
  let deferred = 0;
  for (const [key, event] of pending) {
    if (lookups >= budget) {
      deferred += 1;
      continue;
    }
    if (lookups > 0) await sleep(LOOKUP_GAP_MS);
    const query = placeQuery(event);
    if (!query) continue;
    const place = await lookup(query, event);
    lookups += 1;
    // `undefined` means the request failed rather than the place not existing, so it
    // is not remembered — the name is simply retried next cycle.
    if (place !== undefined) {
      remember(key, place, nowMs);
      places.set(key, place);
    }
  }

  return { places, lookups, deferred };
}

/** Tests only. */
export function resetPlaceCache(): void {
  cache().clear();
}

/** How many names are held, and how many of those are known-unplaceable. */
export function placeCacheStats(): { entries: number; placed: number } {
  let placed = 0;
  for (const entry of cache().values()) if (entry.place) placed += 1;
  return { entries: cache().size, placed };
}
