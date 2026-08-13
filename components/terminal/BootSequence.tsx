"use client";
// components/terminal/BootSequence.tsx
//
// The Terminal's cold-start overlay: the mark assembles itself — rings draw, lens
// pops, book unfolds — over three terminal status lines, then dissolves.
//
// NON-BLOCKING is the load-bearing property, and it is structural rather than
// something to be careful about. This mounts as a sibling overlay INSIDE the
// shell, so the app has already mounted behind it: the map has taken its WebGL
// context, every feed is fetching, and the widgets are painting. The boot covers
// work that was happening anyway and costs nothing in time-to-interactive. It
// must never gate rendering the shell — the moment it does, a decorative
// animation becomes a load-time regression.
//
// Three ways out, because an animation nobody can skip is a tax:
//   * click or Escape anywhere,
//   * it ends on its own,
//   * prefers-reduced-motion renders one static frame and leaves immediately.
//
// Gated by sessionStorage, not localStorage: once per session is the honest
// reading of "on launch". localStorage would show it once ever (so nobody would
// see it again after the first visit, which is not what a boot sequence is for),
// and no gate at all would make it a toll on every reload during development.

import { useEffect, useRef, useState } from "react";
import Mark from "@/components/brand/Mark";

const SESSION_KEY = "tn.terminal.booted.v1";

/** Total run, ms. The mark's own CSS timeline finishes at ~1180ms; the rest is
 *  the last status line sitting readable before the dissolve. */
const RUN_MS = 1500;
const FADE_MS = 320;

/** When each status line appears. */
const LINE_AT = [880, 1030, 1180];

function alreadyBooted(): boolean {
  try {
    return window.sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    // Private mode / storage disabled. Showing the boot is the safe failure:
    // it is 1.5s of decoration, not a permission.
    return false;
  }
}

function markBooted(): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    /* nothing to do; the sequence is idempotent */
  }
}

export default function BootSequence({ layers, feeds }: { layers: number; feeds: number }) {
  // Starts null, not false: rendering the overlay on the server and removing it on
  // the client is a hydration mismatch, and sessionStorage cannot be read during
  // render. The first client effect decides.
  const [state, setState] = useState<"pending" | "running" | "leaving" | "done">("pending");
  const [lines, setLines] = useState(0);
  const timers = useRef<number[]>([]);

  const finish = () => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
    markBooted();
    setState((s) => (s === "done" ? s : "leaving"));
    timers.current.push(window.setTimeout(() => setState("done"), FADE_MS));
  };

  useEffect(() => {
    if (alreadyBooted()) { setState("done"); return; }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      // One static frame, then out. Still marked as booted so the session is
      // consistent for anyone who toggles the preference mid-session.
      setState("running");
      setLines(LINE_AT.length);
      timers.current.push(window.setTimeout(finish, 400));
      return;
    }

    setState("running");
    LINE_AT.forEach((at, i) => {
      timers.current.push(window.setTimeout(() => setLines(i + 1), at));
    });
    timers.current.push(window.setTimeout(finish, RUN_MS));

    return () => {
      for (const t of timers.current) window.clearTimeout(t);
      timers.current = [];
    };
    // Mount only. Re-running would restart the sequence on a data update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state !== "running") return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") finish(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (state === "pending" || state === "done") return null;

  return (
    <div
      className={`tnx-boot${state === "leaving" ? " is-leaving" : ""}`}
      onClick={finish}
      // aria-hidden, and not a dialog. It is decorative, it steals no focus, and
      // the app behind it is already mounted and readable to a screen reader —
      // announcing it would interrupt that for no information.
      aria-hidden="true"
    >
      <div className="tnx-boot-inner">
        <Mark size={132} playing className="tnx-boot-mark" />
        <div className="tnx-boot-lines">
          <div className={`tnx-boot-line${lines > 0 ? " is-on" : ""}`}>&gt; OPENDATA TERMINAL</div>
          <div className={`tnx-boot-line${lines > 1 ? " is-on" : ""}`}>
            &gt; {feeds} feeds · {layers} signal layers
          </div>
          <div className={`tnx-boot-line${lines > 2 ? " is-on" : ""}`}>
            &gt; <span className="tnx-boot-ok">READY</span>
          </div>
        </div>
      </div>
      <span className="tnx-boot-skip">click / esc to skip</span>
    </div>
  );
}
