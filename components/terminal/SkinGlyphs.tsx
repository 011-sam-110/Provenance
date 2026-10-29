// The two glyphs of the console's dark-mode toggle (TerminalHeader).
//
// Hand-drawn like the rest of the console's marks (ToolIcons, the camera stat glyphs):
// a 24-unit viewBox, no fill, `currentColor` strokes with round caps and joins, so they
// take the header button's ink in both skins and need no colour of their own. The size
// comes from `.tnx-hdr-skin svg` in app/globals.css, not from props.
//
// The toggle shows where a press TAKES you: the moon in light, the sun in dark.

const common = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export function MoonGlyph() {
  return (
    <svg {...common}>
      <path d="M20.2 14.6A8.4 8.4 0 0 1 9.4 3.8a8.4 8.4 0 1 0 10.8 10.8Z" />
    </svg>
  );
}

export function SunGlyph() {
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.6v2.1M12 19.3v2.1M2.6 12h2.1M19.3 12h2.1M5.4 5.4l1.5 1.5M17.1 17.1l1.5 1.5M5.4 18.6l1.5-1.5M17.1 6.9l1.5-1.5" />
    </svg>
  );
}
