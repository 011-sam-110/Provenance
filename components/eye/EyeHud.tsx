"use client";
// The God's eye view's frame: the place, the UTC clock, heading and tilt, the ledger
// of what is on screen and who measured it, the credits, and the way back to the
// console. Every word comes from lib/eye/wording.ts. The look (a vignette with scrims
// under the words) is eye.module.css.
//
// RE-RENDERS ONLY WHEN THE TEXT CHANGES. The camera moves every frame while the view
// turns, and a setState per frame would re-render this whole frame per frame. The
// readout is keyed on what it DISPLAYS (four decimals, whole degrees), the same rule
// as components/hud/Hud.tsx.

import { useEffect, useRef, useState } from "react";
import type maplibregl from "maplibre-gl";
import Mark from "@/components/brand/Mark";
import ControlHint, { HintToggle, useControlHint } from "./ControlHint";
import { BRAND } from "@/lib/brand";
import type { EyeClock } from "@/lib/eye/motion";
import { EYE_PLACES, eyePlaceHref, type EyeView } from "@/lib/eye/places";
import { pinCap, type EyeSourceRow, type SourcesAction, type SourcesState } from "@/lib/eye/sources";
import {
  EXIT_LABEL,
  fmtClockUtc,
  fmtHeading,
  fmtLat,
  fmtLon,
  PLACES_LABEL,
  refreshedText,
  sourcesName,
  type LedgerRow,
} from "@/lib/eye/wording";
import { PinChrome, PinnedSources, SourcesTray, TRAY_ID, useSourcesBar, type TrayMemory } from "./EyeSources";
import styles from "./eye.module.css";
import sx from "./EyeSources.module.css";

interface Readout {
  lat: number;
  lon: number;
  heading: number;
  tilt: number;
}

function useReadout(map: maplibregl.Map | null, start: EyeView): Readout {
  const [readout, setReadout] = useState<Readout>({ lat: start.lat, lon: start.lon, heading: start.heading, tilt: start.tilt });
  useEffect(() => {
    if (!map) return;
    let raf = 0;
    let shown = "";
    const read = () => {
      raf = 0;
      const c = map.getCenter();
      const next = { lat: c.lat, lon: c.lng, heading: map.getBearing(), tilt: map.getPitch() };
      const key = `${fmtLat(next.lat)}|${fmtLon(next.lon)}|${fmtHeading(next.heading)}|${Math.round(next.tilt)}`;
      if (key === shown) return;
      shown = key;
      setReadout(next);
    };
    const onMove = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    read();
    map.on("move", onMove);
    return () => {
      map.off("move", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [map]);
  return readout;
}

/** The time shown: the wall clock each second, or a film's clock at each of its steps. */
function useClock(clock: EyeClock): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(clock.now());
    if (clock.film) return clock.subscribe(() => setNow(clock.now()));
    const t = setInterval(() => setNow(clock.now()), 1000);
    return () => clearInterval(t);
  }, [clock]);
  return now;
}

export interface EyeHudProps {
  map: maplibregl.Map | null;
  /** The view the page opened on, shown until the map reports its own. */
  start: EyeView;
  title: string;
  area?: string;
  rows: LedgerRow[];
  /** When the vessels or the aircraft last arrived; the line under the ledger says how long ago. */
  refreshedAt?: number;
  /** Shown on a phone instead of the long rows that state an absence. */
  phoneNote?: string;
  /** Every source drawn, from MapLibre's own attribution (creditsFromAttribution). */
  credits: string[];
  /** The console at the spot on screen NOW, with its Sources rail open; read when the link is used. */
  getSourcesHref: () => string;
  /**
   * The console at the spot on screen NOW, for "Exit to main dashboard"; read when the link
   * is used. Left out for a recording or a film, which draw no way out.
   */
  getDashboardHref?: () => string;
  /** How many rows the console's Sources rail draws (lib/eye/railCount.ts): the tray's foot and its empty search say it. */
  sourceCount: number;
  /** The rows of the Sources tray (lib/eye/sourceRows.ts), and how many of the rail's this view leaves out. */
  sourceRows: EyeSourceRow[];
  leftOut: { country: number; widget: number };
  /** What is switched on and pinned, and how to change it (lib/eye/sources.ts). */
  sources: SourcesState;
  dispatch: (a: SourcesAction) => void;
  /** What each row has in the scene now, by row id, for the "N here" after a switched-on label. */
  counts: Readonly<Record<string, number>>;
  /** The view opened in London: TfL's three road rows have something to show. */
  london: boolean;
  /** A phone's layout: the bar's strip, six pins, the grips. */
  portrait: boolean;
  /** The preset on screen, if the view is one, so the place picker can mark it. */
  placeId?: string;
  /** Recording: no buttons over the picture. */
  record: boolean;
  /** The wall clock, or a film's own under clock=manual (lib/eye/motion.ts). */
  clock: EyeClock;
  children?: React.ReactNode;
}

