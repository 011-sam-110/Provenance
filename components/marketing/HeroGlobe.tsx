"use client";

import { useEffect, useRef } from "react";
import maplibregl, { type Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { BASEMAPS } from "@/lib/basemaps";
import { buildSatrec, propagateAt } from "@/lib/satellites/propagate";
import { classifySatellite } from "@/lib/satellites/classify";

/**
 * The hero globe: the product's own MapLibre engine, its own registry, and its own
 * live layers — not a video of them, and not a curated highlight reel.
 *
 * This deliberately breaks the "the landing page must not load MapLibre" rule the
 * design brief started with. The trade was made on purpose — a real, rotating,
 * live-data globe is a far better argument than a rendered clip, and it makes the
 * closing line ("everything above was this") literally true. It is paid for by
 * mounting on browser idle (see HeroStage.tsx), so the headline still paints on
 * the night stage first and the engine is never on the critical path.
 *
 * EVERY registered signal layer is drawn, not a hand-picked handful. The list
 * arrives as a prop from the server (page.tsx reads `SOURCE_CATALOG`, which is
 * itself computed from `SIGNALS`) rather than being imported here, because
 * importing the registry into a client component would drag all ~39 adapter
 * modules into the browser bundle to read four strings off each of them. Adding an
 * adapter therefore adds a layer to this globe with no edit to this file — the same
 * property the source wall and the ledger further down the page have.
 *
 * RENDERING follows WorldMap exactly: THREE aggregated sources (points, lines,
 * fills) with colour driven off each feature's own props, rather than one source
 * and one layer per signal. Thirty-nine sources and thirty-nine layers would cost
 * a style recompile per feed that lands, on the first screen of the site.
 *
 * FRAMING. The container is a square of the sphere's own diameter, parked by CSS
 * so its centre sits below the fold — so the globe reads as rising into the hero
 * rather than sitting in a box. See `zoomToFill`.
 */

export interface HeroLayer {
  id: string;
  label: string;
  color: string;
}

interface SignalFeatureLite {
  id: string;
  lat: number;
  lon: number;
  title: string;
  color?: string;
  geometry?: { type: string; coordinates: unknown };
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * The zoom at which MapLibre's globe very nearly fills a SQUARE box `px` across.
 *
 * `GLOBE_FIT_PX` is a calibration constant, not a derivation. The tempting
 * derivation — the Mercator world is 512·2^z px wide, so the sphere is that over
 * π — gives 163 and is wrong: MapLibre renders the globe through a perspective
 * camera, so apparent diameter is not linear in 2^z and no closed form survives a
 * range of zooms. What IS stable is that this formula produces the same FILL
 * RATIO at every size, because the container is always square and so the camera's
 * framing never changes. Measured off the painted WebGL buffer:
 *
 *     C = 163  ->  fill 0.779 at 390px, 1440px and 1920px wide
 *     C = 127  ->  fill 0.948 at 390px, 1440px and 1920px wide
 *
 * 127 is deliberately the value that lands just UNDER a perfect fit. Overshooting
 * is not a near miss: the sphere would be clipped by its own box and the limb
 * would come back as a straight vertical edge down the hero, which is far worse
 * than a few pixels of starfield. This only holds while the box is square — if
 * that changes, recalibrate rather than nudging the number.
 *
 * `verify-provenance.mjs` measures the fill ratio, so a MapLibre upgrade that
 * moves it fails the gate instead of quietly reframing the hero.
 */
const GLOBE_FIT_PX = 127;

export function zoomToFill(px: number): number {
  if (!(px > 0)) return 0;
  return Math.log2(px / GLOBE_FIT_PX);
}

/**
 * Dot radius from how many features the layer returned.
 *
 * Derived rather than tabulated per layer, so a new adapter needs no entry here.
 * The dense reference fields (airports, cable landings, weather stations) run to
 * thousands of points and would read as a solid crust at event size; the layers
 * that actually moved today are tens or hundreds and have to stay legible on top
 * of them.
 */
export function radiusForCount(n: number): number {
  if (n > 2000) return 1.1;
  if (n > 600) return 1.6;
  if (n > 150) return 2.2;
  return 3;
}

async function loadSignal(id: string, signal: AbortSignal): Promise<SignalFeatureLite[]> {
  try {
    const res = await fetch(`/api/signals/${id}`, { signal });
    if (!res.ok) return [];
    const body = (await res.json()) as { features?: SignalFeatureLite[] };
    return body.features ?? [];
  } catch {
    // Dormant-safe, exactly like the app: a quiet or broken upstream renders
    // nothing. A key-gated layer with no key lands here and costs one empty set.
    return [];
  }
}

/**
 * Run `jobs` at most `width` at a time.
 *
 * The registry is ~39 layers. Firing all of them at once buries the satellite and
 * coverage requests the rest of the hero needs behind the browser's six-per-origin
 * connection limit, and on a phone it is simply rude. Six at a time keeps the globe
 * filling in steadily from the first second.
 */
async function pool(width: number, jobs: (() => Promise<void>)[]): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(width, jobs.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= jobs.length) return;
      await jobs[i]();
    }
  });
  await Promise.allSettled(runners);
}

