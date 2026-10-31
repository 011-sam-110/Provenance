"use client";
// The way into God's eye view from the console: a person directly above the map's i. Drag it
// onto the map and God's eye view opens where it lands. A tap, or Enter or Space, opens it at
// the centre of the map. The rules (a tap or a drag, what a drop opens, when a drop opens
// nothing) are pure, in lib/console/eyePerson.ts. This file is the pointer and the drawing.
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
// container, which the button is not inside. While carrying, one requestAnimationFrame at a
// time writes a transform and two data attributes straight onto the layer: React renders when
// a carry starts and ends, never per frame. The carried figure is in the console's root, not in
// the corner, because a release off the map has to show off the map too.
//
// ESCAPE follows the ladder in components/shell/inspector/InspectorRail.tsx. While carrying,
// the focused button carries `data-owns-escape`, so that handler stands down, and this one
// (capture phase on window) stops the key, so ConsoleShell's ladder does not also clear the
// map's selection. Only while carrying: at rest, Escape on the button still closes an open tool.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useShellLayout } from "@/lib/console/store";
import {
  DROP_WORDS,
  OFF_MAP_WORDS,
  OPENING_WORDS,
  PERSON_NAME,
  PERSON_TITLE,
  centreSpot,
  dropOutcome,
  isDrag,
  labelAbove,
  labelShift,
  personHref,
  ringPoint,
  spotAtPoint,
  type PersonMap,
  type Point,
} from "@/lib/console/eyePerson";
import { ATTRIB_CONTROL_CLASS } from "@/lib/map/attribution";
import { getMapInstance } from "@/lib/map/instance";
import styles from "./EyePerson.module.css";

/** How often to look for the map until it exists. */
const FIND_MAP_MS = 200;
/** How long the figure takes to walk back: the transition in EyePerson.module.css, and a bit. */
const RETURN_MS = 260;
/** The small figure's feet, from the middle of the button. */
const FEET_BELOW_CENTRE_PX = 11;

type Phase = "idle" | "carry" | "return" | "dropped" | "tapped";

interface Press {
  id: number;
  type: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  carrying: boolean;
}

