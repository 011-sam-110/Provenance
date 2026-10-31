"use client";
// What the God's eye view's frames read from the map and the clock. EyeHud and EyeFilmFrame both
// use these, and neither re-renders per frame.
//
// RE-RENDERS ONLY WHEN THE TEXT CHANGES. The camera moves every frame while the view turns, and
// a setState per frame would re-render the whole frame per frame. The readout is keyed on what
// it DISPLAYS, the same rule as components/hud/Hud.tsx.

import { useEffect, useState } from "react";
import type maplibregl from "maplibre-gl";
import type { EyeClock } from "@/lib/eye/motion";
import type { EyeView } from "@/lib/eye/places";

export interface Readout {
  lat: number;
  lon: number;
  heading: number;
  tilt: number;
}

/** The map's position, with a state change only when `keyOf` of it changes. */
export function useReadout(map: maplibregl.Map | null, start: EyeView, keyOf: (r: Readout) => string): Readout {
  const [readout, setReadout] = useState<Readout>({ lat: start.lat, lon: start.lon, heading: start.heading, tilt: start.tilt });
  useEffect(() => {
    if (!map) return;
    let raf = 0;
    let shown = "";
    const read = () => {
      raf = 0;
      const c = map.getCenter();
      const next = { lat: c.lat, lon: c.lng, heading: map.getBearing(), tilt: map.getPitch() };
      const key = keyOf(next);
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
    // keyOf is a constant of each caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);
  return readout;
}

/** The time shown: the wall clock each second, or a film's clock at each of its steps. */
export function useClock(clock: EyeClock): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(clock.now());
    if (clock.film) return clock.subscribe(() => setNow(clock.now()));
    const t = setInterval(() => setNow(clock.now()), 1000);
    return () => clearInterval(t);
  }, [clock]);
  return now;
}