export default function HeroGlobe({
  layers,
  satColor,
  onStatus,
}: {
  layers: HeroLayer[];
  /** The catalog's own colour for the satellite layer, so the hero's key cannot
      disagree with what is painted. */
  satColor: string;
  onStatus?: (line: string) => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  // Both props are re-created on the parent's every render; reading them through
  // refs keeps the map effect's dependency list empty, so a status update can never
  // tear down and rebuild the engine underneath it.
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const satColorRef = useRef(satColor);
  satColorRef.current = satColor;

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const say = (line: string) => statusRef.current?.(line);

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

    // Drag-to-spin is a mouse affordance only. On touch, a drag on the globe would
    // swallow the vertical swipe and trap the reader in the hero unable to scroll
    // the page, so coarse pointers get the ambient rotation and nothing else.
    const touch = window.matchMedia("(pointer: coarse)").matches;

    const map = new maplibregl.Map({
      container: el,
      style: BASEMAPS.dark.style,
      // MapLibre v5 moved this under canvasContextAttributes (it was a top-level
      // MapOptions field in v4).
      canvasContextAttributes: { preserveDrawingBuffer: capture },
      // Near-equatorial, because only the sphere's upper cap is above the fold:
      // centring further north would put the visible band in the Arctic and hide
      // every populated coastline the data actually sits on.
      center: [8, 8],
      zoom: zoomToFill(el.clientWidth),
      attributionControl: false,
      // Grab it and spin it — and that is the whole interaction. Zoom is off on
      // every gesture now that the globe is a full-bleed backdrop rather than a
      // framed plate: it fills the viewport behind the headline, so wheel-zoom
      // would stop the page scrolling, and pinch or double-click zoom would leave
      // the composition sitting at an arbitrary scale with no way back. The map
      // that you can actually zoom is one click away, and it is the product.
      dragPan: !touch,
      dragRotate: !touch,
      touchZoomRotate: false,
      doubleClickZoom: false,
      keyboard: true,
      scrollZoom: false,
    });
    mapRef.current = map;
    // Debug handle, matching the app's existing `window.__map` convention. The
    // verification script reads layer feature counts off this to prove the globe
    // is carrying real data rather than looking plausible in a screenshot.
    (window as unknown as { __pvMap?: MlMap }).__pvMap = map;

    // The three aggregated collections every signal layer drains into.
    const bag: Record<"fills" | "lines" | "points", GeoJSON.Feature[]> = {
      fills: [],
      lines: [],
      points: [],
    };

    map.on("style.load", () => {
      if (disposed) return;
      map.setProjection({ type: "globe" });

      // Order matters: areas under lines under points, so a country-sized fill
      // never buries the events sitting inside it.
      map.addSource("pv-fills", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "pv-fills",
        type: "fill",
        source: "pv-fills",
        paint: { "fill-color": ["get", "color"], "fill-opacity": 0.14 },
      });

      map.addSource("pv-lines", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "pv-lines",
        type: "line",
        source: "pv-lines",
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 0, 0.5, 4, 1.4],
          "line-opacity": 0.72,
        },
      });

      map.addSource("pv-points", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "pv-points",
        type: "circle",
        source: "pv-points",
        paint: {
          "circle-radius": ["get", "r"],
          "circle-color": ["get", "color"],
          "circle-opacity": 0.9,
          "circle-blur": 0.3,
        },
      });

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

      void hydrate();
      spinLoop();
    });

    // The globe's on-screen size is a function of zoom alone, so a resized
    // container has to be re-fitted or the sphere stops filling its square —
    // leaving a visible circular edge floating in the hero instead of a horizon.
    const refit = new ResizeObserver(() => {
      if (disposed) return;
      const z = zoomToFill(el.clientWidth);
      if (Number.isFinite(z) && Math.abs(map.getZoom() - z) > 0.01) map.setZoom(z);
    });
    refit.observe(el);

    function flush(kind: "fills" | "lines" | "points") {
      if (disposed) return;
      const src = map.getSource(`pv-${kind}`) as maplibregl.GeoJSONSource | undefined;
      src?.setData({ type: "FeatureCollection", features: bag[kind] });
    }

    /** Split one layer's features across the three aggregated collections. */
    function absorb(layer: HeroLayer, features: SignalFeatureLite[]): number {
      const r = radiusForCount(features.length);
      const touched = new Set<"fills" | "lines" | "points">();
      for (const f of features) {
        const color = f.color || layer.color;
        const g = f.geometry;
        if (g && /LineString/.test(g.type)) {
          bag.lines.push({
            type: "Feature",
            geometry: g as unknown as GeoJSON.Geometry,
            properties: { color, title: f.title },
          });
          touched.add("lines");
        } else if (g && /Polygon/.test(g.type)) {
          bag.fills.push({
            type: "Feature",
            geometry: g as unknown as GeoJSON.Geometry,
            properties: { color, title: f.title },
          });
          touched.add("fills");
        } else if (Number.isFinite(f.lat) && Number.isFinite(f.lon)) {
          bag.points.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: [f.lon, f.lat] },
            properties: { color, title: f.title, r },
          });
          touched.add("points");
        }
      }
      for (const k of touched) flush(k);
      return features.length;
    }

    async function hydrate() {
      const answered: string[] = [];
      say("Connecting to live feeds");

      await pool(
        6,
        layersRef.current.map((layer) => async () => {
          if (disposed) return;
          const features = await loadSignal(layer.id, ac.signal);
          if (disposed || !features.length) return;
          const n = absorb(layer, features);
          if (!n) return;
          answered.push(layer.label.toLowerCase());
          // Every number the rail reads out is the length of what actually came
          // back. A scripted ticker with plausible counts typed into it would be
          // the one fabricated thing on a page arguing that its figures are
          // checkable.
          say(`${layer.label} · ${n.toLocaleString()}`);
        }),
      );

      const sats = await hydrateSatellites();
      if (sats) {
        answered.push("satellites");
        say(`Satellites · ${sats.toLocaleString()} propagated locally (SGP4)`);
      }

      if (disposed) return;
      // A layer that answered with nothing is not counted and not named — the same
      // contract the ledger further down the page holds itself to.
      say(
        answered.length > 0
          ? `${answered.length} live layers · ${bag.points.length.toLocaleString()} features on the globe`
          : "Feeds quiet right now — the map says so rather than inventing data",
      );
    }

    async function hydrateSatellites(): Promise<number> {
      try {
        const res = await fetch("/api/satellites?group=visual", { signal: ac.signal });
        if (!res.ok) return 0;
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

        if (!built.length || disposed) return 0;

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
              properties: { color: satColorRef.current, title: b.name },
            });
          }
          const src = map.getSource("pv-sats") as maplibregl.GeoJSONSource | undefined;
          src?.setData({ type: "FeatureCollection", features });
        };
        tick();
        // 2s, not the app's 1s: this is ambient motion in a hero, and halving the
        // rate halves the propagation cost for no visible difference at this zoom.
        satTimer = setInterval(tick, 2000);
        return built.length;
      } catch {
        /* dormant-safe */
        return 0;
      }
    }

    function spinLoop() {
      if (disposed) return;
      spin = window.requestAnimationFrame(spinLoop);
      if (paused || reduce.matches || !map.loaded()) return;
      const c = map.getCenter();
      map.jumpTo({ center: [c.lng + 0.035, c.lat] });
    }

    // Pause the drift while the tab is hidden or the pointer is on the globe, so a
    // backgrounded hero costs nothing and hovering to read a label does not fight
    // you. After a drag, hold still briefly before resuming — snapping straight
    // back into rotation the instant you let go feels like the page undoing you.
    let resume: ReturnType<typeof setTimeout> | undefined;
    const hold = () => {
      paused = true;
      if (resume) clearTimeout(resume);
    };
    const release = (delay: number) => {
      if (resume) clearTimeout(resume);
      resume = setTimeout(() => (paused = document.hidden), delay);
    };
    const onEnter = () => hold();
    const onLeave = () => release(400);
    const onVis = () => (paused = document.hidden);
    const onDragStart = () => hold();
    const onDragEnd = () => release(2500);

    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", onVis);
    map.on("dragstart", onDragStart);
    map.on("dragend", onDragEnd);

    // Clicking a feature names it in the status rail. The dossier proper lives in
    // the app; here it is just enough to prove the dots are real objects carrying
    // real records, and not decoration.
    const DATA_LAYERS = ["pv-fills", "pv-lines", "pv-points", "pv-sats"];
    map.on("click", (e) => {
      const hits = map.queryRenderedFeatures(e.point, {
        layers: DATA_LAYERS.filter((id) => map.getLayer(id)),
      });
      const title = hits[0]?.properties?.title;
      if (typeof title === "string" && title) say(title);
    });
    map.on("mousemove", (e) => {
      const hits = map.queryRenderedFeatures(e.point, {
        layers: DATA_LAYERS.filter((id) => map.getLayer(id)),
      });
      map.getCanvas().style.cursor = hits.length ? "pointer" : touch ? "" : "grab";
    });

    return () => {
      disposed = true;
      ac.abort();
      refit.disconnect();
      if (satTimer) clearInterval(satTimer);
      if (resume) clearTimeout(resume);
      if (spin) cancelAnimationFrame(spin);
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVis);
      map.remove();
      mapRef.current = null;
      delete (window as unknown as { __pvMap?: MlMap }).__pvMap;
    };
  }, []);

  // Just the engine. The legend, the status line and the mandatory credit are the
  // hero's furniture, not the globe's, and they live in HeroStage — which is what
  // lets them sit on the copy's grid instead of floating over a plate.
  return <div ref={holder} className="pv-hero-map" />;
}
