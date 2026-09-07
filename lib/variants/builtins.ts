import type { PanelKey, Variant } from "@/lib/variants/types";

export const DEFAULT_VARIANT_ID = "explore";

// Helper: persistent chrome panels (layerRail/freshness/news) — grid is unused
// for these (they render as fixed SP1a chrome, never in the dock).
const slot = (panel: PanelKey, visible = true): { panel: PanelKey; grid: { x: number; y: number; w: number; h: number }; visible: boolean } =>
  ({ panel, grid: { x: 0, y: 0, w: 3, h: 4 }, visible });

// Helper: a dockable intelligence panel (markets/brief/watchlist/coverage) — a
// full-width tile stacked at row `y`. These are what the SP1b workspace docks.
const dock = (panel: PanelKey, y: number, h = 5): { panel: PanelKey; grid: { x: number; y: number; w: number; h: number }; visible: boolean } =>
  ({ panel, grid: { x: 0, y, w: 12, h }, visible: true });

export const BUILTIN_VARIANTS: Variant[] = [
  { id: "explore", builtin: true, title: "Explore", accent: "#2563eb", theme: "light",
    layers: { cameras: true, planes: true, satellites: false, webcams: false },
    panels: [slot("layerRail"), dock("instability", 0, 6), dock("topEvents", 6, 6), dock("coverage", 12, 6), dock("markets", 18, 6)], tone: "calm" },

  { id: "intel", builtin: true, title: "Intel", accent: "#0f172a", theme: "light",
    layers: { cameras: true, planes: true, satellites: true },
    signals: { groups: ["*"] },
    panels: [slot("layerRail"), slot("freshness"),
      dock("instability", 0, 6), dock("conflict", 6, 6), dock("topEvents", 12, 6),
      dock("risk", 18, 3), dock("markets", 21, 5), slot("news")] },

  { id: "cameras", builtin: true, title: "Cameras", accent: "#7c3aed", theme: "light",
    layers: { cameras: true, webcams: true, planes: false, satellites: false },
    cameraFilter: { liveOnly: true }, panels: [slot("layerRail"), dock("coverage", 0, 6)] },

  { id: "aviation", builtin: true, title: "Aviation", accent: "#0891b2", theme: "light",
    layers: { planes: true, cameras: false, satellites: false },
    signals: { ids: ["military-air", "airports", "launches"] },
    panels: [slot("layerRail"), slot("freshness")] },

  { id: "maritime", builtin: true, title: "Maritime", accent: "#0e7490", theme: "light",
    layers: { cameras: false, planes: false, satellites: false },
    signals: { groups: ["Maritime"], ids: ["ports", "cables"] },
    panels: [slot("layerRail"), slot("freshness")] },

  { id: "orbital", builtin: true, title: "Orbital", accent: "#4338ca", theme: "light",
    layers: { satellites: true, cameras: false, planes: false },
    signals: { groups: ["Space", "Space weather"] },
    panels: [slot("layerRail")] },

  { id: "hazards", builtin: true, title: "Hazards", accent: "#b45309", theme: "light",
    layers: { cameras: false, planes: false, satellites: false },
    signals: { groups: ["Natural hazards", "Weather"] },
    panels: [slot("layerRail"), slot("freshness"), slot("news")] },

  { id: "geopolitics", builtin: true, title: "Geopolitics", accent: "#b91c1c", theme: "light",
    layers: { cameras: false, planes: false, satellites: false },
    signals: { groups: ["Conflict", "Intel", "Military"], ids: ["displacement"] },
    panels: [slot("layerRail"), dock("brief", 0, 6), slot("news"), slot("freshness")] },

  { id: "humanitarian", builtin: true, title: "Humanitarian", accent: "#047857", theme: "light",
    layers: { cameras: false, planes: false, satellites: false },
    signals: { groups: ["Human cost"], ids: ["airquality"] },
    panels: [slot("layerRail"), dock("brief", 0, 6), slot("freshness")] },

  { id: "infrastructure", builtin: true, title: "Infrastructure", accent: "#6d28d9", theme: "light",
    layers: { cameras: false, planes: false, satellites: false },
    signals: { groups: ["Infrastructure"] },
    panels: [slot("layerRail"), slot("freshness")] },

  { id: "cyber", builtin: true, title: "Cyber", accent: "#1d4ed8", theme: "light",
    layers: { cameras: false, planes: false, satellites: false },
    signals: { groups: ["Cyber threat"], ids: ["internet-outages"] },
    panels: [slot("layerRail"), slot("news"), slot("freshness")] },

  { id: "civic", builtin: true, title: "Civic", accent: "#9333ea", theme: "light",
    layers: { cameras: false, planes: false, satellites: false },
    signals: { groups: ["Civic safety", "Environment"] },
    panels: [slot("layerRail"), slot("freshness")] },

  // No `signals` block: this variant's only entry was the instability layer, which
  // became data-only on 2026-09-05. Its two docked panels (markets + the Brief, and the
  // Brief still reads the index) are the whole point of the variant, so it keeps them
  // and simply turns no map layer on -- rather than listing an id that resolves to
  // nothing.
  { id: "markets", builtin: true, title: "Markets", accent: "#15803d", theme: "light",
    layers: { cameras: false, planes: false, satellites: false },
    panels: [slot("layerRail"), dock("markets", 0, 6), dock("brief", 6, 5)] },
];

export const BUILTIN_BY_ID: Record<string, Variant> = Object.fromEntries(
  BUILTIN_VARIANTS.map((v) => [v.id, v]),
);
