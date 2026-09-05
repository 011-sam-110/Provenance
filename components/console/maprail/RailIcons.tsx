// components/console/maprail/RailIcons.tsx
//
// The marks on the stage rail and inside its flyouts. Traced from Sam's reference
// art (opaque PNGs, black-on-white and one on grey) and redrawn as stroke geometry
// so they take the skin's ink colour instead of shipping a black raster that
// vanishes against --tnx-panel on the dark skin.
//
// REDRAWING IS ALSO THE LICENCE ANSWER, not only the theming one. The radius
// reference (radiusdrawicon.png) is a watermarked VectorStock comp — the file
// carries a "VectorStock.com/19399896" bar across the bottom. Shipping that raster
// would put someone else's watermark in the product and would be a licence
// question nobody here has answered. A circle, a centre dot and a radius line are
// geometric primitives, not that artist's expression, so RadiusGlyph is drawn from
// scratch below. The same reasoning covers the "r" label in the reference: it is
// dropped, because a letterform is the part of that comp that looks authored, and
// at 27px it would read as noise anyway.
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
//     string registry and wrong for four pieces of chrome art.
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

/**
 * Draw (the RAIL mark) — a folded map with a pen laid across it.
 *
 * It replaced PolygonGlyph on the rail button when the group grew a second tool.
 * That is the whole reason it exists: a rail button that wears one of its own
 * tools' marks tells you the group IS that tool, so the polygon glyph sitting on
 * the parent would have said "this button draws a polygon" at the moment it
 * stopped being true. This one names the ACTIVITY — drawing on the map — and the
 * two tools carry their own marks inside the flyout.
 *
 * The pen clears the map's right fold rather than crossing it (min x of the
 * rotated group is 13.8, the map's right edge is 13.4), for the same reason
 * PolygonGlyph trims its edges: two strokes of the same colour crossing at 27px
 * read as a smudge, not as one thing over another.
 */
export function MapPenGlyph() {
  return (
    <svg {...BASE} strokeWidth={1.9}>
      <path d="M1.7 6.5 5.6 4.4 9.5 6.5 13.4 4.4V17.5L9.5 19.6 5.6 17.5 1.7 19.6Z" />
      <path d="M5.6 4.4V17.5" />
      <path d="M9.5 6.5V19.6" />
      <g transform="rotate(-35 18.2 14.5)">
        <rect x={17} y={8.6} width={2.4} height={8.6} rx={0.5} />
        <path d="M17 17.2 18.2 20.4 19.4 17.2" />
        <path d="M17 11.2h2.4" />
      </g>
    </svg>
  );
}

/**
 * Radius — a ring, its centre, and the radius that defines it.
 *
 * Drawn from scratch rather than traced; see the licence note in this file's
 * header. The radius line stops exactly ON the outer ring (14.0 → 21.2, the ring
 * being r=9.2 about cx=12) and starts exactly on the centre dot's edge, so no
 * stroke runs through another one.
 */
export function RadiusGlyph() {
  return (
    <svg {...BASE} strokeWidth={1.9}>
      <circle cx={12} cy={12} r={9.2} />
      <circle cx={12} cy={12} r={2} />
      <line x1={14} y1={12} x2={21.2} y2={12} />
    </svg>
  );
}

/**
 * Polygon — five ring vertices joined by five edges, matching the reference: four
 * corners plus one pulled in off the right-hand edge.
 *
 * NOW A FLYOUT MARK, NOT A RAIL MARK. It moved down a tier when Draw grew a
 * second tool; MapPenGlyph took the rail button. It is drawn at the flyout size
 * (18px) rather than the rail size (27px), which the trimmed geometry below
 * handles — the gaps were sized to survive 18px in the first place.
 *
 * The edges stop 2.6 units short of each vertex — the ring radius — so no line
 * is drawn through the inside of a ring. Trimming the geometry is what keeps the
 * mark clean at 18px; overlapping and hoping the ring paints over it does not
 * work when both are stroked in the same colour.
 */
export function PolygonGlyph() {
  return (
    <svg {...BASE} strokeWidth={1.9}>
      <line x1={6.6} y1={4} x2={17.4} y2={4} />
      <line x1={4} y1={6.6} x2={4} y2={17.4} />
      <line x1={6.6} y1={20} x2={17.4} y2={20} />
      <line x1={18.3} y1={5.96} x2={14.7} y2={10.04} />
      <line x1={14.7} y1={13.96} x2={18.3} y2={18.04} />
      <circle cx={4} cy={4} r={2.6} />
      <circle cx={20} cy={4} r={2.6} />
      <circle cx={4} cy={20} r={2.6} />
      <circle cx={20} cy={20} r={2.6} />
      <circle cx={13} cy={12} r={2.6} />
    </svg>
  );
}

/** Cameras — a camera framed by four corner brackets, with the flash above it. */
export function CameraBracketGlyph() {
  return (
    <svg {...BASE} strokeWidth={1.9}>
      <path d="M2 7.5V4a2 2 0 0 1 2-2h3.5" />
      <path d="M16.5 2H20a2 2 0 0 1 2 2v3.5" />
      <path d="M22 16.5V20a2 2 0 0 1-2 2h-3.5" />
      <path d="M7.5 22H4a2 2 0 0 1-2-2v-3.5" />
      <line x1={12} y1={5.6} x2={12} y2={7} />
      <line x1={9.5} y1={6.3} x2={10.2} y2={7.4} />
      <line x1={14.5} y1={6.3} x2={13.8} y2={7.4} />
      <path d="M10.3 9.4h3.4l.5 1.1" />
      <rect x={5.9} y={10.5} width={12.2} height={8} rx={1.7} />
      <circle cx={12} cy={14.5} r={2.7} />
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
