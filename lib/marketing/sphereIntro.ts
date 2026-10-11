import { BRAND } from "@/lib/brand";
import sphereMarkData from "@/lib/brand/sphereMark.json";
import { FILL, SCREEN_DEG, clamp01, cubicBezier, fillTimes, smoothstep } from "@/lib/marketing/cameraSphere";

/**
 * THE OPENING INTRO on `/`: the camera sphere fills, lands to the LEFT of the wordmark, and the
 * lockup (ball, gap, word) then docks into the nav brand while the curtain dissolves to the hero.
 *
 * This file is the pure half: every number Leon tunes, the timeline built from them, the tiny
 * gate script that decides before first paint whether the curtain is shown at all, and what the
 * tuner on `/?tune` reads and writes. components/marketing/SphereIntro.tsx is the half that
 * touches the page, and components/marketing/IntroTuner.tsx is the slider panel.
 *
 * WHY THE LOCKUP DOCKS INTO THE NAV BRAND. The landing settled on 2026-10-08 is ball, gap, word,
 * centred as one. The nav brand (`.lp-brand`) is the same shape: the Mark, a gap, the name, set
 * in the same Archivo at the same width, weight and tracking. So the handover is a move with
 * nothing thrown away: the word scales into the brand's text, and the ball lands on the Mark,
 * which is this same sphere with its screens filled white, the photographs fading to white. The curtain dissolves
 * under the move, and the page's own brand takes over when the lockup arrives.
 *
 * THE WORD IS THE BRAND'S OWN TEXT. It reads `BRAND.name`, the string the nav brand prints, so
 * the word that lands is the word already there. Until 2026-10-10 it was set in capitals, and the
 * docked lockup did not match the nav it docked into.
 *
 * THE STILLS ARE A DATED SNAPSHOT. Nothing here may call the sphere live.
 */

/** Every tunable number, in one place. Times are seconds from the first screen. The fill, the
    start size and the move were tuned by Leon on `/?tune` on 2026-10-11; the rest are the
    numbers settled on 2026-10-08, which he kept. */
export const INTRO = {
  /* ---- the fill, from the sketch (lib/marketing/cameraSphere.ts holds its first two gaps) */
  /** Divides every gap between screens, so the shape of the fill holds and only its pace
      changes. With the ratio below, the 59 screens of the 17° ball are all lit by 3.42 s: the
      first two gaps are slower than the sketch's, the rest speed up much faster. */
  fillSpeed: 0.85,
  /** Each gap after the second is this share of the one before it (the sketch's was 0.85). */
  fillRatio: 0.7,
  /** The shortest gap the speed-up may reach, s (before `fillSpeed` divides it). */
  fillFloor: FILL.floor,
  /** How long one screen takes to fade on, s. */
  fillFade: FILL.fade,
  /** Width of one screen, in degrees of the ball. */
  screenDeg: SCREEN_DEG,

  /* ---- the lockup, measured in cap heights (`measureText('H').actualBoundingBoxAscent`) */
  /** Ball diameter. */
  ballCaps: 1.1,
  /** Gap between the ball's right edge and the word. */
  gapCaps: 0.35,
  /** Largest wordmark font size, px. The sketch's 112. */
  maxFontPx: 112,
  /** Smallest side margin the lockup keeps, px. */
  minMarginPx: 20,

  /* ---- the ball at the start, centred */
  /** Its diameter as a share of the shorter side of the screen: 1.6, so the ball starts larger
      than the screen, running off the top and bottom on a wide screen and off the sides on a
      phone, and the move pulls it in from there. (The sketch's was 0.91, the ball whole.) */
  startDiameter: 1.6,

  /* ---- the move to the left of the word */
  moveStart: 2.81,
  moveDur: 0.95,
  /** cubic-bezier handles: a strong ease-in, so the ball leaves the start slowly. The tuner
      moves the first handle only. */
  moveEase: [0.9, 0, 0.16, 1] as const,

  /* ---- the letters, left to right, starting before the ball lands */
  /** Share of the move at which the first letter starts. */
  lettersAt: 0.4,
  letterStagger: 0.045,
  letterDur: 0.34,
  /** Each letter slides in from this far left, in em. */
  letterSlideEm: 0.18,

  /* ---- the handover */
  /** Stillness after the last letter lands, before the lockup moves. */
  hold: 0.2,
  /** The lockup's move into the nav brand. */
  glideDur: 0.8,
  /** The tuner moves the first handle only. */
  glideEase: [0.6, 0, 0.2, 1] as const,
  /** "dock": the curtain dissolves under the lockup's move. "iris": it opens from the ball's
      landing spot. The lockup docks into the nav brand either way. */
  handover: "dock" as Handover,
  /** The curtain's ground lifts WITH the lockup, between these two points of the glide's eased
      progress. Tied to the move and not to the clock, so the word has risen off the hero's
      headline before the headline shows through. */
  groundFrom: 0.12,
  groundTo: 0.7,
  /** The handoff: the photo ball and the word dissolve into the page's own brand (the Mark is
      this sphere, its screens filled white; the word is the brand's text) on the intro's clock, starting this
      long before the lockup arrives in the nav and ending `handoffTail` after it, on an even
      ease-in-out. Until 2026-10-10 a 0.22 s CSS fade ran only once the lockup had stopped, on
      an ease that did 60% of the change in the first two frames: a visible snap. */
  handoffLead: 0.25,
  handoffTail: 0.4,
  /** A skip (click, key, wheel, touch, scroll) fades everything out this fast. */
  skipFade: 0.3,

  /* ---- never trap the reader */
  /** The client must take the curtain over by this long after navigation start, or it drops it.
      The stylesheet's failsafe hides an unclaimed curtain later than this (see landing.css). */
  claimBy: 2.5,
  /** Three.js, the stills and the font must be ready this long after the claim, or the intro is
      dropped for this visit (not marked as seen, so a warm cache plays it next time). */
  readyWithin: 1.8,
} as const;

