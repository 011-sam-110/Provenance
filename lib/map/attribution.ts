// Start MapLibre's AttributionControl COLLAPSED, behind its own info button.
//
// WHY THIS IS NEEDED even though WorldMap already passes { compact: true }.
// MapLibre's _updateCompact adds BOTH "maplibregl-compact" and
// "maplibregl-compact-show" when it mounts a compact control, so the credit line
// renders expanded on first paint. The only thing that ever removes the -show
// class afterwards is map.on("drag", _updateCompactMinimize) — so the text sits
// across the bottom of the map until the user happens to drag it.
//
// The stylesheet contract (maplibre-gl.css) is:
//   .maplibregl-ctrl-attrib-button                        { display: none }
//   .maplibregl-compact      .maplibregl-ctrl-attrib-button { display: block }
//   .maplibregl-compact      .maplibregl-ctrl-attrib-inner  { display: none }
//   .maplibregl-compact-show .maplibregl-ctrl-attrib-inner  { display: block }
//
// So the wanted state is "compact present, compact-show absent": the info button
// is visible, the credit is one click away. Adding "maplibregl-compact" is also
// what MAKES the button work — _toggleAttribution returns early without it.
//
// THIS COLLAPSES THE CREDIT, IT DOES NOT REMOVE IT, and that distinction is a
// licensing one rather than a stylistic one. OpenStreetMap/OpenMapTiles (ODbL),
// Esri, OpenTopoMap and the AWS Terrain Tiles all require attribution, and this
// app deliberately renders MapLibre's own control so the credit stays correct when
// the basemap changes (see components/terminal/StageBar.tsx). Behind a labelled
// info button is what MapLibre's compact mode exists for. Deleting the control, or
// hiding the button along with the text, would not be.

export const ATTRIB_CONTROL_CLASS = "maplibregl-ctrl-attrib";
export const ATTRIB_COMPACT_CLASS = "maplibregl-compact";
export const ATTRIB_SHOW_CLASS = "maplibregl-compact-show";

/**
 * The slice of Element we touch. Narrow on purpose: vitest runs in the node
 * environment here, with no DOM, so the test drives a stub of exactly this shape.
 */
export interface AttributionTarget {
  classList: { add(token: string): void; remove(token: string): void };
}

/**
 * Put the attribution control into its collapsed state. Idempotent, so it is safe
 * to call again after a basemap swap re-runs the style pipeline.
 */
export function collapseAttribution(el: AttributionTarget | null | undefined): void {
  if (!el) return;
  el.classList.add(ATTRIB_COMPACT_CLASS);
  el.classList.remove(ATTRIB_SHOW_CLASS);
}
