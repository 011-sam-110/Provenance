"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import Starfield from "./Starfield";
import type { HeroLayer } from "./HeroGlobe";

// MapLibre + the TLE propagator are the heaviest things on this page, so the globe
// is still never part of the FIRST PAINT — but it now starts loading immediately
// after it, in parallel with the launch sequence, rather than waiting for the
// browser to go idle.
//
// It used to mount on `requestIdleCallback(…, { timeout: 1800 })`, which meant the
// engine did not begin until roughly the moment the choreography finished, and the
// globe then faded up into a hero that had already finished arriving. Loading it
// under the sequence spends the one second the text is animating on the network
// and the style parse, so the globe is usually painted by the time the rail lands.
//
// Nothing reflows when it arrives, because the box was always that size.
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
  const [ready, setReady] = useState(false);
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

  // Mount on the frame AFTER the first paint. Two nested rAFs is the cheap way to
  // say that: the first fires before the paint that follows hydration, the second
  // after it. So the headline still owns the critical path and the engine starts
  // roughly 16ms later, under the animation rather than after it.
  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setMount(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      if (inner) cancelAnimationFrame(inner);
    };
  }, []);

  // Replay the launch sequence on every arrival, not just on a cold load.
  //
  // A document restored from the back/forward cache comes back with its animations
  // already finished, so returning from /app showed the hero fully assembled with
  // no launch at all. Removing the class, forcing a reflow and putting it back is
  // what actually restarts a CSS animation — reading `offsetWidth` in between is
  // the flush, and without it the browser coalesces the two class changes into no
  // change whatsoever.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      const hero = document.querySelector<HTMLElement>(".pv-hero");
      if (!hero) return;
      hero.classList.remove("pv-intro");
      void hero.offsetWidth;
      hero.classList.add("pv-intro");
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  useEffect(() => () => clearInterval(timer.current), []);

  return (
    <>
      <div className="pv-hero-stage" aria-hidden="true">
        <Starfield />
        {/* `data-ready` drives the globe's own fade-and-settle, and is set when
            MapLibre has painted a frame — not when it mounted. Fading in on mount
            would fade in an empty black square. */}
        <div className="pv-hero-globe" data-ready={ready ? "1" : "0"}>
          {mount ? (
            <HeroGlobe
              layers={layers}
              satColor={satColor}
              onStatus={pushStatus}
              onReady={() => setReady(true)}
            />
          ) : null}
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
