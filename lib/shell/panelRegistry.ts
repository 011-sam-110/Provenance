import type { ComponentType } from "react";
import type { PanelKey } from "@/lib/variants/types";
import SourceCatalog from "@/components/shell/SourceCatalog";
import FreshnessTicker from "@/components/shell/FreshnessTicker";
import NewsTicker from "@/components/shell/NewsTicker";
import MarketsPanel from "@/components/shell/MarketsPanel";
import DailyBrief from "@/components/shell/DailyBrief";
import WatchlistPanel from "@/components/shell/WatchlistPanel";
import CoveragePanel from "@/components/shell/CoveragePanel";

export const PANEL_REGISTRY: Record<PanelKey, {
  component: ComponentType;
  title: string;
  category: "core" | "intelligence" | "markets";
  defaultGrid: { x: number; y: number; w: number; h: number };
}> = {
  layerRail:  { component: SourceCatalog,  title: "Sources",   category: "core",         defaultGrid: { x: 0, y: 0, w: 3, h: 8 } },
  freshness:  { component: FreshnessTicker, title: "Freshness", category: "core",         defaultGrid: { x: 0, y: 8, w: 12, h: 1 } },
  news:       { component: NewsTicker,      title: "News",      category: "intelligence", defaultGrid: { x: 0, y: 7, w: 12, h: 1 } },
  markets:    { component: MarketsPanel,    title: "Markets",   category: "markets",      defaultGrid: { x: 9, y: 0, w: 3, h: 6 } },
  brief:      { component: DailyBrief,      title: "Brief",     category: "intelligence", defaultGrid: { x: 9, y: 0, w: 3, h: 6 } },
  watchlist:  { component: WatchlistPanel,  title: "Saved places", category: "core",       defaultGrid: { x: 9, y: 6, w: 3, h: 4 } },
  coverage:   { component: CoveragePanel,   title: "Coverage",  category: "core",         defaultGrid: { x: 9, y: 0, w: 3, h: 6 } },
};

/**
 * Panels PanelHost mounts directly as persistent chrome.
 *
 * Was `["layerRail", "freshness", "news"]`. The two tickers are `position: fixed;
 * bottom: 0` footers from the pre-console shell; the widget console pins its own
 * bottom dock at `bottom: 10px`, so mounting them now would lay a footer over it.
 * Both are also genuinely superseded — headlines/news have their own widgets, and
 * per-source freshness is on every widget frame (components/console/FreshChip).
 * The layer rail is NOT superseded: nothing else lists all 36 layers with their map
 * toggles, per-layer freshness dot and "needs a key" badge. So it, alone, stays.
 */
export const PERSISTENT_PANELS: PanelKey[] = ["layerRail"];

/**
 * The persistent-chrome panels a host should mount for one variant's placements,
 * in PERSISTENT_PANELS order. Pure — the host is then a `.map()` over the result.
 */
export function persistentPanelsFor(
  placements: readonly { panel: string; visible: boolean }[],
): PanelKey[] {
  const visible = new Set(placements.filter((p) => p.visible).map((p) => p.panel));
  return PERSISTENT_PANELS.filter((k) => visible.has(k));
}
