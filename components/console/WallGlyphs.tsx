/**
 * Small hand-drawn marks for the camera wall's own bar.
 *
 * Drawn here, in the 24-unit box, with the same stroke props as the inspector rail's
 * glyphs (components/shell/inspector/ToolIcons.tsx), and kept out of both of the other
 * places a mark could live: ToolIcons is the inspector rail's set, and lib/icons/svg.ts
 * is the registry of MAP marks. The wall bar is neither. No library, no raster, and no
 * size props: CSS sizes it (`.is-new-area svg`).
 */

const BASE = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
  focusable: "false" as const,
};

/** A counter-clockwise restart arrow: "start over". */
export function RestartGlyph() {
  return (
    <svg {...BASE} strokeWidth={2.2}>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
      <path d="M4.2 3.6v4.1h4.1" />
    </svg>
  );
}
