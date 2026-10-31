"use client";
// The way into God's eye view from the console: a person directly above the map's i, built on the
// behaviour of Google's Pegman (measured 2026-10-31), on our own data and with our own figure. Drag
// him onto the map: he hangs from the pointer, coverage lights up, and a ring under his feet says
// where he would land. Zoomed out, a drop searches a wide radius and opens the best place with
// cameras (lib/eye/coverage.ts), and a marker, a line and a card show that place before the release.
// A click toggles coverage with a legend, and a click on the map then opens the same search's
// result. On the keyboard the ring sits at the map's centre, arrows pan and Enter drops. The rules
// are pure, in lib/console/eyePerson.ts. This file is the pointer and the drawing.
//
// IT LIVES IN MAPLIBRE'S CORNER, NOT BESIDE IT. The corner stacks its controls in the DOM,
// and a position worked out from outside would break the moment that stack changed: the corner
// also holds the credit, and #339 adds a compass, which MapLibre inserts at the corner's top.
// So a slot of ours goes in directly before the credit, whatever the corner holds and in
// whichever order things arrive, and anything added later lands above it. The slot only takes
// up room. The BUTTON is absolute against the corner's own bottom edge (the slot has no
// transform, unlike a `.maplibregl-ctrl`, so the corner is the box it measures from), so:
//   - it does not jump when the credit opens: a credit that wraps grows upward and carries
//     the slot and the compass with it, and the button stays where it was;
//   - it does not cover the credit's words: an open credit keeps the right-hand 34 px or more
//     clear for its i, and the button stays inside that column (EyePerson.module.css).
//
// THE DRAG IS POINTER EVENTS WITH POINTER CAPTURE, and `touch-action: none` on the button, so
// neither the map nor the page moves under it. MapLibre's handlers listen on the canvas
// container, which the button is not inside. While carrying, one requestAnimationFrame at a time
// writes transforms and data attributes straight onto the layer: React renders when a carry starts
// and ends and when the card's contents change, never per frame, and the frames stop when nothing
// is left to draw. The carried figure is in the console's root, not in the corner, because a
// release off the map has to show off the map too.
//
// A DRAG SENDS NO LOCATION. Every search runs on the browser's own copy of the index. The network
// calls are listed in lib/console/eyeCoverageClient.ts, and tests/e2e/eye-person.spec.ts watches
// for any other.
//
// ESCAPE follows the ladder at the top of components/shell/ConsoleSidebar.tsx. While carrying or
// while coverage is on, the focused button carries `data-owns-escape`, and so does the map (focus
// lands on its canvas after a pan), so that handler stands down. This one, also capture phase on
// window, stops the key, so ConsoleShell's ladder does not also clear the map's selection. A carry
// takes the key first, whatever else is open. The toggle takes it only if nothing else has a claim:
// the Controls popover, a panel's tool, a field of its own (the search pill), the phone's sheet and
// a dialog all go first (`toggleTakesEscape`). At rest, Escape on the button still closes an open tool.
//
// A DRAW OR A CAMERA PICK ENDS THE TOGGLE. Both need the clicks on the map that the toggle takes.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CONSOLE_PANEL_ID } from "@/lib/console/consolePanel";
import { useShellLayout } from "@/lib/console/store";
import { pickStore } from "@/lib/console/widgets/camslot.pick";
import {
  DROP_WORDS,
  FALL_MS,
  HOME_MS,
  LEGEND_TITLE,
  MISS_WORDS,
  NO_INDEX_WORDS,
  OFF_MAP_WORDS,
  OPENING_WORDS,
  PERSON_TITLE,
  PREVIEW_MS,
  SETTLE_MS,
  SWING_START,
  TIP_MS,
  cameraCountWords,
  camerasInRing,
  cardPlace,
  dropOutcome,
  edgePan,
  edgePanArea,
  edgePanArmed,
  isDrag,
  legendHint,
  needsMarker,
  personName,
  ringCountWords,
  ringPoint,
  spotAtPoint,
  swingAtRest,
  swingStep,
  targetOnMap,
  visibleMapBox,
  type Box,
  type Point,
  type Swing,
} from "@/lib/console/eyePerson";
import {
  coverageCellsNow,
  coverageIndexNow,
  coverageLoading,
  loadCoverage,
  loadPoints,
  placeNameFor,
} from "@/lib/console/eyeCoverageClient";
import { frameBucket } from "@/lib/cameras/freshness";
import {
  EXACT_FROM_ZOOM,
  POINTS_FROM_ZOOM,
  findDrop,
  pointFeatures,
  snapCoverageBox,
  warmCoverageIndex,
  type CoveragePoint,
  type DropResult,
} from "@/lib/eye/coverage";
import { hideCoverage, showCoverage, type OverlayMap } from "@/lib/map/coverageOverlay";
import { aoiDrawStore } from "@/lib/map/aoi";
import { ATTRIB_CONTROL_CLASS } from "@/lib/map/attribution";
import { getMapInstance } from "@/lib/map/instance";
import { RAIL_NARROW_QUERY, railOpenStore } from "@/lib/rail/railOpen";
import styles from "./EyePerson.module.css";

