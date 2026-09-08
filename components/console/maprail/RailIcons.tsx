// components/console/maprail/RailIcons.tsx
//
// The marks on the stage rail. Traced from Sam's reference art (opaque PNGs) and
// redrawn as stroke geometry so they take the skin's ink colour instead of
// shipping a black raster that vanishes against --tnx-panel.
//
// SIX GLYPHS LEFT WITH THE DRAW AND CAMERAS GROUPS. MapPenGlyph and
// CameraBracketGlyph were those two rail buttons; PolygonGlyph, RadiusGlyph,
// CameraPlusGlyph and BoundingBoxGlyph were the marks inside their flyouts. All
// six are gone rather than kept warm — an exported component nothing renders still
// greps as live art and still has to be read by whoever comes next. Two rules they
// were written under survive them and apply to any mark added here:
//
//   REDRAW, NEVER EMBED. One of the references (radiusdrawicon.png) was a
//   watermarked VectorStock comp, carrying "VectorStock.com/19399896" across the
//   bottom. Shipping that raster would have put someone else's watermark in the
//   product and raised a licence question nobody here has answered. Geometric
//   primitives are not an artist's expression; a traced comp is. Redrawing settles
//   it, and it is also what makes currentColor possible.
//
//   TRIM WHERE STROKES MEET. At 18px two strokes of one colour that touch read as
//   a smudge, and one drawn through another reads as a blot. Stop the geometry
//   short rather than overlapping and hoping the upper shape paints over it.
//
// THESE ARE NOT IN lib/icons/svg.ts, AND THAT IS DELIBERATE. That file's header
// states its contract — one source of truth for every type icon ON THE MAP, so
// the globe, the markers and the legend can never drift apart — and its strings
// are rasterised into MapLibre sprite images by lib/map/icons.ts. Three reasons
// chrome does not belong in it:
//
//   - `IconKey` is consumed as an exhaustive union (`Record<IconKey, string>`,
//     and signalIconKey()'s return type). Widening it for a magnifier and a gear
//     widens every one of those signatures for marks that name no feature and
//     have no palette entry.
//   - wrap() hardcodes `fill="currentColor"` and an INK cut-out constant tuned
//     for rasterising at 80px. These want STROKE geometry at 16-18px with round
//     caps — different drawing rules in the same object.
//   - TypeIcon renders through dangerouslySetInnerHTML, which is right for a
//     string registry and wrong for two pieces of chrome art.
//
// components/console/RailGlyph.tsx is the repo's own precedent for exactly this:
// chrome-only inline SVG as real JSX, aria-hidden, drawn in currentColor.
//
// No size props. The CSS sizes them — `.tnx-maprail-btn svg` for the rail marks,
// `.tnx-maprail-act svg` for the ones inside a flyout — so one rule moves each
// tier and two glyphs in the same place can never disagree.

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

/** View — a map pin with a gear seated inside it. */
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
