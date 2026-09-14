"use client";
// Bottom freshness ticker — one chip per data source with a live-counting age and
// a live/lagging/stale/down state dot. Turning freshness into a visible feature
// (rather than a hidden failure) is the trust wedge: a frozen or failing feed
// reads differently from a healthy one instead of looking like the same dots.
//
// Ages count up via a 1s clock; clicking a chip toggles that layer. Per-adapter
// breakdown (TfL vs Caltrans …) needs a server source-status endpoint over the
// data-owned registry — noted, deferred — so each network layer rolls up to one.

import { useFreshness, classifyFreshness, freshnessAgeMs, type FreshSourceId } from "@/lib/freshness";
import { useLayers, layersStore, type LayerKey } from "@/lib/layers";
import { useNow, formatAge } from "@/lib/shell/useNow";
import { track } from "@/lib/analytics/track";

const TO_LAYER: Record<FreshSourceId, LayerKey> = {
  cameras: "cameras",
  planes: "planes",
  satellites: "satellites",
  webcams: "webcams",
};

export default function FreshnessTicker() {
  const records = useFreshness();
  const layers = useLayers();
  const now = useNow(1000);

  const anyStale = records.some((r) => {
    const s = classifyFreshness(r, now);
    return s === "stale" || s === "down";
  });

  return (
    <footer className="tn-ticker" aria-label="Data freshness">
      <span className="tn-ticker-label">SOURCES</span>
      <div className="tn-ticker-chips">
        {records.map((r) => {
          const layerKey = TO_LAYER[r.id];
          const enabled = layers[layerKey];
          const state = enabled ? classifyFreshness(r, now) : "paused";
          const age = freshnessAgeMs(r, now);
          const ageText = r.local ? "local" : state === "unknown" ? "—" : formatAge(age);
          return (
            <button
              key={r.id}
              type="button"
              className={`tn-chip tn-chip-${state}`}
              onClick={() => {
                layersStore.toggle(layerKey);
                track({ name: "layer_toggled", layer: layerKey });
              }}
              title={
                enabled
                  ? `${r.label}: ${state}${r.lastUpdate ? ` · updated ${formatAge(age)} ago` : ""}`
                  : `${r.label}: layer hidden (click to show)`
              }
            >
              <span className="tn-chip-dot" aria-hidden />
              <span className="tn-chip-name">{r.label}</span>
              <span className="tn-chip-count tn-num">{r.count.toLocaleString()}</span>
              {enabled ? <span className="tn-chip-age tn-num">{ageText}</span> : <span className="tn-chip-age">paused</span>}
            </button>
          );
        })}
      </div>
      <span className="tn-ticker-status">
        {anyStale ? "Showing last-known data for a lagging source" : "All sources live"}
      </span>
    </footer>
  );
}
