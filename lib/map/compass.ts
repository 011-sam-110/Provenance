// The map's one compass: a round 30px button, bottom right above the ⓘ, with a needle
// that turns with the map. A click turns the map to north and keeps any tilt.
//
// WHY THIS IS OUR OWN CONTROL AND NOT MapLibre's NavigationControl. That one is a
// zoom ± plus compass cluster in a `.maplibregl-ctrl-group`, and WorldMap removed it on
// purpose (the Inspector rail is the map's control surface; zoom is the wheel, a pinch,
// a double-tap and the +/- keys). Leon asked for ONE small compass back (2026-10-29), so
// this is a single button of our own that is not a ctrl-group. tests/e2e/inspector-
// rail.spec.ts still pins `.maplibregl-ctrl-group` at 0.
//
// It follows MapLibre's own `IControl` shape (like its ScaleControl): `onAdd` builds
// the element, `onRemove` takes it down. The needle is turned by a direct style write on
// a CSS custom property (`--tn-compass-turn`, read by app/globals.css), driven by the
// map's `rotate` event: no React, no state, no animation frame of its own.
//
// Type-only import: the pure half (`needleTurn`, the strings) must load in the node
// vitest environment, where maplibre-gl itself would not.

import type { IControl, Map as MapLibreMap } from "maplibre-gl";

/** The button's name, read by a screen reader and shown as its tooltip. */
export const COMPASS_LABEL = "Face north";

/** How long the turn to north takes. MapLibre makes it instant under reduced motion. */
export const COMPASS_DURATION_MS = 500;

/**
 * The needle's rotation in degrees for a map bearing: `-bearing` folded into
 * (-180, 180]. A map turned 90° clockwise has its north 90° counter-clockwise from the
 * top, so the needle turns the other way from the map. Rounded to a hundredth of a
 * degree (MapLibre hands back 249.99999999999997 for a bearing set to 250, and the style
 * string should read 110deg); never `-0`; a non-finite bearing reads as north.
 */
export function needleTurn(bearing: number): number {
  if (!Number.isFinite(bearing)) return 0;
  let t = Math.round((-bearing % 360) * 100) / 100;
  if (t > 180) t -= 360;
  else if (t <= -180) t += 360;
  return t === 0 ? 0 : t;
}

/**
 * The needle, as static markup. The north half is solid and the south half is faint,
 * both in `currentColor` (the button sets it to the accent), so there is no colour here.
 */
export const NEEDLE_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">' +
  '<path d="M12 3.2 15.2 12H8.8Z" fill="currentColor"/>' +
  '<path d="M12 20.8 15.2 12H8.8Z" fill="currentColor" opacity=".28"/>' +
  "</svg>";

export class CompassControl implements IControl {
  private container: HTMLDivElement | null = null;
  private map: MapLibreMap | null = null;
  private svg: SVGElement | null = null;

  private readonly update = () => {
    if (!this.map || !this.svg) return;
    this.svg.style.setProperty("--tn-compass-turn", `${needleTurn(this.map.getBearing())}deg`);
  };

  onAdd(map: MapLibreMap): HTMLElement {
    this.map = map;
    const div = document.createElement("div");
    div.className = "maplibregl-ctrl tn-compass-ctrl";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "tn-compass";
    button.setAttribute("aria-label", COMPASS_LABEL);
    button.title = COMPASS_LABEL;
    button.innerHTML = NEEDLE_SVG;
    // No `essential`: MapLibre then makes the turn instant when the visitor asked for
    // reduced motion. `resetNorth` keeps the pitch.
    button.addEventListener("click", () => {
      map.resetNorth({ duration: COMPASS_DURATION_MS });
    });
    div.appendChild(button);

    this.container = div;
    this.svg = button.querySelector("svg");
    map.on("rotate", this.update);
    this.update();
    return div;
  }

  onRemove(): void {
    this.map?.off("rotate", this.update);
    this.container?.remove();
    this.container = null;
    this.svg = null;
    this.map = null;
  }
}
