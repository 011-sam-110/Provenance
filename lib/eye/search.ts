// The God's eye view's search, the pure half: what can be found, the order it is listed in, and
// what the box says when it has nothing to list. components/eye/EyeSearch.tsx does the DOM;
// tests/unit/eye-search.test.ts holds this file.
//
// TWO KINDS OF RESULT, BY WHAT A PICK DOES. A place opens at its own address with a plain full
// page load, like every way into this page (EyeApp.tsx says why), so it carries an `href`. A
// camera or a vessel is in the scene now, so the map flies there and opens its card or panel,
// so it carries its id and its spot.
//
// WHERE THE TYPED TEXT GOES. The presets, the cameras and the vessels are matched in the browser.
// Only a place search leaves it, through /api/geocode, as /privacy's "Search for a place" row
// says. A typed IP or domain is not a place, so it never goes there (`wantsGeocoder`, the same
// rule as components/console/MapSearch.tsx).

import type { GeocodeResult } from "@/lib/geo/geocode";
import { networkTargetOf } from "@/lib/recon/geo";
import { EYE_DEFAULT_TILT, EYE_PLACES, EYE_SPOT_ZOOM, eyePlaceHref, eyeSpotHref } from "@/lib/eye/places";
import { NO_MATCHES, SEARCHING_PLACES, SEARCH_DOWN } from "@/lib/eye/wording";

export type SearchResult =
  | { kind: "place"; key: string; name: string; href: string }
  | { kind: "camera" | "vessel"; key: string; name: string; id: string; lat: number; lon: number };

/** A camera or a vessel, as the scene reports it. */
export interface SearchMark {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

/** How long the list may be, as in the design. */
export const SEARCH_LIMIT = 6;
/** Room kept for the geocoder, so a street full of cameras cannot hide every other place. */
const GEOCODER_ROOM = 2;
/** Shorter than this and the geocoder is not asked, as in components/console/MapSearch.tsx. */
const GEOCODER_MIN = 2;

const presets: SearchResult[] = EYE_PLACES.map((p) => ({ kind: "place", key: `place:${p.id}`, name: p.name, href: eyePlaceHref(p.id) }));

/** The three framed places, which a focused empty box lists. */
export function presetResults(): SearchResult[] {
  return presets;
}

/** What the scene holds now. A mark with no name cannot be searched for, so it is left out. */
export function markResults(cameras: readonly SearchMark[], vessels: readonly SearchMark[]): SearchResult[] {
  const of = (kind: "camera" | "vessel", list: readonly SearchMark[]): SearchResult[] =>
    list.filter((m) => m.name.trim() !== "").map((m) => ({ kind, key: `${kind}:${m.id}`, name: m.name, id: m.id, lat: m.lat, lon: m.lon }));
  return [...of("camera", cameras), ...of("vessel", vessels)];
}

/** The geocoder's answer as results. A row with no usable spot is dropped, not thrown on. */
export function geocodeResults(rows: readonly GeocodeResult[]): SearchResult[] {
  return rows
    .filter((r) => r && typeof r.name === "string" && Number.isFinite(r.lat) && Number.isFinite(r.lon))
    .map((r) => ({
      kind: "place",
      key: `geo:${r.name}:${r.lat},${r.lon}`,
      name: r.name,
      href: eyeSpotHref({ lat: r.lat, lon: r.lon, zoom: EYE_SPOT_ZOOM, tilt: EYE_DEFAULT_TILT, heading: 0 }),
    }));
}

/** 0 for no match; the name itself, then its start, then the start of a word, then anywhere. */
export function matchScore(name: string, query: string): number {
  const n = name.toLowerCase();
  const q = query.trim().toLowerCase();
  if (q === "") return 0;
  if (n === q) return 4;
  if (n.startsWith(q)) return 3;
  if (n.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(q))) return 2;
  if (n.includes(q)) return 1;
  // Each word typed, in any order: "bridge tower" still finds Tower Bridge.
  const words = q.split(/\s+/);
  return words.length > 1 && words.every((w) => n.includes(w)) ? 1 : 0;
}

const KIND_ORDER: Readonly<Record<SearchResult["kind"], number>> = { place: 0, camera: 1, vessel: 2 };

/** Best match first; among equals a place, then a camera, then a vessel, then the shorter name. */
export function rankResults(items: readonly SearchResult[], query: string): SearchResult[] {
  return items
    .map((item) => ({ item, score: matchScore(item.name, query) }))
    .filter((x) => x.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind] ||
        a.item.name.length - b.item.name.length ||
        a.item.name.localeCompare(b.item.name),
    )
    .map((x) => x.item);
}

/** What is in the view first, then the geocoder's places, with room kept for those. */
export function combineResults(local: readonly SearchResult[], geocoded: readonly SearchResult[], limit = SEARCH_LIMIT): SearchResult[] {
  const seen = new Set(local.map((r) => r.name.toLowerCase()));
  const fresh = geocoded.filter((r) => !seen.has(r.name.toLowerCase()));
  const room = Math.min(GEOCODER_ROOM, fresh.length);
  const mine = local.slice(0, limit - room);
  return [...mine, ...fresh.slice(0, limit - mine.length)];
}

/** Is this worth asking the geocoder? Not when it is short, and never for an IP or a domain. */
export function wantsGeocoder(query: string): boolean {
  const q = query.trim();
  return q.length >= GEOCODER_MIN && networkTargetOf(q) == null;
}

/** "idle": not asked. The rest is the geocoder's answer to the words in the box now. */
export type GeocoderState = "idle" | "pending" | "done" | "failed";

/**
 * The quiet line under the results, or null. A failed geocoder is said even beside results, so
 * nobody reads a short list as all there is. A slow one is said only when there is nothing else.
 */
export function searchStatus(query: string, shown: number, geocoder: GeocoderState): string | null {
  if (query.trim() === "") return null;
  if (geocoder === "failed") return SEARCH_DOWN;
  if (shown > 0) return null;
  return geocoder === "pending" ? SEARCHING_PLACES : NO_MATCHES;
}
