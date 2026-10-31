"use client";
// The God's eye view's frame: the sidebar with what used to be the bar's controls, the pill
// search, the place and its area, the UTC clock, the compass along the bottom edge, the spot on
// screen, and the credits. Every word comes from lib/eye/wording.ts. The look is EyeHud.module.css,
// with the vignette and the scrims under the words in eye.module.css (.hud).
//
// A FILM HAS ITS OWN FRAME. record=1 and clock=manual draw EyeFilmFrame.tsx instead, with the
// evidence ledger, because reels are filmed from it. The ledger's facts live here in the Sources
// tray's detail lines, without the counts.
//
// THIS FRAME DOES NOT RE-RENDER WITH THE CAMERA. The compass, the coordinates and the clock are
// leaves that hold their own subscriptions, so a turning view costs one style write per frame
// (EyeCompass.tsx) and this file renders when something here is pressed or a feed lands.
//
// WHO SHARES ROOM WITH WHOM. The sidebar publishes its width as --rail-w and everything beside it
// moves with it (EyeHud.module.css). The tray and the hint both stand beside the sidebar, so each
// closes the other. A details panel stands at the right edge beside an open tray when the window
// has room for both (trayFitsBesidePanel); otherwise the newer one wins. A phone's sheet closes a
// details panel, which would otherwise stack over it (.detail is above this whole frame).
//
// THE MARKS MOVE WHEN THE ROOM DOES. EyeOverlay keeps its cards and tags off every box marked
// data-eye-keep, and it places them only on a move or on new data. So a sidebar that changed width
// or a tray that opened asks for a placement (onFrameChange), after the width's .18s has run.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type maplibregl from "maplibre-gl";
import SideRail, { type RailEntry } from "@/components/rail/SideRail";
import { BRAND } from "@/lib/brand";
import type { EyeClock } from "@/lib/eye/motion";
import type { EyeView } from "@/lib/eye/places";
import { PREVIEWS_LABEL } from "@/lib/eye/previews";
import { closeRail, railExpanded, railWidth, useRailNarrow, useRailOpen, useRailSheet } from "@/lib/rail/railOpen";
import type { SearchResult } from "@/lib/eye/search";
import {
  isRoadRow,
  railPinRoom,
  rowIsOn,
  trayFitsBesidePanel,
  type EyeSourceRow,
  type SourcesAction,
  type SourcesState,
} from "@/lib/eye/sources";
import {
  AUTO_TURN_LABEL,
  CONTROLS_LABEL,
  CREDITS_LABEL,
  EXIT_LABEL,
  HOME_LABEL,
  RAIL_MENU_WORD,
  RAIL_NAME,
  fmtClockUtc,
  fmtLat,
  fmtLon,
  sourcesName,
  type LedgerRow,
} from "@/lib/eye/wording";
import ControlHint, { useControlHint } from "./ControlHint";
import EyeCompass from "./EyeCompass";
import EyeSearch from "./EyeSearch";
import { SourcesTray, TRAY_ID, type TrayMemory } from "./EyeSources";
import { ControlsGlyph, ExitGlyph, PreviewsGlyph, SourcesGlyph, TurnGlyph } from "./HudIcons";
import { useClock, useReadout, type Readout } from "./hudHooks";
import styles from "./eye.module.css";
import s from "./EyeHud.module.css";

const spotKey = (r: Readout) => `${fmtLat(r.lat)}|${fmtLon(r.lon)}`;

/** The spot on screen, re-rendered only when its text changes. */
function Coords({ map, start }: { map: maplibregl.Map | null; start: EyeView }) {
  const r = useReadout(map, start, spotKey);
  return (
    <span className={s.coords}>
      {fmtLat(r.lat)}, {fmtLon(r.lon)}
    </span>
  );
}

/** The time, re-rendered once a second by itself. */
function Clock({ clock }: { clock: EyeClock }) {
  const now = useClock(clock);
  return (
    <p className={s.clock} aria-label="Time now, UTC" data-eye-keep>
      <span className={s.clockTime}>{now != null ? fmtClockUtc(now) : "--:--:--"}</span>
      <span className={s.clockZone}>UTC</span>
    </p>
  );
}

const onResize = (l: () => void) => {
  window.addEventListener("resize", l);
  return () => window.removeEventListener("resize", l);
};
const useWindowSize = () => ({
  width: useSyncExternalStore(onResize, () => window.innerWidth, () => 1440),
  height: useSyncExternalStore(onResize, () => window.innerHeight, () => 900),
});

/** Focus a sidebar row, or the phone's menu button when the row is hidden behind it. */
function focusRailRow(id: string) {
  const row = document.querySelector<HTMLElement>(`[data-rail="eye"] [data-rail-entry="${id}"]`);
  row?.focus();
  if (document.activeElement !== row) document.querySelector<HTMLElement>('[data-rail="eye"] [data-rail-menu]')?.focus();
}

