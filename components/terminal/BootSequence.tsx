"use client";
// components/terminal/BootSequence.tsx
//
// The Terminal's cold start: five seconds of a full-viewport instrument coming
// online. The mark draws itself, the identity resolves, six subsystems check in,
// a scan sweep lights the 12-column grid the workspace is built on, and the
// terminal reports ready.
//
// THE TIMELINE IS NOT HERE. Every offset lives in lib/terminal/boot.ts as data,
// and the two durations this file needs (BOOT_MS, BOOT_FADE_MS) are published to
// CSS as custom properties on the root element. The stylesheet therefore owns no
// duration of its own — the progress rail and the dissolve are literally driven by
// the same numbers the timers are, so they cannot drift. The previous version
// spread its timing across three `animation-delay`s in globals.css and two arrays
// here, and "how long is the boot?" had no single answer.
//
// NON-BLOCKING is structural rather than something to be careful about. This
// mounts as a sibling overlay INSIDE the shell, so the app has already mounted
// behind it: the map has taken its WebGL context, every feed is fetching, and the
// widgets are painting. The boot covers work that was happening anyway and costs
// nothing in time-to-interactive. It must never gate rendering the shell — the
// moment it does, a decorative animation becomes a load-time regression.
//
// FOUR WAYS OUT, because five seconds nobody can skip is a tax:
//   * any key — including the Tab a keyboard-only visitor presses first,
//   * any click or tap anywhere on the plate,
//   * it ends on its own at BOOT_MS,
//   * prefers-reduced-motion paints the final frame and leaves in 260ms.
//
// ACCESSIBILITY. The overlay is aria-hidden and takes no focus: the shell behind
// it is already mounted and fully readable to a screen reader, so nothing is inert
// and nothing is announced over the top of it. That is also why the first Tab
// dismisses it — a sighted keyboard user's opening move ends the plate rather than
// moving focus to a control they cannot see.
//
// ONCE PER VISITOR, via the versioned localStorage envelope every other shell
// store uses (lib/shell/persist.ts), same precedent as the tour's seen flag. The
// flag is written when the sequence STARTS, so a reload two seconds in does not
// replay it. `?boot=1` forces a replay for review.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Mark from "@/components/brand/Mark";
import { BRAND } from "@/lib/brand";
import {
  BOOT_FADE_MS,
  BOOT_MS,
  BOOT_REDUCED_MS,
  BOOT_STAGES,
  bootOverrideFromSearch,
  bootTimeline,
  checksAt,
  loadBootSeen,
  markBootSeen,
  shouldPlayBoot,
  stageAt,
  stageIndex,
  type BootCheck,
  type BootStage,
} from "@/lib/terminal/boot";

/** UTC, off the visitor's own clock — the only other real value on the plate.
 *  toISOString() is already UTC, so there is no timezone maths to get wrong. */
function utcClock(now = new Date()): string {
  return `${now.toISOString().slice(11, 19)} UTC`;
}

