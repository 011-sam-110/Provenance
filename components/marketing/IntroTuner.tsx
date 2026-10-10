"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { layoutTiles } from "@/lib/marketing/cameraSphere";
import {
  INTRO_DEFAULTS,
  INTRO_WORD,
  TUNE_SLIDERS,
  fillSchedule,
  introSnippet,
  introTimeline,
  roundToStep,
  tuneSearch,
  type Handover,
  type IntroControl,
  type IntroFrame,
  type IntroParams,
  type IntroState,
  type TuneGroup,
  type TuneKey,
  type TuneSlider,
} from "@/lib/marketing/sphereIntro";

/**
 * THE INTRO TUNER on `/?tune`: sliders for every number in `INTRO` that is a matter of taste,
 * over the real intro on the real page, so what is tuned here is what ships.
 *
 * It holds no animation of its own. It talks to the intro through the `IntroControl` that
 * components/marketing/SphereIntro.tsx hands it, and the scrubber and the readouts are written
 * from the intro's frame callback straight to the DOM, never through React state. Every change
 * lands in the address bar too, so a reload or a pasted link plays the same run, and "Copy
 * values" gives the lines to paste over `INTRO` in lib/marketing/sphereIntro.ts.
 */

const GROUPS: readonly TuneGroup[] = ["Screens", "Move", "Letters", "Handover"];
const RATES = [0.25, 0.5, 1] as const;
/** The pause on the page between two looped runs. */
const LOOP_GAP_MS = 1200;
/** How long a slider must rest before the intro takes the new number. */
const SETTLE_MS = 120;

const SECONDS: ReadonlySet<TuneKey> = new Set(["fillFade", "moveStart", "moveDur", "letterDur", "hold", "glideDur"]);
const MILLIS: ReadonlySet<TuneKey> = new Set(["fillFloor", "letterStagger"]);

function format(s: TuneSlider, v: number): string {
  if (SECONDS.has(s.key)) return `${roundToStep(s, v).toFixed(Math.max(2, (String(s.step).split(".")[1] ?? "").length))} s`;
  if (MILLIS.has(s.key)) return `${Math.round(v * 1000)} ms`;
  switch (s.key) {
    case "fillSpeed":
    case "ballCaps":
    case "gapCaps":
      return `${v.toFixed(2)}×`;
    case "screenDeg":
      return `${v}°`;
    case "startDiameter":
    case "lettersAt":
      return `${Math.round(v * 100)}%`;
    default:
      return v.toFixed(2);
  }
}

const STATIC_HINTS: Partial<Record<TuneKey, string>> = {
  fillRatio: "Each gap as a share of the one before",
  fillFloor: "Where the speed-up stops",
  startDiameter: "Of the screen's shorter side",
  moveEaseIn: "Higher leaves the centre more slowly",
  ballCaps: "Times the height of the capitals",
  gapCaps: "Times the height of the capitals",
  letterStagger: "Left to right",
  glideEaseIn: "Higher lifts off more slowly",
};

const isChanged = (s: TuneSlider, p: Readonly<IntroParams>) => roundToStep(s, p[s.key]) !== roundToStep(s, INTRO_DEFAULTS[s.key]);