export default function EyeHud({
  map,
  start,
  title,
  area,
  rows,
  refreshedAt,
  phoneNote,
  credits,
  getSourcesHref,
  getDashboardHref,
  sourceCount,
  sourceRows,
  leftOut,
  sources,
  dispatch,
  counts,
  london,
  portrait,
  placeId,
  record,
  clock,
  children,
}: EyeHudProps) {
  // The exit's address is read as it is used (pressed, focused or clicked), so it is the
  // spot on screen then, not where the view opened. Same as the tray's "Open the full map".
  const refreshExit = (e: React.SyntheticEvent<HTMLAnchorElement>) => {
    if (getDashboardHref) e.currentTarget.href = getDashboardHref();
  };
  const readout = useReadout(map, start);
  const now = useClock(clock);
  // A recording is filmed slower than it plays, so a count of seconds since the last
  // refresh would race; it is left out there, like the clock's seconds.
  const fresh = !record && refreshedAt != null && now != null ? refreshedText(refreshedAt, now) : undefined;
  // The place picker on a phone: a short list over the bar, opened by "Places". Places and
  // the Sources tray take the same room, so each closes the other.
  const [placesOpen, setPlacesOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  // Which view and section the tray was last on: kept for the visit, never saved.
  const [memory, setMemory] = useState<TrayMemory>({ view: "sections", section: "view" });
  const barRef = useRef<HTMLElement>(null);
  const sourcesBtn = useRef<HTMLButtonElement>(null);
  const cap = pinCap(portrait);
  const bar = useSourcesBar({ rows: sourceRows, state: sources, cap, portrait, dispatch, barRef });
  const dragging = bar.lifted != null;
  // The control hint's state, shared by the "?" beside the clock and the plate in the footer.
  // `blocked` is whatever takes the plate's room: the places sheet, the sources tray and a
  // carried source. Its toggle closes the tray too (see HintToggle's onOpen below).
  const hint = useControlHint(map, placesOpen || sourcesOpen || dragging);
  const closeTray = (refocus: boolean) => {
    setSourcesOpen(false);
    if (refocus) sourcesBtn.current?.focus();
  };

  // Escape closes what is on top: a carried source (its own listener cancels it), then the
  // pin menu, then the tray. In the capture phase and with preventDefault, so a camera
  // card or a vessel's panel, which look at `defaultPrevented`, close on the NEXT press.
  useEffect(() => {
    if (!sourcesOpen && !bar.menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || bar.activeRef.current) return;
      e.preventDefault();
      if (bar.menu) bar.closeMenu(true);
      else closeTray(true);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourcesOpen, bar.menu]);

  // On a phone the tray is a pop-up: a tap on the scene outside it closes it. On a wide
  // screen it stays open while the map is panned.
  useEffect(() => {
    if (!sourcesOpen || !portrait) return;
    const onDown = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest("[data-eye-tray], [data-eye-bar]")) return;
      setSourcesOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [sourcesOpen, portrait]);

  return (
    <div className={styles.hud} data-exit={getDashboardHref ? "" : undefined}>
      {/* data-eye-keep: EyeOverlay places no card or tag over these. */}
      <header className={styles.top} data-eye-keep>
        <div className={styles.placeBlock}>
          <div className={styles.idRow}>
            {/* Who this is, for a visitor who arrived from a reel or a link: the landing page. */}
            <a className={styles.id} href="/">
              <Mark size={20} className={styles.mark} />
              {BRAND.name}
            </a>
            {/* THE WAY OUT to the console, always on screen: beside the name on a wide screen,
                under the place on a phone (eye.module.css). A plain <a> and a full page load,
                like every way between the two maps (EyeReturn.tsx is the way back). */}
            {getDashboardHref && (
              <a
                className={`${styles.btn} ${styles.exit}`}
                href="/app"
                data-eye-exit=""
                onPointerDown={refreshExit}
                onFocus={refreshExit}
                onClick={refreshExit}
              >
                <span className={styles.exitArrow} aria-hidden>
                  ←
                </span>
                {EXIT_LABEL}
              </a>
            )}
          </div>
          <h1 className={styles.place}>{title}</h1>
          <p className={styles.sub}>
            {area && (
              <>
                {area}
                <span className={styles.sep} />
              </>
            )}
            Heading {fmtHeading(readout.heading)}°<span className={styles.sep} />
            Tilt {Math.round(readout.tilt)}°
          </p>
          {!record && (
            <nav className={`${styles.places} ${styles.long}`} aria-label={PLACES_LABEL}>
              {EYE_PLACES.map((p) => (
                <a
                  key={p.id}
                  className={styles.chip}
                  href={eyePlaceHref(p.id)}
                  aria-current={p.id === placeId ? "page" : undefined}
                >
                  {p.name}
                </a>
              ))}
            </nav>
          )}
        </div>
        <div className={styles.topRight}>
          <p className={styles.clockBlock} aria-label="Time now, UTC">
            <span className={styles.clock}>{now != null ? fmtClockUtc(now, !record) : record ? "--:--" : "--:--:--"}</span>
            <span className={styles.utc}>UTC</span>
          </p>
          {!record && <HintToggle
              hint={hint}
              onOpen={() => {
                setPlacesOpen(false);
                setSourcesOpen(false);
              }}
            />}
        </div>
      </header>

      {rows.length > 0 && (
        <section className={styles.ledger} aria-label="What this view shows" data-eye-keep>
          {rows.map((row) => (
            <p
              key={row.id ?? row.kind}
              data-k={row.kind}
              data-zero={row.count === 0 || undefined}
              data-note={row.count == null || undefined}
              style={row.color ? ({ ["--c" as string]: row.color } as React.CSSProperties) : undefined}
            >
              <i aria-hidden />
              {row.count != null && <b>{row.count}</b>}
              <span className={styles.long}>
                {row.label}
                <small>{row.detail}</small>
              </span>
              <span className={styles.short}>{row.short}</span>
            </p>
          ))}
          {fresh && <p className={`${styles.fresh} ${styles.long}`}>{fresh}</p>}
        </section>
      )}

      <footer className={styles.bottom} data-eye-keep>
      {!record && <ControlHint hint={hint} />}
      {!record && (
        // `tn-terminal` is the console's token scope only: it lets the Sources button and the
        // pins resolve the `--tn-*` tokens. GEV's own `.btn`s use `--eye-*` and are unaffected.
        <nav ref={barRef} className={`${styles.controls} ${sx.barLayer} tn-terminal`} aria-label="View controls" data-eye-keep data-eye-bar>
          {/* SOURCES. The console's own rail button (.tn-rail-fab: the bars in front, the word
              after), here opening the console's rail as a tray in this view (EyeSources.tsx).
              On a phone it stays first in the bar, at thumb height. */}
          <button
            ref={sourcesBtn}
            type="button"
            data-sources-button=""
            className={`tn-rail-fab ${sx.fab} ${sx.sourcesBtn}`}
            aria-expanded={sourcesOpen}
            aria-controls={TRAY_ID}
            onClick={() => {
              setPlacesOpen(false);
              setSourcesOpen((o) => !o);
            }}
          >
            <span className="tn-rail-fab-bars" aria-hidden>
              ≡
            </span>
            {sourcesName()}
          </button>
          {/* On a phone Places, the other buttons and the pins scroll sideways in one strip
              beside Sources; on a wide screen the wrapper adds no box. */}
          <div className={sx.bar}>
            <button
              type="button"
              className={`${styles.btn} ${styles.short}`}
              aria-expanded={placesOpen}
              onClick={() => {
                setSourcesOpen(false);
                setPlacesOpen((o) => !o);
              }}
            >
              {PLACES_LABEL}
            </button>
            {children}
            <PinnedSources rows={sourceRows} state={sources} dispatch={dispatch} cap={cap} london={london} bar={bar} />
          </div>
          <PinChrome rows={sourceRows} state={sources} dispatch={dispatch} cap={cap} bar={bar} />
        </nav>
      )}
      {!record && placesOpen && (
        <nav className={`${styles.placeSheet} ${styles.short}`} aria-label={PLACES_LABEL}>
          {EYE_PLACES.map((p) => (
            <a key={p.id} href={eyePlaceHref(p.id)} aria-current={p.id === placeId ? "page" : undefined}>
              <b>{p.name}</b>
              <span>{p.area}</span>
            </a>
          ))}
        </nav>
      )}
      {!record && sourcesOpen && (
        <SourcesTray
          rows={sourceRows}
          state={sources}
          dispatch={dispatch}
          counts={counts}
          london={london}
          portrait={portrait}
          sourceCount={sourceCount}
          leftOut={leftOut}
          memory={memory}
          setMemory={setMemory}
          bar={bar}
          getSourcesHref={getSourcesHref}
          anchorRef={barRef}
          onClose={closeTray}
        />
      )}
        {phoneNote && <span className={styles.short}>{phoneNote}</span>}
        <span className={styles.coords}>
          {fmtLat(readout.lat)}
          <span className={styles.sep} />
          {fmtLon(readout.lon)}
          {/* Every source drawn, in full (the map's own control is hidden while this
              shows them), then AGPL-3.0 section 13: a network user is offered the source. */}
          <span className={styles.credits}>
            {credits.length > 0 && (
              <span className={styles.sources}>
                {credits.map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </span>
            )}
            <span className={styles.site}>
              {BRAND.domain}
              <a href={BRAND.repoUrl} target="_blank" rel="noreferrer noopener">
                Source
              </a>
              <a href={BRAND.license.url} target="_blank" rel="noreferrer noopener">
                {BRAND.license.short}
              </a>
            </span>
          </span>
        </span>
      </footer>
    </div>
  );
}
