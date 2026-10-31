"use client";
// The frame of a film or a recording (record=1, clock=manual): the place, the clock to the
// minute, heading and tilt, the evidence ledger of what is on screen and who measured it, and
// every credit in full. Reels are filmed from this frame, and its ledger is part of them, so it
// stays as it was when the HUD gained a sidebar, a search and a compass (EyeHud.tsx). It has no
// control: a film is a frame, not a tool. Its words come from lib/eye/wording.ts and its look is
// eye.module.css.
//
// NOT IN IT: the sidebar, the search, the compass, the hint, the Sources tray.

import type maplibregl from "maplibre-gl";
import Mark from "@/components/brand/Mark";
import { BRAND } from "@/lib/brand";
import type { EyeClock } from "@/lib/eye/motion";
import type { EyeView } from "@/lib/eye/places";
import { fmtClockUtc, fmtHeading, fmtLat, fmtLon, refreshedText, type LedgerRow } from "@/lib/eye/wording";
import { useClock, useReadout, type Readout } from "./hudHooks";
import styles from "./eye.module.css";

const keyOf = (r: Readout) => `${fmtLat(r.lat)}|${fmtLon(r.lon)}|${fmtHeading(r.heading)}|${Math.round(r.tilt)}`;

export default function EyeFilmFrame({
  map,
  start,
  title,
  area,
  rows,
  refreshedAt,
  phoneNote,
  credits,
  record,
  clock,
}: {
  map: maplibregl.Map | null;
  /** The view the page opened on, shown until the map reports its own. */
  start: EyeView;
  title: string;
  area?: string;
  rows: LedgerRow[];
  /** When the vessels or the aircraft last arrived. */
  refreshedAt?: number;
  /** Shown on a phone instead of the long rows that state an absence. */
  phoneNote?: string;
  /** Every source drawn, from MapLibre's own attribution (creditsFromAttribution). */
  credits: string[];
  /** A recording shows the clock to the minute: it is filmed slower than it plays. */
  record: boolean;
  /** A film's own clock under clock=manual (lib/eye/motion.ts), or the wall clock. */
  clock: EyeClock;
}) {
  const readout = useReadout(map, start, keyOf);
  const now = useClock(clock);
  // A recording is filmed slower than it plays, so a count of seconds since the last refresh
  // would race; it is left out there, like the clock's seconds.
  const fresh = !record && refreshedAt != null && now != null ? refreshedText(refreshedAt, now) : undefined;
  return (
    <div className={`${styles.hud} ${styles.film}`}>
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
        {phoneNote && <span className={styles.short}>{phoneNote}</span>}
        <span className={styles.coords}>
          {fmtLat(readout.lat)}
          <span className={styles.sep} />
          {fmtLon(readout.lon)}
          {/* Every source drawn, in full (the map's own control is hidden while this shows
              them), then AGPL-3.0 section 13: a network user is offered the source. */}
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
