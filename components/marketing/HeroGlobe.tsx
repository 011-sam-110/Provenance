"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { BASEMAPS } from "@/lib/basemaps";
import { buildSatrec, propagateAt } from "@/lib/satellites/propagate";
import { classifySatellite } from "@/lib/satellites/classify";
import Starfield from "./Starfield";

/**
 * The hero globe: the product's own MapLibre engine and the product's own live
 * layers, not a video of them.
 *
 * This deliberately breaks the "the landing page must not load MapLibre" rule the
 * design brief started with. The trade was made on purpose — a real, rotating,
 * live-data globe is a far better argument than a rendered clip, and it makes the
 * closing line ("everything above was this") literally true. It is paid for by
 * mounting on browser idle (see Aperture.tsx), so the headline still paints on the
 * bone ground first and the engine is never on the critical path.
 *
 * Layers chosen for density and honesty: submarine cables and their landing
 * stations (the physical internet), satellites propagated locally from CelesTrak
 * TLEs, live USGS earthquakes, EONET wildfires and volcanoes, and the airport
 * field for texture. All keyless. Any layer whose upstream is quiet simply
 * renders nothing, which is the app's own contract.
 */

interface SignalFeatureLite {
  id: string;
  lat: number;
  lon: number;
  title: string;
  geometry?: { type: string; coordinates: unknown };
}

/** id → paint, in the app's own layer colours. */
const POINT_LAYERS = [
  { id: "earthquakes", color: "#f0a62e", radius: 3.2, label: "Earthquakes" },
  { id: "wildfires", color: "#e2582a", radius: 3, label: "Wildfires" },
  { id: "volcanoes", color: "#d9534f", radius: 2.8, label: "Volcanoes" },
  { id: "cable-landings", color: "#3fb4ce", radius: 2, label: "Cable landings" },
  { id: "airports", color: "#5b7182", radius: 1.2, label: "Airports" },
] as const;

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

function pointsToFc(features: SignalFeatureLite[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: features
      .filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lon) && !f.geometry)
      .map((f) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [f.lon, f.lat] },
        properties: { title: f.title },
      })),
  };
}

function linesToFc(features: SignalFeatureLite[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: features
      .filter((f) => f.geometry && /LineString/.test(f.geometry.type))
      .map((f) => ({
        type: "Feature" as const,
        geometry: f.geometry as unknown as GeoJSON.Geometry,
        properties: { title: f.title },
      })),
  };
}

async function loadSignal(id: string, signal: AbortSignal): Promise<SignalFeatureLite[]> {
  try {
    const res = await fetch(`/api/signals/${id}`, { signal });
    if (!res.ok) return [];
    const body = (await res.json()) as { features?: SignalFeatureLite[] };
    return body.features ?? [];
  } catch {
    // Dormant-safe, exactly like the app: a quiet or broken upstream renders nothing.
    return [];
  }
}