/** The word that lands: exactly what the nav brand prints. */
export const INTRO_WORD = BRAND.name;

export type Handover = "dock" | "iris";

/** The numbers the tuner can change. The rest of `INTRO` is plumbing, not taste. */
export interface IntroParams {
  fillSpeed: number;
  fillRatio: number;
  fillFloor: number;
  fillFade: number;
  screenDeg: number;
  startDiameter: number;
  moveStart: number;
  moveDur: number;
  /** The first handle of the move's cubic-bezier (`INTRO.moveEase[0]`). */
  moveEaseIn: number;
  ballCaps: number;
  gapCaps: number;
  lettersAt: number;
  letterStagger: number;
  letterDur: number;
  hold: number;
  glideDur: number;
  /** The first handle of the handover's cubic-bezier (`INTRO.glideEase[0]`). */
  glideEaseIn: number;
  handoffLead: number;
  handoffTail: number;
  handover: Handover;
}

export const INTRO_DEFAULTS: Readonly<IntroParams> = {
  fillSpeed: INTRO.fillSpeed,
  fillRatio: INTRO.fillRatio,
  fillFloor: INTRO.fillFloor,
  fillFade: INTRO.fillFade,
  screenDeg: INTRO.screenDeg,
  startDiameter: INTRO.startDiameter,
  moveStart: INTRO.moveStart,
  moveDur: INTRO.moveDur,
  moveEaseIn: INTRO.moveEase[0],
  ballCaps: INTRO.ballCaps,
  gapCaps: INTRO.gapCaps,
  lettersAt: INTRO.lettersAt,
  letterStagger: INTRO.letterStagger,
  letterDur: INTRO.letterDur,
  hold: INTRO.hold,
  glideDur: INTRO.glideDur,
  glideEaseIn: INTRO.glideEase[0],
  handoffLead: INTRO.handoffLead,
  handoffTail: INTRO.handoffTail,
  handover: INTRO.handover,
};

export const MOVE_EASE = cubicBezier(...INTRO.moveEase);
export const GLIDE_EASE = cubicBezier(...INTRO.glideEase);

/**
 * Where the ball lands in the nav's Mark, in the Mark's own 128-unit viewBox. The Mark has
 * been the camera sphere, its screens filled, since 2026-10-10 (components/brand/Mark.tsx), so this is
 * its ball's edge, read from the same file the Mark draws: the photo ball shrinks onto its own
 * white screens, and they are what stays when the photographs fade. Until then it was the
 * lens of the old OpenData mark, { cx: 63.6, cy: 56.4, r: 17 }.
 */
export const MARK_LENS: Readonly<{ cx: number; cy: number; r: number }> = sphereMarkData.orb;

export interface IntroTimeline {
  moveStart: number;
  moveEnd: number;
  /** When the first letter starts. */
  lettersAt: number;
  /** When the last letter has landed. */
  lettersEnd: number;
  /** The lockup starts its move into the nav. */
  glideStart: number;
  /** The lockup is on the nav brand. */
  glideEnd: number;
  /** The dissolve into the page's own brand begins. */
  handoffStart: number;
  /** The page's own brand has taken over and the curtain is gone. */
  end: number;
  moveDur: number;
  glideDur: number;
  letterStagger: number;
  letterDur: number;
  moveEase: (x: number) => number;
  glideEase: (x: number) => number;
}

