"use client";
// The God's eye view: the console's own map engine, opened tilted over satellite
// imagery with the buildings up, and the view's overlays on top. app/(console)/eye
// renders this and nothing else.
//
// THE PAGE READS ITS LINK AFTER MOUNT, so the route stays static (the rule
// tests/unit/console-static.test.ts holds for every page in app/(console)). Nothing
// renders the map until the link is read: WorldMap reads its stores at construction,
// and the stores below must already say satellite, buildings on, no console layers.
//
// THOSE STORE WRITES STAY IN THIS TAB. The layer toggles persist only through the
// console's own boot (variantStore.bootstrap subscribes the writer, and
// inspectorStore saves only after its hydrate), and neither runs on this page. Every
// way in is a full page load (a plain <a>, never a client-side route), so this page
// always starts from a fresh module state, and leaves the same way.
//
// LINK FLAGS, read with the link:
//   overlay=0       the scene alone: no cards, tags or frame. The clean plate for a
//                   reel, and the bare arm of the frame-time measurement.
//   motion=orbit    start turning about the middle of the view (lib/eye/motion.ts).
//   motion=fly      start gliding toward the place's end point.
//   record=1        for a recording: no buttons, the clock to the minute, and on a
//                   9:16 screen every word kept out of the bands Instagram covers.
//   clock=manual    the move waits for window.__eye.step(ms) instead of the screen's
//                   frames, so scripts/eye-record.mjs films it frame by frame.
// With reduced motion asked for, no move runs and "Turn" is not offered.

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type maplibregl from "maplibre-gl";
import { mapViewStore } from "@/lib/mapView";
import { ACTIVE_LAYERS, layersStore, type LayerKey } from "@/lib/layers";
import { consoleHref, parseEyeLink, type EyeTarget } from "@/lib/eye/places";
import { EYE_LIGHT, eyePaintOps } from "@/lib/eye/look";
import { flyAheadOf, flyArrived, parseMotion, stepFly, stepOrbit, type EyeMotion, type EyePose } from "@/lib/eye/motion";
import { creditsFromAttribution, fmtLat, fmtLon } from "@/lib/eye/wording";
import EyeHud from "./EyeHud";
import EyeOverlay, { type OverlayReport } from "./EyeOverlay";
import styles from "./eye.module.css";

const WorldMap = dynamic(() => import("@/components/WorldMap"), {
  ssr: false,
  loading: () => <div className={styles.loading}>Loading the map</div>,
});

/** The same line the CSS draws between the wide and the phone layouts. */
export const PORTRAIT_QUERY = "(max-aspect-ratio: 4/5)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** The console's own layers. This view draws its own cameras and aircraft instead. */
const CONSOLE_LAYERS: readonly LayerKey[] = [...ACTIVE_LAYERS, "countries"];

/** Repaint the ground and the buildings. Called after WorldMap's own paint, on every style. */
function applyLook(map: maplibregl.Map): void {
  for (const op of eyePaintOps()) {
    if (!map.getLayer(op.layer)) continue;
    map.setPaintProperty(op.layer, op.property, op.value as never);
  }
  map.setLight(EYE_LIGHT);
}

function titleFor(target: EyeTarget, cameraName?: string): { title: string; area?: string } {
  if (target.kind === "place") return { title: target.place.name, area: target.place.area };
  if (target.kind === "camera") return { title: cameraName ?? "Road camera", area: cameraName ? "Road camera" : undefined };
  return { title: `${fmtLat(target.view.lat)}, ${fmtLon(target.view.lon)}` };
}

interface Flags {
  overlay: boolean;
  record: boolean;
  manualClock: boolean;
  /** False when reduced motion is asked for: no move, no "Turn". */
  canMove: boolean;
  /** The move the link asked for, if any. */
  motion: EyeMotion | null;
}

/** What the record script drives: one step of the move, then wait for the drawn frame. */
interface EyeDriver {
  step(ms: number): void;
  idle(): Promise<void>;
}

