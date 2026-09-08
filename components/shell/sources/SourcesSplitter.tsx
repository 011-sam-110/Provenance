"use client";
// The draggable seam between the Sources rail and the console.
//
// ── IT IS A SIBLING OF THE RAIL, NOT A CHILD, AND THAT IS LOAD-BEARING ───────
// `.tn-rail` is its own scrollport (`overflow-y: auto`, so the sticky header can
// pin while the source list scrolls under it). An absolutely-positioned handle
// INSIDE it would be positioned against that scrollport's content box and would
// therefore scroll away with the rows — the seam would drift up the screen as you
// scrolled the catalogue. So it sits beside the rail and positions itself off the
// same `--tn-rail-w` the rail is sized by; the two cannot disagree because there is
// only one number.
//
// SourceCatalog returns both from one fragment, which keeps the aside a DIRECT
// child of `.tn-cw-shell` — `.tn-terminal .tn-cw-shell > .tn-rail` and the
// `:has(> .tn-rail)` padding rule both depend on that and would silently stop
// matching if the pair were wrapped in a positioning div.
//
// ── THE ARIA CONTRACT IS COPIED FROM components/console/RailSplitter.tsx ──────
// Same `role="separator"` window-splitter pattern, same keyboard map, for the
// reason that file gives at length: a resize that announces nothing leaves a
// screen-reader user pressing a key into silence. `aria-valuenow` is spoken on
// every change. What is NOT shared is the code, because that component is typed on
// `SegmentId` and writes to `shellLayoutStore` — see lib/shell/sourcesRailWidth.ts
// for why this surface does not belong in that union.

import {
  SOURCES_RAIL_MAX,
  SOURCES_RAIL_MIN,
  SOURCES_RAIL_STEP,
  SOURCES_RAIL_STEP_COARSE,
  sourcesRailWidthStore,
} from "@/lib/shell/sourcesRailWidth";

export default function SourcesSplitter({
  width,
  active,
  onPointerDown,
}: {
  /** The rail's CURRENT width in px — what aria-valuenow reports. */
  width: number;
  /** True while a drag is in flight; drives the held-open highlight. */
  active: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const setWidth = (px: number) => sourcesRailWidthStore.set(px);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? SOURCES_RAIL_STEP_COARSE : SOURCES_RAIL_STEP;
    switch (e.key) {
      case "ArrowLeft":
        setWidth(width - step);
        break;
      case "ArrowRight":
        setWidth(width + step);
        break;
      // Home/End jump to the rail's own bounds rather than to 0. There is no
      // collapse-to-nothing here — the rail already has a distinct closed state
      // with its own control (the ≡ tab), and End must mean "as wide as it goes",
      // never "gone".
      case "Home":
        setWidth(SOURCES_RAIL_MIN);
        break;
      case "End":
        setWidth(SOURCES_RAIL_MAX);
        break;
      // Double-click has no keyboard equivalent unless one is given: Enter and
      // Space restore the default, which is the same thing the pointer path does
      // on a double-click.
      case "Enter":
      case " ":
        sourcesRailWidthStore.reset();
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <div
      className="tn-src-splitter"
      data-active={active ? "" : undefined}
      role="separator"
      tabIndex={0}
      aria-label="Sources pane width"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={SOURCES_RAIL_MIN}
      aria-valuemax={SOURCES_RAIL_MAX}
      aria-valuetext={`${width} pixels`}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => sourcesRailWidthStore.reset()}
      title="Drag to resize · double-click to reset"
    />
  );
}
