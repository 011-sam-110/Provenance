"use client";
// The God's eye view's frame: the place, the UTC clock, heading and tilt, the ledger
// of what is on screen and who measured it, the credits, and the way back to the
// console. Every word comes from lib/eye/wording.ts. The look (a vignette with scrims
// under the words, one sweep when a feed refreshes) is eye.module.css; the sweep is
// off with reduced motion and in a recording.
//
// RE-RENDERS ONLY WHEN THE TEXT CHANGES. The camera moves every frame while the view
// turns, and a setState per frame would re-render this whole frame per frame. The
// readout is keyed on what it DISPLAYS (four decimals, whole degrees), the same rule
// as components/hud/Hud.tsx.

import { useEffect, useState } from "react";
import type maplibregl from "maplibre-gl";
import Mark from "@/components/brand/Mark";
import { BRAND } from "@/lib/brand";
import type { EyeClock } from "@/lib/eye/motion";
import { EYE_PLACES, eyePlaceHref, type EyeView } from "@/lib/eye/places";
import {
  fmtClockUtc,
  fmtHeading,
  fmtLat,
  fmtLon,
  PLACES_LABEL,
  refreshedText,
  SOURCES_LABEL,
  sourcesHint,
  sourcesName,
  type LedgerRow,
} from "@/lib/eye/wording";
import styles from "./eye.module.css";

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
  /** How many rows the console's Sources rail draws (lib/eye/railCount.ts), for the hint. */
  sourceCount: number;
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
  sourceCount,
  placeId,
  record,
  clock,
  children,
}: EyeHudProps) {
  const readout = useReadout(map, start);
  const now = useClock(clock);
  // A recording is filmed slower than it plays, so a count of seconds since the last
  // refresh would race; it is left out there, like the clock's seconds.
  const fresh = !record && refreshedAt != null && now != null ? refreshedText(refreshedAt, now) : undefined;
  // The href is set as the link is used, so it is the spot on screen then, without a
  // re-render on every pan. Pointer-down covers a middle click, focus a keyboard.
  const refreshSources = (e: React.SyntheticEvent<HTMLAnchorElement>) => {
    e.currentTarget.href = getSourcesHref();
  };
  // The place picker on a phone: a short list over the bar, opened by "Places".
  const [placesOpen, setPlacesOpen] = useState(false);

  return (
    <div className={styles.hud}>
      {/* Keyed on the refresh, so each new report runs the sweep once. */}
      {!record && refreshedAt != null && <i key={refreshedAt} className={styles.sweep} aria-hidden />}

      {/* data-eye-keep: EyeOverlay places no card or tag over these. */}
      <header className={styles.top} data-eye-keep>
        <div className={styles.placeBlock}>
          {/* Who this is, for a visitor who arrived from a reel or a link: the landing page. */}
          <a className={styles.id} href="/">
            <Mark size={20} className={styles.mark} />
            {BRAND.name}
          </a>
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
        </div>
      </header>

      {rows.length > 0 && (
        <section className={styles.ledger} aria-label="What this view shows" data-eye-keep>
          {rows.map((row) => (
            <p key={row.kind} data-k={row.kind} data-zero={row.count === 0 || undefined} data-note={row.count == null || undefined}>
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
      {!record && (
        <nav className={styles.controls} aria-label="View controls" data-eye-keep>
          {/* SOURCES. On a phone it is the console's own thumb control, kept as it was:
              the "≡ Sources" button at the bottom left, in thumb reach, which opens the
              Sources rail as a sheet with its grip (.tn-rail-fab and the .tn-rail sheet in
              app/globals.css). Here it opens that same sheet in the console, at this spot.
              A full page load, not a client-side route: the console boots its own stores
              from scratch, and nothing this page set in memory reaches it. */}
          <a
            className={styles.sourcesBtn}
            href="/app?sources=open"
            aria-label={sourcesName(sourceCount)}
            onPointerDown={refreshSources}
            onFocus={refreshSources}
            onClick={refreshSources}
          >
            <span className={styles.bars} aria-hidden>
              ≡
            </span>
            <b>{SOURCES_LABEL}</b>
            <small className={styles.long}>{sourcesHint(sourceCount)}</small>
          </a>
          <button
            type="button"
            className={`${styles.btn} ${styles.short}`}
            aria-expanded={placesOpen}
            onClick={() => setPlacesOpen((o) => !o)}
          >
            {PLACES_LABEL}
          </button>
          {children}
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