/** How often to look for the map until it exists. */
const FIND_MAP_MS = 200;
/**
 * How far ahead one edge-pan ease aims, in seconds, and how often a new one starts. Not every frame:
 * MapLibre measures an ease from the moment it starts, so a new one each frame never gets past its
 * first instant, and the map crawled at 27 px/s (measured on the globe, 2026-10-31).
 */
const PAN_LOOK_S = 0.16;
const PAN_REAIM_MS = 96;
/** A speed that has changed this much starts a new ease early, but not more often than this. */
const PAN_CHANGE = 0.15;
const PAN_CHANGE_MS = 48;
/** So MapLibre treats the steps as one move, with one `moveend` when the pan stops. */
const PAN_EASE_ID = "eye-person-edge-pan";
/** One arrow key's pan. */
const ARROW_PX = 120;
/** How long a click on the map that found nothing says so. */
const NOTE_MS = 2400;
/** How long the card holds its name line empty before it shows the region. */
const NAME_WAIT_MS = 600;
/** How long a drop waits for an index still on its way before it opens at the ring. */
const DROP_WAIT_MS = 2000;
/** The carried figure's size, and its middle above the ring (EyePerson.module.css). */
const FIGURE_MIDDLE_ABOVE_RING_PX = 48;

type Phase = "idle" | "carry" | "aim" | "return" | "dropped";

interface Press {
  id: number;
  type: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  carrying: boolean;
}

/** One carry or one keyboard aim: what the frame loop keeps from frame to frame. */
interface Run {
  aim: boolean;
  type: string;
  lastT: number;
  lastX: number;
  lastMoveAt: number;
  swing: Swing;
  shownSwing: number;
  panning: boolean;
  /** He is picked up from the map's corner, in or past the band. It pans only once he is well inside. */
  edgeArmed: boolean;
  panSpeed: Point;
  panAimedAt: number;
  /** The result the marker and the card describe. */
  key: string;
  /** The result the card has been asked to show. */
  previewKey: string;
  marker: boolean;
}

interface Preview {
  key: string;
  name: string | null;
  count: string;
  sub?: string;
  stillId: string;
  stillFailed?: boolean;
}

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const linear = (t: number) => t;

/**
 * Drawn for this control, and not Google's figure: arms at the sides, feet apart. In parts, so the
 * legs can trail the body. Together the parts make the same outline at rest.
 */
function Figure({ size, className }: { size: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true" focusable="false">
      <g className={styles.legs}>
        <path fill="currentColor" d="M9 15.2h2.8V22A1.4 1.4 0 0 1 9 22Z" />
        <path fill="currentColor" d="M12.2 15.2H15V22a1.4 1.4 0 0 1-2.8 0Z" />
      </g>
      <path
        fill="currentColor"
        d="M8.6 9.4h6.8a2.6 2.6 0 0 1 2.6 2.6v3.2a1.2 1.2 0 0 1-2.4 0v-2.6H15V16H9v-3.4h-.6v2.6a1.2 1.2 0 0 1-2.4 0V12a2.6 2.6 0 0 1 2.6-2.6Z"
      />
      <circle cx="12" cy="4.9" r="3.4" fill="currentColor" />
    </svg>
  );
}

/**
 * The slot in the map's bottom-right corner, once the map and its credit exist. The map is
 * loaded lazily and lib/map/instance has no subscribers on purpose, so this looks every so
 * often, stops when it finds them, and looks again if that map is ever removed.
 */
function useCornerSlot(wanted: boolean): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let undo: (() => void) | null = null;
    const look = () => {
      timer = null;
      const map = getMapInstance();
      const credit = map?.getContainer().querySelector(`.maplibregl-ctrl-bottom-right > .${ATTRIB_CONTROL_CLASS}`);
      if (!map || !credit?.parentElement) {
        timer = setTimeout(look, FIND_MAP_MS);
        return;
      }
      const el = document.createElement("div");
      el.className = styles.slot;
      el.setAttribute("data-eye-person-slot", "");
      credit.parentElement.insertBefore(el, credit);
      setSlot(el);
      const onRemove = () => {
        undo?.();
        look();
      };
      map.once("remove", onRemove);
      undo = () => {
        undo = null;
        map.off("remove", onRemove);
        el.remove();
        setSlot(null);
      };
    };
    look();
    return () => {
      if (timer) clearTimeout(timer);
      undo?.();
    };
  }, [wanted]);
  return slot;
}

/** A box to read if the thing is on screen. A closed or hidden element has no size. */
function boxOf(selector: string): Box[] {
  const r = document.querySelector(selector)?.getBoundingClientRect();
  return r && r.width > 0 && r.height > 0 ? [r] : [];
}