export default function EyeApp() {
  const [target, setTarget] = useState<EyeTarget | null>(null);
  const [portrait, setPortrait] = useState(false);
  const [flags, setFlags] = useState<Flags>({ overlay: true, record: false, manualClock: false, canMove: false, motion: null });
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const [styleEpoch, setStyleEpoch] = useState(0);
  const [report, setReport] = useState<OverlayReport>({ rows: [], ready: false });
  const [motion, setMotion] = useState<EyeMotion | null>(null);
  const [credits, setCredits] = useState<string[]>([]);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const placeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Before the map exists: WorldMap reads these when it is built.
    mapViewStore.setBasemap("satellite");
    mapViewStore.setTerrain(false);
    mapViewStore.setBuildings(true);
    for (const k of CONSOLE_LAYERS) layersStore.set(k, false);
    const params = new URLSearchParams(window.location.search);
    const tall = window.matchMedia(PORTRAIT_QUERY).matches;
    const canMove = !window.matchMedia(REDUCED_MOTION_QUERY).matches;
    setPortrait(tall);
    setFlags({
      overlay: params.get("overlay") !== "0",
      record: params.get("record") === "1",
      manualClock: params.get("clock") === "manual",
      canMove,
      motion: canMove ? parseMotion(params.get("motion")) : null,
    });
    setTarget(parseEyeLink(params, tall));
  }, []);

  // The console's right-click "Add pin here" menu belongs to the console. Caught on
  // the way down, so it never reaches the map.
  const rootRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const stop = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    el.addEventListener("contextmenu", stop, true);
    return () => el.removeEventListener("contextmenu", stop, true);
  }, []);

  const onStyleReady = useCallback((m: maplibregl.Map) => {
    applyLook(m);
    mapRef.current = m;
    setMap(m);
    setStyleEpoch((n) => n + 1);
  }, []);

  const openAt = useMemo(
    () =>
      target && {
        lat: target.view.lat,
        lon: target.view.lon,
        zoom: target.view.zoom,
        pitch: target.view.tilt,
        bearing: target.view.heading,
      },
    [target],
  );

  // The link's move starts once the map is drawn.
  useEffect(() => {
    if (map && flags.motion) setMotion(flags.motion);
  }, [map, flags.motion]);

  // --- the move --------------------------------------------------------------------
  // One at a time: a new move or a stop replaces the loop through this effect's
  // cleanup. The camera is moved with jumpTo, and the overlay re-places its cards at
  // most once a second while it moves (EyeOverlay), never per frame.
  const poseRef = useRef<EyePose | null>(null);
  const driverRef = useRef<EyeDriver | null>(null);
  useEffect(() => {
    if (!map || !motion || !target) return;
    const c = map.getCenter();
    poseRef.current = { lat: c.lat, lon: c.lng, bearing: map.getBearing() };
    const to = motion === "fly" ? flyAheadOf(poseRef.current) : null;
    let stopped = false;
    const advance = (dtSec: number) => {
      const pose = poseRef.current!;
      const next = motion === "orbit" ? stepOrbit(pose, dtSec) : stepFly(pose, to, dtSec);
      poseRef.current = next;
      map.jumpTo({ center: [next.lon, next.lat], bearing: next.bearing });
      if (motion === "fly" && flyArrived(next, to)) {
        stopped = true;
        setMotion(null);
      }
    };

    if (flags.manualClock) {
      driverRef.current = {
        step(ms: number) {
          if (stopped) return;
          // Many small steps: the move's own clamp would hold one long step to 0.1 s.
          for (let left = ms / 1000; left > 1e-9 && !stopped; left -= 0.05) advance(Math.min(0.05, left));
          placeRef.current?.();
        },
        idle: () => idleOf(map),
      };
      return () => {
        stopped = true;
        driverRef.current = null;
      };
    }

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      if (stopped) return;
      advance((now - last) / 1000);
      last = now;
      if (!stopped) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [map, motion, target, flags.manualClock]);

  // The record script's handle, whether or not a move is running: it waits on idle()
  // before the first frame too.
  useEffect(() => {
    if (!map || !flags.manualClock) return;
    const w = window as unknown as { __eye?: EyeDriver };
    w.__eye = {
      step: (ms) => driverRef.current?.step(ms),
      idle: () => idleOf(map),
    };
    return () => {
      delete w.__eye;
    };
  }, [map, flags.manualClock]);

  // The first touch ends the move: a press, a wheel or a key on the map.
  useEffect(() => {
    if (!map || !motion) return;
    const el = map.getCanvasContainer();
    const stop = () => setMotion(null);
    el.addEventListener("pointerdown", stop, true);
    el.addEventListener("wheel", stop, { capture: true, passive: true });
    el.addEventListener("keydown", stop, true);
    return () => {
      el.removeEventListener("pointerdown", stop, true);
      el.removeEventListener("wheel", stop, true);
      el.removeEventListener("keydown", stop, true);
    };
  }, [map, motion]);

  // --- credits ---------------------------------------------------------------------
  // The same credits MapLibre's own attribution control holds, which it keeps to the
  // sources in use. The frame shows them in full instead of behind the control's
  // info button (the CSS hides that button while the frame is up).
  useEffect(() => {
    if (!map) return;
    const inner = map.getContainer().querySelector(".maplibregl-ctrl-attrib-inner");
    if (!inner) return;
    const read = () => setCredits(creditsFromAttribution(inner.textContent ?? ""));
    read();
    const watch = new MutationObserver(read);
    watch.observe(inner, { childList: true, subtree: true, characterData: true });
    return () => watch.disconnect();
  }, [map]);

  const getBackHref = useCallback(() => {
    const m = mapRef.current;
    if (!m) return consoleHref(target?.view ?? { lat: 0, lon: 0, zoom: 2 });
    const c = m.getCenter();
    return consoleHref({ lat: c.lat, lon: c.lng, zoom: m.getZoom() });
  }, [target]);

  const words = target ? titleFor(target, report.cameraName) : null;
  // For scripts and tests: the scene is drawn and, with the overlay on, placed.
  const state = map && (!flags.overlay || report.ready) ? "ready" : "loading";

  return (
    <main
      ref={rootRef}
      className={styles.root}
      data-eye-state={state}
      data-overlay={flags.overlay || undefined}
      data-record={flags.record || undefined}
      data-credits={(flags.overlay && credits.length > 0) || undefined}
    >
      <div className={styles.map}>{openAt && <WorldMap openAt={openAt} onStyleReady={onStyleReady} />}</div>
      {target && map && flags.overlay && (
        <EyeOverlay
          map={map}
          styleEpoch={styleEpoch}
          target={target}
          portrait={portrait}
          record={flags.record}
          onReport={setReport}
          placeRef={placeRef}
        />
      )}
      {target && words && flags.overlay && (
        <EyeHud
          map={map}
          start={target.view}
          title={words.title}
          area={words.area}
          rows={report.rows}
          refreshedAt={report.refreshedAt}
          phoneNote={report.phoneNote}
          credits={credits}
          getBackHref={getBackHref}
          record={flags.record}
        >
          {flags.canMove && (
            <button
              type="button"
              className={styles.btn}
              aria-pressed={motion === "orbit"}
              onClick={() => setMotion((m) => (m === "orbit" ? null : "orbit"))}
            >
              Turn
            </button>
          )}
        </EyeHud>
      )}
    </main>
  );
}

/** Resolves once the map has drawn everything it was asked for (tiles in, no move). */
function idleOf(map: maplibregl.Map): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    // A tile that never arrives must not hang a recording: ten seconds, then go on.
    const timer = setTimeout(() => {
      map.off("idle", done);
      resolve();
    }, 10_000);
    map.once("idle", done);
    map.triggerRepaint();
  });
}
