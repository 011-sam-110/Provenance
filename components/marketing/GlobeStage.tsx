"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import Starfield from "./Starfield";
import type { HeroLayer, GlobeControls } from "./HeroGlobe";

const HeroGlobe = dynamic(() => import("./HeroGlobe"), { ssr: false });

/**
 * The globe, promoted from hero furniture to the backdrop for the whole document.
 *
 * It is one fixed stage behind every section. The page scrolls past it; the stage moves
 * the globe between parked positions — filling the frame at the two ends, tucked into the
 * margin beside the sections that need the column — and turns it to whatever place the
 * section under the reader is about.
 *
 * ── HOW THIS OBEYS THE ONE-SCROLL-SUBSCRIBER RULE ──────────────────────────────────────
 *
 * `CLAUDE.md` allows this page a single scroll subscriber and forbids React state per
 * frame. This component adds NO scroll listener: it reads `window.scrollY` inside the rAF
 * loop it already runs. It sets NO React state after mount. Everything it animates is
 * either a CSS custom property on one element (compositor work, no React, no layout) or
 * `style.opacity` written straight onto the step elements, and only when the active step
 * actually changes.
 *
 * The camera is driven through `GlobeControls`, handed over once on mount, so turning the
 * globe to a country is an imperative call rather than a prop change per step.
 */

export interface GlobePlace {
  lon: number;
  lat: number;
  /** Drawn on the pin's leader line. Caps, because it is set in the mono role at 12px. */
  label: string;
}

export interface GlobeStageProps {
  layers: HeroLayer[];
  satColor: string;
  coverage: Record<string, number>;
  coverageMax: number;
  /** The surveillance section's places, in the order the steps appear. */
  watchPlaces: GlobePlace[];
  /** The coverage section's countries, in the order the steps appear. */
  covPlaces: GlobePlace[];
}

/**
 * The choreography, as scroll keyframes.
 *
 * Each entry is [anchor, x, y, scale, opacity] where the anchor is resolved against the
 * measured document and x/y are fractions of the viewport. Between two keyframes the
 * stage interpolates with a smoothstep, so there are no visible corners at the joins.
 *
 * The globe is only ever scaled DOWN from the size MapLibre actually renders at. Scaling a
 * WebGL canvas up would soften every coastline on it, and the whole reason the engine is
 * here rather than a video is that it is the real thing.
 */
interface Keyframe {
  y: number;
  s: [x: number, y: number, scale: number, opacity: number];
}

