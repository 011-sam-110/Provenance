// The marks on God's eye view's sidebar: stroke geometry in currentColor, in the style of
// components/shell/inspector/ToolIcons.tsx, whose rules these follow. No size props: the sidebar's
// CSS sizes them, so one rule moves every mark.

const BASE = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: "false" as const,
};

/** Camera previews: a picture in its frame. */
export function PreviewsGlyph() {
  return (
    <svg {...BASE}>
      <rect x={3.2} y={4.8} width={17.6} height={14.4} rx={2.6} />
      <rect x={8} y={9} width={8} height={6} rx={1} fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Auto-turn: an arc with its arrowhead. */
export function TurnGlyph() {
  return (
    <svg {...BASE}>
      <path d="M19.4 12.4a7.5 7.5 0 1 1-2.3-5.8" />
      <path d="M20 3.4v4.6h-4.6" />
    </svg>
  );
}

/** Sources & layers: a ring round a smaller ring. */
export function SourcesGlyph() {
  return (
    <svg {...BASE}>
      <circle cx={12} cy={12} r={8.8} />
      <circle cx={12} cy={12} r={3.4} />
    </svg>
  );
}

/** Exit to dashboard: back. */
export function ExitGlyph() {
  return (
    <svg {...BASE}>
      <path d="M20 12H4.6" />
      <path d="M10.6 5.8 4.4 12l6.2 6.2" />
    </svg>
  );
}

/** Controls: a question mark in a ring. */
export function ControlsGlyph() {
  return (
    <svg {...BASE}>
      <circle cx={12} cy={12} r={9} />
      <path d="M9.3 9.4a2.8 2.8 0 0 1 5.4.9c0 1.9-2.7 2.3-2.7 4.1" />
      <circle cx={12} cy={17.4} r={0.5} fill="currentColor" />
    </svg>
  );
}

/** The rail's and the tray's close mark. */
export function CloseGlyph() {
  return (
    <svg {...BASE}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
