"use client";
// Bridges a CatalogSource to its LIVE state by reading the EXISTING stores — core
// layers via metrics + lib/freshness, signals via signalCounts + lib/signals/freshness.
// No fetch is started here (Phase 1: widgets are read-only). Also records each count
// into countHistoryStore so widgets get a delta + sparkline for free.

import { useEffect } from "react";
import { getCatalogSource, kindOf } from "@/lib/sources/catalog";
import { unifyCoreFresh, unifySignalFresh, type FreshKind } from "@/lib/sources/freshKind";
import { countHistoryStore } from "@/lib/widgets/history";
import { useMetrics, type Metrics } from "@/lib/metrics";
import { useFreshness, classifyFreshness, type FreshSourceId } from "@/lib/freshness";
import { useSignals, useSignalCounts, signalsStore } from "@/lib/signals/store";
import { useSignalFreshness, classifySignalFreshness } from "@/lib/signals/freshness";
import { useLayers, layersStore, type LayerKey } from "@/lib/layers";
import { useNow } from "@/lib/shell/useNow";

export interface SourceLive {
  count: number | null;
  fresh: FreshKind;
  mapOn: boolean;
  hasData: boolean;
}

function coreCount(id: string, m: Metrics): number | null {
  switch (id) {
    case "livecams": return m.liveCameras || null;
    // The still registry PLUS the Windy catalogue — both are drawn on this one row,
    // so reporting either alone understates what the toggle turns on.
    case "staticcams": return (m.stillCameras + m.webcams) || null;
    case "planes": return m.planes || null;
    case "satellites": return m.satellites || null;
    default: return null;
  }
}

export function useSourceLive(id: string): SourceLive {
  const now = useNow(1000);
  const metrics = useMetrics();
  const coreFresh = useFreshness();
  const layers = useLayers();
  const sigOn = useSignals();
  const sigCounts = useSignalCounts();
  const sigFresh = useSignalFreshness();
  const source = getCatalogSource(id);

  let live: SourceLive;
  if (source && kindOf(id) === "core") {
    const mapOn = layers[id as LayerKey] === true;
    const rec = coreFresh.find((r) => r.id === (id as FreshSourceId));
    const count = coreCount(id, metrics);
    const fresh: FreshKind = !mapOn ? "off" : rec ? unifyCoreFresh(classifyFreshness(rec, now)) : "unknown";
    live = { count, fresh, mapOn, hasData: mapOn && rec != null };
  } else if (source) {
    const mapOn = sigOn[id] === true;
    const raw = sigFresh[id];
    const count = sigCounts[id] ?? null;
    const fresh: FreshKind = !mapOn
      ? "off"
      : raw
        ? unifySignalFresh(classifySignalFreshness({ ...raw, refreshMs: source.refreshMs }, now))
        : "unknown";
    live = { count, fresh, mapOn, hasData: raw != null };
  } else {
    live = { count: null, fresh: "off", mapOn: false, hasData: false };
  }

  // Feed the history ring whenever we have a real count (drives delta + sparkline).
  useEffect(() => {
    if (live.count != null) countHistoryStore.record(id, live.count, now);
  }, [id, live.count, now]);

  return live;
}

export function toggleSourceMap(id: string, on: boolean): void {
  if (kindOf(id) === "core") layersStore.set(id as LayerKey, on);
  else signalsStore.set(id, on);
}
