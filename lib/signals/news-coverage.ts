// lib/signals/news-coverage.ts
// Scraped stories, placed on the map — one pin per place, not one pin per story.
//
// WHAT THIS LAYER CLAIMS, EXACTLY. "These outlets published this many stories that a
// language model read as being about something happening here." It does NOT claim that
// the thing happened, that it happened here, or that the model read the article right.
// Every one of those hedges is in the props of every feature, beside the pin, because
// the lesson from the GDELT layer is that a caveat in an explainer panel is a caveat
// nobody reads: on 2026-08-14 that layer put "Use of military force · Bristol" on the
// map from an article about a TikTok livestream, and the honest fix was not a better
// filter — no filter removes the residue — it was to stop asserting.
//
// So: the layer is called "News coverage", the category is published as `codedAs`, the
// sentence the place came from is published verbatim as `basis`, and the geocoder's own
// label for what it matched is published as `resolvedTo`. A reader who disagrees with
// any step can see which step to disagree with.
//
// WHY PLACES AND NOT STORIES. Five outlets covering one earthquake is five stories and
// one event. Pinning each would draw a cluster that looks like five events, which is
// the same overstatement in a different shape. Bucketing by resolved coordinate makes
// corroboration visible — "4 stories · Reuters, BBC, The Guardian" — rather than
// inflating the map.
//
// DORMANT BY DEFAULT AND BY CONSTRUCTION. Before the first push, and after every
// restart, the store is empty. That state is reported as DEGRADED rather than as an
// empty layer — nothing has reported, which is not the same as a quiet world — and
// either way nothing here can fail a request.
import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import type { ScrapedItem } from "@/lib/news/ingest";
import { outletDisplayName } from "@/lib/news/ingest";
import { scrapedItems, scrapedStats } from "@/lib/news/scrapedStore";
import { degraded, observed } from "@/lib/signals/outcome";
import { placeKey, placeQuery, resolvePlaces, type ResolvedPlace } from "@/lib/news/places";

/** Stories considered per cycle. The store holds more than any map should draw. */
export const POOL = 600;
/** Pins published. A map with a thousand dots communicates nothing. */
export const MAX_FEATURES = 250;
/** Round to bucket one place. 2 dp ≈ 1.1 km — the same figure the GDELT layer uses. */
export const PLACE_DP = 2;
/** Outlets named on a pin before it says "and N more". */
const MAX_NAMED_OUTLETS = 4;

export const NEWS_COVERAGE_ATTRIBUTION =
  "Headlines © their publishers · places read by a language model · geocoding © Photon/OpenStreetMap contributors";

interface PlaceBucket {
  place: ResolvedPlace;
  /** Newest first. */
  items: ScrapedItem[];
}

const round = (n: number) => Number(n.toFixed(PLACE_DP));

/**
 * Pure: stories plus already-resolved coordinates → one feature per place.
 *
 * Separated from the fetch so the whole shape of what gets published — the bucketing,
 * the counting, the wording of every hedge — is testable against a fixture with no
 * network anywhere near it.
 */
export function buildCoverageFeatures(
  items: ScrapedItem[],
  places: Map<string, ResolvedPlace | null>,
  cap = MAX_FEATURES,
): SignalFeature[] {
  const buckets = new Map<string, PlaceBucket>();

  for (const item of items) {
    const query = placeQuery(item.event);
    if (!query) continue;
    const place = places.get(placeKey(query));
    // No coordinate, no pin. The story is still in the rail — it just is not claimed
    // to be anywhere, which is the honest state for a place we could not resolve.
    if (!place) continue;

    const key = `${round(place.lat)},${round(place.lon)}`;
    const held = buckets.get(key);
    if (held) held.items.push(item);
    else buckets.set(key, { place, items: [item] });
  }

  const out: SignalFeature[] = [];
  for (const [key, bucket] of buckets) {
    // Newest first, so the pin's headline and link are the current story.
    bucket.items.sort((a, b) => b.ts - a.ts);
    out.push(toFeature(key, bucket));
  }

  // Most-covered first, so the cap drops the thinnest pins rather than an arbitrary
  // slice. A place carried by one outlet is the one we can least support.
  out.sort((a, b) => Number(b.props?.stories ?? 0) - Number(a.props?.stories ?? 0));
  return out.slice(0, Math.max(0, cap));
}

