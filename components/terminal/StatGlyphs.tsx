// components/terminal/StatGlyphs.tsx
//
// The two marks beside VIDEO and STILLS in the console's camera-count strip, its
// breakdown and its phone sheet: a camcorder and a camera.
//
// Hand-drawn in the style of components/shell/inspector/ToolIcons.tsx — a 24-unit
// grid, one 2-unit stroke, currentColor, round caps and joins, no fill — and under
// the two rules that file writes down:
//
//   REDRAW, NEVER EMBED. No icon font, no icon package, no traced stock art. A
//   camera is a box with a circle in it; nobody owns that. Drawing it ourselves is
//   also what lets it take the text's colour.
//
//   TRIM WHERE STROKES MEET. At 14px two strokes of one colour that touch read as a
//   smudge, so the camcorder's hood starts at the body's edge instead of through it,
//   and the camera's lens is kept well inside its body.
//
// No size props. The CSS sizes them (`.cs-glyph` in app/globals.css), so one rule
// moves both marks and they can never disagree. On the map, cameras keep their own
// CCTV pictograms: these two are for the top bar only.
//
// What the marks mean is decided in lib/cameras, not here. VIDEO counts the cameras
// whose stream played at its last check (`c.live`, lib/cameras/stats.ts); STILLS are
// pictures their operator refreshes on its own interval (`segmentTip`,
// lib/cameras/statsView.ts). Neither word is "live", and these are not either.

const BASE = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: "false" as const,
  className: "cs-glyph",
};

/** VIDEO: a camcorder. Body plus lens hood; the hood starts at the body's edge, no overlap. */
export function VideoGlyph() {
  return (
    <svg {...BASE} data-glyph="video">
      <rect x={2} y={6} width={13.5} height={12} rx={2.4} />
      <path d="M15.5 10.2 21.8 6.8v10.4l-6.3-3.4" />
    </svg>
  );
}

/** STILLS: a camera. Body with its top hump; the lens is kept well inside the body. */
export function StillsGlyph() {
  return (
    <svg {...BASE} data-glyph="stills">
      <path d="M2.8 9.2a2.3 2.3 0 0 1 2.3-2.3h2.5l1.7-2.4h5.4l1.7 2.4h2.5a2.3 2.3 0 0 1 2.3 2.3v8.2a2.3 2.3 0 0 1-2.3 2.3H5.1a2.3 2.3 0 0 1-2.3-2.3z" />
      <circle cx={12} cy={13.2} r={3.4} />
    </svg>
  );
}