/**
 * The part of the map that shows, in window px. Read and not worked out from `--rail-w`: the column
 * and a panel slide over .18 s, and the band has to follow what is on screen during that too.
 */
function visibleMapArea(map: { getContainer(): HTMLElement }): Box {
  const box = map.getContainer().getBoundingClientRect();
  if (window.matchMedia(RAIL_NARROW_QUERY).matches) {
    return visibleMapBox(box, {
      top: [...boxOf('nav[data-rail="console"] [data-rail-menu]'), ...boxOf(".tn-mapsearch-bar")],
      bottom: boxOf(".tn-cw-shell > .tn-rail"),
    });
  }
  return visibleMapBox(box, { left: [...boxOf('nav[data-rail="console"]'), ...boxOf(".tn-cw-shell > .tn-rail")] });
}

/** The ladder in this file's header: may the toggle take this press of Escape? */
function toggleTakesEscape(e: KeyboardEvent, own: readonly (Element | null | undefined)[]): boolean {
  if (e.defaultPrevented) return false;
  const holder = (e.target as Element | null)?.closest?.("[data-owns-escape]");
  if (holder && !own.includes(holder)) return false;
  if (railOpenStore.isSheet("console")) return false;
  const dialogs = document.querySelectorAll('[role="dialog"]');
  return ![...dialogs].some((d) => !d.closest(`#${CONSOLE_PANEL_ID}`));
}

/** The map and a window point in the map's own px, if the point is over the map's canvas. */
function overMap(ring: Point) {
  const map = getMapInstance();
  if (!map) return null;
  // The carried layer takes no pointer, so this is what lies under it. A panel over the map
  // is not the map, and neither is the person's own place.
  const hit = document.elementFromPoint(ring.x, ring.y);
  if (!hit || !map.getCanvasContainer().contains(hit)) return null;
  const box = map.getContainer().getBoundingClientRect();
  return { map, point: { x: ring.x - box.left, y: ring.y - box.top } };
}

