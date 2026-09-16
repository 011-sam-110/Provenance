// components/shell/inspector/ToolIcons.tsx
//
// The marks on the Inspector rail. Search and Map settings were traced from Sam's
// reference art (opaque PNGs) and redrawn as stroke geometry so they take the
// skin's ink colour instead of shipping a black raster that vanishes against the
// panel. They moved here verbatim from components/console/maprail/RailIcons.tsx
// when the rail left the stage; that file's rules came with them, and two more are
// now load-bearing rather than theoretical.
//
//   REDRAW, NEVER EMBED. This is the rule the fourth glyph arrived under. Sam sent
//   the eye as a raster ("images (1).png") and it is a WATERMARKED VectorStock comp
//   — "VectorStock.com/27400206" runs across its bottom edge — which is exactly the
//   trap the radius icon fell into the first time this rule was written. Shipping
//   that file would put someone else's watermark in the product and raise a licence
//   question nobody here has answered. ViewGlyph below is the redrawn geometry:
//   an eye is two arcs and a circle, and a circle is nobody's artistic expression.
//   A traced comp is. Redrawing is also what makes currentColor possible.
//
//   TRIM WHERE STROKES MEET. At 18px two strokes of one colour that touch read as
//   a smudge, and one drawn through another reads as a blot. Stop the geometry
//   short rather than overlapping and hoping the upper shape paints over it. The
//   eye's pupil is why this matters here: sit it ON the lens outline and the pair
//   turns into a blob at the small size; the lens is drawn through and the pupil
//   is kept well inside it.
//
// THESE ARE STILL NOT IN lib/icons/svg.ts, for the reasons that file's own header
// gives — that registry is for marks that name a feature ON THE MAP and is
// rasterised into a MapLibre sprite; `IconKey` is consumed as an exhaustive union
// and widening it for chrome widens every signature that reads it.
//
// No size props. The CSS sizes them (`.tn-insp-rail-btn svg`), so one rule moves
// every mark on the rail and two glyphs in the same place can never disagree.

const BASE = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: "false" as const,
};

/** Search — a ring and a handle. */
export function SearchGlyph() {
  return (
    <svg {...BASE} strokeWidth={2}>
      <circle cx={10.2} cy={10.2} r={6.3} />
      <line x1={14.9} y1={14.9} x2={20.6} y2={20.6} />
    </svg>
  );
}

/**
 * View — an eye.
 *
 * The lens is ONE closed path: two arcs meeting at a point on each side, drawn as
 * curves rather than as a lens made of two stroked halves, because two halves meet
 * at the corners and at 18px that joint is where the ink piles up.
 *
 * The pupil is a plain circle at 3.4 — big enough to read as a pupil at 18px, small
 * enough to leave a visible white ring inside the lens. The reference art's pupil
 * touches the lens outline; at rail size that closes the shape into a solid eye.
 */
export function ViewGlyph() {
  return (
    <svg {...BASE} strokeWidth={1.8}>
      <path d="M2.5 12S6.2 5.7 12 5.7 21.5 12 21.5 12 17.8 18.3 12 18.3 2.5 12 2.5 12z" />
      <circle cx={12} cy={12} r={3.4} />
    </svg>
  );
}

/** Map settings — a map pin with a gear seated inside it. */
export function PinGearGlyph() {
  return (
    <svg {...BASE} strokeWidth={1.9}>
      <path d="M12 22.2c0 0 7-7.1 7-12.1a7 7 0 1 0-14 0c0 5 7 12.1 7 12.1z" />
      <circle cx={12} cy={10} r={2.5} />
      <g strokeWidth={1.7}>
        <line x1={12} y1={5.7} x2={12} y2={7.2} />
        <line x1={12} y1={12.8} x2={12} y2={14.3} />
        <line x1={7.7} y1={10} x2={9.2} y2={10} />
        <line x1={14.8} y1={10} x2={16.3} y2={10} />
        <line x1={8.96} y1={6.96} x2={10.02} y2={8.02} />
        <line x1={13.98} y1={11.98} x2={15.04} y2={13.04} />
        <line x1={15.04} y1={6.96} x2={13.98} y2={8.02} />
        <line x1={10.02} y1={11.98} x2={8.96} y2={13.04} />
      </g>
    </svg>
  );
}

/**
 * Draw an area — a closed polygon with its corners marked.
 *
 * NOT A PEN, which is what the stage rail's removed Draw group used. A pen names
 * the gesture ("you will draw"); the vertex dots name the THING and the interaction
 * — click the map to place its corners — which is what the button has to teach now
 * that it is the only way into the gesture. The bottom-left corner is a vertex too,
 * so the shape reads as closed rather than as a line that happens to bend.
 */
export function DrawGlyph() {
  return (
    <svg {...BASE} strokeWidth={1.8}>
      <path d="M4 18.5 7.4 8.9l5.1 6.4 3.3-8.2L20 18.5z" />
      <circle cx={7.4} cy={8.9} r={1.5} />
      <circle cx={15.8} cy={7.1} r={1.5} />
      <circle cx={4} cy={18.5} r={1.5} />
    </svg>
  );
}
