// Single source of truth for every type icon on the map.
//
// Each icon is a hand-authored 24×24 SVG pictogram drawn in `currentColor`, so
// it can be (a) rendered inline in the legend/overlay at any CSS colour and
// (b) rasterised to a tinted sprite texture for the 3D globe and to an SDF
// symbol for the MapLibre map. Keeping the art, palette and labels together
// means the globe, the map markers and the legend can never drift apart.
//
// Pure + isomorphic (no DOM / no three.js here) so it can be imported anywhere.

import type { SatCategory } from "@/lib/satellites/classify";
import type { PlaneCategory } from "@/lib/planes/classify";
import type { CameraFeed } from "@/lib/cameras/classify";

export type IconKey =
  | "sat-station" | "sat-starlink" | "sat-oneweb" | "sat-navigation" | "sat-weather"
  | "sat-eo" | "sat-science" | "sat-comms" | "sat-cubesat" | "sat-debris" | "sat-other"
  | "plane-airliner" | "plane-regional" | "plane-light" | "plane-helicopter" | "plane-ground"
  | "cam-still" | "cam-video"
  | "webcam"
  // Event / signal pictograms — one per hazard family, drawn white onto the
  // colour-coded disc (see lib/map/icons.ts loadSignalIcons + SIGNAL_ICON below).
  | "sig-quake" | "sig-fire" | "sig-volcano" | "sig-storm" | "sig-flood" | "sig-cyclone"
  | "sig-drought" | "sig-aurora" | "sig-spaceweather" | "sig-launch" | "sig-nuclear"
  | "sig-airport" | "sig-port" | "sig-ship" | "sig-outage" | "sig-conflict" | "sig-protest"
  | "sig-cyber" | "sig-crime" | "sig-displacement" | "sig-food" | "sig-relief" | "sig-grid"
  | "sig-military" | "sig-air" | "sig-instability" | "sig-weather" | "sig-generic";

// "Inner" dark used for cut-outs (lenses, panel cells) that should read against
// any tint — it stays constant when currentColor is replaced.
const INK = "#0b0f1a";

const wrap = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">${inner}</svg>`;