export default function BootSequence({ layers, feeds }: { layers: number; feeds: number }) {
  const beats = useMemo(() => bootTimeline({ layers, feeds }), [layers, feeds]);

  // Starts "pending", not "running": rendering the overlay on the server and
  // removing it on the client is a hydration mismatch, and localStorage cannot be
  // read during render. The first client effect decides.
  const [state, setState] = useState<"pending" | "running" | "leaving" | "done">("pending");
  const [stage, setStage] = useState<BootStage>("power");
  const [checks, setChecks] = useState<BootCheck[]>([]);
  const [clock, setClock] = useState("");
  const timers = useRef<number[]>([]);

  const finish = () => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
    setState((s) => (s === "done" || s === "leaving" ? s : "leaving"));
    timers.current.push(window.setTimeout(() => setState("done"), BOOT_FADE_MS));
  };

  useEffect(() => {
    const seen = loadBootSeen();
    const override = bootOverrideFromSearch(window.location.search);
    if (!shouldPlayBoot(seen, override)) {
      setState("done");
      return;
    }
    // Written up front: someone who reloads mid-sequence has seen it.
    markBootSeen();

    setState("running");
    setClock(utcClock());

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // The end of the sequence as one static frame — the assembled mark, the
      // wordmark, every subsystem already checked in — then out.
      setStage(stageAt(beats, BOOT_MS));
      setChecks(checksAt(beats, BOOT_MS));
      timers.current.push(window.setTimeout(finish, BOOT_REDUCED_MS));
    } else {
      for (const beat of beats) {
        timers.current.push(
          window.setTimeout(() => {
            setStage(beat.stage);
            if (beat.check) setChecks((prev) => [...prev, beat.check as BootCheck]);
          }, beat.at),
        );
      }
      // The dissolve is carved out of BOOT_MS's tail, so the overlay is gone at
      // BOOT_MS exactly rather than BOOT_MS plus a fade nobody counted.
      timers.current.push(window.setTimeout(finish, BOOT_MS - BOOT_FADE_MS));
    }

    return () => {
      for (const t of timers.current) window.clearTimeout(t);
      timers.current = [];
    };
    // Mount only. Re-running would restart the sequence when a count updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Any key, any pointer. Registered on `window` in the capture phase so it fires
  // even if something under the plate would otherwise swallow the event.
  useEffect(() => {
    if (state !== "running") return;
    const skip = () => finish();
    window.addEventListener("keydown", skip, true);
    window.addEventListener("pointerdown", skip, true);
    return () => {
      window.removeEventListener("keydown", skip, true);
      window.removeEventListener("pointerdown", skip, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    if (state !== "running") return;
    const id = window.setInterval(() => setClock(utcClock()), 1000);
    return () => window.clearInterval(id);
  }, [state]);

  if (state === "pending" || state === "done") return null;

  const reached = stageIndex(stage);
  const className = [
    "tnx-boot",
    ...BOOT_STAGES.slice(0, reached + 1).map((s) => `is-${s}`),
    state === "leaving" ? "is-leaving" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={className}
      // The two durations, handed to the sheet. Nothing in globals.css restates them.
      style={{ "--tnx-boot-ms": `${BOOT_MS}ms`, "--tnx-boot-fade": `${BOOT_FADE_MS}ms` } as CSSProperties}
      // Decorative, and not a dialog: it steals no focus, and the shell behind it is
      // already mounted and readable to a screen reader. Announcing it would
      // interrupt that for no information.
      aria-hidden="true"
    >
      {/* The graticule, the 12 columns and the scan bar. All three are background
          plates; the veil punches the middle back out so the type sits on flat ink. */}
      <div className="tnx-boot-field" />
      <div className="tnx-boot-cols" />
      <div className="tnx-boot-veil" />
      <div className="tnx-boot-sweep" />

      <span className="tnx-boot-corner is-tl" />
      <span className="tnx-boot-corner is-tr" />
      <span className="tnx-boot-corner is-bl" />
      <span className="tnx-boot-corner is-br" />

      <span className="tnx-boot-stamp is-left">OPENDATA · TERMINAL</span>
      <span className="tnx-boot-stamp is-right">{clock}</span>

      <div className="tnx-boot-core">
        {/* Power-on: a hairline snaps open across the mark's row and fades as the
            mark draws over it. Positioned off the mark's own clamp() height, so it
            stays on the mark's centreline at every viewport size. */}
        <div className="tnx-boot-ignite" />
        <Mark
          size={220}
          playing={stage === "assemble"}
          idle={reached >= stageIndex("identify")}
          className="tnx-boot-mark"
        />
        <div className="tnx-boot-word">{BRAND.name}</div>
        <div className="tnx-boot-rule" />
        <div className="tnx-boot-sub">GLOBAL SITUATIONAL AWARENESS</div>

        {/* Height is reserved for all six rows so the wordmark above does not walk
            up the screen as lines arrive. */}
        <div className="tnx-boot-checks">
          {checks.map((c) => (
            <div className="tnx-boot-check" key={c.label}>
              <span className="tnx-boot-check-label">{c.label}</span>
              <span className="tnx-boot-check-detail">{c.detail}</span>
              <span className="tnx-boot-lead" />
              <span className="tnx-boot-check-state">{c.state}</span>
            </div>
          ))}
        </div>

        <div className="tnx-boot-ready">TERMINAL READY</div>
      </div>

      <div className="tnx-boot-foot">
        <span className="tnx-boot-foot-label">LAUNCH SEQUENCE</span>
        {/* The rail's fill runs for exactly --tnx-boot-ms, so it is a readout of the
            real timeline rather than a decorative bar that finishes whenever. */}
        <span className="tnx-boot-rail">
          <span className="tnx-boot-rail-fill" />
        </span>
        <span className="tnx-boot-skip">PRESS ANY KEY TO SKIP</span>
      </div>
    </div>
  );
}