export interface EyeHudProps {
  map: maplibregl.Map | null;
  /** The view the page opened on, shown until the map reports its own. */
  start: EyeView;
  title: string;
  area?: string;
  /** The facts behind the Sources tray's detail lines (the ledger a film draws). */
  rows: LedgerRow[];
  /** When the vessels or the aircraft last arrived; the tray's foot says how long ago. */
  refreshedAt?: number;
  /** Every source drawn, from MapLibre's own attribution (creditsFromAttribution). */
  credits: string[];
  /** The console at the spot on screen NOW, for "Exit to dashboard"; read when the link is used. */
  getDashboardHref: () => string;
  /** The rows of the Sources tray (lib/eye/sourceRows.ts), and how many of the rail's this view leaves out. */
  sourceRows: EyeSourceRow[];
  leftOut: { country: number; widget: number };
  /** What is switched on and pinned, and how to change it (lib/eye/sources.ts). */
  sources: SourcesState;
  dispatch: (a: SourcesAction) => void;
  /** The view opened in London: TfL's three road rows have something to show. */
  london: boolean;
  portrait: boolean;
  /** The wall clock (a film has its own frame). */
  clock: EyeClock;
  /** Camera previews, and the switch's handler (EyeApp holds what is remembered). */
  previews: boolean;
  onTogglePreviews: () => void;
  /** Auto-turn: not offered when reduced motion is asked for. */
  canTurn: boolean;
  turning: boolean;
  onToggleTurn: () => void;
  /** The cameras and vessels in the scene now, for the search, and what picking one does. */
  marks: readonly SearchResult[];
  onPickMark: (r: Extract<SearchResult, { kind: "camera" | "vessel" }>) => void;
  /** A details panel is open: it takes the hint's room. */
  detailOpen?: boolean;
  /** Close the details panel, leaving focus where it is. */
  onCloseDetail?: () => void;
  /** The sidebar's width or the tray changed: place the cards and tags again. */
  onFrameChange?: () => void;
}

