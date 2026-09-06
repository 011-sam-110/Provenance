"use client";
// "Nearby cameras": an inset map of the neighbours beside a grid of their live frames.
//
// THE MAP IS DEFERRED, AND THAT IS THE WHOLE REASON THIS FILE IS SHAPED LIKE THIS.
// <InsetMap> pulls in maplibre-gl, which is the single largest dependency in the tree.
// ~20k camera pages exist to be found in a search result and read; shipping a WebGL map
// engine to every one of them, above the fold, on a phone, to draw six dots would undo
// the point of the page. So it is loaded through next/dynamic AND held back until the
// section is actually approaching the viewport. A visitor who never scrolls that far
// never downloads it.
//
// The tiles are plain <img> against /api/proxy?id=, the same SSRF-guarded path the main
// frame uses. They are not <CameraImage>: that component re-fetches on the camera's own
// cadence, and six neighbours refreshing on six timers is a lot of requests for a
// thumbnail strip. One frame each, fetched once.

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cameraPath } from "@/lib/seo/paths";
import type { NearbyCamera } from "@/lib/seo/registrySnapshot";

const InsetMap = dynamic(() => import("@/components/InsetMap"), {
  ssr: false,
  loading: () => <div className="tn-nb-map-skeleton" aria-hidden="true" />,
});

/** The camera the page is about. Distinct colour so the reader can find it on the map. */
const SELF_COLOR = "#0e7d97";
const NEIGHBOUR_COLOR = "#15803d";

export function NearbyCameras({
  self,
  nearby,
}: {
  self: { id: string; name: string; lat: number; lon: number };
  nearby: NearbyCamera[];
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [mapWanted, setMapWanted] = useState(false);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || mapWanted) return;
    // No IntersectionObserver (old browser, or a test runner) means show the map rather
    // than hide it — a missing optimisation is better than a missing feature.
    if (typeof IntersectionObserver === "undefined") {
      setMapWanted(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setMapWanted(true);
          io.disconnect();
        }
      },
      // A screen's worth of warning, so the map is drawn by the time it is scrolled to.
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [mapWanted]);

  if (nearby.length === 0) return null;

  const points = [
    { id: self.id, lat: self.lat, lon: self.lon, color: SELF_COLOR },
    ...nearby.map((n) => ({ id: n.id, lat: n.lat, lon: n.lon, color: NEIGHBOUR_COLOR })),
  ];
  const furthest = nearby[nearby.length - 1]?.km;

  return (
    <section className="tn-nb" aria-labelledby="nearby-heading">
      <div className="tn-cd-head">
        <h2 id="nearby-heading">Nearby cameras</h2>
        <span className="tn-cd-meta">
          {nearby.length} within {furthest !== undefined ? `${furthest.toFixed(1)} km` : "reach"}
        </span>
      </div>

      <div className="tn-nb-body">
        <div className="tn-nb-map" ref={boxRef}>
          {mapWanted ? (
            // maxZoom 15, against the shared default of 6. These points are neighbours by
            // construction — the whole set is inside a few km — so the default cap made
            // the fit render a country. 15 stops short of building level, which keeps the
            // surrounding street names on screen and is what makes the map worth having.
            <InsetMap points={points} height={340} selectedId={self.id} maxZoom={15} />
          ) : (
            <div className="tn-nb-map-skeleton" aria-hidden="true" />
          )}
        </div>

        <ul className="tn-nb-tiles">
          {nearby.map((n) => (
            <li key={n.id}>
              <Link href={cameraPath(n.id)}>
                {n.available ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={`/api/proxy?id=${encodeURIComponent(n.id)}`} alt="" loading="lazy" />
                ) : (
                  <span className="tn-nb-dead">not answering</span>
                )}
                <span className="tn-nb-name">{n.name}</span>
                <span className="tn-nb-dim">
                  {n.km.toFixed(2)} km{n.road ? ` · ${n.road}` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
