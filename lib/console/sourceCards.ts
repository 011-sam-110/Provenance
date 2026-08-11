// Trust cards + help text for the two widget families the Source Catalog's ＋
// button creates: the per-category roll-up (`rollup:<group>`) and the generic
// per-source leaf (`source:<id>`).
//
// GENERATED, not hand-written, for the same reason the 39 signal cards are:
// these widgets are themselves generated from lib/sources/catalog.ts, so a card
// typed out by hand would go stale the moment a source moves category. Every
// registered widget still gets a real card — see lib/console/help.ts, which
// routes these two prefixes here, and tests/unit/widget-explainers.test.ts,
// which fails the build if any registered widget resolves none.
//
// The house rules from lib/signals/explain.ts apply unchanged, and the one that
// matters most here is the unflattering one: a roll-up SUMS counts that do not
// share a unit. Twelve wildfires plus three cyclones is fifteen of nothing in
// particular. That has to be said on the card, not buried, because the widget's
// whole visual grammar (one big number) implies a measurement it is not.

import { catalogByGroup, getCatalogSource } from "@/lib/sources/catalog";
import type { LayerExplainer } from "@/lib/signals/explain";
import type { WidgetHelp } from "@/lib/console/help";

const list = (xs: string[]): string =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

/** The sources that make up a catalog group, as labels. */
export function groupSourceLabels(group: string): string[] {
  const g = catalogByGroup().find((x) => x.group === group);
  return g ? g.sources.map((s) => s.label) : [];
}

/** Trust card for a category roll-up widget. */
export function rollupExplainer(group: string, widgetId: string): LayerExplainer {
  const labels = groupSourceLabels(group);
  const n = labels.length;
  return {
    id: widgetId,
    whatItShows: `The live total across every ${group} source on this map (${n === 0 ? "none are registered in this category" : list(labels)}), with each source's own count and freshness listed beneath it.`,
    method: "Counts are read from the sources already running on this map and added together. Nothing extra is fetched, and a source that is switched off contributes nothing rather than a zero.",
    confidence: "derived",
    coverage: `The ${n} ${n === 1 ? "source" : "sources"} registered under ${group}. Each one carries its own geographic limits, listed on its own card.`,
    limitations: [
      "The headline number adds up things that do not share a unit. Summing counts from different feeds gives you a sense of activity, not a measurement of anything in particular.",
      "A source that is off, dormant or still connecting is simply absent from the total, so the total goes down without anything having happened in the world. Read the per-source rows underneath before reading the big number.",
      "The roll-up is only as fresh as its slowest member, and one frozen feed inside a healthy-looking total is invisible unless you check each row's own freshness dot.",
    ],
  };
}

export function rollupHelp(group: string): WidgetHelp {
  const n = groupSourceLabels(group).length;
  return {
    what: `Everything this map is tracking under ${group}, as one live total plus a row per source. Use it to see a whole category at a glance and to spot which member has gone quiet.`,
    source: `${n} ${n === 1 ? "source" : "sources"} already running on this map`,
  };
}

/** Trust card for a generic single-source leaf widget. */
export function sourceExplainer(sourceId: string, widgetId: string): LayerExplainer {
  const s = getCatalogSource(sourceId);
  const label = s?.label ?? sourceId;
  return {
    id: widgetId,
    whatItShows: `A live count of everything ${label} is currently reporting on this map, with the change since the last update and a short trend line of recent counts.`,
    method: `The number is the count of ${label} records currently loaded, read from the layer already running on this map. The trend line is a rolling window of those counts as they arrived in this browser session, not a historical series fetched from anywhere.`,
    confidence: "reported",
    coverage: s?.attribution ?? `Whatever ${label} publishes.`,
    limitations: [
      "This is a count of what the feed returned, not a census of what exists. Coverage gaps in the upstream look identical here to an absence of things in the world.",
      "The trend line starts when you open the page and is lost on reload, so a flat line can mean 'nothing changed' or 'we have only been watching for a minute'.",
      "Switching the layer off stops the fetch, so the card goes to 'off' rather than to zero. That is a state of this app, not a statement about the world.",
    ],
  };
}

export function sourceHelp(sourceId: string): WidgetHelp {
  const s = getCatalogSource(sourceId);
  return {
    what: `How many ${s?.label ?? sourceId} records are live on the map right now, which way that number is moving, and whether the feed is still arriving on time.`,
    source: s?.attribution,
  };
}
