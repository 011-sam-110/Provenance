"use client";
// The four CORE-LAYER shortcuts — Core / None / Cameras / Air + space.
//
// ── WHY THIS EXISTS AS ITS OWN COMPONENT ────────────────────────────────────
// It is PresetBar's second tier, lifted out unchanged, because the Presets tab it
// lived in has been removed and this tier had nowhere else to go.
//
// The tab went because the boards it offered are already reachable from two
// louder places — the centre navbar pill (components/shell/PresetPill.tsx) and
// ⌘K's Profiles group — so a whole tab spent on a third copy was, in Sam's words,
// "the presets are already at the top". That reasoning covers the tab's FIRST
// tier and none of its second: `LAYER_PRESETS` and `layersStore.applyPreset` had
// exactly one renderer in the product, this row, and CommandPalette.tsx says so
// in as many words at its snapshot — "Layer sets were removed from the palette —
// nothing to mark active". Deleting the tab wholesale would have deleted the only
// way to turn every data layer off in one tap.
//
// ── IT IS NOT A "PRESET" IN THE presets.ts SENSE, AND THAT IS WHY IT SURVIVES ─
// A preset is the whole workspace: core layers, signal layers and the board that
// reads them. These four switch three core layers and nothing else — no board, no
// signals — which is why they never had pressed state (they describe a partial
// state the store cannot match against) and why the pill, which lists boards,
// was never going to carry them.
//
// So they sit with the source list they act on, above the sections whose rows
// they flip, rather than under a heading that would claim they are a third tier
// of preset.
//
// CONTEXT-BLIND, DELIBERATELY, and unlike PresetBar's tiles. `layersStore` writes
// whichever source context the rail is pointed at, which is the right behaviour
// here: "turn cameras on" means "turn them on for the thing I am editing". The
// tiles needed a context branch because a BOARD is a property of the globe and
// cannot be given to a polygon; a layer set has no such problem.

import { LAYER_PRESETS, layersStore } from "@/lib/layers";
import { useT } from "@/lib/i18n/store";

export default function LayerPresetRow() {
  const t = useT();
  return (
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
  );
}
