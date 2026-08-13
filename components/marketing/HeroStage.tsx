"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import Starfield from "./Starfield";
import type { HeroLayer } from "./HeroGlobe";

// MapLibre + the TLE propagator are the heaviest things on this page, so the globe
// is never part of the first paint. The headline and the star field render
// immediately; the globe box is an empty, correctly-sized square of night until the
// browser is idle, then the real engine mounts into it. Nothing reflows when it
// arrives, because the box was always that size.
const HeroGlobe = dynamic(() => import("./HeroGlobe"), { ssr: false });

/**
 * The hero's night stage: star field, globe, scrim, and the status rail along the
 * foot.
 *
 * Replaces the old right-hand aperture plate. The globe is no longer a framed
 * object beside the headline — it is the ground the headline stands on, rising
 * from below the fold. The stage owns the status line because the status line
 * reports what the globe's own fetches came back with (see `pushStatus`), and
 * routing that through a store for one string would be ceremony.
 *
 * The scrim sits ABOVE the globe so it can darken the headline's corner, and is
 * `pointer-events: none` so the globe underneath is still grabbable through it.
 */
export default function HeroStage({ layers, satColor }: { layers: HeroLayer[]; satColor: string }) {
  const [mount, setMount] = useState(false);
  const [status, setStatus] = useState("Starting the engine");

  // The ticker: the globe hands us lines as its layers land, and we show them one
  // at a time rather than letting the last one to resolve win. A queue rather than
  // a fixed script, because the numbers in it are measured — a scripted sequence
  // with plausible counts typed into it is exactly the thing this page exists to
  // argue against.
  const queue = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const pushStatus = useCallback((line: string) => {
    queue.current.push(line);
    if (timer.current) return;
    const step = () => {
      const next = queue.current.shift();
      if (next === undefined) {
        clearInterval(timer.current);
        timer.current = undefined;
        return;
      }
      setStatus(next);
    };
    step();
    timer.current = setInterval(step, 1600);
  }, []);

  useEffect(() => {
    type IdleWindow = Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const w = window as IdleWindow;
    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(() => setMount(true), { timeout: 1800 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = setTimeout(() => setMount(true), 600);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => () => clearInterval(timer.current), []);

  return (
    <>
      <div className="pv-hero-stage" aria-hidden="true">
        <Starfield />
        <div className="pv-hero-globe">
          {mount ? <HeroGlobe layers={layers} satColor={satColor} onStatus={pushStatus} /> : null}
        </div>
        <div className="pv-hero-scrim" />
      </div>

      <p className="pv-hero-hint" aria-hidden="true">
        Drag to spin
      </p>

      <div className="pv-hero-foot">
        <div className="pv-hero-foot-inner">
          {/* A live region: the ticker is the page's first factual claim, and a
              screen reader that never hears it gets a hero with no evidence in it. */}
          <p className="pv-hero-status" role="status" aria-live="polite">
            {status}
          </p>
          <p className="pv-hero-credit">
            CARTO · OpenStreetMap · TeleGeography · CelesTrak · USGS · NASA EONET · OurAirports
          </p>
        </div>
      </div>
    </>
  );
}
