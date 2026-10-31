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
//   motion=fly      start gliding straight ahead along the heading, 220 m, then stop.
//   record=1        for a recording: the film's own frame (EyeFilmFrame.tsx), no buttons,
//                   the clock to the minute, and on a 9:16 screen every word kept out of
//                   the bands Instagram covers.
//   clock=manual    the move waits for window.__eye.step(ms) instead of the screen's
//                   frames, so scripts/eye-record.mjs films it frame by frame. The
//                   view then runs on the film's clock (lib/eye/motion.ts, filmClock):
//                   the HUD's time and every age move only with the film's steps, no
//                   feed is fetched again during the film, the cards' clips step with
//                   it, and no card plays a stream. It draws the film's frame too.
// With reduced motion asked for, no move runs and "Auto-turn" is not offered.
//
// PREVIEWS. The "Camera previews" switch in the sidebar is on by default. Off, a camera is a
// small icon that fetches no picture, and a tap opens that one camera's card (EyeOverlay,
// cameraIcon.ts). The choice is kept in this browser as { previews: boolean } under
// tn.eye.v1 (lib/eye/previews.ts), read after mount and saved at each switch; it is not
// in a link and not synced to an account. A recording (record=1) or a film
// (clock=manual) ignores it: previews are on, and the switch is not offered.
//
// SOURCES. The Sources tray (EyeSources.tsx) switches this view's own seven kinds on and
// off (cameras of both kinds, vessels, aircraft, TfL's works, incidents and closures) and
// switches the console's other layers ON, which WorldMap draws and a paint pass here lays
// flat (lib/eye/look.ts). What is on and what is pinned to the sidebar is remembered in this
// browser (tn.eye.sources.v1, lib/eye/sources.ts), apart from the console's boards;
// record=1 and clock=manual ignore it. This page never starts the console's variant spine
// or hydrates its inspector store, so nothing here reaches tn.variant.v1 or tn.inspector.v1.

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type maplibregl from "maplibre-gl";
import { mapViewStore } from "@/lib/mapView";
import { ACTIVE_LAYERS, layersStore, type LayerKey } from "@/lib/layers";
import { signalsStore } from "@/lib/signals/store";
import { BUILDING_LAYER } from "@/lib/map/buildings";
import { consoleHref, hasSavedBoard, parseEyeLink, type EyeTarget, type EyeView } from "@/lib/eye/places";
import { PERSIST_KEY as BOARD_KEY } from "@/lib/variants/store";
import MapBoundary from "@/components/map/MapBoundary";
import MapFallback from "@/components/map/MapFallback";
import { useWebGL } from "@/components/map/useWebGL";
import { EYE_LIGHT, EYE_SIGNAL_SINK, eyePaintOps, eyeSignalPaintOps } from "@/lib/eye/look";
import { inLondon } from "@/lib/eye/streets";
import {
  EYE_SOURCES_KEY,
  EYE_SOURCES_VERSION,
  consoleOn,
  defaultSources,
  hiddenKinds,
  sourcesReducer,
  type EyeSourceRow,
  type SourcesState,
} from "@/lib/eye/sources";
import {
  filmClock,
  flyAheadOf,
  flyArrived,
  parseMotion,
  stepFly,
  stepOrbit,
  wallClock,
  type EyeMotion,
  type EyePose,
} from "@/lib/eye/motion";
import { markResults, type SearchResult } from "@/lib/eye/search";
import {
  EYE_PREFS_KEY,
  EYE_PREFS_VERSION,
  previewsInEffect,
  readEyePrefs,
  type EyePrefs,
} from "@/lib/eye/previews";
import { creditsFromAttribution, fmtSpot } from "@/lib/eye/wording";
import { loadPersisted, savePersisted } from "@/lib/shell/persist";
import { clipsSettled, stepClips } from "./cameraCard";
import EyeFilmFrame from "./EyeFilmFrame";
import EyeHud from "./EyeHud";
import EyeOverlay, { type OpenMark, type OverlayReport } from "./EyeOverlay";
import { useSpotName } from "./useSpotName";
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
  // The console's layers, laid flat for a tilted scene (lib/eye/look.ts): WorldMap's own
  // signal layers exist by now, switched on or not.
  for (const op of eyeSignalPaintOps()) {
    if (!map.getLayer(op.layer)) continue;
    if (op.kind === "paint") map.setPaintProperty(op.layer, op.property, op.value as never);
    else map.setLayoutProperty(op.layer, op.property, op.value as never);
  }
  if (map.getLayer(BUILDING_LAYER)) {
    for (const id of EYE_SIGNAL_SINK) if (map.getLayer(id)) map.moveLayer(id, BUILDING_LAYER);
  }
  map.setLight(EYE_LIGHT);
}