export const ICON_SVG: Record<IconKey, string> = {
  // --- Satellites ---------------------------------------------------------
  "sat-station": wrap(
    `<rect x="10.3" y="8.5" width="3.4" height="7" rx=".6"/><rect x="2" y="9.5" width="7" height="5" rx=".6"/><rect x="15" y="9.5" width="7" height="5" rx=".6"/><rect x="11.3" y="2.6" width="1.4" height="6"/><rect x="11.3" y="15.4" width="1.4" height="6"/>`,
  ),
  "sat-starlink": wrap(
    `<rect x="2.5" y="10" width="9" height="4" rx=".6"/><rect x="12.5" y="6.5" width="9" height="11" rx=".9"/><path d="M14.5 9h5M14.5 12h5M14.5 15h5" stroke="${INK}" stroke-width=".7"/>`,
  ),
  "sat-oneweb": wrap(
    `<rect x="9" y="8.8" width="6" height="6.4" rx=".9"/><rect x="2.4" y="10" width="5.6" height="4" rx=".5"/><rect x="16" y="10" width="5.6" height="4" rx=".5"/>`,
  ),
  "sat-navigation": wrap(
    `<rect x="9.6" y="2.6" width="4.8" height="4.6" rx=".6"/><rect x="4" y="3.4" width="4.6" height="3.2" rx=".4"/><rect x="15.4" y="3.4" width="4.6" height="3.2" rx=".4"/><path d="M12 7.4v3.6" stroke="currentColor" stroke-width="1.4"/><path d="M7.6 13.2a6 6 0 0 1 8.8 0" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4.6 16.4a10 10 0 0 1 14.8 0" fill="none" stroke="currentColor" stroke-width="1.5"/>`,
  ),
  "sat-weather": wrap(
    `<rect x="9.6" y="3" width="4.8" height="4.4" rx=".6"/><rect x="3.6" y="3.7" width="5" height="3" rx=".4"/><rect x="15.4" y="3.7" width="5" height="3" rx=".4"/><path d="M9.8 7.4 7.2 21h9.6L14.2 7.4z" opacity=".5"/><circle cx="12" cy="8.6" r="1.3"/>`,
  ),
  "sat-eo": wrap(
    `<rect x="9" y="2.8" width="6" height="5" rx=".6"/><rect x="2.8" y="3.7" width="5.4" height="3.2" rx=".4"/><rect x="15.8" y="3.7" width="5.4" height="3.2" rx=".4"/><rect x="10.6" y="7.8" width="2.8" height="2.6"/><circle cx="12" cy="15" r="3.4" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="15" r="1.2"/>`,
  ),
  "sat-science": wrap(
    `<rect x="7.4" y="5" width="9.2" height="13" rx="1.4"/><rect x="8.8" y="2.6" width="6.4" height="2.8" rx="1"/><rect x="3.4" y="9.5" width="4" height="4" rx=".5"/><rect x="16.6" y="9.5" width="4" height="4" rx=".5"/><circle cx="12" cy="7.2" r="1.7" fill="${INK}"/>`,
  ),
  "sat-comms": wrap(
    `<rect x="10" y="11" width="4" height="6.5" rx=".5"/><rect x="3" y="12" width="6" height="4" rx=".5"/><rect x="15" y="12" width="6" height="4" rx=".5"/><path d="M12 11.4 6.4 5.6a7.8 7.8 0 0 1 11.2 0L12 11.4z"/><circle cx="12" cy="7.8" r="1" fill="${INK}"/>`,
  ),
  "sat-cubesat": wrap(
    `<rect x="8.4" y="8.4" width="7.2" height="7.2" rx=".8"/><rect x="9.8" y="9.8" width="4.4" height="4.4" rx=".4" fill="${INK}"/><rect x="2.8" y="10.4" width="4.6" height="3.2" rx=".4"/><rect x="16.6" y="10.4" width="4.6" height="3.2" rx=".4"/>`,
  ),
  "sat-debris": wrap(
    `<path d="M7.5 3.6 13 5.2l3.6-1.1 2.3 4.8-2.8 3.1 1.2 5.2-5.6-1.2-4.4 2.4-1.1-5.7L3 6.6z" opacity=".92"/>`,
  ),
  "sat-other": wrap(
    `<rect x="9.5" y="8.5" width="5" height="7" rx=".6"/><rect x="3" y="9.5" width="5.5" height="5" rx=".5"/><rect x="15.5" y="9.5" width="5.5" height="5" rx=".5"/><path d="M12 8.5V4M10 4h4" stroke="currentColor" stroke-width="1.3" fill="none"/>`,
  ),

  // --- Planes (top view, nose pointing UP/north) --------------------------
  "plane-airliner": wrap(
    `<path d="M12 1.4c.85 0 1.45 1.25 1.55 3.3l.12 3.2 7.83 4.55v2.05l-7.83-2.3v4.45l2.45 1.6v1.75L12 22.6l-4.12-1.0v-1.75l2.45-1.6v-4.45l-7.83 2.3V12.45L10.33 7.9l.12-3.2C10.55 2.65 11.15 1.4 12 1.4z"/>`,
  ),
  "plane-regional": wrap(
    `<path d="M12 2.6c.72 0 1.22 1.05 1.32 2.8l.1 2.9 6.58 3.75v1.75l-6.58-1.9v3.7l2.05 1.45v1.55L12 21.3l-3.47-.7v-1.55l2.05-1.45v-3.7l-6.58 1.9V12.05L10.58 8.3l.1-2.9C10.78 3.65 11.28 2.6 12 2.6z"/>`,
  ),
  "plane-light": wrap(
    `<path d="M11 3.2h2v4.1l8 3v2l-8-1.6v6.1l3 1.9v1.4l-5-1-5 1v-1.4l3-1.9v-6.1l-8 1.6v-2l8-3z"/><rect x="8.6" y="1.8" width="6.8" height="1.4" rx=".7"/>`,
  ),
  "plane-helicopter": wrap(
    `<rect x="2" y="11.2" width="20" height="1.5" rx=".75"/><rect x="11.25" y="2" width="1.5" height="20" rx=".75"/><ellipse cx="12" cy="12" rx="2.6" ry="3.7"/><rect x="11.4" y="14.8" width="1.2" height="6.4"/><rect x="9.4" y="20.4" width="5.2" height="1.4" rx=".7"/>`,
  ),
  "plane-ground": wrap(
    `<path d="M12 1.8c.78 0 1.32 1.1 1.42 3l.1 2.9 7.18 4.15v1.85l-7.18-2.1v4l2.2 1.45v1.55L12 18.6l-3.72-.95v-1.55l2.2-1.45v-4l-7.18 2.1V11.85L10.48 7.7l.1-2.9C10.68 2.9 11.22 1.8 12 1.8z"/><rect x="2.5" y="20.6" width="19" height="1.6" rx=".8" opacity=".75"/>`,
  ),

  // --- Cameras ------------------------------------------------------------
  "cam-still": wrap(
    `<path d="M2.6 7.7 16 4.4c1-.25 2.02.37 2.3 1.4l.5 1.95c.27 1.02-.35 2.05-1.37 2.32L3.6 13.6 2.6 7.7z"/><circle cx="6.1" cy="9.1" r="1.15" fill="${INK}"/><rect x="11" y="13" width="2" height="5.1"/><rect x="6.8" y="18" width="10.4" height="1.8" rx=".9"/>`,
  ),
  "cam-video": wrap(
    `<path d="M1.8 8.1 12.6 5.4c.9-.22 1.82.32 2.05 1.25l.46 1.85c.22.9-.32 1.82-1.22 2.05L2.8 13.5 1.8 8.1z"/><circle cx="5" cy="9.5" r="1.05" fill="${INK}"/><rect x="9.4" y="13" width="1.8" height="4.7"/><rect x="5.8" y="17.6" width="9" height="1.7" rx=".85"/><path d="M17.6 7.4a4.2 4.2 0 0 1 0 6.2M19.9 5.6a6.8 6.8 0 0 1 0 9.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  ),

  // --- Webcams (Windy) ----------------------------------------------------
  // A front-facing webcam (monitor body + lens + stand), deliberately distinct
  // from the angled CCTV "cam-*" pictograms so the public-webcam layer reads as
  // its own thing on the map and in the legend.
  webcam: wrap(
    `<rect x="3.5" y="3.5" width="17" height="13" rx="2.2"/><circle cx="12" cy="10" r="3.9" fill="${INK}"/><circle cx="12" cy="10" r="1.6"/><circle cx="17" cy="6.6" r="1" fill="${INK}"/><rect x="10.7" y="16.5" width="2.6" height="2.8"/><rect x="7.3" y="19" width="9.4" height="1.9" rx=".95"/>`,
  ),

  // --- Events / signals (drawn white onto the colour-coded disc) ----------
  // One pictogram per hazard family. Mapped from a signal source id (or, for
  // GDACS, its per-feature hazard) by SIGNAL_ICON / signalIconKey below.
  "sig-quake": wrap(
    `<path d="M2 12h3l2-6 3 12 3.4-15 3 16 2-7H22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round"/>`,
  ),
  "sig-fire": wrap(
    `<path d="M13 2c.5 3-1.6 4.6-1.6 7 0 1.3.9 2 1.8 1.8C15.1 10.4 15 8 14.5 6.8 17 9 18.5 12 18.5 14.5a6.5 6.5 0 0 1-13 0C5.5 10 9 7.6 10 4c.4 1.7 1.3 2.4 2 2.2.9-.3 1.2-2.2 1-4.2z"/>`,
  ),
  "sig-volcano": wrap(
    `<path d="M9 10 3.5 21h17L15 10z"/><path d="M9.6 10h4.8l-1.4 3.4h-2z" fill="${INK}"/><circle cx="12" cy="4.6" r="1.4"/><circle cx="14.6" cy="2.8" r="1.05"/><circle cx="9.7" cy="3" r=".95"/>`,
  ),
  "sig-storm": wrap(
    `<path d="M7 13.5a4 4 0 0 1 .3-7.95A5 5 0 0 1 17 6.6 3.5 3.5 0 0 1 17 13.5z"/><path d="M12 11.5l-2.6 4.7H12L10.4 21 15 14h-2.4l1.4-2.5z" fill="${INK}"/>`,
  ),
  "sig-flood": wrap(
    `<path d="M12 3 5 8v3l7-5 7 5V8z"/><path d="M2 15c1.5 0 1.5 1.2 3 1.2S8 15 9.5 15s1.5 1.2 3 1.2S14 15 15.5 15s1.5 1.2 3 1.2S20 15 22 15v2.4c-1.5 0-1.5-1.2-3-1.2s-1.5 1.2-3 1.2-1.5-1.2-3-1.2-1.5 1.2-3 1.2-1.5-1.2-3-1.2-1.5 1.2-3 1.2zM2 19.2c1.5 0 1.5 1.2 3 1.2s1.5-1.2 3-1.2 1.5 1.2 3 1.2 1.5-1.2 3-1.2 1.5 1.2 3 1.2 1.5-1.2 3-1.2 1.5 1.2 3 1.2v1.6H2z"/>`,
  ),
  "sig-cyclone": wrap(
    `<path d="M12 12c0-2.6 3-3.1 3-5.6C15 4 13 3 11 3 7 3 4 6 4 10c0 4.6 3.6 8.2 8 8.2" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/><path d="M12 12c0 2.6-3 3.1-3 5.6 0 2.4 2 3.4 4 3.4 4 0 7-3 7-7 0-4.6-3.6-8.2-8-8.2" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/><circle cx="12" cy="12" r="1.4"/>`,
  ),
  "sig-drought": wrap(
    `<circle cx="12" cy="6.5" r="3.1"/><path d="M12 1.4v1.8M5.9 6.5H4.1M19.9 6.5h-1.8M7.9 2.6 6.7 1.4M17.3 2.6l-1.2-1.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M3 15.5h6l1.8 2-1.8 2.2H3.7l-1-2zM13 15.5h8l-1 2 1 2.2h-7l-1.2-2.2z"/>`,
  ),
  "sig-aurora": wrap(
    `<path d="M5 3c-1 5.5-1 9.5 0 15.5M9 2.5c-1 6.5-1 10.5 0 16.5M13 3c-1 5.5-1 9.5 0 15.5M17 2.5c-1 6.5-1 10.5 0 16.5M21 3c-1 5.5-1 9.5 0 15.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>`,
  ),
  "sig-spaceweather": wrap(
    `<circle cx="11" cy="12" r="4.8"/><path d="M11 2.4v3M11 18.6v3M1.4 12h3M17.6 12h3M4.3 5.3 6.4 7.4M15.6 16.6l2.1 2.1M4.3 18.7 6.4 16.6M15.6 7.4l2.1-2.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M15.5 12c2.2 0 3.4-1.1 5.5-2.2-1 2.7-2.1 4.4-5.5 3.9z" fill="${INK}"/>`,
  ),
  "sig-launch": wrap(
    `<path d="M12 2c3 2 4.6 5 4.6 9l-1.4 4H8.8L7.4 11C7.4 7 9 4 12 2z"/><circle cx="12" cy="9" r="1.6" fill="${INK}"/><path d="M8.8 15 6.4 17.4l.7-3.4zM15.2 15l2.4 2.4-.7-3.4z"/><path d="M10.6 18.6h2.8L12 22z"/>`,
  ),
  "sig-nuclear": wrap(
    `<circle cx="12" cy="12" r="2.1"/><path d="M12 12 7.2 3.6a10 10 0 0 1 9.6 0zM12 12l9.4 1a10 10 0 0 1-4.8 8.3zM12 12l-9.4 1a10 10 0 0 0 4.8 8.3z"/>`,
  ),
  "sig-airport": wrap(
    `<path d="M10 8h4l-.6 13h-2.8z"/><path d="M9.2 8 7 4.4h10L14.8 8z"/><rect x="11" y="1.8" width="2" height="2.6"/><path d="M14.6 11.2 19 12.8v1.6l-4.4-1.3zM9.4 11.2 5 12.8v1.6l4.4-1.3z"/>`,
  ),
  "sig-port": wrap(
    `<path d="M11 3.2h2v3h2v2h-2v9.3c2.4-.5 4.1-2.3 4.6-4.5H21c-.6 3.8-4 6.9-9 6.9s-8.4-3.1-9-6.9h3.4c.5 2.2 2.2 4 4.6 4.5V8.2H7v-2h2v-3z"/><circle cx="12" cy="3.1" r="1.7" fill="none" stroke="currentColor" stroke-width="1.6"/>`,
  ),
  "sig-ship": wrap(
    `<path d="M3 14h18l-2.4 5c-.5 1-1.5 1.5-3 1.5H8.4c-1.5 0-2.5-.5-3-1.5zM6 13.2V7l6-2.2L18 7v6.2z"/><path d="M11 4.6V2h2v2.2" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="8" y="8.2" width="2" height="2.2" fill="${INK}"/><rect x="14" y="8.2" width="2" height="2.2" fill="${INK}"/>`,
  ),
  "sig-outage": wrap(
    `<path d="M12 4c3.8 0 7.3 1.5 9.8 4l-2.1 2.1A10.7 10.7 0 0 0 12 7zM4.3 6 2.2 8A13.6 13.6 0 0 1 12 4v3a10.7 10.7 0 0 0-7.7 2z" opacity=".55"/><path d="M12 11c2 0 3.9.8 5.3 2.2l-2.1 2.1A4.3 4.3 0 0 0 12 14zM6.7 13.2l2.1 2.1A4.3 4.3 0 0 1 12 14v-3c-2 0-3.9.8-5.3 2.2z"/><circle cx="12" cy="18.6" r="1.7"/><path d="M3.5 3 21 20.5" stroke="${INK}" stroke-width="2"/>`,
  ),
  "sig-conflict": wrap(
    `<path d="m12 1 2.2 5.2L19.8 4l-1.9 5.7L23 11l-5.3 1.3L20 18l-5.5-2.4L12 21l-2.5-5.4L4 18l2.3-5.7L1 11l5.3-1.3L4.2 4l5.6 2.2z"/>`,
  ),
  "sig-protest": wrap(
    `<path d="M3 10v4l3 .5 1.5 4.5h2.2L8 14.8l9 4.2V5L8 9.4H5a2 2 0 0 0-2 .6z"/><path d="M19.5 9c1.6 1.1 1.6 4.9 0 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
  ),
  "sig-cyber": wrap(
    `<rect x="9" y="7" width="6" height="9.2" rx="3"/><path d="M9 10.2H4.8M9 13.2H4.3M9 16l-3.2 2.1M15 10.2h4.2M15 13.2h4.7M15 16l3.2 2.1M10.2 6.6 8.6 4M13.8 6.6 15.4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="10.7" cy="10.2" r=".85" fill="${INK}"/><circle cx="13.3" cy="10.2" r=".85" fill="${INK}"/>`,
  ),
  "sig-crime": wrap(
    `<path d="M12 2 4 5v6c0 5 3.4 8.7 8 11.2C16.6 19.7 20 16 20 11V5z"/><path d="M12 7.2v6.2" stroke="${INK}" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16.4" r="1.15" fill="${INK}"/>`,
  ),
  "sig-displacement": wrap(
    `<circle cx="10.5" cy="4.4" r="2.2"/><path d="M10.5 7c-1.4 0-2.3 1-2.7 2.2L6.3 14h2.4l1-2.6V21h2.2v-5.7l1.3 2.1L15.7 20l1.8-1.1-2.1-3.2-1.5-3.4 2.4 1.1" fill="currentColor"/><path d="M18.5 8.5H22M22 8.5l-1.6-1.5M22 8.5l-1.6 1.5" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round"/>`,
  ),
  "sig-food": wrap(
    `<path d="M12 21.5V7.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M12 8c0-2.6 2.2-4.2 2.2-4.2s.5 2.7-2.2 4.2zM12 8c0-2.6-2.2-4.2-2.2-4.2S9.3 6.5 12 8zM12 12.4c0-2.2 2-3.5 2-3.5s.4 2.4-2 3.5zM12 12.4c0-2.2-2-3.5-2-3.5s-.4 2.4 2 3.5zM12 16.6c0-2.2 2-3.5 2-3.5s.4 2.4-2 3.5zM12 16.6c0-2.2-2-3.5-2-3.5s-.4 2.4 2 3.5z"/>`,
  ),
  "sig-relief": wrap(
    `<circle cx="12" cy="12" r="9.4" fill="none" stroke="currentColor" stroke-width="2.1"/><path d="M10 6.4h4v3.6h3.6v4H14v3.6h-4V14H6.4v-4H10z"/>`,
  ),
  "sig-grid": wrap(
    `<path d="M13 2 4 14h6l-1 8 9-12h-6z"/>`,
  ),
  "sig-military": wrap(
    `<path d="M12 2 3.5 20.5 12 16l8.5 4.5z"/><path d="M12 3.5V15" stroke="${INK}" stroke-width="1.3"/>`,
  ),
  "sig-air": wrap(
    `<path d="M3 8h12.5a2.6 2.6 0 1 0-2.6-2.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M3 12.2h15.5a2.6 2.6 0 1 1-2.6 2.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M3 16.4h9.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="6" cy="20" r="1.05"/><circle cx="11" cy="20" r="1.05"/><circle cx="16" cy="20" r="1.05"/>`,
  ),
  "sig-instability": wrap(
    `<path d="M12 2.8 1 21.2h22z"/><path d="M12 9.4v6" stroke="${INK}" stroke-width="2.1" stroke-linecap="round"/><circle cx="12" cy="18.4" r="1.2" fill="${INK}"/>`,
  ),
  "sig-weather": wrap(
    `<path d="M7 18.5a4.6 4.6 0 0 1-.4-9.2A6 6 0 0 1 18.2 8.6a3.9 3.9 0 0 1-.4 9.9z"/>`,
  ),
  "sig-generic": wrap(
    `<circle cx="12" cy="12" r="9.4"/><path d="M12 6.4v7.2" stroke="${INK}" stroke-width="2.3" stroke-linecap="round"/><circle cx="12" cy="17.2" r="1.35" fill="${INK}"/>`,
  ),
};

