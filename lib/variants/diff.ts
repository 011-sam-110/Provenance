import type { Variant, OverrideDelta } from "@/lib/variants/types";
import type { LayerState } from "@/lib/layers";
import type { SignalState } from "@/lib/signals/store";
import type { Theme } from "@/lib/shell/ui";
import { DEFAULT_STATE } from "@/lib/layers";
import { resolveSignals } from "@/lib/variants/resolveSignals";
import { MAP_SIGNALS } from "@/lib/signals/registry";

export function diffFromVariant(
  live: { layers: LayerState; signals: SignalState; theme: Theme },
  preset: Variant,
): OverrideDelta {
  const out: OverrideDelta = {};

  const presetLayers = { ...DEFAULT_STATE, ...preset.layers } as LayerState;
  const layerDiff: Partial<LayerState> = {};
  for (const k of Object.keys(live.layers) as (keyof LayerState)[]) {
    if (live.layers[k] !== presetLayers[k]) layerDiff[k] = live.layers[k];
  }
  if (Object.keys(layerDiff).length) out.layers = layerDiff;

  const presetSignals = resolveSignals(preset.signals); // id→true (absent ≡ false)
  const sigDiff: Record<string, boolean> = {};
  for (const s of MAP_SIGNALS) {
    const liveOn = live.signals[s.id] === true;
    const presetOn = presetSignals[s.id] === true;
    if (liveOn !== presetOn) sigDiff[s.id] = liveOn;
  }
  if (Object.keys(sigDiff).length) out.signals = sigDiff;

  if (live.theme !== preset.theme) out.theme = live.theme;
  return out;
}

export function isEmptyDelta(d: OverrideDelta): boolean {
  return !d.layers && !d.signals && d.theme === undefined;
}
