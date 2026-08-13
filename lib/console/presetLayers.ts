// Pure mapping: a persona's board (its widgets) → the map layers that board should
// switch ON. Deliberately import-light — only types + the DEFAULT_STATE constant, no
// stores, no React — so it unit-tests fast. `applyPreset` (presets.ts) applies the
// result via layersStore/signalsStore so the globe always matches the active persona
// instead of lingering on the default planes+cameras view.

import { DEFAULT_STATE, type LayerKey, type LayerState } from "@/lib/layers";
import type { SignalState } from "@/lib/signals/store";
import type { ShellLayout } from "@/lib/console/types";

// Core-layer widgets → the core map layer they imply. List-only widgets
// (events / markets / headlines / news) map to nothing.
const WIDGET_TO_CORE: Record<string, LayerKey> = {
  cameras: "cameras",
  aviation: "planes",
  satellites: "satellites",
};

const SIGNAL_PREFIX = "signal:";

export interface PersonaLayers {
  core: LayerState;
  signals: SignalState;
}

/**
 * Derive the map layers a persona's board should switch ON from its widgets:
 *   • `signal:<id>` widget            → signal layer <id> ON
 *   • cameras / aviation / satellites → that core layer ON
 * Every other core data layer (cameras/planes/satellites/webcams) is forced OFF so a
 * previous persona's planes don't linger under an emergency board; the `countries`
 * base layer (borders + click target) always stays ON. Works for custom presets too
 * since it reads the ShellLayout, not the preset spec.
 */
export function layersForLayout(layout: ShellLayout, extraSignals: readonly string[] = []): PersonaLayers {
  const core: LayerState = {
    ...DEFAULT_STATE,
    cameras: false,
    planes: false,
    satellites: false,
    webcams: false,
  };
  const signals: SignalState = {};
  for (const w of layout.widgets) {
    if (w.type.startsWith(SIGNAL_PREFIX)) {
      signals[w.type.slice(SIGNAL_PREFIX.length)] = true;
    } else {
      const key = WIDGET_TO_CORE[w.type];
      if (key) core[key] = true;
    }
  }
  // Layers a board wants ON THE MAP without spending a card on each.
  //
  // Deriving map layers purely from cards was fine while every board was a wall of
  // per-signal cards. It breaks for a board whose cards are merged lists: the Brief
  // board carries an anomaly feed and an event log rather than one card per source,
  // so without this its map would light nothing but cameras — and reviewers'
  // sharpest complaint about the old landing board was exactly that, "not one item
  // I can read is on the map I can see". The cards are the captions; this is the
  // picture they caption.
  for (const id of extraSignals) signals[id] = true;
  return { core, signals };
}