// Webcams are a DISTINCT layer from road CCTV. They get their own warm rose hue
// so they never blend into the cool camera family, the amber planes, or the
// violet satellites. Single source of truth for the layer's identity colour.
export const WEBCAM_COLOR = "#ec4899";

// Unavailable cameras render in this muted slate (not their live region colour)
// so a dead feed reads as dead at a glance — the freshness/honesty signal on the
// map. The icon dimming on top makes it unmistakable. Single source of truth.
export const CAMERA_OFFLINE_COLOR = "#9aa6b2";

// ---------------------------------------------------------------------------
// Per-type metadata: which icon, what colour, what label.
// ---------------------------------------------------------------------------

export interface SubtypeMeta {
  key: IconKey;
  label: string;
  color: string;
}

// Satellites — a cool violet→blue palette so the whole layer still reads as one
// family, with the iconic ISS picked out in white.
export const SAT_META: Record<SatCategory, SubtypeMeta> = {
  station: { key: "sat-station", label: "Space station", color: "#ffffff" },
  starlink: { key: "sat-starlink", label: "Starlink", color: "#60a5fa" },
  oneweb: { key: "sat-oneweb", label: "OneWeb", color: "#818cf8" },
  navigation: { key: "sat-navigation", label: "Navigation", color: "#a78bfa" },
  weather: { key: "sat-weather", label: "Weather", color: "#c084fc" },
  "earth-observation": { key: "sat-eo", label: "Earth imaging", color: "#e879f9" },
  science: { key: "sat-science", label: "Science", color: "#f0abfc" },
  communications: { key: "sat-comms", label: "Comms", color: "#7dd3fc" },
  cubesat: { key: "sat-cubesat", label: "CubeSat", color: "#a5b4fc" },
  debris: { key: "sat-debris", label: "Debris / rocket body", color: "#94a3b8" },
  other: { key: "sat-other", label: "Other", color: "#cbd5e1" },
};