export default function IntroTuner({ control }: { control: MutableRefObject<IntroControl | null> }) {
  const [params, setParams] = useState<IntroParams>(() => ({ ...(control.current?.params ?? INTRO_DEFAULTS) }));
  const [state, setState] = useState<IntroState>(() => control.current?.state ?? "loading");
  const [open, setOpen] = useState(true);
  const [loop, setLoop] = useState(true);
  const [rate, setRate] = useState(1);
  const [copied, setCopied] = useState<"" | "done" | "failed">("");
  const scrubRef = useRef<HTMLInputElement | null>(null);
  const timeRef = useRef<HTMLSpanElement | null>(null);
  const litRef = useRef<HTMLSpanElement | null>(null);
  const pillRef = useRef<HTMLButtonElement | null>(null);
  const hideRef = useRef<HTMLButtonElement | null>(null);
  const loopRef = useRef(loop);
  const applied = useRef(JSON.stringify(params));
  const lastFrame = useRef<IntroFrame>({ t: 0, lit: 0, screens: 0 });

  /** The scrubber and the two readouts, from the last frame the intro drew. DOM writes only. */
  const writeFrame = useCallback(() => {
    const c = control.current;
    if (!c) return;
    const f = lastFrame.current;
    const end = c.timeline.end;
    const s = scrubRef.current;
    if (s) {
      s.max = end.toFixed(2);
      s.value = String(Math.min(f.t, end));
    }
    if (timeRef.current) timeRef.current.textContent = `${f.t.toFixed(2)} s of ${end.toFixed(2)} s`;
    if (litRef.current) litRef.current.textContent = `${f.lit} of ${f.screens || c.screens} screens lit`;
  }, [control]);

  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);

  /* The intro's two callbacks. The frame one writes to the DOM only. */
  useEffect(() => {
    const c = control.current;
    if (!c) return;
    let loopTimer = 0;
    c.onFrame = (f) => {
      lastFrame.current = f;
      writeFrame();
    };
    c.onState = (s) => {
      setState(s);
      window.clearTimeout(loopTimer);
      if (s === "ended" && c.endedBy === "arrived") {
        loopTimer = window.setTimeout(() => {
          if (loopRef.current) c.replay();
        }, LOOP_GAP_MS);
      }
    };
    setState(c.state);
    return () => {
      c.onFrame = null;
      c.onState = null;
      window.clearTimeout(loopTimer);
    };
  }, [control]);

  /* The status row is rebuilt when the state changes; fill its readouts straight away. */
  useEffect(() => {
    writeFrame();
  }, [state, writeFrame]);

  /* New numbers reach the intro once the slider rests, and the address bar with them. */
  useEffect(() => {
    const key = JSON.stringify(params);
    if (key === applied.current) return;
    const id = window.setTimeout(() => {
      applied.current = key;
      control.current?.update(params);
      try {
        window.history.replaceState(window.history.state, "", `${window.location.pathname}${tuneSearch(params)}`);
      } catch {
        /* a sandboxed frame may refuse; the panel still works */
      }
    }, SETTLE_MS);
    return () => window.clearTimeout(id);
  }, [params, control]);

  useEffect(() => {
    control.current?.setRate(rate);
  }, [rate, control]);

  /* What the numbers mean, worked out the way the intro works them out. */
  const screens = useMemo(() => layoutTiles({ screenDeg: params.screenDeg, stillCount: 1 }).length, [params.screenDeg]);
  const sched = useMemo(() => fillSchedule(screens, params), [screens, params]);
  const lastStart = sched[sched.length - 1] ?? 0;
  const tl = useMemo(() => introTimeline(INTRO_WORD.length, lastStart + params.fillFade, params), [params, lastStart]);
  const litAtMove = sched.filter((t) => t <= params.moveStart).length;

  const hint = (k: TuneKey): string | undefined => {
    switch (k) {
      case "fillSpeed":
        return `Second screen at ${(sched[1] ?? 0).toFixed(2)} s, all ${screens} lit by ${lastStart.toFixed(2)} s`;
      case "screenDeg":
        return `${screens} screens on the ball`;
      case "moveStart":
        return `${litAtMove} of ${screens} screens lit by then`;
      case "lettersAt":
        return `At ${tl.lettersAt.toFixed(2)} s, the ball ${Math.round(tl.moveEase(params.lettersAt) * 100)}% of the way there`;
      case "hold":
        return `Handover at ${tl.glideStart.toFixed(2)} s, curtain gone at ${tl.end.toFixed(2)} s`;
      default:
        return STATIC_HINTS[k];
    }
  };

  const set = useCallback((key: TuneKey, v: number) => setParams((p) => ({ ...p, [key]: v })), []);
  const setHandover = (h: Handover) => setParams((p) => ({ ...p, handover: h }));

  const ready = state !== "loading" && state !== "unavailable";
  const pct = (t: number) => `${Math.max(0, Math.min(100, (t / tl.end) * 100)).toFixed(2)}%`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(introSnippet(params));
      setCopied("done");
    } catch {
      setCopied("failed");
    }
    window.setTimeout(() => setCopied(""), 1800);
  }

  if (!open) {
    return (
      <button
        ref={pillRef}
        type="button"
        className="lp-tune lp-tune-pill"
        onClick={() => {
          setOpen(true);
          requestAnimationFrame(() => hideRef.current?.focus());
        }}
      >
        Tune intro
      </button>
    );
  }

  const changed = TUNE_SLIDERS.some((s) => isChanged(s, params)) || params.handover !== INTRO_DEFAULTS.handover;

  return (
    <section className="lp-tune lp-tune-panel" aria-label="Intro tuner" data-state={state}>
      {/* The Discord note sits in its own layer above the whole landing page, so nothing inside
          `.lp-root` can rise over it, and its corner is where this panel ends. While the panel
          is open, and only on `/?tune`, it steps aside. */}
      <style>{".tn-note-live { display: none !important; }"}</style>
      <header className="lp-tune-head">
        <h2>Intro tuner</h2>
        <button
          ref={hideRef}
          type="button"
          className="lp-tune-btn lp-tune-quiet"
          onClick={() => {
            setOpen(false);
            requestAnimationFrame(() => pillRef.current?.focus());
          }}
        >
          Hide
        </button>
      </header>

      <div className="lp-tune-transport">
        <button
          type="button"
          className="lp-tune-btn lp-tune-primary"
          disabled={!ready}
          onClick={() => (state === "playing" ? control.current?.pause() : control.current?.play())}
        >
          {state === "playing" ? "Pause" : "Play"}
        </button>
        <button type="button" className="lp-tune-btn" disabled={state === "unavailable"} onClick={() => control.current?.replay()}>
          Replay
        </button>
      </div>

      <div className="lp-tune-scrub">
        <input
          ref={scrubRef}
          type="range"
          min={0}
          max={tl.end.toFixed(2)}
          step={0.01}
          defaultValue={0}
          disabled={!ready}
          aria-label="Time in the intro"
          onChange={(e) => control.current?.seek(Number(e.currentTarget.value))}
        />
        <div className="lp-tune-ticks" aria-hidden="true">
          <i style={{ left: pct(tl.moveStart) }} />
          <i style={{ left: pct(tl.lettersAt) }} />
          <i style={{ left: pct(tl.glideStart) }} />
          <i style={{ left: pct(tl.glideEnd) }} />
        </div>
      </div>
      <p className="lp-tune-status" aria-live="polite">
        {state === "loading" ? (
          <span>Loading the stills</span>
        ) : state === "unavailable" ? (
          <span>The intro could not start: {control.current?.reason || "unknown reason"}</span>
        ) : (
          <>
            {/* Written by the frame callback alone: React must own no text inside them. */}
            <span ref={timeRef} />
            <span ref={litRef} />
          </>
        )}
      </p>
      <p className="lp-tune-times">
        Move at {tl.moveStart.toFixed(2)} s, letters at {tl.lettersAt.toFixed(2)} s, handover at {tl.glideStart.toFixed(2)} s, done at{" "}
        {tl.end.toFixed(2)} s
      </p>
      <div className="lp-tune-options">
        <label className="lp-tune-check">
          <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.currentTarget.checked)} />
          Loop
        </label>
        <div className="lp-tune-seg" role="group" aria-label="Playback speed">
          {RATES.map((r) => (
            <button key={r} type="button" aria-pressed={rate === r} onClick={() => setRate(r)}>
              {`${r}×`}
            </button>
          ))}
        </div>
      </div>

      {GROUPS.map((g) => (
        <section key={g} className="lp-tune-group" aria-labelledby={`lp-tune-${g}`}>
          <h3 id={`lp-tune-${g}`}>{g}</h3>
          {TUNE_SLIDERS.filter((s) => s.group === g).map((s) => {
            const v = params[s.key];
            const id = `lp-tune-${s.key}`;
            const diff = isChanged(s, params);
            const h = hint(s.key);
            return (
              <div key={s.key} className="lp-tune-row" data-changed={diff ? "" : undefined}>
                <label htmlFor={id}>{s.label}</label>
                <span className="lp-tune-val">
                  {diff && (
                    <button
                      type="button"
                      className="lp-tune-reset"
                      onClick={() => set(s.key, INTRO_DEFAULTS[s.key])}
                      aria-label={`Reset ${s.label.toLowerCase()} to ${format(s, INTRO_DEFAULTS[s.key])}`}
                    >
                      Reset
                    </button>
                  )}
                  <output htmlFor={id}>{format(s, v)}</output>
                </span>
                <input
                  id={id}
                  type="range"
                  min={s.min}
                  max={s.max}
                  step={s.step}
                  value={v}
                  aria-valuetext={format(s, v)}
                  onChange={(e) => set(s.key, roundToStep(s, Number(e.currentTarget.value)))}
                />
                {h && <span className="lp-tune-hint">{h}</span>}
              </div>
            );
          })}
          {g === "Handover" && (
            <div className="lp-tune-row lp-tune-row-seg" data-changed={params.handover !== INTRO_DEFAULTS.handover ? "" : undefined}>
              <span id="lp-tune-curtain">Curtain</span>
              <div className="lp-tune-seg" role="group" aria-labelledby="lp-tune-curtain">
                <button type="button" aria-pressed={params.handover === "dock"} onClick={() => setHandover("dock")}>
                  Dissolves
                </button>
                <button type="button" aria-pressed={params.handover === "iris"} onClick={() => setHandover("iris")}>
                  Opens from the ball
                </button>
              </div>
            </div>
          )}
        </section>
      ))}

      <footer className="lp-tune-foot">
        <button type="button" className="lp-tune-btn lp-tune-primary" onClick={copy}>
          {copied === "done" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy values"}
        </button>
        <button type="button" className="lp-tune-btn" disabled={!changed} onClick={() => setParams({ ...INTRO_DEFAULTS })}>
          Reset all
        </button>
      </footer>
      <p className="lp-tune-note">
        Copy values gives the lines to paste over <code>INTRO</code> in lib/marketing/sphereIntro.ts. The address bar keeps every change.
      </p>
    </section>
  );
}