function toFeature(key: string, bucket: PlaceBucket): SignalFeature {
  const { place, items } = bucket;
  const newest = items[0];
  const outlets = Array.from(new Set(items.map((it) => outletDisplayName(it.outlet))));
  const named = outlets.slice(0, MAX_NAMED_OUTLETS).join(", ");
  const extra = outlets.length - MAX_NAMED_OUTLETS;

  // The place AS THE ARTICLE WROTE IT, not as the geocoder rewrote it. The two are
  // published side by side on purpose — where they disagree, that disagreement is the
  // most useful thing on the card.
  const asWritten = placeQuery(newest.event) ?? place.label;

  return {
    id: `news:${key}`,
    lat: place.lat,
    lon: place.lon,
    // A place name, not a headline: this is the on-map label as well as the dossier
    // title, and a headline at map scale is unreadable. The headline is `latest`.
    title: place.label,
    signalId: "news-coverage",
    link: newest.url,
    ts: new Date(newest.ts).toISOString(),
    props: {
      // `stories` and not `magnitude`: this is a count of articles, and putting a
      // count on `magnitude` would scale the marker as though it were a severity.
      stories: items.length,
      outlets: extra > 0 ? `${named} and ${extra} more` : named,
      latest: newest.title,
      latestAt: newest.tsExact
        ? new Date(newest.ts).toISOString()
        : `${new Date(newest.ts).toISOString()} (first seen — the outlet published no time)`,
      placeAsWritten: asWritten,
      resolvedTo: place.label,
      pinPrecision: describePrecision(newest.event?.placeKind ?? null, place.type),
      ...(newest.event?.category ? { codedAs: newest.event.category } : {}),
      ...(newest.event?.quote ? { basis: `"${newest.event.quote}"` } : {}),
      ...(newest.event?.eventDate ? { eventDated: newest.event.eventDate } : {}),
      reading:
        "A language model read this place out of the article text and this app geocoded the name — not a verified location, and not a verified incident",
    },
  };
}

/**
 * What the pin's precision actually is. The extractor says how precise it MEANT to be
 * and the geocoder says what it matched; where those disagree the reader should see
 * both, because "city" matched to a country centroid is a pin in a field somewhere.
 */
export function describePrecision(placeKind: string | null, matchedType: string | undefined): string {
  const said = placeKind?.trim();
  const got = matchedType?.trim();
  if (said && got && said.toLowerCase() !== got.toLowerCase()) return `${said} (matched as ${got})`;
  return said || got || "unstated";
}

export const NEWS_COVERAGE_SOURCE: SignalSource = {
  id: "news-coverage",
  kind: "event",
  // NOT "News events". The layer knows about coverage; whether there was an event is
  // the publisher's claim and the model's reading, neither of which this app verified.
  label: "News coverage",
  group: "Intel",
  color: "#0f766e",
  // The push arrives hourly, so a tighter refresh would re-resolve the same buckets
  // for nothing. It also paces the geocoder budget: 12 new names per cycle.
  refreshMs: 15 * 60 * 1000,
  attribution: NEWS_COVERAGE_ATTRIBUTION,
  sourceUrl: "https://photon.komoot.io/",
  metric: { field: "stories", domain: [1, 8] },
  async fetch(): Promise<SignalFeature[]> {
    // THE READ TIME IS THE PUSH, NOT NOW. Nothing is fetched from an outlet here —
    // the scraper did that on its own host and posted the result. Stamping this
    // `Date.now()` would report a layer as freshly read every 15 minutes while the
    // stories behind it aged for a day, which is the exact claim lib/signals/outcome.ts
    // exists to stop.
    const { updatedAt } = scrapedStats();
    // NOT `observed([])`. An empty store means nothing has been pushed — the upstream
    // has not reported, which is a degraded layer, not a quiet world. This is what
    // makes the landing page's layer table say "no answer" rather than showing a rail
    // that has never received anything as a calm hour.
    if (updatedAt === 0) return degraded("no push received");
    try {
      const items = scrapedItems(POOL).filter((it) => placeQuery(it.event) !== null);
      if (items.length === 0) return observed([], updatedAt);
      const { places } = await resolvePlaces(items.map((it) => it.event));
      return observed(buildCoverageFeatures(items, places), updatedAt);
    } catch {
      return degraded("place resolution failed", updatedAt);
    }
  },
};