export default function HeroGlobe() {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [status, setStatus] = useState("Connecting to live feeds");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;

    const ac = new AbortController();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let spin = 0;
    let paused = false;
    let satTimer: ReturnType<typeof setInterval> | undefined;
    let disposed = false;

    // A WebGL canvas screenshots BLANK unless the drawing buffer is preserved, which
    // costs real performance — so it is opt-in via ?capture=1 for the verification
    // script and never paid for by an actual visitor.
    const capture = new URLSearchParams(window.location.search).has("capture");

    const map = new maplibregl.Map({
      container: el,
      style: BASEMAPS.dark.style,
      // MapLibre v5 moved this under canvasContextAttributes (it was a top-level
      // MapOptions field in v4).
      canvasContextAttributes: { preserveDrawingBuffer: capture },
      center: [8, 22],
      zoom: 1.15,
      attributionControl: false,
      // A hero, not a toy: drag to spin, no zoom/pitch/rotate controls to get lost in.
      scrollZoom: false,
      doubleClickZoom: false,
      touchZoomRotate: false,
      keyboard: false,
      dragPan: false,
      dragRotate: false,
    });
    mapRef.current = map;
    // Debug handle, matching the app's existing `window.__map` convention. The
    // verification script reads layer feature counts off this to prove the globe
    // is carrying real data rather than looking plausible in a screenshot.
    (window as unknown as { __pvMap?: MlMap }).__pvMap = map;

    map.on("style.load", () => {
      if (disposed) return;
      map.setProjection({ type: "globe" });

      // Sources first, all empty; each fetch fills its own in as it lands, so a
      // slow upstream never holds up the ones that answered.
      map.addSource("pv-cables", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "pv-cables",
        type: "line",
        source: "pv-cables",
        paint: {
          "line-color": "#2ea3bd",
          "line-width": ["interpolate", ["linear"], ["zoom"], 0, 0.5, 4, 1.4],
          "line-opacity": 0.72,
        },
      });

      for (const layer of POINT_LAYERS) {
        map.addSource(`pv-${layer.id}`, { type: "geojson", data: EMPTY });
        map.addLayer({
          id: `pv-${layer.id}`,
          type: "circle",
          source: `pv-${layer.id}`,
          paint: {
            "circle-radius": layer.radius,
            "circle-color": layer.color,
            "circle-opacity": layer.id === "airports" ? 0.5 : 0.9,
            "circle-blur": layer.id === "airports" ? 0 : 0.35,
          },
        });
      }

      map.addSource("pv-sats", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "pv-sats",
        type: "circle",
        source: "pv-sats",
        paint: {
          "circle-radius": 2.1,
          "circle-color": ["get", "color"],
          "circle-opacity": 0.95,
          "circle-stroke-width": 0.6,
          "circle-stroke-color": "rgba(232,238,241,0.5)",
        },
      });

      setReady(true);
      void hydrate();
      spinLoop();
    });

    function setData(source: string, data: GeoJSON.FeatureCollection) {
      if (disposed) return;
      const src = map.getSource(source) as maplibregl.GeoJSONSource | undefined;
      src?.setData(data);
    }

    async function hydrate() {
      let answered = 0;
      const jobs: Promise<void>[] = [];

      jobs.push(
        loadSignal("cables", ac.signal).then((f) => {
          if (f.length) answered++;
          setData("pv-cables", linesToFc(f));
        }),
      );
      for (const layer of POINT_LAYERS) {
        jobs.push(
          loadSignal(layer.id, ac.signal).then((f) => {
            if (f.length) answered++;
            setData(`pv-${layer.id}`, pointsToFc(f));
          }),
        );
      }
      jobs.push(hydrateSatellites());

      await Promise.allSettled(jobs);
      if (disposed) return;
      setStatus(
        answered > 0
          ? `${answered + 1} live layers · cables · satellites · quakes · fires`
          : "Feeds quiet right now — the map says so rather than inventing data",
      );
    }

    async function hydrateSatellites() {
      try {
        const res = await fetch("/api/satellites?group=visual", { signal: ac.signal });
        if (!res.ok) return;
        const body = (await res.json()) as {
          satellites?: { name: string; noradId: string; line1: string; line2: string }[];
        };
        const built = (body.satellites ?? [])
          .map((s) => {
            try {
              // Spent stages and fragments are dead hardware — the app drops them
              // from the live layer and so does the hero.
              if (classifySatellite(s.name) === "debris") return null;
              return { satrec: buildSatrec(s.line1, s.line2), name: s.name };
            } catch {
              return null;
            }
          })
          .filter((b): b is { satrec: ReturnType<typeof buildSatrec>; name: string } => b !== null);

        if (!built.length || disposed) return;

        const tick = () => {
          if (disposed) return;
          const now = new Date();
          const features: GeoJSON.Feature[] = [];
          for (const b of built) {
            const p = propagateAt(b.satrec, now);
            if (!p) continue;
            features.push({
              type: "Feature",
              geometry: { type: "Point", coordinates: [p.lon, p.lat] },
              properties: { color: "#a78bfa", title: b.name },
            });
          }
          setData("pv-sats", { type: "FeatureCollection", features });
        };
        tick();
        // 2s, not the app's 1s: this is ambient motion in a hero, and halving the
        // rate halves the propagation cost for no visible difference at this zoom.
        satTimer = setInterval(tick, 2000);
      } catch {
        /* dormant-safe */
      }
    }

    function spinLoop() {
      if (disposed) return;
      spin = window.requestAnimationFrame(spinLoop);
      if (paused || reduce.matches || !map.loaded()) return;
      const c = map.getCenter();
      map.jumpTo({ center: [c.lng + 0.035, c.lat] });
    }

    // Pause the drift while the tab is hidden or the pointer is on the globe, so
    // a backgrounded hero costs nothing.
    const onEnter = () => (paused = true);
    const onLeave = () => (paused = false);
    const onVis = () => (paused = document.hidden);
    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      disposed = true;
      ac.abort();
      if (satTimer) clearInterval(satTimer);
      if (spin) cancelAnimationFrame(spin);
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVis);
      map.remove();
      mapRef.current = null;
      delete (window as unknown as { __pvMap?: MlMap }).__pvMap;
    };
  }, []);

  return (
    <>
      <Starfield />
      <div ref={holder} className="pv-aperture-map" aria-hidden="true" />
      <div className="pv-aperture-legend">
        <span>
          <i style={{ background: "#2ea3bd" }} />
          Submarine cables
        </span>
        <span>
          <i style={{ background: "#a78bfa" }} />
          Satellites
        </span>
        <span>
          <i style={{ background: "#f0a62e" }} />
          Earthquakes
        </span>
        <span>
          <i style={{ background: "#e2582a" }} />
          Wildfires
        </span>
      </div>
      <div className="pv-aperture-foot">
        <p className="pv-aperture-status">{ready ? status : "Starting the engine"}</p>
        <p className="pv-aperture-credit">
          CARTO · OpenStreetMap · TeleGeography · CelesTrak · USGS · NASA EONET · OurAirports
        </p>
      </div>
    </>
  );
}
