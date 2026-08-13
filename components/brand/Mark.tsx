// components/brand/Mark.tsx
//
// The OpenData mark, as SVG.
//
// WHY IT STOPPED BEING A PNG. A raster cannot do any of the three things this
// mark now has to do: animate its parts for the boot sequence, recolour for the
// light skin (the PNG has a baked near-black plate, so on paper it sat as a dark
// square in the header), or act as the one source the favicon and PWA icons are
// generated from — which is what stopped the browser tab showing June's teal
// globe while the header showed this.
//
// WHY IT IS TRACED AND NOT REDRAWN. The first attempt was hand-authored from the
// artwork. It got the rings and the book close and turned the globe's continents
// into abstract texture — a different mark wearing the same layout, which for a
// product logo is not a near miss, it is the wrong logo. The geometry in
// lib/brand/markPaths.json is traced from public/brand/mark.png by
// scripts/trace-mark.mjs (marching squares + Douglas-Peucker, deterministic), so
// what renders here IS the approved artwork.
//
// The two orbit rings and their dots are the exception: they are authored as
// <circle> rather than traced. They are hairlines at low contrast in the source,
// so thresholding shreds them into arcs — and the stroke-draw animation needs a
// continuous path anyway. You cannot draw-on a set of disconnected fragments.
//
// NOT rendered through <use href="#symbol">: a `use` builds a shadow tree, and
// document CSS does not reliably cross it with descendant selectors, so
// `.is-playing .mk-ring` would silently never match and the sequence would render
// as a static logo with no error anywhere.

import markPaths from "@/lib/brand/markPaths.json";

export interface MarkProps {
  /** Rendered size in px (square). */
  size?: number;
  /** Runs the assemble animation — rings draw, glass pops, book unfolds. */
  playing?: boolean;
  /** Slow orbit on the two ring dots: the ambient "system is live" tell. */
  idle?: boolean;
  className?: string;
  /** Give it a label only where it is NOT beside the wordmark. Next to the h1 it
   *  is a decorative duplicate, and a second "OpenData" in the accessibility tree
   *  is noise. */
  title?: string;
}

export default function Mark({ size = 24, playing = false, idle = false, className, title }: MarkProps) {
  const cls = ["tn-mark", playing ? "is-playing" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <svg
      className={cls}
      viewBox={markPaths.viewBox}
      width={size}
      height={size}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {/* `pathLength` normalises both rings to 100 units, so the stroke-draw
          dasharray is one number in CSS rather than a circumference per radius. */}
      <g className="mk-rings">
        <circle className="mk-ring mk-ring-1" cx="64" cy="63" r="46" pathLength={100} />
        <circle className="mk-ring mk-ring-2" cx="64" cy="56" r="37" pathLength={100} />
      </g>

      <g className={`mk-dots${idle ? " is-idle" : ""}`}>
        <circle className="mk-dot" cx="18" cy="63" r="2.4" />
        <circle className="mk-dot" cx="110" cy="63" r="2.4" />
      </g>

      {/* fill-rule="evenodd" is mandatory: the traced contours include the INNER
          boundaries of the lens ring and of every continent. Under the default
          nonzero rule those inner loops fill solid and the globe becomes a disc. */}
      <path className="mk-glass mk-fill" fillRule="evenodd" d={markPaths.glass.join(" ")} />
      <path className="mk-book mk-fill" fillRule="evenodd" d={markPaths.book.join(" ")} />
    </svg>
  );
}
