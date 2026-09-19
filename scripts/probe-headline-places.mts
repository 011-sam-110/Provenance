// Measure the headline-places layer against the live feeds, and print every pin with
// the headlines behind it so a human can mark the wrong ones.
//
// WHAT THIS IS FOR. The layer's whole argument is that a reader can check any pin by
// reading the headline on the card. This script is that check, run over a whole live
// pull at once instead of one card at a time — it is how AMBIGUOUS_FORMS in
// lib/news/headlinePlaces.ts is decided, and how it should be revised. Run it, read the
// matches, and add anything that is routinely not the place.
//
// It is deliberately NOT a pass/fail gate. Whether "Turkey" in a headline is the country
// is a judgement, and a script that answered it automatically would be the modelled
// claim this layer exists to avoid.
//
//   npx vite-node scripts/probe-headline-places.mts
//   npx vite-node scripts/probe-headline-places.mts --json   (machine-readable)

import { mergedNews } from "@/lib/news/feed";
import { matchPlaces, gazetteerSize } from "@/lib/news/headlinePlaces";
import { buildHeadlinePlaceFeatures } from "@/lib/signals/headline-places";

const asJson = process.argv.includes("--json");

const { items, generatedAt } = await mergedNews();
const features = buildHeadlinePlaceFeatures(items);

const matchedItems = items.filter((it) => matchPlaces(it.title).length > 0);
const byOutlet = new Map<string, { total: number; placed: number }>();
for (const it of items) {
  const row = byOutlet.get(it.source) ?? { total: 0, placed: 0 };
  row.total += 1;
  if (matchPlaces(it.title).length > 0) row.placed += 1;
  byOutlet.set(it.source, row);
}

const countries = new Set(features.filter((f) => f.id.startsWith("headline:country:")).map((f) => f.id));
const cities = new Set(features.filter((f) => f.id.startsWith("headline:city:")).map((f) => f.id));

const summary = {
  fetchedAt: new Date(generatedAt).toISOString(),
  gazetteer: gazetteerSize(),
  headlines: items.length,
  headlinesWithAPlace: matchedItems.length,
  placedPct: items.length ? Math.round((matchedItems.length / items.length) * 1000) / 10 : 0,
  pins: features.length,
  countryPins: countries.size,
  cityPins: cities.size,
  outlets: Object.fromEntries([...byOutlet].sort((a, b) => b[1].total - a[1].total)),
};

if (asJson) {
  console.log(JSON.stringify({ summary, features }, null, 2));
} else {
  console.log("── headline-places, measured against the live feed ──");
  console.log(summary);
  console.log("\n── every pin, most-named first, with the headlines it rests on ──");
  console.log("Read these. A pin whose headlines do not name the place is a bug in the gazetteer,");
  console.log("not a bug in the matcher, and belongs in AMBIGUOUS_FORMS.\n");
  for (const f of features) {
    const quoted = (f.props?.quoted as string[] | undefined) ?? [];
    console.log(`${f.title}  (${f.props?.headlines} headlines, matched on "${f.props?.nameMatched}")`);
    for (const q of quoted) console.log(`    ${q}`);
    console.log("");
  }
}
