// The ids of the global-signal sources and layers WorldMap adds to the map, in one place.
//
// They moved here out of components/WorldMap.tsx with their values unchanged, so the
// God's eye view (lib/eye/look.ts, components/eye/EyeOverlay.tsx) can name the same
// layers without importing the 3,000-line map component. WorldMap imports them back.
// Pinned by tests/unit/eye-look.test.ts (the paint pass touches only ids from here).

// Global signals — FIVE aggregated sources carrying the union of every ON
// signal's features. The first three are split by geometry so each MapLibre layer
// type gets its own; the last two (declared below SIGNAL_FILL_OUTLINE) draw the
// features whose place is an area or a country, which never get a pin:
//   • SIGNAL_SRC   — points that are exact or a named site → circle + label layers
//   • SIGNAL_LINE_SRC — LineString/MultiLineString → line layer (e.g. cables)
//   • SIGNAL_FILL_SRC — Polygon/MultiPolygon → fill + outline layers (e.g. jamming)
// The point circle layer is unaffected by line/area features (toSignalFC excludes
// them) and by area/country points (pinSignals excludes those), and a click on ANY
// mark resolves to the SAME signal dossier.
export const SIGNAL_SRC = "signals";
export const SIGNAL_LAYER = "signal-dots";
export const SIGNAL_ICON_LAYER = "signal-icons"; // white hazard pictogram drawn over the disc
export const SIGNAL_LABEL = "signal-labels";
export const SIGNAL_LINE_SRC = "signal-lines";
export const SIGNAL_LINE_LAYER = "signal-line-paths";
// A road notice's patterned line (SignalFeature.line), never solid: a closed street's
// white base and its bars, works dashes, incident dots. Same source as the solid line;
// SIGNAL_LINE_HIT below is unfiltered, so a click on any of them opens its dossier.
export const SIGNAL_LINE_BAR_BASE = "signal-line-bar-base";
export const SIGNAL_LINE_BAR = "signal-line-bar";
export const SIGNAL_LINE_DASH = "signal-line-dash";
export const SIGNAL_LINE_DOT = "signal-line-dot";
// A measured road speed: solid, road width, its band's colour. Under the notices, so a
// closure drawn on a measured road stays on top.
export const SIGNAL_LINE_SPEED = "signal-line-speed";
// The cable you are pointing at, redrawn thick and opaque. With ~700 routes
// crossing each other, knowing a cable is under the cursor is not the same as
// knowing WHICH one — this answers that before the click, not after it.
export const SIGNAL_LINE_HOVER = "signal-line-hover";
// Transparent, much wider copy of the line layer, used only as a hit target.
// See resolveLineHit in lib/map/hitTest.ts for what it is allowed to claim.
export const SIGNAL_LINE_HIT = "signal-line-hit";
export const SIGNAL_FILL_SRC = "signal-fills";
export const SIGNAL_FILL_LAYER = "signal-fill-areas";
// The diagonal lines over an area of unknown status (SignalFeature.fill "hatch"). Drawn
// over SIGNAL_FILL_LAYER, which leaves those areas untinted and stays their click target.
export const SIGNAL_FILL_HATCH = "signal-fill-hatch";
export const SIGNAL_FILL_OUTLINE = "signal-fill-outline";
// The diamond pin (SignalFeature.shape "diamond"), drawn where SIGNAL_LAYER leaves that
// pin's own circle transparent. The circle stays the click and hover target.
export const SIGNAL_DIAMOND_LAYER = "signal-diamonds";
// DRAWN BY PRECISION (lib/map/precisionMarks.ts). An area or a country figure is
// never a pin, so those features leave SIGNAL_SRC and are drawn from two more
// aggregated sources:
//   • SIGNAL_COUNTRY_SRC — the outline of each country a country-level feature
//     stands for → a shaded fill + outline
//   • SIGNAL_ANCHOR_SRC  — one anchor point for each disc, country and ring mark
//     → the soft disc, the dashed ring, the figure, the name and the click target
export const SIGNAL_COUNTRY_SRC = "signal-country-shapes";
export const SIGNAL_COUNTRY_FILL = "signal-country-fill";
export const SIGNAL_COUNTRY_OUTLINE = "signal-country-outline";
export const SIGNAL_ANCHOR_SRC = "signal-area-marks";
export const SIGNAL_DISC_LAYER = "signal-area-discs";
export const SIGNAL_RING_LAYER = "signal-area-rings";
export const SIGNAL_ANCHOR_HIT = "signal-area-hit"; // transparent click target on a country figure
export const SIGNAL_FIGURE_LAYER = "signal-area-figures";
export const SIGNAL_ANCHOR_LABEL = "signal-area-labels";