/** The whole sequence, from the first screen to the curtain being gone. `fillEnd` is when the
    last screen has finished fading on: the handover never starts before the ball is full. */
export function introTimeline(letterCount: number, fillEnd = 0, p: Readonly<IntroParams> = INTRO_DEFAULTS): IntroTimeline {
  const moveStart = p.moveStart;
  const moveEnd = moveStart + p.moveDur;
  const lettersAt = moveStart + p.moveDur * p.lettersAt;
  const lettersEnd = lettersAt + Math.max(0, letterCount - 1) * p.letterStagger + p.letterDur;
  const glideStart = Math.max(moveEnd, lettersEnd, fillEnd) + p.hold;
  const glideEnd = glideStart + p.glideDur;
  const moveEase =
    p.moveEaseIn === INTRO.moveEase[0] ? MOVE_EASE : cubicBezier(p.moveEaseIn, INTRO.moveEase[1], INTRO.moveEase[2], INTRO.moveEase[3]);
  const glideEase =
    p.glideEaseIn === INTRO.glideEase[0] ? GLIDE_EASE : cubicBezier(p.glideEaseIn, INTRO.glideEase[1], INTRO.glideEase[2], INTRO.glideEase[3]);
  return {
    moveStart,
    moveEnd,
    lettersAt,
    lettersEnd,
    glideStart,
    glideEnd,
    handoffStart: Math.max(glideStart, glideEnd - p.handoffLead),
    end: glideEnd + p.handoffTail,
    moveDur: p.moveDur,
    glideDur: p.glideDur,
    letterStagger: p.letterStagger,
    letterDur: p.letterDur,
    moveEase,
    glideEase,
  };
}

/** When each of `n` screens (nearest the centre first) starts to fade on. The sketch's gaps,
    each divided by the fill speed. */
export function fillSchedule(n: number, p: Readonly<IntroParams> = INTRO_DEFAULTS): number[] {
  const speed = p.fillSpeed > 0 ? p.fillSpeed : 1;
  return fillTimes(n, { ratio: p.fillRatio, floor: p.fillFloor }).map((t) => t / speed);
}

/** 0 to 1: how far letter `i` (left to right) has come in at time `t`. */
export function letterProgress(t: number, i: number, tl: IntroTimeline): number {
  return smoothstep(0, 1, (t - tl.lettersAt - i * tl.letterStagger) / tl.letterDur);
}

/** 0 to 1: the eased progress of the move from the centre to the spot left of the word. */
export function moveProgress(t: number, tl: IntroTimeline): number {
  return tl.moveEase(clamp01((t - tl.moveStart) / tl.moveDur));
}

/** 0 to 1: the eased progress of the lockup's move into the nav brand. */
export function glideProgress(t: number, tl: IntroTimeline): number {
  return tl.glideEase(clamp01((t - tl.glideStart) / tl.glideDur));
}

/** 0 to 1: how far the photo ball and the word have dissolved into the page's own brand. An
    even ease-in-out, so no frame carries more of the change than its neighbours. */
export function handoffProgress(t: number, tl: IntroTimeline): number {
  return smoothstep(tl.handoffStart, tl.end, t);
}

/** 0 to 1: how far the curtain's ground has lifted, which follows the lockup's move. */
export function groundLift(t: number, tl: IntroTimeline): number {
  return t <= tl.glideStart ? 0 : smoothstep(INTRO.groundFrom, INTRO.groundTo, glideProgress(t, tl));
}

/* ------------------------------------------------------------------ the toggles */

export interface IntroToggles {
  /** `?handover=dock|iris`: the curtain dissolves (default), or opens as an iris. */
  handover: Handover;
  /** `?intro=always`: replay on every load, ignoring the once-per-session flag. `?tune` implies it. */
  always: boolean;
  /** `?tune`: the slider panel (components/marketing/IntroTuner.tsx). */
  tune: boolean;
}

/** Read from `location.search` on the client. Never from a `searchParams` prop: see
    tests/unit/landing-static.test.ts for why `/` must not take one. */
export function readIntroToggles(search: string): IntroToggles {
  const q = new URLSearchParams(search);
  const tune = q.has("tune");
  return {
    handover: q.get("handover") === "iris" ? "iris" : "dock",
    always: tune || q.get("intro") === "always",
    tune,
  };
}

/* ------------------------------------------------------------------ the tuner's numbers */

export type TuneKey = Exclude<keyof IntroParams, "handover">;
export type TuneGroup = "Screens" | "Move" | "Letters" | "Handover";

