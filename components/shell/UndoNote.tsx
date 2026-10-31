"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The console's one undo note.
 *
 * Shared by every control that does something big in one click and offers the way
 * back instead of asking first (Streets "New area"; Sources "Use same sources"). One
 * look (`.tn-undo` in globals.css), one set of rules, so the two cannot drift.
 *
 * It is NOT the toast. The toast (`.tn-toast`, ConsoleShell) is one plain line that
 * goes after 3.2 s and cannot be clicked; this one holds a button, so it waits while
 * the pointer is on it or focus is in it, and goes when its time is up.
 *
 *  - TIMER: `ms`, then `onClose("timeout")`. Paused while the pointer is over the note
 *    or focus is inside it; resuming runs the REMAINING time, not a fresh `ms`.
 *    Unmounting clears the timer and never calls `onClose` (the caller removed it).
 *  - FOCUS: moves to the action ONLY when `autoFocus` is set, which the caller sets
 *    only for a keyboard activation. A mouse user's note must not take focus, or it
 *    would be paused for good.
 *  - ACTION: runs `onUndo` once; repeat clicks are ignored.
 *  - CLOSE: the x calls `onClose("close")`; Escape with focus inside calls
 *    `onClose("escape")`.
 *  - SPEECH: the live region mounts EMPTY and receives its text in an effect, because
 *    a live region that arrives carrying its text is announced inconsistently (see
 *    ConsoleShell's toast host). The same words are drawn in a sibling that screen
 *    readers skip, so the note still shows its text on the first painted frame.
 *  - NO colours or sizes here: placement belongs to the caller's `className`, the look
 *    to `.tn-undo`.
 */

export type UndoCloseReason = "timeout" | "close" | "escape";

export interface UndoNoteProps {
  /** What happened, as a sentence: "21 cameras cleared." */
  message: string;
  /** The action's words. Default "Undo"; Streets passes "Click to undo." */
  actionLabel?: string;
  onUndo(): void;
  onClose(reason: UndoCloseReason): void;
  /** How long it stays when nothing is pointing at it. Default 6000. */
  ms?: number;
  /** True ONLY when the control that caused the note was activated by keyboard. */
  autoFocus?: boolean;
  /** Placement belongs to the caller. */
  className?: string;
}

export function UndoNote({
  message,
  actionLabel = "Undo",
  onUndo,
  onClose,
  ms = 6000,
  autoFocus = false,
  className,
}: UndoNoteProps) {
  const [spoken, setSpoken] = useState("");
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const paused = hover || focus;

  const actRef = useRef<HTMLButtonElement>(null);
  const undone = useRef(false);

  // The callbacks change every render of the caller; the timer must not restart for it.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // The live region: fill it after mount, and again if the sentence changes.
  useEffect(() => {
    setSpoken(message);
  }, [message]);

  // The clock. `left` is what remains; each run of this effect spends from it.
  const left = useRef(ms);
  useEffect(() => {
    if (paused) return;
    const startedAt = Date.now();
    const t = window.setTimeout(() => onCloseRef.current("timeout"), left.current);
    return () => {
      window.clearTimeout(t);
      left.current = Math.max(0, left.current - (Date.now() - startedAt));
    };
  }, [paused]);

  // Idempotent, so StrictMode's second mount is harmless.
  useEffect(() => {
    if (autoFocus) actRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, at mount
  }, []);

  return (
    <div
      className={"tn-undo" + (className ? " " + className : "")}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={(e) => {
        // Focus moving between the note's own two buttons is still "inside".
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose("escape");
        }
      }}
    >
      <span className="tn-undo-msg" aria-hidden="true">{message}</span>
      <span className="tn-sr-only" role="status" aria-live="polite">{spoken}</span>
      <button
        ref={actRef}
        type="button"
        className="tn-undo-act"
        onClick={() => {
          if (undone.current) return;
          undone.current = true;
          onUndo();
        }}
      >
        {actionLabel}
      </button>
      <button type="button" className="tn-undo-x" aria-label="Close" onClick={() => onClose("close")}>
        ×
      </button>
    </div>
  );
}