export default function EyeHud({
  map,
  start,
  title,
  area,
  rows,
  refreshedAt,
  credits,
  getDashboardHref,
  sourceRows,
  leftOut,
  sources,
  dispatch,
  london,
  portrait,
  clock,
  previews,
  onTogglePreviews,
  canTurn,
  turning,
  onToggleTurn,
  marks,
  onPickMark,
  detailOpen,
  onCloseDetail,
  onFrameChange,
}: EyeHudProps) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  // Which view and section the tray was last on: kept for the visit, never saved.
  const [memory, setMemory] = useState<TrayMemory>({ view: "sections", section: "view" });
  const creditsId = "eye-credits";
  const creditsBtn = useRef<HTMLButtonElement>(null);
  const hint = useControlHint(map, sourcesOpen || Boolean(detailOpen));

  const open = useRailOpen("eye");
  const sheet = useRailSheet("eye");
  const narrow = useRailNarrow();
  const railPx = parseInt(railWidth({ expanded: railExpanded({ open, sheet, narrow }), narrow }), 10);
  const size = useWindowSize();

  const closeTray = (refocus: boolean) => {
    setSourcesOpen(false);
    if (refocus) focusRailRow("sources");
  };

  // Escape closes what is on top: the credits, then the tray. In the capture phase and with
  // preventDefault, so a camera card or a vessel's panel, which look at `defaultPrevented`, close
  // on the NEXT press. A phone's sheet, over all of it, takes the press for itself.
  useEffect(() => {
    if ((!sourcesOpen && !creditsOpen) || sheet) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      if (creditsOpen) {
        setCreditsOpen(false);
        creditsBtn.current?.focus();
      } else closeTray(true);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourcesOpen, creditsOpen, sheet]);

  // On an upright phone the tray is a pop-up: a tap on the scene outside it closes it. On a wide
  // screen it stays open while the map is panned.
  useEffect(() => {
    if (!sourcesOpen || !portrait) return;
    const onDown = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest('[data-eye-tray], [data-rail="eye"]')) return;
      setSourcesOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [sourcesOpen, portrait]);

  useEffect(() => {
    if (!creditsOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest("[data-eye-credits]")) setCreditsOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [creditsOpen]);

  // The tray and a details panel: side by side where the window has room, else the newer one.
  const hadDetail = useRef(false);
  useEffect(() => {
    if (sourcesOpen && detailOpen && !trayFitsBesidePanel(size.width, railPx, narrow, portrait)) {
      if (hadDetail.current) onCloseDetail?.();
      else setSourcesOpen(false);
    }
    hadDetail.current = Boolean(detailOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourcesOpen, detailOpen, railPx, size.width, narrow, portrait]);

  // The phone's sheet covers the scene: a details panel would stay over it.
  useEffect(() => {
    if (sheet && detailOpen) onCloseDetail?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet]);

  // The room changed. After the width's .18s, so the sidebar is measured where it ends.
  useEffect(() => {
    const t = setTimeout(() => onFrameChange?.(), 220);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [railPx, sourcesOpen]);

  const byId = new Map(sourceRows.map((r) => [r.id, r] as const));
  // A road row outside London has nothing to switch, so it waits in the tray, which says why.
  const pinned = sources.pins
    .filter((id) => byId.has(id) && !(isRoadRow(id) && !london))
    .slice(0, railPinRoom(size.height, narrow));

  const entries: RailEntry[] = [
    { kind: "switch", id: "previews", label: PREVIEWS_LABEL, icon: <PreviewsGlyph />, on: previews, onClick: onTogglePreviews },
    ...(canTurn
      ? [{ kind: "switch", id: "turn", label: AUTO_TURN_LABEL, icon: <TurnGlyph />, on: turning, onClick: onToggleTurn } as RailEntry]
      : []),
    {
      kind: "action",
      id: "sources",
      label: sourcesName(),
      icon: <SourcesGlyph />,
      active: sourcesOpen,
      controls: TRAY_ID,
      onClick: () => {
        closeRail("eye");
        setSourcesOpen((o) => !o);
      },
    },
    ...(pinned.length > 0 ? [{ kind: "rule", id: "pins" } as RailEntry] : []),
    ...pinned.map((id): RailEntry => {
      const row = byId.get(id)!;
      return {
        kind: "switch",
        id: `pin-${id}`,
        label: row.label,
        icon: <span className={s.pinDot} style={{ background: row.color }} />,
        on: rowIsOn(sources, id),
        onClick: () => dispatch({ type: "toggle", id }),
      };
    }),
  ];

  const foot: RailEntry[] = [
    {
      kind: "link",
      id: "exit",
      label: EXIT_LABEL,
      icon: <ExitGlyph />,
      href: "/app",
      refreshHref: getDashboardHref,
      attrs: { "data-eye-exit": "" },
    },
    {
      kind: "action",
      id: "controls",
      label: CONTROLS_LABEL,
      icon: <ControlsGlyph />,
      active: hint.state.shown,
      controls: hint.plateId,
      onClick: () => {
        closeRail("eye");
        const opening = !hint.state.shown;
        hint.toggle();
        if (!opening) return;
        setSourcesOpen(false);
        onCloseDetail?.();
      },
    },
  ];

  return (
    <div className={styles.hud}>
      {/* data-eye-keep: EyeOverlay places no card or tag over these. */}
      <div className={s.railBox} data-eye-keep>
        <SideRail surface="eye" tone="dark" label={RAIL_NAME} menuLabel={RAIL_MENU_WORD} entries={entries} foot={foot} />
      </div>

      <header className={s.top}>
        <EyeSearch marks={marks} onPickMark={onPickMark} onOpen={() => closeTray(false)} />
        <Clock clock={clock} />
        <div className={s.place} data-eye-keep data-eye-place="">
          <h1>{title}</h1>
          {area && <p>{area}</p>}
        </div>
      </header>

      <EyeCompass map={map} start={start.heading} />

      <footer className={s.foot} data-eye-keep data-eye-credits="">
        {creditsOpen && (
          <div id={creditsId} className={s.creditsPop}>
            <span className={s.sources}>
              {credits.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </span>
            {/* Who this is, for a visitor who arrived from a reel or a link: the landing page. */}
            <a className={s.home} href="/">
              {HOME_LABEL}
            </a>
          </div>
        )}
        <div className={s.line}>
          <Coords map={map} start={start} />
          <button
            ref={creditsBtn}
            type="button"
            className={s.lineBtn}
            aria-expanded={creditsOpen}
            aria-controls={creditsId}
            onClick={() => setCreditsOpen((o) => !o)}
          >
            {CREDITS_LABEL}
          </button>
          {/* AGPL-3.0 section 13: a network user is offered the source, with the credits closed too. */}
          <a className={s.lineBtn} href={BRAND.repoUrl} target="_blank" rel="noreferrer noopener">
            Source
          </a>
          <a className={s.lineBtn} href={BRAND.license.url} target="_blank" rel="noreferrer noopener">
            {BRAND.license.short}
          </a>
        </div>
      </footer>

      <ControlHint hint={hint} />
      {sourcesOpen && (
        <SourcesTray
          rows={sourceRows}
          state={sources}
          dispatch={dispatch}
          ledger={rows}
          refreshedAt={refreshedAt}
          clock={clock}
          london={london}
          leftOut={leftOut}
          memory={memory}
          setMemory={setMemory}
          onClose={closeTray}
        />
      )}
    </div>
  );
}
