import type { LayerState } from "@/lib/layers";
import type { CameraFilterState } from "@/lib/cameraFilter";
import type { Theme } from "@/lib/shell/ui";

export type PanelKey =
  | "layerRail" | "markets" | "brief"
  | "freshness" | "news" | "watchlist" | "coverage";
// "instability" | "conflict" | "topEvents" | "risk" were retired here 2026-10-24: the
// console redesign (docs/superpowers/specs/2026-06-28-ground-truth-console-redesign-
// design.md:112-115) replaced them with the anomaly-ranked feed
// (lib/console/anomaly/anomaly.ts) months ago; the dock() placements and components
// just never got deleted. Unlike these, VariantSwitcher.tsx is a DELIBERATE keep
// (2026-07-10-navbar-opendata-overhaul-design.md:39: "keep the component + its unit
// test; just unmount it") — do not apply this same retirement logic to it.
// NOTE: 'dossier' is intentionally NOT a panel — it is the FeedOverlay slide-in
// (transient, deep-linked via ?obj=), kept as overlay chrome.

export interface PanelPlacement {
  /**
   * A PanelKey for a registered panel, OR a dynamic widget key
   * (`source:<id>` / `rollup:<group>`) resolved by the dock at render time.
   */
  panel: string;
  /** Grid geometry — carried for SP1b (react-grid-layout); unused in SP1a. */
  grid: { x: number; y: number; w: number; h: number; minW?: number; minH?: number };
  visible: boolean;
}

export interface SignalSelection {
  /** Registry `group` strings, or the sentinel "*" for all groups (intel). */
  groups?: string[];
  ids?: string[];
  exclude?: string[];
}

/** Persisted divergence of the live session from a preset. */
export interface OverrideDelta {
  layers?: Partial<LayerState>;
  signals?: Record<string, boolean>;
  theme?: Theme;
}

export interface Variant {
  id: string;
  builtin: boolean;
  title: string;
  tone?: string;
  accent: string; // hex → --accent
  theme: Theme;
  layers: Partial<LayerState>;
  signals?: SignalSelection;
  panels: PanelPlacement[];
  view?: { lon: number; lat: number; zoom: number };
  cameraFilter?: Partial<CameraFilterState>;
}
