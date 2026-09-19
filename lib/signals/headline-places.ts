// lib/signals/headline-places.ts
// The World Headlines stream, put on the map — one pin per place NAMED, not per event.
//
// WHAT THIS LAYER CLAIMS, IN ONE SENTENCE. "Headlines in the current stream contain this
// place name." It does not claim an event happened, that it happened here, or that the
// story is even about this place. "US sanctions Iran" names two countries and locates
// nothing; this layer pins both and says, on the card, that naming is all it found.
//
// WHY A CLAIM THAT SMALL IS THE POINT. Every pin publishes the headline it came from, so
// a reader can check the claim without leaving the card and without reading the article:
// the headline either contains the name or it does not. That is the one property the
// GDELT layer never had. On 2026-08-14 GDELT put "Use of military force · Bristol" on
// this map from an article about a TikTok livestream (CLAUDE.md keeps the post-mortem) —
// the geocoding was right and the CLAIM was wrong, and no filter could find the
// difference. A claim a reader can audit at a glance cannot fail that way silently.
//
// HOW IT DIFFERS FROM news-coverage, WHICH LOOKS SIMILAR AND IS NOT. That layer reads
// the place out of the article BODY with a language model and geocodes it through
// Photon, which is a far more useful claim and a far more fragile one — it is switched
// off pending a labelled accuracy review, and nothing here changes that. The two are
// deliberately separate rows: one says where a model thinks the news happened, this one
// says which places the headlines name. Turning this on does not turn that on.
//
// WHY PLACES AND NOT STORIES. Five outlets covering one summit is five headlines and one
// place. Pinning each would draw a cluster that looks like five events, which is
// overstatement in a different shape. Bucketing by place makes corroboration visible —
// "6 headlines · BBC, Reuters, DW" — instead of inflating the map.
//
// NOTHING HERE IS FETCHED TWICE. The stream comes from lib/news/feed.ts, behind the same
// process-wide five-minute cache /api/news reads, so switching this layer on costs the
// upstreams nothing at all.
import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import type { NewsItem } from "@/lib/news";
import { mergedNews } from "@/lib/news/feed";
import { matchPlaces, type GazetteerEntry } from "@/lib/news/headlinePlaces";
import { NEWS_ATTRIBUTION } from "@/lib/news/sources";
import { degraded, observed } from "@/lib/signals/outcome";

/** Pins published. A map with a thousand dots communicates nothing. */
export const MAX_FEATURES = 250;
/** Outlets named on a pin before it says "and N more". */
const MAX_NAMED_OUTLETS = 4;
/** Headlines quoted on a pin. The rest are counted, not listed. */
export const MAX_QUOTED_HEADLINES = 5;

export const HEADLINE_PLACES_ATTRIBUTION = `Headlines © their publishers — ${NEWS_ATTRIBUTION} · coordinates from this repo's committed country-centroid and city tables`;

interface PlaceBucket {
  entry: GazetteerEntry;
  /** The exact text that matched in the first headline seen for this place. */
  matched: string;
  /** Newest first, once bucketed. */
  items: NewsItem[];
}

/**
 * Pure: headlines → one feature per place named. Separated from the fetch so the whole
 * shape of what gets published — the bucketing, the counts, the wording of every hedge —
 * is testable against a fixture with no network anywhere near it.
 */
export function buildHeadlinePlaceFeatures(items: NewsItem[], cap = MAX_FEATURES): SignalFeature[] {
  const buckets = new Map<string, PlaceBucket>();

  for (const item of items) {
    for (const match of matchPlaces(item.title)) {
      const held = buckets.get(match.entry.id);
      if (held) held.items.push(item);
      else buckets.set(match.entry.id, { entry: match.entry, matched: match.matched, items: [item] });
    }
  }

  const out: SignalFeature[] = [];
  for (const bucket of buckets.values()) {
    // Newest first, so the pin quotes the current headline rather than an arbitrary one.
    bucket.items.sort((a, b) => b.ts - a.ts);
    out.push(toFeature(bucket));
  }

  // Most-named first, so the cap drops the thinnest pins rather than an arbitrary slice.
  // A place named by one headline is the one we can least support.
  out.sort((a, b) => Number(b.props?.headlines ?? 0) - Number(a.props?.headlines ?? 0));
  return out.slice(0, Math.max(0, cap));
}

function toFeature(bucket: PlaceBucket): SignalFeature {
  const { entry, items, matched } = bucket;
  const newest = items[0];
  const outlets = Array.from(new Set(items.map((it) => it.source)));
  const named = outlets.slice(0, MAX_NAMED_OUTLETS).join(", ");
  const extra = outlets.length - MAX_NAMED_OUTLETS;

  return {
    id: `headline:${entry.id}`,
    lat: entry.lat,
    lon: entry.lon,
    // A place name, not a headline: this is the on-map label as well as the dossier
    // title, and a headline at map scale is unreadable. The headlines are in the props.
    title: entry.name,
    signalId: "headline-places",
    link: newest.url,
    ts: newest.ts > 0 ? new Date(newest.ts).toISOString() : undefined,
    props: {
      // `headlines` and not `magnitude`: this is a count of headlines, and putting a
      // count on `magnitude` would scale the marker as though it were a severity.
      headlines: items.length,
      outlets: extra > 0 ? `${named} and ${extra} more` : named,
      // The evidence, verbatim and in the publisher's words. This is the whole audit
      // trail: the name below appears in these, or the pin is wrong and you can see it.
      latest: newest.title,
      quoted: items.slice(0, MAX_QUOTED_HEADLINES).map((it) => `${it.source}: ${it.title}`),
      nameMatched: matched,
      pinPrecision:
        entry.kind === "country"
          ? "country centroid — a label anchor for the whole country, not a location"
          : "city coordinates",
      // The hedge sits in the props of every feature, beside the pin, because the lesson
      // from the GDELT layer is that a caveat in an explainer panel is a caveat nobody
      // reads.
      reading:
        "These headlines contain this place name — not a verified location, and not a claim that anything happened here",
    },
  };
}

export const HEADLINE_PLACES_SOURCE: SignalSource = {
  id: "headline-places",
  kind: "event",
  // NOT "World news" or "Headlines". The layer knows which places are NAMED; where the
  // news happened is a different question and lib/signals/news-coverage.ts is the layer
  // that tries to answer it.
  label: "Headline places",
  group: "Intel",
  color: "#0e7490",
  // Matches the feed cache in lib/news/feed.ts. A tighter refresh would re-match the
  // same headlines for nothing; a looser one would serve a stream the rail has moved on
  // from.
  refreshMs: 5 * 60 * 1000,
  attribution: HEADLINE_PLACES_ATTRIBUTION,
  metric: { field: "headlines", domain: [1, 10] },
  async fetch(): Promise<SignalFeature[]> {
    try {
      const { items, generatedAt } = await mergedNews();
      // NOT degraded. An empty stream means every upstream refused at once, which the
      // feed's last-good fallback already tries to cover — if it is still empty, nothing
      // reported, and that is a degraded layer rather than a world with no news in it.
      if (items.length === 0) return degraded("no headlines in the stream", generatedAt);
      // THE READ TIME IS THE FEED'S, NOT NOW. Stamping Date.now() would report the layer
      // as freshly read on every poll while the cached headlines behind it aged for five
      // minutes — the exact claim lib/signals/outcome.ts exists to stop.
      return observed(buildHeadlinePlaceFeatures(items), generatedAt);
    } catch {
      return degraded("headline stream unavailable");
    }
  },
};
