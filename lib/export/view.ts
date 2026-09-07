"use client";
// Assembling a sitrep from the live console: the thin, browser-only shell over
// the pure formatter in lib/export/sitrep.
//
// Everything that could be a decision is pulled out into a pure exported
// function here (the freshness mapping, the layer list) so it can be unit-tested
// without a DOM. What remains is only the store reads.

import { MAP_SIGNALS } from "@/lib/signals/registry";
import { signalsStore, signalCountsStore } from "@/lib/signals/store";
import { signalFreshnessStore, classifySignalFreshness } from "@/lib/signals/freshness";
import { resolveSignalSources } from "@/lib/signals/sourceLink";
import { scopeStore } from "@/lib/shell/scope";
import { getMapInstance } from "@/lib/map/instance";
import { BRAND, siteUrl } from "@/lib/brand";
import {
  toSitrepMarkdown,
  sitrepFilename,
  type SitrepFeedState,
  type SitrepInput,
  type SitrepLayer,
} from "@/lib/export/sitrep";

/**
 * Pure: one signal layer's live state → the sitrep's vocabulary.
 *
 * The two vocabularies are deliberately not the same set. `unknown` (switched on,
 * no fetch has completed) becomes `dormant`, NOT `down` — inventing a failure is
 * as dishonest as hiding one, and lib/terminal/feedHealth makes exactly the same
 * call for exactly the same reason.
 */
export function mapFreshState(
  fresh: { lastUpdate: number; ok: boolean; count: number } | undefined,
  refreshMs: number,
  now: number,
): SitrepFeedState {
  if (!fresh) return "dormant"; // on, but no fetch has ever completed
  switch (classifySignalFreshness({ ...fresh, refreshMs }, now)) {
    case "live":
      return "live";
    case "empty":
      return "empty";
    case "lagging":
      return "lag";
    case "stale":
      return "stale";
    case "down":
      return "down";
    case "unknown":
    default:
      return "dormant";
  }
}

export interface BuildLayersInput {
  now: number;
  /** Registry entries — id, label and the source's own cadence. */
  sources: readonly { id: string; label: string; refreshMs: number; sourceUrl?: unknown }[];
  /** Which ids are switched on. */
  on: Readonly<Record<string, boolean>>;
  /** Live counts pushed by the rendering feeds. */
  counts: Readonly<Record<string, number>>;
  /** Last fetch outcome per id. */
  fresh: Readonly<Record<string, { lastUpdate: number; ok: boolean; count: number } | undefined>>;
}

/**
 * Pure: the layer section of the report.
 *
 * ONLY layers that are switched on appear. A layer nobody enabled was never part
 * of this view and listing it as "dormant" would pad the document with forty
 * lines of noise — but a layer that IS on and is failing must survive all the way
 * into the output, which is what the sitrep's blind-state section is for.
 */
export function buildLayers(input: BuildLayersInput): SitrepLayer[] {
  const out: SitrepLayer[] = [];
  for (const s of input.sources) {
    if (!input.on[s.id]) continue;
    const state = mapFreshState(input.fresh[s.id], s.refreshMs, input.now);
    const count = Object.prototype.hasOwnProperty.call(input.counts, s.id)
      ? input.counts[s.id]
      : null;
    out.push({
      id: s.id,
      title: s.label,
      state,
      // A layer we could not see has no honest count, whatever number is cached.
      count: state === "down" || state === "stale" || state === "refused" ? null : count,
      providers: resolveSignalSources({ signalId: s.id, sourceUrl: s.sourceUrl })
        .filter((r) => r.scope === "provider")
        .map((r) => ({ label: r.label, href: r.href, licence: r.licence })),
    });
  }
  return out;
}

/** Read the live console and build the report's input. Browser-only. */
export function collectSitrepInput(now: number = Date.now()): SitrepInput {
  const map = getMapInstance();
  const centre = map?.getCenter();
  const bounds = map?.getBounds();
  const scope = scopeStore.get();

  return {
    generatedAt: now,
    product: { name: BRAND.name, url: siteUrl() },
    scope: {
      mode: scope.mode,
      label: scope.label,
      radiusKm: scope.radiusKm,
      center: scope.center,
      bbox: scope.bbox,
    },
    view: {
      center: centre ? [centre.lng, centre.lat] : [0, 0],
      zoom: map?.getZoom() ?? 0,
      bounds: bounds
        ? [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]
        : undefined,
    },
    layers: buildLayers({
      now,
      sources: MAP_SIGNALS.map((s) => ({
        id: s.id,
        label: s.label,
        refreshMs: s.refreshMs,
        sourceUrl: (s as { sourceUrl?: unknown }).sourceUrl,
      })),
      on: signalsStore.get(),
      counts: signalCountsStore.get(),
      fresh: signalFreshnessStore.get(),
    }),
  };
}

/** The finished document plus its filename. Browser-only. */
export function buildSitrep(now: number = Date.now()): { filename: string; markdown: string } {
  return { filename: sitrepFilename(now), markdown: toSitrepMarkdown(collectSitrepInput(now)) };
}
