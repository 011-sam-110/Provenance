"use client";
// The God's eye view's control hint: a small plate that says how to move the view, in
// the person's own input (mouse and keys, a finger, or, on a mouse desktop that is
// touched, Leon's line and the finger gestures). The words and the rules are in
// lib/eye/controls.ts and are tested there; this file only wires them to the page.
//
// Shown on every visit, nothing is remembered (no localStorage, no sessionStorage), and
// it reacts to discrete events only (a move ending, a press, a timer, a close), never to
// the camera frame by frame.
//
// THE FIRST MOVE is a `moveend` that carries `originalEvent`: a drag, its inertia, the
// wheel, a key or a tap all do. "Turn" moves the view with jumpTo and no event data, so
// it fires `moveend` every frame with NO `originalEvent`, and must not count.

import { useEffect, useReducer, useState } from "react";
import type maplibregl from "maplibre-gl";
import {
  CLOSE_NAME,
  FADE_AFTER_MS,
  FADE_OUT_MS,
  HINT_NAME,
  TOUCH_ON_DESKTOP_LINE,
  TOUCH_QUERY,
  hintCopy,
  hintReducer,
  initialHint,
  type HintRow,
} from "@/lib/eye/controls";
import styles from "./eye.module.css";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export default function ControlHint({ map, blocked }: { map: maplibregl.Map | null; blocked: boolean }) {
  const [state, dispatch] = useReducer(hintReducer, undefined, () =>
    initialHint(typeof window !== "undefined" && window.matchMedia(TOUCH_QUERY).matches),
  );
  const [focused, setFocused] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // The first move the person makes.
  useEffect(() => {
    if (!map) return;
    const onEnd = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) dispatch({ type: "move-end" });
    };
    map.on("moveend", onEnd);
    return () => {
      map.off("moveend", onEnd);
    };
  }, [map]);

  // Presses anywhere on the page, and when the last finger is lifted.
  useEffect(() => {
    const fingers = new Set<number>();
    const down = (e: PointerEvent) => {
      if (e.pointerType === "touch") fingers.add(e.pointerId);
      dispatch({ type: "press", pointerType: e.pointerType });
    };
    const up = (e: PointerEvent) => {
      if (e.pointerType === "touch" && fingers.delete(e.pointerId) && fingers.size === 0) {
        dispatch({ type: "touches-lifted" });
      }
    };
    const opts = { capture: true, passive: true } as const;
    document.addEventListener("pointerdown", down, opts);
    document.addEventListener("pointerup", up, opts);
    document.addEventListener("pointercancel", up, opts);
    return () => {
      document.removeEventListener("pointerdown", down, opts);
      document.removeEventListener("pointerup", up, opts);
      document.removeEventListener("pointercancel", up, opts);
    };
  }, []);

  // The Places sheet (and the sources menu, when it exists) takes the plate's room.
  useEffect(() => {
    if (blocked) dispatch({ type: "panel-open" });
  }, [blocked]);

  // The wait: 5 s after the first move, paused while focus is inside the plate.
  useEffect(() => {
    if (!state.shown || !state.armed || focused) return;
    const t = setTimeout(() => dispatch({ type: "timeout" }), FADE_AFTER_MS);
    return () => clearTimeout(t);
  }, [state.shown, state.armed, focused]);

  // A swap remounts the plate, and a remounted plate sends no blur.
  useEffect(() => {
    setFocused(false);
  }, [state.kind]);

  // Leaving: stay mounted while it fades, unless motion is reduced. Worked out while
  // rendering, not in an effect, so the plate never unmounts for a frame and comes back.
  const [wasShown, setWasShown] = useState(state.shown);
  if (wasShown !== state.shown) {
    setWasShown(state.shown);
    setLeaving(!state.shown && !window.matchMedia(REDUCED_MOTION_QUERY).matches);
  }
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setLeaving(false), FADE_OUT_MS);
    return () => clearTimeout(t);
  }, [leaving]);

  const close = (fromKeyboard: boolean) => {
    dispatch({ type: "close" });
    // A keyboard user lands on the map the plate explains, not on <body>.
    if (fromKeyboard) map?.getCanvas().focus();
  };

  const copy = hintCopy(state.kind);
  const present = state.shown || leaving;
  const announce = state.shown && state.kind === "touch-desktop" ? TOUCH_ON_DESKTOP_LINE : "";

  return (
    <>
      {present && (
        <aside
          className={styles.hint}
          aria-label={HINT_NAME}
          data-kind={state.kind}
          data-leaving={!state.shown || undefined}
          data-eye-keep
          key={state.kind}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        >
          <div className={styles.hintBody}>
            {copy.lead && (
              <p className={styles.hintLead} aria-hidden="true">
                {copy.lead}
              </p>
            )}
            <dl className={styles.hintRows}>
              {copy.rows.map((row) => (
                <HintRowView key={row.does} row={row} withKeys={state.kind === "mouse"} />
              ))}
            </dl>
            {copy.note && (
              <p className={styles.hintNote}>
                {copy.note.before}
                <kbd>{copy.note.key}</kbd>
                {copy.note.after}
              </p>
            )}
          </div>
          <button
            type="button"
            className={styles.hintClose}
            aria-label={CLOSE_NAME}
            onClick={(e) => close(e.detail === 0)}
            onKeyDown={(e) => {
              if (e.key === "Escape") close(true);
            }}
          >
            <span aria-hidden="true">×</span>
          </button>
        </aside>
      )}
      <span className="tn-sr-only" role="status">
        {announce}
      </span>
    </>
  );
}

function HintRowView({ row, withKeys }: { row: HintRow; withKeys: boolean }) {
  return (
    <>
      <dt>{row.does}</dt>
      <dd>{row.how}</dd>
      {withKeys && (
        <dd className={styles.hintKeys}>
          {row.keysText ??
            row.keys?.map((k, i) => (
              <span key={k}>
                {i > 0 && " "}
                <kbd>{k}</kbd>
              </span>
            ))}
        </dd>
      )}
    </>
  );
}
