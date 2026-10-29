"use client";
// The map legend: which MARK means what.
//
// The map draws a signal by how precise its place is (lib/map/precisionMarks.ts): a
// pin for an exact point or a named site, a shaded shape or a soft disc for an area,
// a shaded country for a country figure, and a dashed ring for a country figure
// where the map has no outline to shade. A road notice is a patterned line: dashes
// for works, dots for an incident, bars for a closed street, with one note that a
// notice is not a speed and no line is not a clear road. A reader cannot know that
// from the marks alone, so this key says it, on the map.
//
// It lists ONLY the marks on the map now, and renders nothing while no signal layer
// draws one, so the empty Globe board stays empty. WorldMap mounts it and hands it
// the marks: there is one map, and the legend is about what that map shows.

import { MARK_LEGEND, ROAD_MARKS, ROAD_MARK_NOTE, type SignalMark } from "@/lib/map/precisionMarks";

/** A neutral swatch colour: the key explains the SHAPE, and every layer has its own hue. */
const INK = "#b45309";

function Swatch({ mark }: { mark: SignalMark }) {
  const common = { width: 22, height: 22, viewBox: "0 0 22 22", "aria-hidden": true } as const;
  switch (mark) {
    case "pin":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6" fill={INK} stroke="#ffffff" strokeWidth="1.6" />
          <circle cx="11" cy="11" r="1.7" fill="#ffffff" />
        </svg>
      );
    case "shape":
      return (
        <svg {...common}>
          <path d="M11 3.5 17.5 7.2v7.6L11 18.5 4.5 14.8V7.2Z" fill={INK} fillOpacity="0.3" stroke={INK} strokeWidth="1.2" />
        </svg>
      );
    case "disc":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="8" fill={INK} fillOpacity="0.4" stroke={INK} strokeOpacity="0.9" strokeWidth="1.5" />
        </svg>
      );
    case "country":
      return (
        <svg {...common}>
          <path
            d="M4 6.5 9 4l5.5 1.5L18 9l-1.5 5.5L12 18l-5-1-3-4.5Z"
            fill={INK}
            fillOpacity="0.34"
            stroke={INK}
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "ring":
      return (
        <svg {...common}>
          {/* The legend draws the ring in its own ink so it reads in both skins; on the map the
              ring stays dark over imagery (WorldMap). A var() in an SVG attribute resolves
              like any other: components/Chart.tsx does the same. */}
          <circle cx="11" cy="11" r="7.5" fill={INK} fillOpacity="0.22" stroke="var(--tnx-ink)" strokeWidth="1.7" strokeDasharray="3.6 2.6" />
        </svg>
      );
    // The road marks keep the map's own patterns (WorldMap's roadLine layers).
    case "dash":
      return (
        <svg {...common}>
          <path d="M2 11h18" stroke={INK} strokeWidth="3" strokeDasharray="4.2 3" />
        </svg>
      );
    case "dot":
      return (
        <svg {...common}>
          <path d="M3 11h16" stroke={INK} strokeWidth="3.4" strokeLinecap="round" strokeDasharray="0 6.4" />
        </svg>
      );
    case "speed":
      // The three speed bands of lib/roads/hk-speed.ts, side by side. Never red.
      return (
        <svg {...common}>
          <path d="M2 11h6" stroke="#4ade80" strokeWidth="4" strokeLinecap="round" />
          <path d="M9 11h5" stroke="#facc15" strokeWidth="4" strokeLinecap="round" />
          <path d="M15 11h5" stroke="#f97316" strokeWidth="4" strokeLinecap="round" />
        </svg>
      );
    case "bar":
      return (
        <svg {...common}>
          <path d="M2 11h18" stroke="#ffffff" strokeWidth="5" />
          <path d="M2 11h18" stroke={INK} strokeWidth="4" strokeDasharray="3 3" />
        </svg>
      );
  }
}

export default function MarkLegend({ marks }: { marks: readonly SignalMark[] }) {
  if (marks.length === 0) return null;
  return (
    <aside className="tn-markkey" aria-label="Map legend: what each mark means" data-testid="mark-legend">
      <div className="tn-markkey-title">Marks</div>
      <ul className="tn-markkey-list">
        {marks.map((mark) => (
          <li key={mark} className="tn-markkey-row" data-mark={mark}>
            <Swatch mark={mark} />
            <span>
              <b>{MARK_LEGEND[mark].name}</b>
              <span className="tn-markkey-meaning">{MARK_LEGEND[mark].meaning}</span>
            </span>
          </li>
        ))}
      </ul>
      {marks.some((m) => ROAD_MARKS.includes(m)) ? <p className="tn-markkey-note">{ROAD_MARK_NOTE}</p> : null}
    </aside>
  );
}
