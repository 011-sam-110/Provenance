"use client";
// The map legend: which MARK means what.
//
// The map draws a signal by how precise its place is (lib/map/precisionMarks.ts): a
// pin for an exact point or a named site (a diamond for the second side of a pair), a
// shaded shape or a soft disc for an area (hatched where the status is not known),
// a shaded country for a country figure, and a dashed ring for a country figure
// where the map has no outline to shade. A road notice is a patterned line: dashes
// for works, dots for an incident, bars for a closed street, with one note that a
// notice is not a speed and no line is not a clear road. A reader cannot know that
// from the marks alone, so this key says it, on the map.
//
// It lists ONLY the marks on the map now, and renders nothing while no signal layer
// draws one, so the empty Globe board stays empty. WorldMap mounts it and hands it
// the marks: there is one map, and the legend is about what that map shows.
//
// THE TITLE IS A BUTTON. Folded, the key is a one-line "Marks" chip in the same corner,
// and the fold is remembered in this browser (lib/map/markKey.ts, tn.map.legend.v1).
// WHERE IT SITS: top right, unless the HUD readout (top left) would reach it, which on a
// phone it does; the key then sits just below the HUD and opens downward, and it stops
// 8px above the map's bottom-right controls (the compass and the i) and scrolls inside
// rather than run over them. The maths is markKeyPlacement; this file measures the boxes
// and writes two custom properties (the pattern of EyeReturn.tsx).

import { useEffect, useLayoutEffect, useRef } from "react";
import { useHudPrefs } from "@/lib/hud/store";
import { markKeyPlacement, markKeyStore, useMarkKeyFolded } from "@/lib/map/markKey";
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
    case "diamond":
      // The map's diamond pin (WorldMap's SIGNAL_DIAMOND_LAYER): a solid mark, a white rim.
      return (
        <svg {...common}>
          <path d="M11 3.6 18.4 11 11 18.4 3.6 11Z" fill={INK} stroke="#ffffff" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      );
    case "shape":
      return (
        <svg {...common}>
          <path d="M11 3.5 17.5 7.2v7.6L11 18.5 4.5 14.8V7.2Z" fill={INK} fillOpacity="0.3" stroke={INK} strokeWidth="1.2" />
        </svg>
      );
    case "hatch":
      // The map's hatch (addHatchImage): diagonal lines, clear gaps, no tint under them.
      return (
        <svg {...common}>
          <path d="M4 8 8 4M4 13 13 4M4 18 18 4M9 18 18 9M14 18 18 14" stroke={INK} strokeWidth="1.5" strokeLinecap="square" />
          <rect x="4" y="4" width="14" height="14" fill="none" stroke={INK} strokeWidth="1.2" />
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

/** The fold arrow: down when open, turned to the side by CSS when folded. */
function Chevron() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function MarkLegend({ marks }: { marks: readonly SignalMark[] }) {
  const folded = useMarkKeyFolded();
  const hud = useHudPrefs();
  const ref = useRef<HTMLElement>(null);
  const shown = marks.length > 0;

  // The saved fold is read after mount (never during render: the server draws it open).
  useEffect(() => markKeyStore.hydrate(), []);

  useLayoutEffect(() => {
    const el = ref.current;
    const map = el?.offsetParent as HTMLElement | null | undefined;
    if (!el || !map) return;
    const watched = new Set<Element>();
    let ro: ResizeObserver | null = null;
    const watch = (target: Element | null) => {
      if (target && ro && !watched.has(target)) {
        watched.add(target);
        ro.observe(target);
      }
    };
    const place = () => {
      const m = map.getBoundingClientRect();
      const hudEl = el.closest(".tn-cw-stage")?.querySelector<HTMLElement>("[data-tn-hud]") ?? null;
      const group = map.querySelector<HTMLElement>(".maplibregl-ctrl-bottom-right");
      const body = el.querySelector<HTMLElement>(".tn-markkey-body");
      watch(hudEl);
      watch(group);
      watch(body);
      const h = hudEl?.getBoundingClientRect();
      // The open width is the key's own max-width, so folding never moves the chip.
      const maxW = parseFloat(getComputedStyle(el).maxWidth);
      const p = markKeyPlacement({
        mapW: m.width,
        mapH: m.height,
        hud: h ? { left: h.left - m.left, top: h.top - m.top, right: h.right - m.left, bottom: h.bottom - m.top } : null,
        groupTop: group && group.offsetHeight > 0 ? group.getBoundingClientRect().top - m.top : Number.NaN,
        openW: Number.isFinite(maxW) ? maxW : el.offsetWidth,
      });
      el.style.setProperty("--tn-markkey-top", `${p.top}px`);
      // Never below the folded chip (30px): a HUD that fills a short map must not squash the
      // key to a sliver, and the chip is the least it can be.
      el.style.setProperty("--tn-markkey-max", `${Math.max(p.maxHeight, 30)}px`);
      if (body && body.scrollHeight > body.clientHeight + 1) el.setAttribute("data-scroll", "");
      else el.removeAttribute("data-scroll");
    };
    ro = new ResizeObserver(place);
    watched.add(map);
    ro.observe(map);
    watched.add(el);
    ro.observe(el);
    place();
    // The map's own controls are added a moment after the first render.
    const raf = requestAnimationFrame(place);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [shown, folded, hud.enabled, hud.variant]);

  if (!shown) return null;
  return (
    <aside
      ref={ref}
      className="tn-markkey"
      aria-label="Map legend: what each mark means"
      data-testid="mark-legend"
      data-folded={folded || undefined}
    >
      <button
        type="button"
        className="tn-markkey-toggle"
        aria-expanded={!folded}
        aria-controls="tn-markkey-body"
        onClick={() => markKeyStore.toggle()}
      >
        <span>Marks</span>
        <Chevron />
      </button>
      <div id="tn-markkey-body" className="tn-markkey-body" hidden={folded}>
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
      </div>
    </aside>
  );
}
