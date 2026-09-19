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
  aviation: "planes",
  satellites: "satellites",
  // A camera slot is a camera widget, so it implies camera pins wherever it is
  // dropped — including on a board that was not authored around it.
  //
  // IT IMPLIES THE LIVE TIER ONLY, which is the same judgement the old mapping made
  // in the old vocabulary: it used to switch on `cameras` (the whole road registry)
  // and pointedly not `webcams`, so that a board asking for road cameras did not also
  // get a third-party still sample. `staticcams` now holds both kinds of still, so
  // implying it would hand every camslot board ~89,000 pins it never asked for. A
  // board that wants the stills says so through `mapCore`.
  camslot: "livecams",
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
 * Every other core data layer (live/static cams, planes, satellites) is forced OFF so a
 * previous persona's planes don't linger under an emergency board; the `countries`
 * base layer (borders + click target) always stays ON. Works for custom presets too
 * since it reads the ShellLayout, not the preset spec.
 */
export function layersForLayout(
  layout: ShellLayout,
  extraSignals: readonly string[] = [],
  extraCore: readonly LayerKey[] = [],
): PersonaLayers {
  const core: LayerState = {
    ...DEFAULT_STATE,
    livecams: false,
    staticcams: false,
    planes: false,
    satellites: false,
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
  // The same escape hatch for CORE layers. `staticcams` is the case that needs it:
  // no widget implies it, and the reset above forces it off — which means no board
  // could show the still tier however it was composed. Applied after the widget pass
  // so an explicit request wins.
  for (const key of extraCore) core[key] = true;
  return { core, signals };
}