export default function GlobeStage({
  layers,
  satColor,
  coverage,
  coverageMax,
  watchPlaces,
  covPlaces,
}: GlobeStageProps) {
  const [mount, setMount] = useState(false);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Starting the engine");
  const stageRef = useRef<HTMLDivElement>(null);
  const controls = useRef<GlobeControls | null>(null);

  // The ticker. The globe hands up a line as each layer lands and they are shown one at a
  // time, rather than letting whichever resolved last win. A queue rather than a script,
  // because the numbers in it are measured — a scripted sequence with plausible counts
  // typed into it is the exact thing this page exists to argue against.
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
  useEffect(() => () => clearInterval(timer.current), []);

  // Mount on the frame AFTER the first paint. Two nested rAFs is the cheap way to say
  // that: the first fires before the paint that follows hydration, the second after it. So
  // the headline still owns the critical path and the engine starts roughly 16ms later,
  // under the launch animation rather than after it.
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

  const takeControls = useCallback((c: GlobeControls | null) => {
    controls.current = c;
    // The globe rests until a section asks it to turn. See `ambientDrift` in HeroGlobe.
    c?.rest();
  }, []);

  // ── the director ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    let frame = 0;
    let frameN = 0;
    let lastY = -1;
    let activeWatch = -1;
    let activeCov = -1;
    let last: [number, number, number, number] | null = null;

    interface Metrics {
      w: number;
      h: number;
      watchTop: number;
      watchBottom: number;
      covTop: number;
      covBottom: number;
      tableTop: number;
      handoffTop: number;
      watchMids: number[];
      covMids: number[];
    }
    let m: Metrics | null = null;
    let watchEls: HTMLElement[] = [];
    let covEls: HTMLElement[] = [];

    const measure = () => {
      const sy = window.scrollY;
      const h = window.innerHeight;
      const edge = (sel: string, which: "top" | "bottom") => {
        const el = document.querySelector(sel);
        if (!el) return 0;
        const r = el.getBoundingClientRect();
        return (which === "top" ? r.top : r.bottom) + sy;
      };
      watchEls = Array.from(document.querySelectorAll<HTMLElement>("[data-step]"));
      covEls = Array.from(document.querySelectorAll<HTMLElement>("[data-cov]"));
      const mids = (els: HTMLElement[]) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return r.top + sy + r.height / 2;
        });
      m = {
        w: window.innerWidth,
        h,
        watchTop: edge("#watched", "top"),
        watchBottom: edge("#watched", "bottom"),
        covTop: edge("[data-pv-cov]", "top"),
        covBottom: edge("[data-pv-cov]", "bottom"),
        tableTop: edge("#layers", "top"),
        // Never past the end of the document, or the globe never reaches its closing
        // keyframe and the page ends mid-transition.
        handoffTop: Math.min(
          edge("#handoff", "top"),
          Math.max(1, document.documentElement.scrollHeight - h),
        ),
        watchMids: mids(watchEls),
        covMids: mids(covEls),
      };
    };

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const smooth = (t: number) => {
      const c = Math.max(0, Math.min(1, t));
      return c * c * (3 - 2 * c);
    };

    /** Highlight one step, dim the rest. Written straight to style, on change only. */
    const setActive = (els: HTMLElement[], next: number) => {
      els.forEach((el, i) => {
        el.style.opacity = i === next ? "1" : "0.3";
      });
    };

    const onResize = () => {
      m = null;
    };
    window.addEventListener("resize", onResize, { passive: true });

    const tick = () => {
      frame = requestAnimationFrame(tick);
      // A hidden tab still receives rAF in some browsers and a throttled one in others.
      // Composing a stage nobody is looking at is pure cost.
      if (document.hidden) return;

      frameN += 1;
      const y = window.scrollY;
      if (y === lastY && frameN % 30 !== 0) return;
      lastY = y;

      if (!m || m.h !== window.innerHeight || m.w !== window.innerWidth || frameN % 90 === 0) measure();
      if (!m) return;
      const { w, h, watchTop, watchBottom, covTop, covBottom, tableTop, handoffTop, watchMids, covMids } = m;

      // Where the globe parks. The text column is centred at min(74rem, 100% - 2.5rem) and
      // its steps run ~42rem from its left edge; the globe takes whatever is left over, and
      // gives up and sits behind the copy at full width when that is not enough to hold it.
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const colLeft = Math.max(1.25 * rem, (w - 74 * rem) / 2);
      const textRight = colLeft + 42 * rem;
      const narrow = w - textRight < 14 * rem;
      const free = w - textRight;
      const park: [number, number, number] = narrow
        ? [0.5, 0.26, 0.62]
        : [(textRight + free / 2) / w, 0.5, Math.min(free * 0.92, 0.78 * h) / Math.min(w, h)];
      const parkAlpha = narrow ? 0.4 : 0.92;

      const keys: Keyframe[] = [
        { y: 0, s: [0.56, 0.92, 1, 1] },
        { y: watchTop - h * 0.25, s: [park[0], park[1], park[2], parkAlpha] },
        { y: watchBottom - h * 0.5, s: [park[0], park[1], park[2], parkAlpha] },
        { y: watchBottom, s: [park[0], park[1], park[2], 0.5] },
        { y: covTop - h * 0.6, s: [park[0], park[1], park[2], parkAlpha] },
        { y: covBottom - h * 0.5, s: [park[0], park[1], park[2], parkAlpha] },
        { y: tableTop, s: [park[0], park[1], park[2], 0.22] },
        { y: handoffTop - h * 0.9, s: [park[0], park[1], park[2], 0.22] },
        { y: handoffTop, s: [0.5, 1.0, 1, 0.9] },
      ];
      // Sections can collapse or reorder at small widths. Forcing the anchors to increase
      // keeps the interpolation monotonic rather than dividing by a negative span.
      for (let i = 1; i < keys.length; i++) if (keys[i].y <= keys[i - 1].y) keys[i].y = keys[i - 1].y + 1;

      let s = keys[keys.length - 1].s;
      for (let i = 0; i < keys.length - 1; i++) {
        if (y <= keys[i + 1].y) {
          const t = smooth((y - keys[i].y) / (keys[i + 1].y - keys[i].y));
          s = keys[i].s.map((v, k) => lerp(v, keys[i + 1].s[k], t)) as typeof s;
          break;
        }
      }

      // Only touch the DOM when something actually moved. Writing four custom properties
      // every frame of a still page is the kind of cost that does not show up in a profile
      // as any one expensive call and still keeps the compositor awake.
      if (!last || s.some((v, i) => Math.abs(v - last![i]) > 0.0005)) {
        stage.style.setProperty("--pv-globe-x", `${(s[0] - 0.5) * 100}%`);
        stage.style.setProperty("--pv-globe-y", `${(s[1] - 0.5) * 100}%`);
        stage.style.setProperty("--pv-globe-scale", s[2].toFixed(4));
        stage.style.setProperty("--pv-globe-alpha", s[3].toFixed(3));
        last = [...s] as typeof s;
      }

      // ── which step the reader is on, and where that points the camera ────────────────
      const nearest = (mids: number[]) => {
        let best = 0;
        let bd = Infinity;
        const eye = y + h * 0.5;
        mids.forEach((mid, i) => {
          const d = Math.abs(mid - eye);
          if (d < bd) {
            bd = d;
            best = i;
          }
        });
        return best;
      };
      const inWatch = y > watchTop - h * 0.5 && y < watchBottom - h * 0.5;
      const inCov = y > covTop - h * 0.5 && y < covBottom - h * 0.4;

      if (inWatch && watchMids.length) {
        const b = nearest(watchMids);
        if (b !== activeWatch) {
          activeWatch = b;
          setActive(watchEls, b);
          const p = watchPlaces[b];
          if (p) controls.current?.focus(p.lon, p.lat, p.label);
        }
      } else if (inCov && covMids.length) {
        const b = nearest(covMids);
        if (b !== activeCov) {
          activeCov = b;
          setActive(covEls, b);
          const p = covPlaces[b];
          if (p) controls.current?.focus(p.lon, p.lat, p.label);
        }
      } else if (activeWatch !== -1 || activeCov !== -1) {
        // Left a stepped section. Take the pin off — it labels a claim the copy on screen
        // is no longer making — and forget the active index, so coming back re-issues the
        // camera move rather than believing it is already there.
        activeWatch = -1;
        activeCov = -1;
        controls.current?.rest();
      }
    };
    tick();

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, [watchPlaces, covPlaces]);

  return (
    <>
      <div className="pv-stage" ref={stageRef} aria-hidden="true">
        <Starfield />
        {/* `data-ready` drives the globe's own fade-and-settle and is set when MapLibre has
            actually painted a frame, not when it mounted. Fading in on mount would fade in
            an empty black square. */}
        <div className="pv-stage-globe" data-ready={ready ? "1" : "0"}>
          {mount ? (
            <HeroGlobe
              layers={layers}
              satColor={satColor}
              coverage={coverage}
              coverageMax={coverageMax}
              ambientDrift={false}
              onStatus={pushStatus}
              onReady={() => setReady(true)}
              onControls={takeControls}
            />
          ) : null}
        </div>
        <div className="pv-stage-scrim" />
      </div>

      {/* A live region: the ticker is the page's first factual claim, and a screen reader
          that never hears it gets a hero with no evidence in it. */}
      <p className="pv-stage-status" role="status" aria-live="polite">
        {status}
      </p>
    </>
  );
}