/** Drawn for this control, in one path, and not Google's figure: arms at the sides, feet apart. */
function Figure({ size, className }: { size: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true" focusable="false">
      <circle cx="12" cy="4.9" r="3.4" fill="currentColor" />
      <path
        fill="currentColor"
        d="M8.6 9.4h6.8a2.6 2.6 0 0 1 2.6 2.6v3.2a1.2 1.2 0 0 1-2.4 0v-2.6H15V22a1.4 1.4 0 0 1-2.8 0v-5.2h-.4V22A1.4 1.4 0 0 1 9 22v-9.4h-.6v2.6a1.2 1.2 0 0 1-2.4 0V12a2.6 2.6 0 0 1 2.6-2.6Z"
      />
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

/** The map, and a window point in the map's own px, if the ring is over the map's canvas. */
function overMap(ring: Point): { map: PersonMap; point: Point } | null {
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
  const [phase, setPhase] = useState<Phase>("idle");
  const button = useRef<HTMLButtonElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const frame = useRef(0);
  const returning = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A press that has already done its job can still end in a click: a drag on some browsers, and
  // a tap always (onPointerUp). A keyboard's click has detail 0 and always counts.
  const swallowClick = useRef(false);
  const shownOver = useRef<boolean | null>(null);
  const labelWidth = useRef(0);

  const paint = () => {
    frame.current = 0;
    const p = press.current;
    const el = layer.current;
    if (!p || !el) return;
    const ring = ringPoint(p.x, p.y, p.type);
    el.style.transform = `translate3d(${ring.x}px, ${ring.y}px, 0)`;
    const over = overMap(ring);
    const on = over != null && spotAtPoint(over.map, over.point.x, over.point.y) != null;
    if (on !== shownOver.current) {
      shownOver.current = on;
      el.setAttribute("data-on", on ? "true" : "false");
      // The two sentences differ in width. Read only when the words change.
      labelWidth.current = el.querySelector<HTMLElement>("[data-eye-person-label]")?.offsetWidth ?? 0;
    }
    el.style.setProperty("--person-label-x", `${labelShift(ring.x, labelWidth.current, window.innerWidth)}px`);
    el.setAttribute("data-label", labelAbove(ring.y, p.type, window.innerHeight) ? "above" : "below");
  };

  const schedulePaint = () => {
    if (!frame.current) frame.current = requestAnimationFrame(paint);
  };

  const endPress = () => {
    const p = press.current;
    press.current = null;
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = 0;
    shownOver.current = null;
    const b = button.current;
    if (p && b?.hasPointerCapture(p.id)) b.releasePointerCapture(p.id);
  };

  /** The figure goes back to its place. With reduced motion, it is simply there. */
  const goHome = () => {
    endPress();
    const el = layer.current;
    const b = button.current;
    if (!el || !b || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPhase("idle");
      return;
    }
    const box = b.getBoundingClientRect();
    el.setAttribute("data-state", "return");
    // The state has to apply before the new transform, or nothing transitions.
    void el.offsetWidth;
    el.style.transform = `translate3d(${box.left + box.width / 2}px, ${box.top + box.height / 2 + FEET_BELOW_CENTRE_PX}px, 0)`;
    setPhase("return");
    returning.current = setTimeout(() => setPhase("idle"), RETURN_MS);
  };

  const release = (x: number, y: number) => {
    const p = press.current;
    if (!p) return;
    p.x = x;
    p.y = y;
    paint();
    const ring = ringPoint(x, y, p.type);
    const over = overMap(ring);
    const map = over?.map ?? getMapInstance();
    const outcome = map ? dropOutcome(map, over?.point ?? null) : null;
    if (outcome?.kind !== "open") {
      goHome();
      return;
    }
    endPress();
    setPhase("dropped");
    // A full page load, like every way in: /eye sets its own layers in memory, and must start
    // from a fresh module state (EyeApp.tsx).
    window.location.assign(outcome.href);
  };

  const openAtCentre = () => {
    const map = getMapInstance();
    if (!map || phase !== "idle") return;
    setPhase("tapped");
    window.location.assign(personHref(centreSpot(map), map.getZoom(), map.getBearing()));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    swallowClick.current = false;
    if (phase !== "idle" || press.current || e.button !== 0 || !e.isPrimary) return;
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
      setPhase("carry");
      return;
    }
    schedulePaint();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || e.pointerId !== p.id) return;
    if (p.carrying) {
      release(e.clientX, e.clientY);
      return;
    }
    // A tap opens here and not on the click that follows it, because that click may never come.
    // After a finger lifts at speed, Chrome sends the next tap's pointer and touch events and
    // no click, and it was still sending none 3 s later (measured on Chrome's touch input,
    // 2026-10-31). So a fast flick to cancel would leave the person dead to the next tap.
    endPress();
    swallowClick.current = true;
    openAtCentre();
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
    openAtCentre();
  };

  // The layer has just mounted: put it under the pointer before it paints.
  useLayoutEffect(() => {
    if (phase === "carry") paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (phase !== "carry") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      goHome();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // The browser's Back button can bring this page back exactly as it was left, mid-drop.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      swallowClick.current = false;
      setPhase("idle");
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  useEffect(
    () => () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      if (returning.current) clearTimeout(returning.current);
    },
    [],
  );

  if (!slot) return null;
  const carried = phase === "carry" || phase === "return" || phase === "dropped";
  // In the console's root, for its tokens and so nothing in the map can clip it.
  const host = slot.closest<HTMLElement>(".tn-terminal") ?? document.body;
  return (
    <>
      {createPortal(
        <button
          ref={button}
          type="button"
          className={styles.person}
          data-eye-person=""
          data-state={phase}
          data-owns-escape={phase === "carry" ? "" : undefined}
          aria-label={PERSON_NAME}
          title={PERSON_TITLE}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerLost}
          onLostPointerCapture={onPointerLost}
          onClick={onClick}
          onContextMenu={(e) => {
            if (press.current) e.preventDefault();
          }}
        >
          <Figure size={22} className={styles.figure} />
        </button>,
        slot,
      )}
      {carried &&
        createPortal(
          <div
            ref={layer}
            className={styles.layer}
            data-eye-person-layer=""
            data-state={phase}
            aria-hidden="true"
          >
            <span className={styles.ring} data-eye-person-ring="" />
            <span className={styles.carried}>
              <Figure size={48} />
            </span>
            <span className={styles.label} data-eye-person-label="">
              <span data-when="on">{DROP_WORDS}</span>
              <span data-when="off">{OFF_MAP_WORDS}</span>
              <span data-when="dropped">{OPENING_WORDS}</span>
            </span>
          </div>,
          host,
        )}
    </>
  );
}
