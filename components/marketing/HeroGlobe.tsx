"use client";

import { useEffect, useRef } from "react";
import maplibregl, { type Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { DARK_STYLE_URL, DARK_FALLBACK_STYLE } from "@/lib/basemaps";
import { classifyMapError } from "@/lib/map/resilience";
import { buildSatrec, propagateAt } from "@/lib/satellites/propagate";
import { classifySatellite } from "@/lib/satellites/classify";
import { setHeroView } from "@/lib/marketing/heroView";

/**
 * The hero globe: the product's own MapLibre engine, its own registry, and its own
 * live layers — not a video of them, and not a curated highlight reel.
 *
 * This deliberately breaks the "the landing page must not load MapLibre" rule the
 * design brief started with. The trade was made on purpose — a real, rotating,
 * live-data globe is a far better argument than a rendered clip, and it makes the
 * closing line ("everything above was this") literally true. It is paid for by
 * mounting after the first paint (see GlobeStage.tsx), so the headline still paints on
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

/**
 * The handle the page gets on the engine.
 *
 * WHY A CONTROL SURFACE RATHER THAN PROPS. The globe is no longer hero furniture — it is
 * the backdrop for the whole document, and the page turns it to whatever place the section
 * under the reader is about. Driving that through props would mean a prop change per scroll
 * step, and `CLAUDE.md` forbids React state per frame on this page. So the page takes this
 * handle once, on mount, and drives the camera imperatively from its own rAF loop.
 *
 * `stopSpin` before any `focus`, always: the ambient drift chains itself on `moveend`, so a
 * camera move issued while the drift is armed is immediately overwritten by the next leg.
 */
export interface GlobeControls {
  /**
   * Turn the globe to a place, hold it there, and drop a labelled pin on it.
   *
   * The pin is a real MapLibre marker rather than something drawn over the canvas, so
   * it is projected by the same camera as the geometry underneath it and MapLibre hides
   * it on its own when the place rotates round the far side of the sphere. A pin painted
   * in screen space would go on pointing at a country that is no longer facing you.
   */
  focus(lon: number, lat: number, label: string, durationMs?: number): void;
  /** Stop the globe moving, and take the pin off. */
  rest(): void;
}

export default function HeroGlobe({
  layers,
  satColor,
  coverage,
  coverageMax,
  ambientDrift = true,
  onStatus,
  onReady,
  onControls,
}: {
  layers: HeroLayer[];
  /** The catalog's own colour for the satellite layer, so the hero's key cannot
      disagree with what is painted. */
  satColor: string;
  /**
   * ISO-2 → how many signal layers place at least one feature in that country, from the
   * committed coverage audit. Paints the land, so the globe IS the Coverage section's
   * evidence rather than an illustration sitting near it. Omit for an unshaded globe.
   */
  coverage?: Record<string, number>;
  /** The top of the shading ramp, so it is anchored to a real maximum rather than to 100. */
  coverageMax?: number;
  /**
   * Whether the globe turns on its own when nothing is driving it. Default true, which is
   * what every caller before the landing-page rebuild expected. The landing page passes
   * false: its globe is a full-page backdrop, so the off-screen gate that used to pay for
   * the drift can never fire, and a backdrop that turns for the length of a long document
   * is a re-render per frame nobody is watching.
   */
  ambientDrift?: boolean;
  onStatus?: (line: string) => void;
  /** Fired once the engine has actually PAINTED, which is what the hero's globe
      entrance is keyed to. Mount is far too early — the box is still empty. */
  onReady?: () => void;
  /** Handed the camera controls on mount, and `null` on teardown. */
  onControls?: (controls: GlobeControls | null) => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  // Both props are re-created on the parent's every render; reading them through
  // refs keeps the map effect's dependency list empty, so a status update can never
  // tear down and rebuild the engine underneath it.
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const satColorRef = useRef(satColor);
  satColorRef.current = satColor;
  const coverageRef = useRef(coverage);
  coverageRef.current = coverage;
  const coverageMaxRef = useRef(coverageMax);
  coverageMaxRef.current = coverageMax;
  const controlsRef = useRef(onControls);
  controlsRef.current = onControls;
  const ambientRef = useRef(ambientDrift);
  ambientRef.current = ambientDrift;

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
      // DARK_STYLE_URL by name, not BASEMAPS.dark. Dark is no longer a registry entry —
      // it left with the console's dark skin — but this hero is a night stage and
      // the style itself is still exported for exactly this caller.
      style: DARK_STYLE_URL,
      // MapLibre v5 moved this under canvasContextAttributes (it was a top-level
      // MapOptions field in v4).
      canvasContextAttributes: {
        preserveDrawingBuffer: capture,
        // MSAA off. On a sphere seen from orbit the only geometry with visible edges
        // is the coastline, and it is already antialiased by the tile raster; paying
        // for multisampling on every fragment buys nothing here and is charged on
        // every frame of a rotation that now never stops.
        antialias: false,
      },
      // NO TILE CROSSFADE. MapLibre fades tiles and labels in over 300ms by default,
      // which means a moving camera keeps TWO versions of a tile alive and composites
      // between them for the whole fade. On a globe that is turning continuously this
      // never settles, so the fade is permanent overdraw for an effect nobody can see
      // at this zoom.
      fadeDuration: 0,
      // The hero's camera never leaves its orbit, so there is nothing to refetch when
      // a tile's cache entry expires — and a refetch mid-spin is a stall.
      refreshExpiredTiles: false,
      // Near-equatorial, because only the sphere's upper cap is above the fold:
      // centring further north would put the visible band in the Arctic and hide
      // every populated coastline the data actually sits on.
      center: [8, 8],
      zoom: zoomToFill(el.clientWidth),
      /**
       * RENDER THE GLOBE AT 1.5x, NOT AT THE DISPLAY'S FULL 2x.
       *
       * This is the largest single saving available on a Retina machine and it is
       * invisible to every measurement taken in headless Chromium, which runs at
       * devicePixelRatio 1 — so the profiles in this file UNDERSTATE the hero's real
       * cost on the hardware people actually use. At dpr 2 the globe is rasterised at
       * four times the fragments of those runs, every frame, for the whole of a
       * rotation that no longer stops.
       *
       * 1.5 rather than 1 because the coastline is the one edge on screen with any
       * high-frequency detail, and at 1 it visibly stair-steps against the black.
       * At 1.5 it holds, and the fragment count is 44% of full Retina.
       *
       * NOT applied to the console's map: that one is stationary, is the product
       * rather than a backdrop, and is zoomed into detail where sharpness is the
       * whole point. This is a hero-only trade.
       */
      pixelRatio: Math.min(1.5, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1),
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

    // The star layer behind the globe reads the camera out of this plain store
    // every frame it draws — not React state, per CLAUDE.md's "Shape" rule that
    // nothing but the page's one scroll subscriber may set React state per frame. "move" fires for
    // the spin loop's jumpTo AND for a drag/rotate gesture, so both are covered
    // by one publisher; a first call right away means the sky is right before
    // anything has moved at all.
    const publishHeroView = () => {
      const c = map.getCenter();
      setHeroView({ lngDeg: c.lng, latDeg: c.lat, bearingDeg: map.getBearing(), pitchDeg: map.getPitch() });
    };
    publishHeroView();
    map.on("move", publishHeroView);

    // The three aggregated collections every signal layer drains into.
    const bag: Record<"fills" | "lines" | "points", GeoJSON.Feature[]> = {
      fills: [],
      lines: [],
      points: [],
    };

    // THE FLOOR UNDER A REMOTE STYLE. The basemap is a URL now (see DARK_STYLE_URL for
    // why it stopped being an inline CARTO style), so for the first time the hero can
    // fail on the style document itself. If it does, `style.load` never fires and none
    // of the code below runs: no basemap, and — because every signal layer is added in
    // that handler — no data either. A blank stage under the headline.
    //
    // Swapping to the inline floor re-fires `style.load` on a document that cannot fail,
    // so the layers below get added anyway and the hero keeps its live globe with a plain
    // night ground under it. Reuses classifyMapError rather than reacting to every error
    // event: a raster style 404s tiles constantly at the poles and past maxzoom, and
    // tearing the style down for one missing tile would be its own outage. One shot only
    // — if the floor itself somehow errors, retrying it forever would spin.
    let floored = false;
    map.on("error", (e) => {
      if (disposed || floored) return;
      if (classifyMapError(e) !== "style") return;
      floored = true;
      map.setStyle(DARK_FALLBACK_STYLE);
    });

    map.on("style.load", () => {
      if (disposed) return;
      map.setProjection({ type: "globe" });

      // MUTE THE BASEMAP'S OWN LABELS. The old CARTO style was a RASTER, so its few
      // labels were baked into the tile and there was nothing to switch off. The
      // OpenFreeMap replacement is vector and ships a full label set — country, region,
      // state, city, water — in local scripts. Left on, the hero picks up dense
      // multi-script type across the sphere, competing with the headline sitting on top
      // of it and with the signal dots that are the actual argument. This is a backdrop,
      // not a reference map: the map you can read is one click away.
      //
      // Hiding beats not-adding: the style is fetched whole from a URL we do not own, so
      // there is no build step to strip layers in, and a style edit would have to be
      // re-derived every time upstream changes. Hidden symbol layers also never request
      // their glyphs, so this removes the font fetches too.
      //
      // Only OUR layers are added below, all of them circle/line/fill, so this can never
      // catch one of them — but it runs first regardless, so a symbol layer added later
      // stays visible by construction rather than by luck.
      for (const layer of map.getStyle().layers ?? []) {
        if (layer.type === "symbol") map.setLayoutProperty(layer.id, "visibility", "none");
      }

      /**
       * THE COVERAGE CHOROPLETH — the land, shaded by how many signal layers reach it.
       *
       * Added FIRST, so it sits under every signal layer and can never bury a pin.
       *
       * The polygons are `/geo/countries-110m.geojson`, which is the same 177-polygon file
       * `scripts/country-event-breakdown.mts` runs point-in-polygon against. That is the
       * point: the globe cannot shade a country the audit had no way to place a feature in,
       * so the picture and the table can never disagree. A richer boundary set would draw
       * countries the measurement is silent about — better looking, and a false statement.
       *
       * Two tones, not one ramp. A country with no measured layer is painted in its own
       * "no data" colour rather than at the bottom of the ramp, because "we found nothing
       * here" and "we found one thing here" are different claims and the page's legend
       * names them separately.
       */
      if (coverageRef.current) {
        const shading = coverageRef.current;
        const max = coverageMaxRef.current || Math.max(1, ...Object.values(shading));
        fetch("/geo/countries-110m.geojson", { signal: ac.signal })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
          .then((fc: GeoJSON.FeatureCollection) => {
            if (disposed || !map.getStyle()) return;
            for (const f of fc.features) {
              const iso = String(f.properties?.ISO_A2 ?? "");
              // `?? 0` rather than leaving it absent: a missing property makes the
              // interpolate expression fall back to its own default, which would paint an
              // unmeasured country as if it were the palest measured one.
              f.properties = { ...f.properties, pvLayers: shading[iso] ?? 0 };
            }
            map.addSource("pv-coverage", { type: "geojson", data: fc });
            map.addLayer({
              id: "pv-coverage",
              type: "fill",
              source: "pv-coverage",
              paint: {
                "fill-color": [
                  "case",
                  ["==", ["get", "pvLayers"], 0],
                  "#141f27",
                  [
                    "interpolate",
                    ["linear"],
                    // The audit's distribution is long-tailed — most countries sit in single
                    // digits and one reaches 22 — so a linear ramp would leave almost the
                    // whole map at the dark end. The same 0.6 exponent the legend is drawn to.
                    ["^", ["/", ["to-number", ["get", "pvLayers"]], max], 0.6],
                    0,
                    "#1d3540",
                    1,
                    "#3fb4ce",
                  ],
                ],
                "fill-opacity": 0.55,
                "fill-outline-color": "rgba(5,7,12,0.7)",
              },
            });
          })
          // A globe with no land shading is the honest failure: the basemap, the signal
          // layers and the pins all still draw, and no claim on the page depends on it.
          .catch(() => {});
      }

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
      startSpin();

      // The globe's entrance is keyed to the FIRST PAINTED FRAME, not to the map
      // being finished. Both of the obvious events are wrong here:
      //   `idle` — nothing left in flight, i.e. all 37 feeds home. Measured at 9.1s,
      //     so the globe faded up six seconds after the text had settled.
      //   `load` — style plus the initial raster tiles. Measured at 5.4s on one run
      //     and NEVER on the next, because a single stalled tile request holds it.
      // `render` is the moment MapLibre has actually drawn the sphere, which is
      // what there is to reveal; the data then lands on top of it, which is the
      // order the choreography wants anyway.
      map.once("render", fireReady);
    });

    // ...and a hard backstop. The entrance is part of a timed sequence, so it is
    // not allowed to depend on the network at all: if nothing has rendered by the
    // time the headline has finished, reveal the box regardless. A stage that is
    // still empty is honest — it is black on black — but a globe that stays hidden
    // because one tile hung is not.
    let readyFired = false;
    function fireReady() {
      if (readyFired || disposed) return;
      readyFired = true;
      readyRef.current?.();
    }
    const readyBackstop = setTimeout(fireReady, 1500);

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
        //
        // GATED, and it was not before. Every tick propagates each satellite and
        // calls setData, which forces a full MapLibre re-render — so this timer alone
        // kept the hero repainting twice a second with the page scrolled away, the
        // tab hidden, or reduced motion on. PR #156 gated the spin and the sky on
        // exactly those signals and missed this one, which is why the landing page
        // stayed 18.9% busy under reduced motion where the console reached 3.4%.
        // Settling the spin without this would have left a timer re-rendering the
        // map underneath a globe that had stopped.
        satTimer = setInterval(() => {
          if (paused || offScreen || reduce.matches) return;
          tick();
        }, 2000);
        return built.length;
      } catch {
        /* dormant-safe */
        return 0;
      }
    }

    // THE HERO NO LONGER SETTLES, and the cost of that is known rather than ignored.
    //
    // It used to turn for ~8 seconds and ease to a stop on `lib/map/spin.ts`, whose
    // measurements still stand and are still the honest argument against this: with
    // the globe turning, this page measured 83.1% main-thread busy over a 10 s idle
    // window against 18.9% with motion off, and 46% of the sampled profile was
    // MapLibre rendering this globe. That module also records the thing that does NOT
    // help — slowing the spin down. Rate-limited to 30fps it measured 99.4% busy; at
    // 20fps, 99.6%. A moving camera re-renders the whole globe however often the
    // centre actually moves, so the cost is the movement itself.
    //
    // It was changed anyway, deliberately: a hero that stops after eight seconds reads
    // as a page that has finished loading and died, and the drift is the thing that
    // says the map is alive. The budget is bought back at the two edges that actually
    // matter instead — `offScreen` (scrolled past, nobody is looking) and
    // `document.hidden` (another tab) — both of which stop it completely.
    //
    // lib/map/spin.ts is deliberately left in place with its measurements intact. It
    // is the record of what this costs, and `tests/unit/console-globe-still.test.ts`
    // still uses it to pin the CONSOLE globe motionless, which is untouched by this.
    /**
     * ── WHY THIS IS AN easeTo AND NOT A PER-FRAME jumpTo ─────────────────────
     *
     * THE SYMPTOM THAT FOUND IT: dragging the globe is smooth, the automatic drift is
     * not. Same camera, same renderer, same frame budget — so the difference cannot be
     * cost, and it is not. It is WHO drives the camera.
     *
     * A drag is interpolated by MapLibre itself, inside its own render loop: one
     * camera update per rendered frame, by construction. The drift used to be driven
     * from OUR requestAnimationFrame, calling `map.jumpTo` once per callback. Those are
     * two independent loops. Ours fires, mutates the camera and returns; MapLibre then
     * schedules its render for the following frame. The two beat against each other —
     * some rendered frames carry two of our steps, some carry none — and the result is
     * a judder that is not dropped frames and cannot be fixed by making frames cheaper.
     * It is a phase problem, and it looked exactly like a performance problem.
     *
     * `easeTo` with a linear easing hands the interpolation back to MapLibre: it
     * computes the camera for each frame it is ABOUT to draw, so every rendered frame
     * advances by exactly its own elapsed time. That is the same path a drag takes,
     * which is why a drag was always smooth.
     *
     * It is also less work. The old loop ran a rAF callback of our own every frame for
     * the life of the page and fired movestart/moveend on every one of them; this runs
     * one callback per LEG.
     */
    const SPIN_DEG_PER_SEC = 2.1;
    /**
     * How much of the turn each `easeTo` covers.
     *
     * Long enough that the per-leg callback is rare (one every 12s), short enough that
     * a leg in flight when you grab the globe is cheap to abandon. It must NOT be so
     * long that floating-point drift accumulates inside one interpolation.
     */
    const SPIN_LEG_DEG = 25;
    const SPIN_LEG_MS = (SPIN_LEG_DEG / SPIN_DEG_PER_SEC) * 1000;

    /** Linear, so leg boundaries are invisible. Any eased curve would make the globe
     *  pulse once per leg, which is the artefact this whole comment is about. */
    const linear = (t: number) => t;

    function spinLeg() {
      if (disposed || spinStopped || paused || offScreen || reduce.matches) return;
      // NOT LOADED YET IS A WAIT, NOT A REFUSAL — and this is the one difference from
      // the rAF loop that has to be handled explicitly. That loop re-ran every frame,
      // so `!map.loaded()` simply meant "not this frame" and it started on its own as
      // soon as the map was ready. A chain has no such heartbeat: the first call comes
      // from `style.load`, when tiles are still arriving and `loaded()` is false, so
      // returning here would end the chain before it began and the globe would never
      // move at all. (It did exactly that, first try.)
      //
      // `idle` rather than `load`: load fires once and may already have gone by, while
      // idle fires whenever the map next has nothing in flight — which is precisely
      // when starting a drift is cheapest.
      if (!map.loaded()) {
        map.once("idle", spinLeg);
        return;
      }
      const c = map.getCenter();
      map.easeTo({
        center: [c.lng + SPIN_LEG_DEG, c.lat],
        duration: SPIN_LEG_MS,
        easing: linear,
        // Not a user-initiated move: this must never be reported as interaction, and
        // must never be interrupted-and-restored by MapLibre's own gesture bookkeeping.
        animate: true,
        essential: true,
      });
    }

    // Chain the next leg when the last one lands. `moveend` also fires when a drag
    // finishes or when a leg is cut short by one, which is exactly when the drift
    // should be reconsidered — the gates at the top of spinLeg decide whether it may
    // actually resume.
    let spinStopped = false;
    const onMoveEnd = () => { if (!spinStopped) spinLeg(); };
    map.on("moveend", onMoveEnd);

    /**
     * Stop the drift NOW, not at the end of the current leg.
     *
     * `map.stop()` is the load-bearing call. Setting a flag alone would leave the
     * in-flight `easeTo` interpolating for up to a whole leg — so a drag would fight
     * an animation that believed it was still running, and scrolling past would keep
     * re-rendering the globe for another twelve seconds with nobody watching. That
     * second case is the one the offScreen gate exists to prevent and would have
     * silently stopped working.
     */
    function stopSpin() {
      spinStopped = true;
      map.stop();
    }

    // Reduced motion never starts it at all — it is a standing answer, not a state
    // that resumes on its own. `ambientDrift: false` is the same kind of standing answer
    // from the caller: the landing page's globe rests unless a section turns it, so the
    // IntersectionObserver and the motion-preference handler must not be able to start a
    // drift behind its back. Gating it HERE rather than at the call sites means a future
    // caller of startSpin inherits the answer instead of having to remember it.
    function startSpin() {
      if (disposed || reduce.matches || ambientRef.current === false) return;
      spinStopped = false;
      spinLeg();
    }
    const onMotionPreference = () => startSpin();
    reduce.addEventListener("change", onMotionPreference);

    /**
     * Hand the page the camera.
     *
     * `focus` stops the drift BEFORE it eases, and that order is load-bearing: the drift
     * chains itself on `moveend`, so easing first would have the next leg overwrite the
     * move a moment after it landed. `stopSpin` sets `spinStopped`, which is the flag
     * `onMoveEnd` reads, so the chain stays broken until `release` is called.
     *
     * `essential: true` so the move still runs under `prefers-reduced-motion`. Turning the
     * globe to the country a section is about is navigation — it tells the reader where
     * they are — and suppressing it would leave the pin and the label pointing at the
     * wrong place rather than simply not animating. Under reduced motion it jumps rather
     * than eases, which is the same information without the travel.
     *
     * THE AMBIENT DRIFT IS NOT PART OF THIS SURFACE, ON PURPOSE. The globe on the landing
     * page now rests unless a section points it somewhere. It is a backdrop the reader
     * scrolls past, and a backdrop that turns on its own for the whole length of a long
     * document is a MapLibre re-render per frame for an effect nobody is looking at — the
     * exact cost the old `offScreen` gate existed to claw back, which no longer works now
     * that the globe's element is full-page and therefore always intersecting.
     * `startSpin` is still here and still reachable by the motion-preference handler for a
     * caller that wants it; the landing page is not that caller.
     */
    // One marker, reused. Creating a new one per step would remount the element and
    // restart the ring animation from zero every time the reader moved between places.
    const pinEl = document.createElement("div");
    pinEl.className = "pv-pin";
    // The globe is draggable; the pin sits on top of it and must not swallow that.
    pinEl.style.pointerEvents = "none";
    const pinLabel = document.createElement("span");
    pinLabel.className = "pv-pin-label";
    pinEl.innerHTML = '<i class="pv-pin-dot"></i><i class="pv-pin-ring"></i><span class="pv-pin-line"></span>';
    pinEl.appendChild(pinLabel);
    const pin = new maplibregl.Marker({ element: pinEl, anchor: "center" });
    let pinOn = false;

    const controls: GlobeControls = {
      focus(lon, lat, label, durationMs = 1400) {
        if (disposed) return;
        stopSpin();
        pinLabel.textContent = label;
        pin.setLngLat([lon, lat]);
        if (!pinOn) {
          pin.addTo(map);
          pinOn = true;
        }
        map.easeTo({
          center: [lon, lat],
          duration: reduce.matches ? 0 : durationMs,
          essential: true,
        });
      },
      rest() {
        if (disposed) return;
        stopSpin();
        if (pinOn) {
          pin.remove();
          pinOn = false;
        }
      },
    };
    controlsRef.current?.(controls);

    // Scrolled past the hero, a drifting globe is a full MapLibre re-render per frame
    // that nobody can see. Measured on prod at the FOOT of the landing page, before
    // this gate: `calculatePosMatrix` was still 5.2% of main-thread self time with the
    // hero entirely off screen.
    //
    // This is a SEPARATE flag from `paused` on purpose. `paused` is owned by the
    // pointer/drag/visibility handlers, and `release()` resets it to `document.hidden`
    // — so parking the off-screen state in it would let a stray pointerleave restart
    // the drift under a hero that is nowhere near the viewport.
    let offScreen = false;
    const vis = new IntersectionObserver(
      (entries) => {
        for (const e of entries) offScreen = !e.isIntersecting;
        // Acted on, not just recorded. The gate used to be read by a rAF loop that
        // ran every frame anyway; there is no such loop now, so scrolling away has to
        // cancel the leg in flight and scrolling back has to start a new one.
        if (offScreen) stopSpin();
        else startSpin();
      },
      { rootMargin: "100% 0px" },
    );
    vis.observe(el);

    // WHAT STOPS THE DRIFT, AND WHAT DELIBERATELY NO LONGER DOES.
    //
    // Only three things stop it now: a DRAG (you are steering, so the page must not
    // fight you), scrolling PAST the hero (`offScreen` below — nobody can see it),
    // and a hidden tab. Everything else keeps turning.
    //
    // HOVER USED TO STOP IT AND THAT WAS THE BUG. `pointerenter` on this element
    // paused the spin, and this element is the FULL-BLEED hero backdrop — so moving
    // the mouse anywhere across the headline, the lede or the buttons stopped the
    // globe dead. The intent was "hovering to read a label does not fight you", which
    // made sense when the globe was a small plate beside the copy and stopped making
    // sense when it became the whole stage. There are no labels to hover here.
    //
    // After a drag, still hold briefly before resuming: snapping straight back into
    // rotation the instant you let go feels like the page undoing you.
    let resume: ReturnType<typeof setTimeout> | undefined;
    const hold = () => {
      paused = true;
      if (resume) clearTimeout(resume);
      stopSpin();
    };
    const release = (delay: number) => {
      if (resume) clearTimeout(resume);
      resume = setTimeout(() => {
        paused = document.hidden;
        if (!paused) startSpin();
      }, delay);
    };
    const onVis = () => {
      paused = document.hidden;
      if (paused) stopSpin();
      else startSpin();
    };

    // POINTER EVENTS ON THE CANVAS, NOT MapLibre's `dragstart`/`dragend`.
    //
    // Those two never fire here. Instrumented against the running hero, a full
    // press-move-release over the globe emits exactly: `mousedown`, `movestart`,
    // `moveend` — and nothing else. The drag handlers were bound to events this map
    // does not produce, so the "hold still while you steer" behaviour had simply
    // never worked; the globe kept drifting under the cursor mid-drag and fought you.
    //
    // The likely reason is that the spin loop calls `map.jumpTo` on every frame,
    // which is itself a camera move, so the drag never becomes the thing driving the
    // camera in the way the gesture handler reports on. Rather than depend on that
    // staying true, the pause now comes from the pointer directly: pressing is what
    // "you are steering" actually means, and it cannot be masked by our own writes.
    //
    // `pointerdown` on the CANVAS (not the container) so a press on the copy or the
    // buttons floating over the stage is not mistaken for grabbing the globe.
    // `pointerup`/`pointercancel` on the WINDOW, because a drag almost always ends
    // with the cursor somewhere else entirely.
    const onPointerDown = () => hold();
    const onPointerUp = () => release(2500);

    document.addEventListener("visibilitychange", onVis);
    map.getCanvas().addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

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
    // Coalesced to one hit-test per FRAME, not one per pointer event. A mouse
    // delivers moves faster than the compositor paints, and each of these is a
    // queryRenderedFeatures across four layers — the same storm that was taken out of
    // the console's map in #154. Only the newest point matters for a cursor shape, so
    // dropping the intermediate ones changes nothing a user can see.
    let hoverPt: maplibregl.Point | null = null;
    let hoverRaf = 0;
    const runHover = () => {
      hoverRaf = 0;
      if (disposed || !hoverPt) return;
      const hits = map.queryRenderedFeatures(hoverPt, {
        layers: DATA_LAYERS.filter((id) => map.getLayer(id)),
      });
      map.getCanvas().style.cursor = hits.length ? "pointer" : touch ? "" : "grab";
    };
    map.on("mousemove", (e) => {
      hoverPt = e.point;
      if (!hoverRaf) hoverRaf = window.requestAnimationFrame(runHover);
    });

    return () => {
      disposed = true;
      // Hand the handle back before anything is torn down, so a director still holding it
      // cannot call `focus` on a map that is mid-removal.
      controlsRef.current?.(null);
      pin.remove();
      ac.abort();
      refit.disconnect();
      clearTimeout(readyBackstop);
      if (satTimer) clearInterval(satTimer);
      if (resume) clearTimeout(resume);
      // Cancel any leg still interpolating, then unbind the chain that would start
      // another one. Order matters: `map.stop()` fires `moveend`.
      spinStopped = true;
      map.off("moveend", onMoveEnd);
      map.stop();
      if (spin) cancelAnimationFrame(spin);
      if (hoverRaf) cancelAnimationFrame(hoverRaf);
      vis.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      map.getCanvas().removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      reduce.removeEventListener("change", onMotionPreference);
      map.remove();
      mapRef.current = null;
      delete (window as unknown as { __pvMap?: MlMap }).__pvMap;
      setHeroView(null);
    };
  }, []);

  // Just the engine. The legend, the status line and the mandatory credit are the
  // page's furniture, not the globe's, and they live in GlobeStage — which is what
  // lets them sit on the copy's grid instead of floating over a plate.
  return <div ref={holder} className="pv-hero-map" />;
}