export interface TuneSlider {
  key: TuneKey;
  /** The query parameter that carries it on `/?tune`, so a tuned link reproduces the run. */
  q: string;
  label: string;
  group: TuneGroup;
  min: number;
  max: number;
  step: number;
}

/** Every slider on `/?tune`, in panel order. The ranges are also what a hand-edited link is
    clamped to. */
export const TUNE_SLIDERS: readonly TuneSlider[] = [
  { key: "fillSpeed", q: "fs", label: "Fill speed", group: "Screens", min: 0.25, max: 4, step: 0.05 },
  { key: "fillRatio", q: "fr", label: "Speed-up", group: "Screens", min: 0.6, max: 0.98, step: 0.01 },
  { key: "fillFloor", q: "ff", label: "Fastest gap", group: "Screens", min: 0.005, max: 0.2, step: 0.005 },
  { key: "fillFade", q: "fd", label: "Fade per screen", group: "Screens", min: 0.05, max: 1, step: 0.025 },
  { key: "screenDeg", q: "sd", label: "Screen size", group: "Screens", min: 10, max: 24, step: 1 },
  { key: "startDiameter", q: "sz", label: "Ball size at start", group: "Screens", min: 0.4, max: 1.6, step: 0.01 },
  { key: "moveStart", q: "ms", label: "Move starts", group: "Move", min: 0, max: 8, step: 0.01 },
  { key: "moveDur", q: "md", label: "Move length", group: "Move", min: 0.3, max: 2, step: 0.05 },
  { key: "moveEaseIn", q: "me", label: "Ease in", group: "Move", min: 0, max: 1, step: 0.01 },
  { key: "ballCaps", q: "bc", label: "Ball beside the word", group: "Move", min: 0.6, max: 2, step: 0.05 },
  { key: "gapCaps", q: "gc", label: "Gap to the word", group: "Move", min: 0, max: 1, step: 0.01 },
  { key: "lettersAt", q: "la", label: "Letters start", group: "Letters", min: 0, max: 1, step: 0.01 },
  { key: "letterStagger", q: "ls", label: "Between letters", group: "Letters", min: 0, max: 0.15, step: 0.005 },
  { key: "letterDur", q: "ld", label: "Each letter", group: "Letters", min: 0.1, max: 1, step: 0.01 },
  { key: "hold", q: "ho", label: "Hold before", group: "Handover", min: 0, max: 2, step: 0.05 },
  { key: "glideDur", q: "gd", label: "Handover length", group: "Handover", min: 0.3, max: 2, step: 0.05 },
  { key: "glideEaseIn", q: "ge", label: "Ease in", group: "Handover", min: 0, max: 1, step: 0.01 },
  { key: "handoffLead", q: "hl", label: "Dissolve starts before arrival", group: "Handover", min: 0, max: 0.8, step: 0.05 },
  { key: "handoffTail", q: "ht", label: "Dissolve ends after arrival", group: "Handover", min: 0.1, max: 1.2, step: 0.05 },
];

/** Decimal places in a step as written: 0.025 has three, so 0.225 survives a round trip. */
const decimals = (step: number) => (String(step).split(".")[1] ?? "").length;
/** A slider value as the panel, the link and the snippet all print it. */
export const roundToStep = (s: TuneSlider, v: number) => Number(v.toFixed(decimals(s.step)));

/** The tuned numbers on `/?tune&ms=3.2&...`: the defaults, overridden by whatever the link
    carries, each clamped to its slider. */
export function readTuneParams(search: string): IntroParams {
  const q = new URLSearchParams(search);
  const p: IntroParams = { ...INTRO_DEFAULTS };
  for (const s of TUNE_SLIDERS) {
    const raw = q.get(s.q);
    if (raw === null || raw.trim() === "") continue;
    const v = Number(raw);
    if (Number.isFinite(v)) p[s.key] = roundToStep(s, Math.min(s.max, Math.max(s.min, v)));
  }
  p.handover = q.get("handover") === "iris" ? "iris" : "dock";
  return p;
}

/** The query string that reproduces `p` on `/?tune`. Only what differs from the defaults. */
export function tuneSearch(p: Readonly<IntroParams>): string {
  const parts = ["tune"];
  for (const s of TUNE_SLIDERS) {
    const v = roundToStep(s, p[s.key]);
    if (v !== roundToStep(s, INTRO_DEFAULTS[s.key])) parts.push(`${s.q}=${v}`);
  }
  if (p.handover !== INTRO_DEFAULTS.handover) parts.push(`handover=${p.handover}`);
  return `?${parts.join("&")}`;
}