// Planes — a warm amber palette, with helicopters in red and parked craft grey.
export const PLANE_META: Record<PlaneCategory, SubtypeMeta> = {
  airliner: { key: "plane-airliner", label: "Airliner", color: "#fbbf24" },
  regional: { key: "plane-regional", label: "Regional / jet", color: "#fb923c" },
  light: { key: "plane-light", label: "Light aircraft", color: "#fcd34d" },
  helicopter: { key: "plane-helicopter", label: "Helicopter", color: "#f87171" },
  ground: { key: "plane-ground", label: "On ground", color: "#a8a29e" },
};

// Cameras — shape encodes the feed; colour encodes the region (below).
export const CAMERA_FEED_META: Record<CameraFeed, SubtypeMeta> = {
  video: { key: "cam-video", label: "Live video", color: "#67e8f9" },
  still: { key: "cam-still", label: "Still image", color: "#67e8f9" },
};

export interface RegionMeta {
  source: string;
  label: string;
  color: string;
  /** Globe camera position to fly to when jumping to this region. */
  view?: { lat: number; lng: number; altitude: number };
}

// Region tint, keyed by source id. Cyan/green/teal family — distinct from the
// satellite (violet) and plane (amber) layers. `view` powers the region
// quick-jump (altitude tuned so the whole region's cluster is in frame).
export const CAMERA_REGIONS: RegionMeta[] = [
  { source: "tfl", label: "London (TfL)", color: "#22d3ee", view: { lat: 51.5, lng: -0.12, altitude: 0.5 } },
  { source: "caltrans", label: "California", color: "#4ade80", view: { lat: 36.8, lng: -119.7, altitude: 0.95 } },
  { source: "scdot", label: "South Carolina", color: "#2dd4bf", view: { lat: 33.9, lng: -80.9, altitude: 0.6 } },
  { source: "digitraffic", label: "Finland", color: "#38bdf8", view: { lat: 64.5, lng: 26, altitude: 0.9 } },
  { source: "castlerock", label: "US & Canada 511", color: "#0ea5e9", view: { lat: 40, lng: -88, altitude: 1.6 } },
  { source: "tripcheck", label: "Oregon", color: "#10b981", view: { lat: 44, lng: -120.5, altitude: 0.8 } },
  { source: "drivebc", label: "British Columbia", color: "#5eead4", view: { lat: 53.5, lng: -125, altitude: 0.9 } },
  { source: "nzta", label: "New Zealand", color: "#34d399", view: { lat: -41, lng: 173, altitude: 0.85 } },
  { source: "iceland", label: "Iceland", color: "#2dd4bf", view: { lat: 64.9, lng: -18.6, altitude: 0.7 } },
  { source: "estonia", label: "Estonia", color: "#6ee7b7", view: { lat: 58.7, lng: 25.5, altitude: 0.55 } },
  { source: "trafficscotland", label: "Scotland", color: "#22d3ee", view: { lat: 56.5, lng: -4, altitude: 0.55 } },
  // Serbia arrives as two operators rather than one region, so both get a view
  // framing the whole country: the border crossings ring its edge and the toll
  // plazas run down the motorway spine, and neither is legible zoomed to itself.
  { source: "mup-rs", label: "Serbia (borders)", color: "#7dd3fc", view: { lat: 44.1, lng: 20.9, altitude: 0.6 } },
  { source: "putevi-rs", label: "Serbia (motorways)", color: "#99f6e4", view: { lat: 44.1, lng: 20.9, altitude: 0.6 } },
];

