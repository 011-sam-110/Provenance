"use client";
// The Sources rail's PRESETS block — one heading over the two kinds of one-tap
// configuration the app has.
//
// ── WHAT A TILE DOES NOW ───────────────────────────────────────────────────
// It used to apply a MONITOR: a curated set of core + signal layers, and nothing
// else. `lib/monitors.ts` held six of them and this was their only caller.
//
// Monitors are gone. A preset is the whole workspace now — the layers AND the
// board that reads them — so these tiles and the ⌘K Profiles list finally mean
// the same thing, which is the whole point of the merge. See lib/console/presets.ts.
//
// ── THE ONE PLACE THAT IS NOT A STRAIGHT SWAP ──────────────────────────────
// This rail can be pointed at a drawn AREA instead of at the globe, and while it
// is, every tick in it writes to that area. `applyPreset` writes to WORLD on
// purpose — a board is a property of the globe, not of a polygon — so sending a
// tile through it during an area edit would change the globe the user is not
// looking at AND replace their board mid-edit. That is the same class of bug
// #186 fixed for the rail's own ticks, and it is not being reintroduced here.
//
// So the tile splits on context:
//   • pointed at the globe → applyPreset(): board, core layers, signal layers.
//   • pointed at an area   → the layer set only, written to that area.
// An area has a layer set and no board, so the layer set is the only half of a
// preset that means anything for one.
//
// ── THE LAYOUT, WHICH IS UNCHANGED ─────────────────────────────────────────
// Two tiers, and the difference between them is carried by the layout rather
// than by prose:
//   • the PRESETS are the full ones — layers, signals and a board — so they get
//     the primary tier: a 3-column grid, each tile showing pressed state.
//   • the four LAYER PRESETS only switch cameras/planes/satellites, so they get
//     a quieter second tier: a 4-column row of small text buttons, no pressed
//     state, because they describe a partial state the store cannot match.
//
// Fixed column counts, not auto-fit: 7 into 3 leaves one short row rather than a
// ragged wrap, and 4 into 4 divides exactly.

import { BUILTIN_PRESETS, applyPreset, presetMapState } from "@/lib/console/presets";
import { useActivePreset } from "@/lib/console/activePreset";
// THE EDITING PROJECTION. See the note above: which context this rail is aimed
// at decides what a tile is allowed to write.
import { LAYER_PRESETS, layersStore } from "@/lib/layers";
import { signalsStore } from "@/lib/signals/store";
import { editingArea, useInspector } from "@/lib/shell/inspector";
import { useT } from "@/lib/i18n/store";

export default function PresetBar() {
  const inspector = useInspector();
  const active = useActivePreset();
  const t = useT();
  const area = editingArea(inspector);

  // Pressed state comes from the ACTIVE PRESET, not from matching the live layer
  // state back against each preset's set. Matching was how the old monitor tiles
  // worked and it was always slightly dishonest: toggling one layer off silently
  // un-pressed a tile that had genuinely been applied, and two presets with the
  // same layers would both light. The active id is the fact; the layers are a
  // consequence of it.
  //
  // While an AREA is being edited nothing is pressed, because "the active board"
  // is a property of the globe and this rail is not pointed at the globe. A
  // pressed tile there would be claiming the area is on that preset.
  const pressed = area ? null : active;

  const apply = (id: string) => {
    if (!area) { applyPreset(id); return; }
    const state = presetMapState(id);
    if (!state) return;
    // applyExact, NOT applyWorld — this is the contextual write, so it lands on
    // the area the rail is pointed at. Both stores merge rather than replace, so
    // neither wipes the other's ids out of the area's shared source set.
    layersStore.applyExact(state.core);
    signalsStore.applyExact(state.signals);
  };

  return (
    <div className="tn-presets">
      <div className="tn-subhead">{t("sectionPresets")}</div>

      <div className="tn-preset-grid" role="group" aria-label={t("sectionPresets")}>
        {BUILTIN_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="tn-preset-tile"
            aria-pressed={pressed === p.id}
            title={area ? `${p.blurb} — applies this preset's layers to ${area.label}` : p.blurb}
            onClick={() => apply(p.id)}
          >
            {p.title}
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
