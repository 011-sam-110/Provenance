// components/brand/Mark.tsx
//
// The Provenance mark: the camera sphere, its screens filled.
//
// WHAT IT IS. Since 2026-10-10 the logo is a screenshot of the landing intro's photo sphere run
// through a filter (scripts/gen-sphere-mark.mjs): every screen on the ball, filled, with the
// gaps between them open, exactly as the WebGL ball renders them. The filter writes white
// images whose alpha is the screens, at five sizes, to public/brand/sphere-mark-<size>.png, and lists them
// in lib/brand/sphereMark.json, which this component, scripts/gen-icons.mjs and the intro read,
// so the header, the boot plate, the landing nav and the favicon cannot show different logos.
//
// WHAT IT REPLACED. Until then the mark was the traced OpenData logo (rings, a lens over a
// globe, a book): lib/brand/markPaths.json, traced from public/brand/mark.png by
// scripts/trace-mark.mjs. Those files are no longer read by anything.
//
// IT TAKES currentColor, as the old SVG did: the PNG is a CSS mask over a box filled with the
// text colour, so it is white on the dark nav and the dark console skin and dark ink on a light
// one. Which PNG depends on the size it is drawn at and the screen's density (`image-set`), so
// the gaps stay open: a 512 px image shrunk to 24 px blurs them shut.
//
// THE BOOT SEQUENCE plays it in (`playing`): it opens from the centre outwards, the order the
// intro lights its screens in. The timing is in globals.css and pinned by
// tests/unit/mark-timeline.test.ts against MARK_ASSEMBLE_MS. `idle` is kept for the callers
// that pass it and does nothing: the old mark's orbiting dots have no counterpart in a still.

import type { CSSProperties } from "react";
import sphereMark from "@/lib/brand/sphereMark.json";

export interface MarkProps {
  /** Rendered size in px (square). A stylesheet width wins over it. */
  size?: number;
  /** Runs the assemble animation: the mark opens from the centre. */
  playing?: boolean;
  /** Kept for existing callers; the still mark has no ambient motion. */
  idle?: boolean;
  className?: string;
  /** Give it a label only where it is NOT beside the wordmark. Next to the name it is a
   *  decorative duplicate, and a second "Provenance" in the accessibility tree is noise. */
  title?: string;
}

const FILES = Object.entries(sphereMark.files)
  .map(([px, url]) => ({ px: Number(px), url }))
  .sort((a, b) => a.px - b.px);

/** The smallest image with at least `px` pixels, or the largest there is. */
const fileFor = (px: number) => (FILES.find((f) => f.px >= px) ?? FILES[FILES.length - 1]).url;

/** One image per screen density, each close to the pixels it will fill, so the browser
    hardly resamples it and the gaps between screens stay open. */
export function markImage(size: number): string {
  return `image-set(url(${fileFor(size)}) 1x, url(${fileFor(size * 2)}) 2x, url(${fileFor(size * 3)}) 3x)`;
}

export default function Mark({ size = 24, playing = false, idle: _idle = false, className, title }: MarkProps) {
  const cls = ["tn-mark", playing ? "is-playing" : "", className ?? ""].filter(Boolean).join(" ");
  const set = markImage(size);
  const face: CSSProperties = { maskImage: set, WebkitMaskImage: set.replace("image-set(", "-webkit-image-set(") };
  return (
    <span
      className={cls}
      style={{ "--mark-size": `${size}px` } as CSSProperties}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <span className="mk-face" style={face} />
    </span>
  );
}
