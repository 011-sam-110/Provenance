"use client";
// The compass along the bottom edge: a chip with the heading, a pointer, and a strip that moves
// under it. It reads the map's real bearing and takes no clicks. lib/eye/compass.ts holds the
// ticks and the wrap.
//
// NO REACT RENDER PER FRAME. The strip is drawn once, as one layer, and the map's `move` writes
// its transform from a ref. The chip's text is written only when it changes. The view turns every
// frame on Auto-turn, and this file adds one style write per frame to that.

import { memo, useEffect, useRef } from "react";
import type maplibregl from "maplibre-gl";
import { compassLabel, compassOffset, compassTicks } from "@/lib/eye/compass";
import styles from "./EyeHud.module.css";

const TICKS = compassTicks();
const shift = (heading: number) => `translate3d(${compassOffset(heading)}%, 0, 0)`;

function EyeCompass({ map, start }: { map: maplibregl.Map | null; /** The heading the page opened on. */ start: number }) {
  const strip = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!map) return;
    let shown = "";
    const read = () => {
      const heading = map.getBearing();
      if (strip.current) strip.current.style.transform = shift(heading);
      const text = compassLabel(heading);
      if (text === shown || !chip.current) return;
      shown = text;
      chip.current.textContent = text;
    };
    read();
    map.on("move", read);
    return () => {
      map.off("move", read);
    };
  }, [map]);

  return (
    <div className={styles.compass} role="group" aria-label="Heading" data-eye-keep data-eye-compass="">
      <span ref={chip} className={styles.chip} data-compass-chip="">
        {compassLabel(start)}
      </span>
      <span className={styles.pointer} aria-hidden />
      <div className={styles.window} aria-hidden>
        <div ref={strip} className={styles.strip} style={{ transform: shift(start) }}>
          {TICKS.map((t) => (
            <span key={t.deg} className={styles.tick} data-kind={t.kind} style={{ left: `${t.at}%` }}>
              <i />
              {t.label && <b>{t.label}</b>}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default memo(EyeCompass);
