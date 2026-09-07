"use client";
// The Sources rail's PRESETS block — one heading over the two kinds of one-tap
// configuration the app has.
//
// WAS "Monitors", renamed 2026-09-05. The rail used to stack two chip rows: a
// labelled "MONITORS" row (the six curated whole-map combos in lib/monitors.ts) and,
// directly beneath it, an UNLABELLED row of four core-layer presets from
// lib/layers.ts. Two rows, two shapes, one heading between them — nothing on screen
// said why there were two, and both wrapped raggedly.
//
// They are now one block. Both are presets in the only sense a user cares about
// ("configure the map in one tap"), so they share a heading, and the difference that
// IS real is carried by the layout instead of by prose:
//
//   • the six MONITORS are the full presets — they set core layers AND signal layers,
//     so they get the primary tier: a 3-column grid, two clean rows of three, each
//     tile showing pressed state (a monitor can be "the current configuration").
//   • the four LAYER PRESETS only switch cameras/planes/satellites, so they get a
//     quieter second tier: a 4-column row of small text buttons, no pressed state,
//     because they describe a partial state that the store cannot match against.
//
// Fixed column counts, not auto-fit: 6 into 3 and 4 into 4 both divide exactly, which
// is what removes the ragged wrap. Behaviour is unchanged — this still just calls
// applyMonitor() and layersStore.applyPreset().

import { MONITORS, applyMonitor, matchMonitor } from "@/lib/monitors";
import { LAYER_PRESETS, layersStore, useLayers } from "@/lib/layers";
import { useSignals } from "@/lib/signals/store";
import { MAP_SIGNALS } from "@/lib/signals/registry";
import { useT } from "@/lib/i18n/store";

const SIGNAL_IDS = MAP_SIGNALS.map((s) => s.id);

export default function PresetBar() {
  const layers = useLayers();
  const signals = useSignals();
  const t = useT();
  const active = matchMonitor(layers, signals, SIGNAL_IDS);

  return (
    <div className="tn-presets">
      <div className="tn-subhead">{t("sectionPresets")}</div>

      <div className="tn-preset-grid" role="group" aria-label={t("sectionPresets")}>
        {MONITORS.map((m) => (
          <button
            key={m.id}
            type="button"
            className="tn-preset-tile"
            aria-pressed={active === m.id}
            title={m.blurb}
            onClick={() => applyMonitor(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="tn-preset-quick" role="group" aria-label={t("presetsCoreLayers")}>
        {LAYER_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="tn-preset-quick-btn"
            title={p.hint}
            onClick={() => layersStore.applyPreset(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