export const CAMERA_DEFAULT_REGION: RegionMeta = {
  source: "*",
  label: "Other region",
  color: "#67e8f9",
};

/** Region colour for a camera source id (falls back to the default cyan). */
export function cameraRegionColor(source: string): string {
  return (CAMERA_REGIONS.find((r) => r.source === source) ?? CAMERA_DEFAULT_REGION).color;
}

// ---------------------------------------------------------------------------
// Event / signal pins: signal source id → pictogram.
//
// The signal layer is data-driven (one disc layer for every source), so the
// icon can't live on a per-source object the way SAT_META/PLANE_META do — it is
// resolved from the source id here. GDACS is multi-hazard, so it resolves
// per-feature from its `hazard` prop instead (see signalIconKey).
// ---------------------------------------------------------------------------

export const SIGNAL_ICON: Record<string, IconKey> = {
  instability: "sig-instability",
  earthquakes: "sig-quake",
  "emsc-quakes": "sig-quake",
  wildfires: "sig-fire",
  "fire-active": "sig-fire",
  volcanoes: "sig-volcano",
  severeStorms: "sig-storm",
  floods: "sig-flood",
  "tropical-cyclones": "sig-cyclone",
  aurora: "sig-aurora",
  "space-weather": "sig-spaceweather",
  launches: "sig-launch",
  nuclear: "sig-nuclear",
  airports: "sig-airport",
  ports: "sig-port",
  ais: "sig-ship",
  "internet-outages": "sig-outage",
  conflict: "sig-conflict",
  acled: "sig-conflict",
  protests: "sig-protest",
  "cyber-c2": "sig-cyber",
  "cyber-ransomware": "sig-cyber",
  crime: "sig-crime",
  displacement: "sig-displacement",
  "food-security": "sig-food",
  reliefweb: "sig-relief",
  "grid-load": "sig-grid",
  "military-air": "sig-military",
  airquality: "sig-air",
  "air-quality-stations": "sig-air",
  weather: "sig-weather",
  gdacs: "sig-generic", // overridden per-feature by hazard (see signalIconKey)
};

