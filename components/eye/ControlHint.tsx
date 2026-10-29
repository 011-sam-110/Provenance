"use client";
// The God's eye view's control hint: a small plate that says how to move the view, in
// the person's own input (mouse and keys, a finger, or, on a mouse desktop that is
// touched, Leon's line and the finger gestures). The words and the rules are in
// lib/eye/controls.ts and are tested there; this file only wires them to the page.
//
// Shown on every visit, nothing is remembered (no localStorage, no sessionStorage), and
// it reacts to discrete events only (a move ending, a press, a timer, a close, the "?"),
// never to the camera frame by frame.
//
// THE "?" BESIDE THE CLOCK (HintToggle, below) brings the plate back or hides it (Leon,
// 29 Oct 2026). The state is lifted into useControlHint so the header holds the "?" and
// the footer holds the plate and both read the same state. A plate brought back follows
// the arrival rules: it fades 5 s after the next move, and the x or the "?" closes it.
//
// IT RESERVES NO ROOM. The plate has no `data-eye-keep`, so EyeOverlay places cameras and
// tags as if it were not there, and it may cover part of a card while it is up (Leon's
// call). It used to carry the attribute, which hid every camera on a phone at Westminster
// and did not give them back when the x was pressed, because places are worked out only on
// a move or on new data.
//
// THE FIRST MOVE is a `moveend` that carries `originalEvent`: a drag, its inertia, the
// wheel, a key or a tap all do. "Turn" moves the view with jumpTo and no event data, so
// it fires `moveend` every frame with NO `originalEvent`, and must not count.

import { useEffect, useId, useReducer, useRef, useState } from "react";
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
  type HintState,
} from "@/lib/eye/controls";
import styles from "./eye.module.css";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export interface ControlHintApi {
  state: HintState;
  /** Shown, or still fading out. */
  present: boolean;
  /** The plate's id, for the toggle's aria-controls. */
  plateId: string;
  /** `pointerType` is what pressed the "?": "mouse", "pen", "touch", or "" for the keyboard. */
  toggle(pointerType: string): void;
  close(fromKeyboard: boolean): void;
  setFocused(focused: boolean): void;
}

/** The hint's state, shared by the "?" in the header and the plate in the footer. `blocked`
 *  is true while a panel that takes the plate's room is open (the Places sheet). */
export function useControlHint(map: maplibregl.Map | null, blocked: boolean): ControlHintApi {
  const [state, dispatch] = useReducer(hintReducer, undefined, () =>
    initialHint(typeof window !== "undefined" && window.matchMedia(TOUCH_QUERY).matches),
  );
  const [focused, setFocused] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const plateId = useId();
  // Shown, or still fading out.
  const present = state.shown || leaving;

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
      // The "?" decides for itself: a first touch landing on it must not swap in Leon's
      // line, only for the click that follows to close the plate again.
      if (e.target instanceof Element && e.target.closest("[data-hint-toggle]")) return;
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

  // A swap remounts the plate, and a plate that unmounts sends no blur: the x that was just
  // pressed still held focus when it went, and the "?" brings the plate back, so a stale
  // `focused` would hold the wait for ever.
  useEffect(() => {
    setFocused(false);
  }, [state.kind, present]);

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

  const toggle = (pointerType: string) => {
    dispatch({ type: "toggle", pointerType, onlyTouch: window.matchMedia(TOUCH_QUERY).matches });
  };

  return { state, present, plateId, toggle, close, setFocused };
}

/** The plate itself, and the live region that reads out Leon's line. */
export default function ControlHint({ hint }: { hint: ControlHintApi }) {
  const { state, present, plateId, close, setFocused } = hint;
  const copy = hintCopy(state.kind);
  const announce = state.shown && state.kind === "touch-desktop" ? TOUCH_ON_DESKTOP_LINE : "";

  return (
    <>
      {present && (
        <aside
          className={styles.hint}
          id={plateId}
          aria-label={HINT_NAME}
          data-kind={state.kind}
          data-leaving={!state.shown || undefined}
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

/** The "?" beside the clock: hides a shown plate, brings a hidden one back. Focus stays on
 *  the button, which is a disclosure. `onOpen` runs when the press opens the plate, so the
 *  caller can close whatever else wants the room (the Places sheet). */
export function HintToggle({ hint, onOpen }: { hint: ControlHintApi; onOpen?: () => void }) {
  // Safari's click from a tap may not carry pointerType, so the button keeps its own.
  const pointer = useRef("");
  return (
    <button
      type="button"
      className={styles.hintToggle}
      data-hint-toggle
      aria-label={HINT_NAME}
      aria-expanded={hint.state.shown}
      aria-controls={hint.present ? hint.plateId : undefined}
      onPointerDown={(e) => {
        pointer.current = e.pointerType;
      }}
      onClick={(e) => {
        const opening = !hint.state.shown;
        hint.toggle(e.detail === 0 ? "" : pointer.current);
        if (opening) onOpen?.();
      }}
    >
      <span aria-hidden="true">?</span>
    </button>
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
