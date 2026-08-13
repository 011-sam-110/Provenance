"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

// MapLibre + the TLE propagator are the heaviest things on this page, so the globe
// is never part of the first paint. The headline renders on the bone ground
// immediately; the aperture is a dark, correctly-sized hole until the browser is
// idle, then the real engine mounts into it. Nothing reflows when it arrives.
const HeroGlobe = dynamic(() => import("./HeroGlobe"), { ssr: false });

export default function Aperture() {
  const [mount, setMount] = useState(false);

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

  return (
    <div className="pv-aperture">
      {/* The dark field must exist BEFORE the engine does. Without this the hero
          shows a blank bone rectangle where the globe belongs until MapLibre has
          loaded — most visible on mobile, where the aperture sits below the copy
          and the reader reaches it long before idle-mount has finished. Same
          class, same mask, so nothing shifts when the real one replaces it. */}
      {mount ? <HeroGlobe /> : <div className="pv-aperture-vis" aria-hidden="true" />}
    </div>
  );
}