/** The lines of `INTRO` above that `p` changes, ready to paste over the old ones. */
export function introSnippet(p: Readonly<IntroParams>): string {
  const v = (k: TuneKey) => {
    const s = TUNE_SLIDERS.find((x) => x.key === k);
    return String(s ? roundToStep(s, p[k]) : p[k]);
  };
  return [
    `  fillSpeed: ${v("fillSpeed")},`,
    `  fillRatio: ${v("fillRatio")},`,
    `  fillFloor: ${v("fillFloor")},`,
    `  fillFade: ${v("fillFade")},`,
    `  screenDeg: ${v("screenDeg")},`,
    `  ballCaps: ${v("ballCaps")},`,
    `  gapCaps: ${v("gapCaps")},`,
    `  startDiameter: ${v("startDiameter")},`,
    `  moveStart: ${v("moveStart")},`,
    `  moveDur: ${v("moveDur")},`,
    `  moveEase: [${v("moveEaseIn")}, ${INTRO.moveEase.slice(1).join(", ")}] as const,`,
    `  lettersAt: ${v("lettersAt")},`,
    `  letterStagger: ${v("letterStagger")},`,
    `  letterDur: ${v("letterDur")},`,
    `  hold: ${v("hold")},`,
    `  glideDur: ${v("glideDur")},`,
    `  glideEase: [${v("glideEaseIn")}, ${INTRO.glideEase.slice(1).join(", ")}] as const,`,
    `  handoffLead: ${v("handoffLead")},`,
    `  handoffTail: ${v("handoffTail")},`,
    `  handover: "${p.handover}" as Handover,`,
  ].join("\n");
}

/* ------------------------------------------------------------------ the gate */

/** sessionStorage key: set when the sequence starts, so it plays once per browser session. */
export const INTRO_SESSION_KEY = "pv.landing.intro.v1";

/**
 * Runs inline, straight after the curtain in the server HTML, before the first paint. It only
 * sets `data-on` on the curtain when the intro may play, so a visit that will not get it never
 * sees a black frame, and a visit that will is black from the first frame rather than showing
 * the hero and then cutting to black. With no script at all the attribute never appears and the
 * curtain never shows.
 *
 * It says no to: reduced motion, no WebGL in the browser, a deep link (`#...`), a back/forward
 * visit, Save-Data or a 2G/3G connection, and a session that has already seen it, unless
 * `?intro=always` or `?tune`. A JSON-encoded key keeps the string safe to inline.
 */
export const INTRO_GATE_SCRIPT = `(function(){try{var c=document.currentScript,el=c&&c.previousElementSibling;if(!el)return;var q=location.search,always=/[?&](intro=always|tune)(=|&|$)/.test(q);if(window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches)return;if(!window.WebGLRenderingContext)return;if(location.hash&&location.hash!=="#")return;var n=navigator.connection;if(n&&(n.saveData||/2g|3g/.test(n.effectiveType||"")))return;if(!always){var e=performance.getEntriesByType&&performance.getEntriesByType("navigation")[0];if(e&&e.type==="back_forward")return;try{if(sessionStorage.getItem(${JSON.stringify(
  INTRO_SESSION_KEY,
)}))return}catch(x){}}el.setAttribute("data-on","")}catch(x){}})();`;

/* ------------------------------------------------------------------ the tuner's handle */

export type IntroState = "loading" | "playing" | "paused" | "ended" | "unavailable";

export interface IntroFrame {
  t: number;
  /** Screens that have started to fade on. */
  lit: number;
  screens: number;
}

/** What components/marketing/SphereIntro.tsx hands the tuner on `/?tune`, and nothing else. */
export interface IntroControl {
  readonly params: Readonly<IntroParams>;
  readonly timeline: IntroTimeline;
  /** Screens on the ball now (0 until it is built). */
  readonly screens: number;
  readonly state: IntroState;
  /** Why the intro could not start, when `state` is "unavailable". */
  readonly reason: string;
  /** How the last run ended: "arrived", or what skipped it. */
  readonly endedBy: string;
  /** Start again from the first screen, with new numbers if given. A new screen size rebuilds
      the ball first. */
  replay(p?: IntroParams): void;
  /** New numbers: redrawn in place while held, otherwise a replay with them. */
  update(p: IntroParams): void;
  /** Hold the sequence at `t` seconds. */
  seek(t: number): void;
  play(): void;
  pause(): void;
  /** Playback speed: 1 is real time. */
  setRate(r: number): void;
  onFrame: ((f: IntroFrame) => void) | null;
  onState: ((s: IntroState) => void) | null;
}
