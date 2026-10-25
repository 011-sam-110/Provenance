"use client";
// The God's eye view's frame: the place, the UTC clock, heading and tilt, the ledger
// of what is on screen and who measured it, the credits, and the way back to the
// console. Every word comes from lib/eye/wording.ts. The look (corner brackets, scan
// lines, a vignette with scrims under the words, one sweep when a feed refreshes) is
// eye.module.css; the sweep is off with reduced motion and in a recording.
//
// RE-RENDERS ONLY WHEN THE TEXT CHANGES. The camera moves every frame while the view
// turns, and a setState per frame would re-render this whole frame per frame. The
// readout is keyed on what it DISPLAYS (four decimals, whole degrees), the same rule
// as components/hud/Hud.tsx.

import { useEffect, useState } from "react";
import type maplibregl from "maplibre-gl";
import { BRAND } from "@/lib/brand";
import type { EyeView } from "@/lib/eye/places";
import { fmtClockUtc, fmtHeading, fmtLat, fmtLon, refreshedText, type LedgerRow } from "@/lib/eye/wording";
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

function useClock(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
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
  /** The console at the spot on screen NOW, read when the link is used. */
  getBackHref: () => string;
  /** Recording: no buttons over the picture. */
  record: boolean;
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
  getBackHref,
  record,
  children,
}: EyeHudProps) {
  const readout = useReadout(map, start);
  const now = useClock();
  // A recording is filmed slower than it plays, so a count of seconds since the last
  // refresh would race; it is left out there, like the clock's seconds.
  const fresh = !record && refreshedAt != null && now != null ? refreshedText(refreshedAt, now) : undefined;
  // The href is set as the link is used, so it is the spot on screen then, without a
  // re-render on every pan. Pointer-down covers a middle click, focus a keyboard.
  const refreshBack = (e: React.SyntheticEvent<HTMLAnchorElement>) => {
    e.currentTarget.href = getBackHref();
  };

  return (
    <div className={styles.hud}>
      <i className={styles.scan} aria-hidden />
      {/* Keyed on the refresh, so each new report runs the sweep once. */}
      {!record && refreshedAt != null && <i key={refreshedAt} className={styles.sweep} aria-hidden />}
      <i className={styles.corner} data-c="tl" aria-hidden />
      <i className={styles.corner} data-c="tr" aria-hidden />
      <i className={styles.corner} data-c="bl" aria-hidden />
      <i className={styles.corner} data-c="br" aria-hidden />

      {/* data-eye-keep: EyeOverlay places no card or tag over these. */}
      <header className={styles.top} data-eye-keep>
        <div className={styles.placeBlock}>
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
          {children}
          {/* A full page load, not a client-side route: the console boots its own
              stores from scratch, and nothing this page set in memory reaches it. */}
          <a
            className={styles.btn}
            href="/app"
            onPointerDown={refreshBack}
            onFocus={refreshBack}
            onClick={refreshBack}
          >
            Back to the console
          </a>
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