// GDACS multi-hazard → the per-feature pictogram, keyed by gdacsEventLabel().
const GDACS_HAZARD_ICON: Record<string, IconKey> = {
  Earthquake: "sig-quake",
  "Tropical cyclone": "sig-cyclone",
  Flood: "sig-flood",
  Volcano: "sig-volcano",
  Drought: "sig-drought",
  Wildfire: "sig-fire",
  Tsunami: "sig-flood",
};

/** Pictogram for a signal feature — by source id, or GDACS per-feature hazard. */
export function signalIconKey(signalId: string, props?: Record<string, unknown>): IconKey {
  if (signalId === "gdacs") {
    const hazard = typeof props?.hazard === "string" ? props.hazard : "";
    return GDACS_HAZARD_ICON[hazard] ?? "sig-generic";
  }
  return SIGNAL_ICON[signalId] ?? "sig-generic";
}

/** Every pictogram the signal layer can render — registered as white sprites. */
export const SIGNAL_ICON_KEYS: IconKey[] = [
  "sig-quake", "sig-fire", "sig-volcano", "sig-storm", "sig-flood", "sig-cyclone",
  "sig-drought", "sig-aurora", "sig-spaceweather", "sig-launch", "sig-nuclear",
  "sig-airport", "sig-port", "sig-ship", "sig-outage", "sig-conflict", "sig-protest",
  "sig-cyber", "sig-crime", "sig-displacement", "sig-food", "sig-relief", "sig-grid",
  "sig-military", "sig-air", "sig-instability", "sig-weather", "sig-generic",
];