function titleFor(target: EyeTarget, cameraName?: string, spotName?: string | null): { title: string; area?: string } {
  if (target.kind === "place") return { title: target.place.name, area: target.place.area };
  if (target.kind === "camera") return { title: cameraName ?? "Road camera", area: cameraName ? "Road camera" : undefined };
  const spot = fmtSpot(target.view.lat, target.view.lon);
  return spotName ? { title: spotName, area: spot } : { title: spot };
}

interface Flags {
  overlay: boolean;
  record: boolean;
  manualClock: boolean;
  /** False when reduced motion is asked for: no move, no "Auto-turn". */
  canMove: boolean;
  /** The move the link asked for, if any. */
  motion: EyeMotion | null;
}

/** What the record script drives: one step of the move, then wait for the drawn frame. */
interface EyeDriver {
  step(ms: number): void;
  idle(): Promise<void>;
}

/** window.__eye under clock=manual: the driver, and the film's time for checks. */
interface EyeHandle extends EyeDriver {
  now(): number;
}

export default function EyeApp({
  sources,
  leftOut,
}: {
  /** The rows of the Sources tray (lib/eye/sourceRows.ts, built on the server). */
  sources: EyeSourceRow[];
  /** How many of the rail's rows this view leaves out, by reason. */
  leftOut: { country: number; widget: number };
}) {
  // With no WebGL the map cannot start: show the fallback instead (lib/map/webgl.ts).
  const gl = useWebGL();
  const [target, setTarget] = useState<EyeTarget | null>(null);
  const [portrait, setPortrait] = useState(false);
  const [flags, setFlags] = useState<Flags>({ overlay: true, record: false, manualClock: false, canMove: false, motion: null });
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const [styleEpoch, setStyleEpoch] = useState(0);
  const [report, setReport] = useState<OverlayReport>({ rows: [], ready: false, counts: {} });
  // What is switched on and pinned. Read from this browser's storage once the link is read
  // (never for a recording or a film), and saved when it changes.
  const [picks, dispatch] = useReducer(sourcesReducer, undefined, defaultSources);
  const [restored, setRestored] = useState(false);
  const [motion, setMotion] = useState<EyeMotion | null>(null);
  const [credits, setCredits] = useState<string[]>([]);
  // Camera pictures on (the default) or off: icons instead (EyeOverlay).
  const [previews, setPreviews] = useState(true);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const placeRef = useRef<(() => void) | null>(null);
  // A details panel (a vessel, an aircraft, a road notice) is open: the control hint steps
  // aside, and the sidebar's row that brings it back closes the panel (EyeHud, EyeOverlay).
  const [detailOpen, setDetailOpen] = useState(false);
  const detailCloseRef = useRef<(() => void) | null>(null);
  // Open a camera's card or a vessel's panel, for the search.
  const markRef = useRef<OpenMark | null>(null);
  // The film's clock under clock=manual, made when the link is read; else the wall clock.
  const film = useMemo(() => (flags.manualClock ? filmClock(Date.now()) : null), [flags.manualClock]);
  const clock = film ?? wallClock;

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
    const record = params.get("record") === "1";
    const manualClock = params.get("clock") === "manual";
    // The remembered choice, unless a recording or a film is asked for.
    const stored = readEyePrefs(loadPersisted<EyePrefs>(EYE_PREFS_KEY, EYE_PREFS_VERSION)).previews;
    setPreviews(previewsInEffect(stored, { record, film: manualClock }));
    setFlags({
      overlay: params.get("overlay") !== "0",
      record,
      manualClock,
      canMove,
      motion: canMove ? parseMotion(params.get("motion")) : null,
    });
    setTarget(parseEyeLink(params, tall));
    // A recording or a film is a frame, not a tool: it shows the defaults and saves nothing.
    if (!record && !manualClock) {
      dispatch({
        type: "load",
        saved: loadPersisted<unknown>(EYE_SOURCES_KEY, EYE_SOURCES_VERSION),
        rowIds: sources.map((r) => r.id),
      });
      setRestored(true);
    }
    // Read once, at mount; the rows are the same for the life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Saved on change: not when it was only read, so a first visit stores nothing.
  const savedFrom = useRef<SourcesState | null>(null);
  useEffect(() => {
    if (!restored) return;
    if (savedFrom.current === null) {
      savedFrom.current = picks;
      return;
    }
    if (picks === savedFrom.current) return;
    savePersisted(EYE_SOURCES_KEY, EYE_SOURCES_VERSION, picks);
  }, [picks, restored]);

  // The console's layers that are on draw through WorldMap, in this tab only: the stores
  // below are the ones the console's map reads, and neither the variant spine nor the
  // inspector's hydrate runs on this page, so nothing here reaches the saved board.
  const consoleRows = useMemo(() => sources.filter((r) => !r.own), [sources]);
  useEffect(() => {
    const on = new Set(consoleOn(picks));
    for (const r of consoleRows) {
      if (r.layer) layersStore.set(r.id as LayerKey, on.has(r.id));
      else signalsStore.set(r.id, on.has(r.id));
    }
  }, [picks, consoleRows]);

  // What the scene is told: the kinds of its own that are hidden, and the console rows on.
  // Both keep their identity until the choice changes, so the overlay's effect runs then.
  const { ownOff, consoleOn: onIds } = picks;
  const hidden = useMemo(() => hiddenKinds({ ownOff, consoleOn: [], pins: [] }), [ownOff]);
  const signals = useMemo(() => onIds.flatMap((id) => consoleRows.filter((r) => r.id === id)), [onIds, consoleRows]);
  // Every credit the map holds, then each switched-on console layer's own, each once.
  const allCredits = useMemo(() => {
    const out = [...credits];
    for (const r of signals) if (r.credit && !out.includes(r.credit)) out.push(r.credit);
    return out;
  }, [credits, signals]);

  // The console's right-click "Add pin here" menu belongs to the console. Caught on
  // the way down, so it never reaches the map.
  const rootRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const stop = (e: Event) => {
      // The search box keeps the browser's own menu: paste is on it.
      if ((e.target as Element | null)?.closest?.("[data-eye-search]")) return;
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
    if (!map || !film) return;
    const w = window as unknown as { __eye?: EyeHandle };
    // The film's time moves first, so the placement and the ages read the new time. The
    // clips step with the film whether or not the move still runs (a fly arrives before
    // the film ends), and each frame waits for their new pictures too.
    w.__eye = {
      step: (ms) => {
        film.step(ms);
        driverRef.current?.step(ms);
        stepClips(ms);
      },
      idle: () => Promise.all([idleOf(map), clipsSettled()]).then(() => undefined),
      now: () => film.now(),
    };
    return () => {
      delete w.__eye;
    };
  }, [map, film]);

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

  const togglePreviews = useCallback(() => {
    const next = !previews;
    setPreviews(next);
    savePersisted<EyePrefs>(EYE_PREFS_KEY, EYE_PREFS_VERSION, { previews: next });
  }, [previews]);

  // The console at the spot on screen, read when "Exit to dashboard" is used. A browser with
  // no saved console board also gets this view's layers and ground, so the console does not
  // open empty; one with a board keeps its own (lib/eye/places.ts). The way back in is the person
  // on the console's map.
  const getDashboardHref = useCallback(() => {
    let storage: Storage | undefined;
    try {
      storage = window.localStorage;
    } catch {
      storage = undefined;
    }
    const m = mapRef.current;
    const c = m?.getCenter();
    const live: EyeView =
      m && c
        ? { lat: c.lat, lon: c.lng, zoom: m.getZoom(), tilt: m.getPitch(), heading: m.getBearing() }
        : target?.view ?? { lat: 0, lon: 0, zoom: 2, tilt: 0, heading: 0 };
    return consoleHref(live, {
      sources: false,
      scene: !hasSavedBoard(storage, BOARD_KEY),
    });
  }, [target]);

  // What the search can find: what the scene holds now and is drawing.
  const { cameras: reportedCameras, vessels: reportedVessels } = report;
  const marks = useMemo(
    () =>
      markResults(
        (reportedCameras ?? []).filter((c) => c.available && !hidden.has(c.live ? "livecams" : "staticcams")),
        hidden.has("ships") ? [] : reportedVessels ?? [],
      ),
    [reportedCameras, reportedVessels, hidden],
  );

  // A camera or a vessel was picked. The move ends with the mark where its card or panel can
  // be seen: a vessel in the middle of the view, a camera low in it, because its card stands
  // above it on a stalk. flyTo honours reduced motion by itself and jumps.
  const flyToMark = useCallback((r: Extract<SearchResult, { kind: "camera" | "vessel" }>) => {
    const m = mapRef.current;
    if (!m) return;
    setMotion(null);
    const h = m.getContainer().clientHeight;
    const anchorY = r.kind === "camera" ? (h < 500 ? h - 90 : h * 0.68) : h / 2;
    m.once("moveend", () => markRef.current?.(r.kind, r.id));
    m.flyTo({ center: [r.lon, r.lat], zoom: Math.max(m.getZoom(), 15.5), offset: [0, anchorY - h / 2] });
  }, []);

  const spotName = useSpotName(target, flags.manualClock || flags.record);
  const words = target ? titleFor(target, report.cameraName, spotName) : null;
  // For scripts and tests: the scene is drawn and, with the overlay on, placed.
  const state = gl === false ? "no-webgl" : map && (!flags.overlay || report.ready) ? "ready" : "loading";

  return (
    <main
      ref={rootRef}
      className={styles.root}
      data-eye-state={state}
      data-overlay={flags.overlay || undefined}
      data-record={flags.record || undefined}
      data-previews={previews ? undefined : "off"}
      data-credits={(flags.overlay && credits.length > 0) || undefined}
    >
      <div className={styles.map}>
        {openAt && gl && (
          <MapBoundary fallback={<MapFallback tone="dark" place={words?.title} />}>
            {/* No Marks key: this view lists its sources in its own tray. */}
            <WorldMap openAt={openAt} onStyleReady={onStyleReady} legend={false} />
          </MapBoundary>
        )}
      </div>
      {gl === false && <MapFallback tone="dark" place={words?.title} />}
      {gl !== false && target && map && flags.overlay && (
        <EyeOverlay
          map={map}
          styleEpoch={styleEpoch}
          target={target}
          portrait={portrait}
          record={flags.record}
          clock={clock}
          previews={previews}
          hidden={hidden}
          signals={signals}
          onReport={setReport}
          placeRef={placeRef}
          onDetail={setDetailOpen}
          detailCloseRef={detailCloseRef}
          markRef={markRef}
        />
      )}
      {gl !== false && target && words && flags.overlay &&
        (flags.record || flags.manualClock ? (
          // A recording or a film is a frame, not a tool.
          <EyeFilmFrame
            map={map}
            start={target.view}
            title={words.title}
            area={words.area}
            rows={report.rows}
            refreshedAt={report.refreshedAt}
            phoneNote={report.phoneNote}
            credits={allCredits}
            record={flags.record}
            clock={clock}
          />
        ) : (
          <EyeHud
            map={map}
            start={target.view}
            title={words.title}
            area={words.area}
            rows={report.rows}
            refreshedAt={report.refreshedAt}
            credits={allCredits}
            getDashboardHref={getDashboardHref}
            sourceRows={sources}
            leftOut={leftOut}
            sources={picks}
            dispatch={dispatch}
            london={inLondon(target.view.lat, target.view.lon)}
            portrait={portrait}
            clock={clock}
            previews={previews}
            onTogglePreviews={togglePreviews}
            canTurn={flags.canMove}
            turning={motion === "orbit"}
            onToggleTurn={() => setMotion((m) => (m === "orbit" ? null : "orbit"))}
            marks={marks}
            onPickMark={flyToMark}
            detailOpen={detailOpen}
            onCloseDetail={() => detailCloseRef.current?.()}
            onFrameChange={() => placeRef.current?.()}
          />
        ))}
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