export default function EyePerson() {
  const { mode } = useShellLayout();
  const slot = useCornerSlot(mode !== "wall");
  const [phase, setPhaseState] = useState<Phase>("idle");
  const [on, setOnState] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [tip, setTip] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [touch, setTouch] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const cardEl = useRef<HTMLDivElement>(null);
  const plateEl = useRef<HTMLSpanElement>(null);
  const lineEl = useRef<HTMLSpanElement>(null);
  const markerEl = useRef<HTMLSpanElement>(null);
  const swingEl = useRef<HTMLSpanElement>(null);
  const press = useRef<Press | null>(null);
  const run = useRef<Run | null>(null);
  const frame = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  // A press that has already done its job can still end in a click: a drag on some browsers, and
  // a tap always (onPointerUp). A keyboard's click has detail 0 and always counts.
  const swallowClick = useRef(false);
  const phaseRef = useRef<Phase>("idle");
  const onRef = useRef(false);
  const cardSize = useRef({ width: 0, height: 0 });
  const plateSize = useRef({ width: 0, height: 0 });
  const shownPlate = useRef("");
  const points = useRef<{ key: string; list: readonly CoveragePoint[]; data: GeoJSON.FeatureCollection } | null>(null);
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
    return t;
  };

  const setPhase = (next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  };

  const overlayWanted = () => onRef.current || phaseRef.current === "carry" || phaseRef.current === "aim";

  /** The overlay as it should be now: exact points close in, cells wider out, or hidden. */
  const syncOverlay = () => {
    const map = getMapInstance();
    if (!map) return;
    const overlay = map as unknown as OverlayMap;
    if (!overlayWanted()) {
      hideCoverage(overlay);
      return;
    }
    const close = map.getZoom() >= POINTS_FROM_ZOOM && points.current;
    const data = close ? points.current?.data : coverageCellsNow();
    if (data) showCoverage(overlay, data);
  };

  /** One fetch of the exact points in view, at zoom 9 and closer, unless they are held already. */
  const askForPoints = () => {
    const map = getMapInstance();
    if (!map) return;
    if (map.getZoom() < POINTS_FROM_ZOOM) {
      points.current = null;
      return;
    }
    const b = map.getBounds();
    const west = Math.max(-180, b.getWest());
    const east = Math.min(180, b.getEast());
    const south = Math.max(-90, b.getSouth());
    const north = Math.min(90, b.getNorth());
    if (!(west < east) || !(south < north)) return;
    const box = snapCoverageBox([west, south, east, north]);
    const key = box.join(",");
    if (points.current?.key === key) return;
    void loadPoints(box).then((answer) => {
      if (!answer) return;
      points.current = { key, list: answer.points, data: pointFeatures(answer.points) };
      syncOverlay();
    });
  };

  /** The first hover, focus or press: read the index once, and be ready before the first move. */
  const warmUp = () => {
    void loadCoverage().then((index) => {
      const map = getMapInstance();
      if (index && map) warmCoverageIndex(index, map.getZoom());
      syncOverlay();
    });
  };

  const showPlate = (el: HTMLElement, words: string) => {
    if (shownPlate.current === words) return;
    shownPlate.current = words;
    const plate = plateEl.current;
    if (!plate) return;
    plate.textContent = words;
    el.setAttribute("data-plate", words ? "true" : "false");
    // Words change rarely, and the plate's width with them. Read only then, and only once it is
    // shown: a plate that is not drawn measures nothing.
    if (words) plateSize.current = { width: plate.offsetWidth, height: plate.offsetHeight };
  };

  const placePlate = (ring: Point, type: string) => {
    const plate = plateEl.current;
    if (!plate || plateSize.current.width === 0) return;
    const map = getMapInstance();
    if (!map) return;
    const place = cardPlace(ring, plateSize.current, visibleMapArea(map), type);
    plate.style.transform = `translate3d(${place.x}px, ${place.y}px, 0)`;
  };

  const askForPreview = (r: Run, drop: DropResult | null, key: string, inRing: ReturnType<typeof camerasInRing>) => {
    if (r.previewKey === key) return;
    r.previewKey = key;
    if (inRing) {
      setPreview({ key, name: inRing.name, count: ringCountWords(inRing.count), stillId: inRing.stillId });
      return;
    }
    if (drop?.kind !== "snap") {
      setPreview(null);
      return;
    }
    const place = drop.place;
    setPreview({
      key,
      name: place?.area ?? null,
      count: cameraCountWords(drop.cameras),
      sub: place ? `Opens at ${place.name}` : undefined,
      stillId: drop.stillId,
    });
    if (place) return;
    let answered = false;
    void placeNameFor(drop.key, drop.cellSpot, drop.region).then((name) => {
      answered = true;
      setPreview((p) => (p?.key === key ? { ...p, name } : p));
    });
    later(() => {
      if (answered) return;
      setPreview((p) => (p?.key === key && !p.name && drop.region ? { ...p, name: drop.region } : p));
    }, NAME_WAIT_MS);
  };

  /** One frame: the ring, the edge pan, the result, the marker, the swing and the card's place. */
  const tick = (now: number) => {
    frame.current = 0;
    const r = run.current;
    const el = layer.current;
    const map = getMapInstance();
    if (!r || !el || !map) return;
    const box = map.getContainer().getBoundingClientRect();
    const visible = visibleMapArea(map);
    const p = press.current;
    const pointer: Point = r.aim
      ? { x: box.left + box.width / 2, y: box.top + box.height / 2 }
      : { x: p?.x ?? r.lastX, y: p?.y ?? 0 };
    const ring = r.aim ? pointer : ringPoint(pointer.x, pointer.y, r.type);
    const dt = Math.max(1, now - r.lastT);
    r.lastT = now;
    el.style.transform = `translate3d(${ring.x}px, ${ring.y}px, 0)`;

    const over = overMap(ring);
    const spot = over ? spotAtPoint(over.map, over.point.x, over.point.y) : null;

    // The edge pan. Short eases under one id, so MapLibre runs one smooth move and fires one
    // `moveend`. A `jumpTo` per frame would fire one per frame, and the console writes its address
    // and refreshes its thumbnails on each.
    if (!r.aim) {
      const area = edgePanArea(map, box, visible);
      const raw = edgePan(pointer, ring, area.from, area.until);
      const pan = { x: raw.x * area.speed, y: raw.y * area.speed };
      const wants = pan.x !== 0 || pan.y !== 0;
      if (!r.edgeArmed && edgePanArmed(pointer, ring, area)) r.edgeArmed = true;
      if (wants && r.edgeArmed) {
        const since = now - r.panAimedAt;
        const changed = Math.hypot(pan.x - r.panSpeed.x, pan.y - r.panSpeed.y) > PAN_CHANGE * Math.hypot(pan.x, pan.y);
        if (!r.panning || since >= PAN_REAIM_MS || (changed && since >= PAN_CHANGE_MS)) {
          r.panning = true;
          r.panSpeed = pan;
          r.panAimedAt = now;
          map.panBy([pan.x * PAN_LOOK_S, pan.y * PAN_LOOK_S], {
            duration: PAN_LOOK_S * 1000,
            easing: linear,
            easeId: PAN_EASE_ID,
            essential: true,
          });
        }
      } else if (r.panning) {
        r.panning = false;
        r.lastMoveAt = now;
        map.stop();
        askForPoints();
      }
    }

    const zoom = map.getZoom();
    const index = coverageIndexNow();
    const drop = spot ? findDrop(index, zoom, spot) : null;
    const moved = now - r.lastMoveAt;
    const settled = !r.panning && moved >= SETTLE_MS;
    const result = !spot || !drop ? "off" : drop.kind === "miss" ? "miss" : "hit";
    if (el.dataset.result !== result) el.dataset.result = result;
    const ringState = result === "hit" && settled ? "hit" : "moving";
    if (el.dataset.ring !== ringState) el.dataset.ring = ringState;

    // At zoom 12 and closer it opens at the ring, and the only thing to show is a camera in it.
    const inRing =
      over && drop?.kind === "exact" && zoom >= EXACT_FROM_ZOOM && points.current
        ? camerasInRing(over.map, over.point, points.current.list)
        : null;
    const key = inRing ? `ring:${inRing.stillId}:${inRing.count}` : drop?.kind === "snap" ? `cell:${drop.key}:${drop.place?.id ?? ""}` : result;
    if (key !== r.key) {
      r.key = key;
      // The card must not describe a place the marker has left. It comes back once the ring settles.
      if (r.previewKey !== "") {
        r.previewKey = "";
        setPreview(null);
      }
    }

    // The marker and its line, when the result is not under the ring.
    const target = drop?.kind === "snap" ? targetOnMap(map, drop.spot) : null;
    const targetWin = target ? { x: target.x + box.left, y: target.y + box.top } : null;
    const marker = needsMarker(ring, targetWin);
    if (marker !== r.marker) {
      r.marker = marker;
      el.dataset.marker = marker ? "true" : "false";
    }
    if (marker && targetWin) {
      const dx = targetWin.x - ring.x;
      const dy = targetWin.y - ring.y;
      if (markerEl.current) markerEl.current.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      if (lineEl.current) lineEl.current.style.transform = `rotate(${Math.atan2(dy, dx)}rad) scaleX(${Math.hypot(dx, dy)})`;
    }

    // The swing: horizontal speed only, and none for a keyboard's ring or with reduced motion.
    let swinging = false;
    if (!r.aim && !reduced()) {
      const vx = ((pointer.x - r.lastX) / dt) * 1000;
      r.swing = swingStep(r.swing, vx, dt);
      swinging = !swingAtRest(r.swing);
      const angle = swinging ? r.swing.angle : 0;
      if (Math.abs(angle - r.shownSwing) > 0.04 || (!swinging && r.shownSwing !== 0)) {
        r.shownSwing = angle;
        swingEl.current?.style.setProperty("--swing", `${angle.toFixed(2)}deg`);
      }
    }
    r.lastX = pointer.x;

    // The card, about 200 ms after the ring settles.
    const previewDue = !r.panning && moved >= PREVIEW_MS;
    if (previewDue && result !== "off" && result !== "miss") askForPreview(r, drop, key, inRing);
    const cardUp = r.previewKey !== "" && (inRing != null || drop?.kind === "snap");
    if (cardUp && cardEl.current && cardSize.current.width > 0) {
      const place = cardPlace(ring, cardSize.current, visible, r.type);
      cardEl.current.style.transform = `translate3d(${place.x}px, ${place.y}px, 0)`;
      cardEl.current.style.setProperty("--arrow-x", `${place.arrowX}px`);
      if (cardEl.current.dataset.side !== place.side) cardEl.current.dataset.side = place.side;
    }

    // The plate says what the card does not.
    const words =
      result === "off"
        ? OFF_MAP_WORDS
        : result === "miss"
          ? MISS_WORDS
          : cardUp
            ? ""
            : drop?.kind === "exact" && drop.note === "no-index" && !coverageLoading()
              ? NO_INDEX_WORDS
              : DROP_WORDS;
    showPlate(el, words);
    if (words) placePlate(ring, r.type);

    const waiting = moved < PREVIEW_MS + 40;
    if (waiting || r.panning || swinging) schedule();
  };

  const schedule = () => {
    if (!frame.current) frame.current = requestAnimationFrame(tick);
  };

  const beginRun = (aim: boolean, type: string, x: number) => {
    const now = performance.now();
    shownPlate.current = "";
    run.current = {
      aim,
      type,
      lastT: now,
      lastX: x,
      lastMoveAt: now,
      swing: SWING_START,
      shownSwing: 0,
      panning: false,
      edgeArmed: false,
      panSpeed: { x: 0, y: 0 },
      panAimedAt: 0,
      key: "",
      previewKey: "",
      marker: false,
    };
  };

  const endPress = () => {
    const p = press.current;
    press.current = null;
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = 0;
    const r = run.current;
    run.current = null;
    if (r?.panning) getMapInstance()?.stop();
    const b = button.current;
    if (p && b?.hasPointerCapture(p.id)) b.releasePointerCapture(p.id);
  };

  /**
   * He flies home in 500 ms, with no swing and no fall. With reduced motion, he is simply there.
   * Coverage is hidden the moment the carry ends, unless the toggle holds it on.
   */
  const goHome = () => {
    endPress();
    setPreview(null);
    const el = layer.current;
    const b = button.current;
    if (!el || !b || reduced()) {
      setPhase("idle");
      syncOverlay();
      return;
    }
    const box = b.getBoundingClientRect();
    el.setAttribute("data-state", "return");
    swingEl.current?.style.setProperty("--swing", "0deg");
    // The state has to apply before the new transform, or nothing transitions.
    void el.offsetWidth;
    el.style.transform = `translate3d(${box.left + box.width / 2}px, ${box.top + box.height / 2 + FIGURE_MIDDLE_ABOVE_RING_PX}px, 0)`;
    setPhase("return");
    syncOverlay();
    later(() => setPhase("idle"), HOME_MS);
  };

  /** He falls straight down, about 40 px in 300 ms, then the page loads. He does not slide. */
  const fall = (href: string, ring: Point, type: string) => {
    endPress();
    setPreview(null);
    swingEl.current?.style.setProperty("--swing", "0deg");
    if (layer.current) showPlate(layer.current, OPENING_WORDS);
    placePlate(ring, type);
    setPhase("dropped");
    syncOverlay();
    // A full page load, like every way in: /eye sets its own layers in memory, and must start
    // from a fresh module state (EyeApp.tsx).
    later(() => window.location.assign(href), reduced() ? 0 : FALL_MS);
  };

  const release = (x: number, y: number) => {
    const p = press.current;
    if (!p) return;
    p.x = x;
    p.y = y;
    const ring = ringPoint(x, y, p.type);
    const over = overMap(ring);
    const map = over?.map ?? getMapInstance();
    if (!map) {
      goHome();
      return;
    }
    const decide = () => dropOutcome(map, over?.point ?? null, coverageIndexNow());
    // The index is on its way and this zoom needs it: the fall covers the wait, up to a limit.
    if (coverageLoading() && over && map.getZoom() < EXACT_FROM_ZOOM) {
      const started = dropOutcome(map, over.point, null);
      if (started.kind === "open") {
        const timeout = new Promise<null>((resolve) => later(() => resolve(null), DROP_WAIT_MS));
        endPress();
        setPhase("dropped");
        syncOverlay();
        void Promise.race([loadCoverage(), timeout]).then(() => {
          const outcome = decide();
          if (outcome.kind === "open") window.location.assign(outcome.href);
          else setPhase("idle");
        });
        return;
      }
    }
    const outcome = decide();
    if (outcome.kind !== "open") {
      goHome();
      return;
    }
    fall(outcome.href, ring, p.type);
  };

  const stopAim = () => {
    if (phaseRef.current !== "aim") return;
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = 0;
    run.current = null;
    setPreview(null);
    setPhase("idle");
  };

  const startAim = () => {
    const map = getMapInstance();
    if (!map || phaseRef.current !== "idle") return;
    setTouch(false);
    beginRun(true, "mouse", 0);
    setPhase("aim");
  };

  const setCoverage = (next: boolean) => {
    onRef.current = next;
    setOnState(next);
    setNote(null);
    if (!next) stopAim();
    const map = getMapInstance();
    if (next) {
      warmUp();
      askForPoints();
    }
    if (map) {
      if (next) map.getContainer().setAttribute("data-owns-escape", "");
      else map.getContainer().removeAttribute("data-owns-escape");
    }
    syncOverlay();
  };

  /** A click or a tap on the map while coverage is on: the same search, then the same open. */
  const openAtWindowPoint = (x: number, y: number) => {
    const over = overMap({ x, y });
    if (!over) return;
    const outcome = dropOutcome(over.map, over.point, coverageIndexNow());
    if (outcome.kind === "open") {
      setNote(OPENING_WORDS);
      window.location.assign(outcome.href);
      return;
    }
    if (outcome.why === "miss") {
      setNote(MISS_WORDS);
      later(() => setNote(null), NOTE_MS);
      button.current?.focus({ preventScroll: true });
    }
  };

  const dropAtAim = () => {
    const map = getMapInstance();
    if (!map) return;
    const box = map.getContainer().getBoundingClientRect();
    const ring = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const over = overMap(ring);
    const outcome = dropOutcome(map, over?.point ?? null, coverageIndexNow());
    if (outcome.kind !== "open") {
      setNote(outcome.why === "miss" ? MISS_WORDS : OFF_MAP_WORDS);
      later(() => setNote(null), NOTE_MS);
      return;
    }
    fall(outcome.href, ring, "mouse");
  };

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    swallowClick.current = false;
    clearTip();
    if (phaseRef.current === "aim") stopAim();
    if (phaseRef.current !== "idle" || press.current || e.button !== 0 || !e.isPrimary) return;
    warmUp();
    press.current = { id: e.pointerId, type: e.pointerType, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, carrying: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || e.pointerId !== p.id) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (!p.carrying) {
      if (!isDrag(p.x - p.startX, p.y - p.startY, p.type)) return;
      p.carrying = true;
      swallowClick.current = true;
      // Escape lands on the focused element, and the ladder reads the marker from there. Safari
      // does not focus a clicked button. Not on the press itself: at that moment Chrome still
      // counts a script's focus as a keyboard's, and draws the ring on a mouse drag.
      e.currentTarget.focus({ preventScroll: true });
      clearTip();
      beginRun(false, p.type, p.x);
      setPhase("carry");
      // Coverage lights up on the first move, not on the hover and not on the press.
      askForPoints();
      syncOverlay();
      return;
    }
    if (run.current) run.current.lastMoveAt = performance.now();
    schedule();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || e.pointerId !== p.id) return;
    if (p.carrying) {
      release(e.clientX, e.clientY);
      return;
    }
    // A tap acts here and not on the click that follows it, because that click may never come.
    // After a finger lifts at speed, Chrome sends the next tap's pointer and touch events and
    // no click, and it was still sending none 3 s later (measured on Chrome's touch input,
    // 2026-10-31). So a fast flick to cancel would leave the person dead to the next tap.
    setTouch(p.type === "touch");
    endPress();
    swallowClick.current = true;
    setCoverage(!onRef.current);
  };

  // The browser took the pointer away (a system gesture, a lost capture). It was no drop.
  const onPointerLost = (e: React.PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || e.pointerId !== p.id) return;
    if (p.carrying) goHome();
    else endPress();
  };

  // Enter, Space and a screen reader's activation come here, with no pointer before them.
  const onClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (swallowClick.current && e.detail !== 0) {
      swallowClick.current = false;
      return;
    }
    const next = !onRef.current;
    setCoverage(next);
    if (next) startAim();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!onRef.current) return;
    const map = getMapInstance();
    if (!map) return;
    if (e.key === "Enter") {
      // Not a toggle while it is on: Enter drops. Space still turns it off, by the click it makes.
      e.preventDefault();
      if (phaseRef.current === "aim") dropAtAim();
      else startAim();
      return;
    }
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-ARROW_PX, 0],
      ArrowRight: [ARROW_PX, 0],
      ArrowUp: [0, -ARROW_PX],
      ArrowDown: [0, ARROW_PX],
    };
    const by = step[e.key];
    if (!by) return;
    e.preventDefault();
    if (phaseRef.current !== "aim") startAim();
    map.panBy(by, reduced() ? { duration: 0 } : { duration: 180, easing: linear });
  };

  const clearTip = () => {
    if (tipTimer.current) clearTimeout(tipTimer.current);
    tipTimer.current = null;
    setTip(false);
  };

  const askTip = () => {
    if (tipTimer.current) clearTimeout(tipTimer.current);
    tipTimer.current = setTimeout(() => {
      if (phaseRef.current === "idle" && !press.current) setTip(true);
    }, TIP_MS);
  };

  // The layer has just mounted: put it where it belongs before it paints.
  useLayoutEffect(() => {
    if (phase === "carry" || phase === "aim") tick(performance.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // The card's size only changes with its contents, so it is read only then. A picture that fails
  // shrinks it, and the frame loop places it again.
  useLayoutEffect(() => {
    const el = cardEl.current;
    if (el && preview) cardSize.current = { width: el.offsetWidth, height: el.offsetHeight };
    if (run.current) tick(performance.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);

  // A keyboard's ring follows the map, and so does the overlay while the toggle holds it on.
  useEffect(() => {
    const map = getMapInstance();
    if (!map || (!on && phase !== "aim")) return;
    const onMove = () => {
      const r = run.current;
      if (r?.aim) {
        r.lastMoveAt = performance.now();
        schedule();
      }
    };
    const onEnd = () => {
      if (!overlayWanted()) return;
      askForPoints();
      syncOverlay();
    };
    // A basemap swap wipes the source and the layers.
    const onStyle = () => syncOverlay();
    map.on("move", onMove);
    map.on("moveend", onEnd);
    map.on("style.load", onStyle);
    return () => {
      map.off("move", onMove);
      map.off("moveend", onEnd);
      map.off("style.load", onStyle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, phase]);

  // While coverage is on, a click on the map is ours. The window's capture phase runs before
  // MapLibre's listener on the canvas container, so a pin under the click does not also open. A
  // press that moved was a pan, and goes through.
  useEffect(() => {
    if (!on) return;
    const map = getMapInstance();
    if (!map) return;
    const canvas = map.getCanvasContainer();
    let down: Point | null = null;
    const onDown = (e: PointerEvent) => {
      down = canvas.contains(e.target as Node) ? { x: e.clientX, y: e.clientY } : null;
    };
    const onUpClick = (e: MouseEvent) => {
      if (!canvas.contains(e.target as Node)) return;
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      e.stopPropagation();
      e.preventDefault();
      openAtWindowPoint(e.clientX, e.clientY);
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("click", onUpClick, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("click", onUpClick, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);

  // Escape: a carry cancels and flies home, and the toggle turns off.
  useEffect(() => {
    if (phase !== "carry" && !on) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const carrying = phaseRef.current === "carry";
      if (!carrying && !toggleTakesEscape(e, [button.current, getMapInstance()?.getContainer()])) return;
      e.preventDefault();
      e.stopPropagation();
      if (carrying) goHome();
      else setCoverage(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, on]);

  // A draw or a camera pick needs the map's clicks, which the toggle takes.
  useEffect(() => {
    if (!on) return;
    const check = () => {
      if (aoiDrawStore.get().active || pickStore.get().mode === "picking") setCoverage(false);
    };
    check();
    const offDraw = aoiDrawStore.subscribe(check);
    const offPick = pickStore.subscribe(check);
    return () => {
      offDraw();
      offPick();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);

  // The browser's Back button can bring this page back exactly as it was left, mid-drop.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      swallowClick.current = false;
      setNote(null);
      setPreview(null);
      setPhase("idle");
      syncOverlay();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaving the map (a Streets wall) ends everything.
  useEffect(() => {
    if (slot || !onRef.current) return;
    setPreview(null);
    setCoverage(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot]);

  useEffect(
    () => () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      if (tipTimer.current) clearTimeout(tipTimer.current);
      for (const t of timers.current) clearTimeout(t);
    },
    [],
  );

  if (!slot) return null;
  const carried = phase !== "idle";
  const owns = phase === "carry" || on;
  // In the console's root, for its tokens and so nothing in the map can clip it.
  const host = slot.closest<HTMLElement>(".tn-terminal") ?? document.body;
  const mapBox = slot.closest<HTMLElement>(".maplibregl-map");
  const showLegend = on || phase === "carry";
  return (
    <>
      {createPortal(
        <button
          ref={button}
          type="button"
          className={styles.person}
          data-eye-person=""
          data-state={phase}
          data-owns-escape={owns ? "" : undefined}
          aria-label={personName(on)}
          aria-pressed={on}
          onPointerEnter={(e) => {
            warmUp();
            if (e.pointerType === "mouse" && phaseRef.current === "idle") askTip();
          }}
          onPointerLeave={clearTip}
          onFocus={(e) => {
            warmUp();
            if (e.currentTarget.matches(":focus-visible") && phaseRef.current === "idle" && !press.current) askTip();
          }}
          onBlur={() => {
            clearTip();
            stopAim();
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerLost}
          onLostPointerCapture={onPointerLost}
          onClick={onClick}
          onKeyDown={onKeyDown}
          onContextMenu={(e) => {
            if (press.current) e.preventDefault();
          }}
        >
          <Figure size={22} className={styles.figure} />
          {tip && (
            <span className={styles.tip} data-eye-person-tip="" role="tooltip">
              {PERSON_TITLE}
            </span>
          )}
        </button>,
        slot,
      )}
      {mapBox &&
        showLegend &&
        createPortal(
          <div className={styles.legend} data-eye-person-legend="" role="status">
            <span className={styles.legendKey}>
              <i className={styles.legendDot} aria-hidden="true" />
              {LEGEND_TITLE}
            </span>
            {on && <span className={styles.legendHint}>{note ?? legendHint(touch)}</span>}
          </div>,
          mapBox,
        )}
      {carried &&
        createPortal(
          <div
            ref={layer}
            className={styles.layer}
            data-eye-person-layer=""
            data-state={phase}
            data-ring="moving"
            aria-hidden="true"
          >
            <span ref={lineEl} className={styles.line} data-eye-person-line="" />
            <span ref={markerEl} className={styles.marker} data-eye-person-marker="" />
            <span className={styles.fuzz} />
            <span className={styles.dots} data-eye-person-ring="" />
            <span className={styles.hit} data-eye-person-hit="">
              <i />
            </span>
            <span className={styles.carried} data-eye-person-figure="">
              <span ref={swingEl} className={styles.swing} data-eye-person-swing="">
                <Figure size={36} />
              </span>
            </span>
            <span ref={plateEl} className={styles.plate} data-eye-person-label="" />
            {preview && (
              <div ref={cardEl} className={styles.card} data-eye-person-card="" data-side="below">
                {preview.stillId && !preview.stillFailed && (
                  <img
                    className={styles.still}
                    src={`/api/proxy?id=${encodeURIComponent(preview.stillId)}&_=${frameBucket(Date.now(), 300)}`}
                    alt=""
                    decoding="async"
                    data-eye-person-still=""
                    onError={() => setPreview((p) => (p?.key === preview.key ? { ...p, stillFailed: true } : p))}
                  />
                )}
                <span className={styles.words}>
                  <b data-eye-person-name="">{preview.name ?? " "}</b>
                  <span data-eye-person-count="">{preview.count}</span>
                  {preview.sub && <span data-eye-person-sub="">{preview.sub}</span>}
                </span>
                <i className={styles.arrow} aria-hidden="true" />
              </div>
            )}
          </div>,
          host,
        )}
    </>
  );
}
