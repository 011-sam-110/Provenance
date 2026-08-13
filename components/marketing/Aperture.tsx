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
      {mount ? (
        <HeroGlobe />
      ) : (
        <p className="pv-aperture-status">Starting the engine</p>
      )}
    </div>
  );
}
