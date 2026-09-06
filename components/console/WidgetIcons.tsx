// components/console/WidgetIcons.tsx
// The console's widget chrome, as ONE drawn set.
//
// It was three fonts. `⤲` is an arrow glyph, `🗑` is a COLOUR EMOJI that resolves
// to Segoe UI Emoji on Windows, `⋯` is a text ellipsis, and `🔔` on the expanded
// view's Notify switch was a fourth. Four faces with four advance widths, four
// optical weights and four vertical centres sitting in one 22px row, which is why
// no amount of `gap` made them look evenly spaced — the spacing was even; the
// GLYPHS were not. Sampo's report was "the icons are spaced weirdly", and that is
// what it was.
//
// One 16-unit grid, one 1.5 stroke, `currentColor`, one box. The set inherits each
// button's hover, danger and focus colours, and CSS sizes it through
// `--tn-cw-ico`, so a denser skin scales the whole set from a single token rather
// than per-icon font-size guesses. Rendered size is measured, not eyeballed:
// scripts/shoot-widget-anatomy.mjs asserts the three boxes agree, the gaps are
// equal, and the control fits the bar it sits in.
"use client";

export type IconName = "expand" | "trash" | "more" | "bell" | "download" | "back";

export function Icon({ name }: { name: IconName }) {
  const common = {
    width: 15, height: 15, viewBox: "0 0 16 16", fill: "none",
    stroke: "currentColor", strokeWidth: 1.5,
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
    "aria-hidden": true, focusable: false as const,
  };
  if (name === "expand") {
    return (
      <svg {...common}>
        <path d="M2.75 6V2.75H6" /><path d="M10 2.75h3.25V6" />
        <path d="M13.25 10v3.25H10" /><path d="M6 13.25H2.75V10" />
      </svg>
    );
  }
  if (name === "trash") {
    return (
      <svg {...common}>
        <path d="M2.75 4.5h10.5" />
        <path d="M6 4.5V3.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 .75.75V4.5" />
        <path d="M4.25 4.5l.6 8.1a1 1 0 0 0 1 .9h4.3a1 1 0 0 0 1-.9l.6-8.1" />
      </svg>
    );
  }
  if (name === "bell") {
    return (
      <svg {...common}>
        <path d="M4 6.5a4 4 0 1 1 8 0c0 2.4.5 3.6 1.1 4.3.2.3 0 .7-.4.7H3.3c-.4 0-.6-.4-.4-.7C3.5 10.1 4 8.9 4 6.5Z" />
        <path d="M6.5 13.5a1.6 1.6 0 0 0 3 0" />
      </svg>
    );
  }
  if (name === "download") {
    return (
      <svg {...common}>
        <path d="M8 2.75v7" /><path d="M5 7l3 3 3-3" /><path d="M2.75 12.75h10.5" />
      </svg>
    );
  }
  if (name === "back") {
    return (
      <svg {...common}>
        <path d="M9.75 3.5 5.25 8l4.5 4.5" />
      </svg>
    );
  }
  // Named rather than left as the fall-through this used to be: a reader should not
  // have to know which of the six lands here, and a test asserts every name in
  // `IconName` has a branch of its own.
  //
  // Dots are FILLED rather than stroked — a 1.5 stroke on a circle this small closes
  // up anyway and reads as a muddy ring.
  if (name === "more") {
    return (
      <svg {...common} fill="currentColor" stroke="none">
        <circle cx="3.4" cy="8" r="1.15" /><circle cx="8" cy="8" r="1.15" /><circle cx="12.6" cy="8" r="1.15" />
      </svg>
    );
  }
  return null;
}
