"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { createCameraSphere, logLerp, smoothstep, webglAvailable, type CameraSphere } from "@/lib/marketing/cameraSphere";
import { SPHERE_STILLS } from "@/lib/marketing/sphere-stills.data";
import {
  INTRO,
  INTRO_DEFAULTS,
  INTRO_GATE_SCRIPT,
  INTRO_SESSION_KEY,
  INTRO_WORD,
  MARK_LENS,
  fillSchedule,
  glideProgress,
  groundLift,
  handoffProgress,
  introTimeline,
  letterProgress,
  moveProgress,
  readIntroToggles,
  readTuneParams,
  type IntroControl,
  type IntroParams,
  type IntroState,
  type IntroTimeline,
  type IntroToggles,
} from "@/lib/marketing/sphereIntro";

/* The slider panel, fetched only on `/?tune`: no other visit downloads a byte of it. */
const IntroTuner = dynamic(() => import("@/components/marketing/IntroTuner"), { ssr: false });

/**
 * THE OPENING INTRO on `/`. A full-screen curtain plays the camera sphere (lib/marketing/
 * cameraSphere.ts): the stills fade on from the centre outwards, the ball lands left of the
 * wordmark with the word riding beside it, and the lockup then docks into the nav brand while the
 * curtain dissolves onto the hero, which is server-rendered underneath and never changes.
 * lib/marketing/sphereIntro.ts holds every number and says why the handover is a dock.
 *
 * WHAT KEEPS IT FROM TRAPPING ANYONE.
 *   - The curtain is shown only when the inline gate script (in the server HTML, before first
 *     paint) says so. No script, reduced motion, no WebGL, a deep link, a back/forward visit or
 *     a slow connection: no curtain, no WebGL context, nothing loaded.
 *   - Any click, key, wheel, touch or scroll skips it (a fast fade). So does the visually hidden
 *     "Skip intro" button, which sits outside the aria-hidden curtain.
 *   - If the client has not taken the curtain over by `INTRO.claimBy`, or the sphere is not
 *     ready `INTRO.readyWithin` later, the intro is dropped and the curtain fades. A CSS
 *     failsafe in landing.css hides a curtain no script ever claimed.
 *   - It plays once per browser session (`?intro=always` replays it).
 *
 * THE RULES OF THE PAGE. This adds no scroll listener: a scroll is noticed by reading
 * `scrollY` inside this component's own frame loop, which runs only while the intro runs and
 * stops for good when it ends. It sets no React state per frame; every frame is direct style
 * writes. The canvas is made here, not by React, so React strict mode's double mount gets two
 * canvases and two contexts instead of two spheres fighting over one, and the context is handed
 * back when the intro ends.
 *
 * WHY THE CURTAIN IS THREE FIXED LAYERS AND NOT ONE BOX. The ball is drawn on an opaque black
 * canvas (the sketch's bloom pass needs one) and composited with `mix-blend-mode: screen`, so its
 * black vanishes and only the ball shows over whatever is behind it. A blend only reaches the
 * page if the canvas's parent stacking context IS the page, so the ground, the canvas and the
 * word are siblings in `.lp-root`'s stacking context, and the wrapper is a plain block that
 * makes no stacking context of its own (no position, no opacity, no transform). Give the
 * wrapper any of those and the docking ball drags a black rectangle across the hero.
 *
 * THE TUNER. On `/?tune` the intro plays on every load with the numbers the link carries, and
 * components/marketing/IntroTuner.tsx gets an `IntroControl` to replay, hold and scrub it. A run
 * then ends by fading the curtain and keeping the ball, rather than handing everything back, so
 * the next replay starts at once. Input inside the panel never skips the intro.
 *
 * `window.__freezeT = <seconds>` holds the clock, for review screenshots. `window.__pvIntro`
 * is a read-only handle for the same.
 */

interface IntroDebug {
  readonly phase: Phase;
  /** When the first screen started, ms after navigation start (0 until then). */
  readonly startedAt: number;
  readonly t: number;
  readonly timeline: IntroTimeline;
  readonly toggles: IntroToggles;
  /** The tuner's handle, on `/?tune` only. */
  readonly control: IntroControl | null;
}

declare global {
  interface Window {
    __freezeT?: number;
    __pvIntro?: IntroDebug;
    /** How the last intro ended, and at what time in its sequence. For review and tests. */
    __pvIntroEnded?: { by: string; t: number };
  }
}

type Phase = "wait" | "play" | "hand" | "out";

/** Below this width the page is the phone layout (LandingStage.tsx and landing.css agree). */
const PHONE_MAX = 760;

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

function runIntro(el: HTMLElement, skipBtn: HTMLButtonElement, onControl?: (c: IntroControl | null) => void): () => void {
  const root = el.closest<HTMLElement>(".lp-root");
  const ground = el.querySelector<HTMLElement>(".lp-intro-ground");
  const wordEl = el.querySelector<HTMLElement>(".lp-intro-word");
  const brand = root?.querySelector<HTMLElement>(".lp-nav .lp-brand") ?? null;
  const mark = brand?.querySelector<HTMLElement>(".tn-mark") ?? null;
  /* The name, not the Mark (which is a span too since it became a masked image). */
  const brandText = brand?.querySelector<HTMLElement>(":scope > span:not(.tn-mark)") ?? null;
  const toggles = readIntroToggles(window.location.search);
  const tune = toggles.tune;
  const dev = process.env.NODE_ENV !== "production";

  /* ---- the numbers: the settled ones, or the ones a tuner link carries */
  let p: IntroParams = tune ? readTuneParams(window.location.search) : { ...INTRO_DEFAULTS, handover: toggles.handover };
  let tl: IntroTimeline = introTimeline(INTRO_WORD.length, 0, p);
  /** When each screen (nearest the centre first) starts to fade on. */
  let T0: number[] = [];

  /* ---- the tuner's handle. Methods are function declarations below, so hoisted. */
  let state: IntroState = "loading";
  let reason = "";
  let endedBy = "";
  let rate = 1;
  let paused = false;
  const control: IntroControl | null = tune
    ? {
        get params() {
          return p;
        },
        get timeline() {
          return tl;
        },
        get screens() {
          return T0.length;
        },
        get state() {
          return state;
        },
        get reason() {
          return reason;
        },
        get endedBy() {
          return endedBy;
        },
        replay: (next?: IntroParams) => replay(next),
        update: (next: IntroParams) => update(next),
        seek: (t: number) => seek(t),
        play: () => play(),
        pause: () => pause(),
        setRate: (r: number) => {
          rate = Math.max(0.05, Math.min(4, r));
        },
        onFrame: null,
        onState: null,
      }
    : null;
  onControl?.(control);
  function setState(s: IntroState) {
    if (s === state) return;
    state = s;
    control?.onState?.(s);
  }

  /* Not playing after all: fade the curtain (it may already be black on screen) and let go. */
  const drop = (why: string) => {
    reason = why;
    setState("unavailable");
    el.dataset.phase = "out";
    const kids = Array.from(el.children) as HTMLElement[];
    for (const n of kids) {
      n.style.transition = `opacity ${INTRO.skipFade * 1000}ms ease`;
      n.style.opacity = "0";
    }
    const timer = window.setTimeout(() => {
      el.removeAttribute("data-on");
      el.removeAttribute("data-phase");
      for (const n of kids) n.removeAttribute("style");
    }, INTRO.skipFade * 1000 + 40);
    return () => {
      window.clearTimeout(timer);
      onControl?.(null);
    };
  };
  if (!root || !ground || !wordEl) return drop("the page has no curtain to play it on");

  /* The gate ran before paint. These are the checks it could not make: a context we can really
     get (a blocklisted GPU passes the gate's cheap test), a scroll the browser restored, and
     time. The tuner waives the clock and puts the page back at the top. */
  if (tune && window.scrollY > 2) window.scrollTo({ top: 0, behavior: "instant" });
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return drop("reduced motion is on");
  if (!tune && performance.now() > INTRO.claimBy * 1000) return drop("the page took too long to start");
  if (window.scrollY > 2) return drop("the page was already scrolled");
  if (!webglAvailable()) return drop("this browser gives no WebGL context");

  let phase: Phase = "wait";
  el.dataset.phase = phase;

  /* ---- the word, one span per letter, and a zero-size span that sits on the baseline */
  const letters = [...INTRO_WORD].map((ch) => {
    const s = document.createElement("span");
    s.textContent = ch;
    wordEl.appendChild(s);
    return s;
  });
  const base = document.createElement("span");
  base.className = "lp-intro-base";
  wordEl.appendChild(base);

  /* ---- the canvas, made here (see the header). A new screen size gets a new one. */
  const makeCanvas = () => {
    const c = document.createElement("canvas");
    c.className = "lp-intro-ball";
    c.setAttribute("aria-hidden", "true");
    el.insertBefore(c, wordEl);
    return c;
  };
  let canvas = makeCanvas();

  let sphere: CameraSphere | null = null;
  /** The screen size the current ball was built with. */
  let sphereDeg = 0;
  /** The screen size of the ball being built, while one is. */
  let pendingDeg = 0;
  let building = 0;
  let disposed = false;
  let raf = 0;
  let endTimer = 0;
  let clock = 0;
  let lastNow = 0;
  let lastT = -1;
  let needLayout = true;
  const claimAt = performance.now();
  let startedAt = 0;
  let y0 = window.scrollY;
  const stills = SPHERE_STILLS.map((s) => s.src);

  /* ---- styles the frames write, written only when they change */
  const written = new Map<HTMLElement, Map<string, string>>();
  function put(node: HTMLElement, prop: "transform" | "opacity" | "mask-image", v: string) {
    let m = written.get(node);
    if (!m) written.set(node, (m = new Map()));
    if (m.get(prop) === v) return;
    m.set(prop, v);
    node.style.setProperty(prop, v);
    if (prop === "mask-image") node.style.setProperty("-webkit-mask-image", v);
  }

  /* ---- layout: measured once, and again on a resize */
  let W = 1;
  let H = 1;
  let r0 = 1;
  /** The ball's place left of the word, and the word's rest position and metrics. */
  const spot = { x: 0, y: 0, r: 1, gap: 0 };
  const word = { x0: 0, y0: 0, capOff: 0 };
  /** Where the lockup ends: the ball on the Mark's own ball, the word on the brand's text. */
  let dock: { x: number; y: number; r: number; s: number; gap: number; off: number } | null = null;

  function measureCap(fontPx: number, cs: CSSStyleDeclaration): number {
    const g = document.createElement("canvas").getContext("2d");
    if (!g) return fontPx * 0.72;
    g.font = `${cs.fontWeight} ${fontPx}px ${cs.fontFamily}`;
    return g.measureText("H").actualBoundingBoxAscent || fontPx * 0.72;
  }

  function layout() {
    needLayout = false;
    lastT = -1;
    W = document.documentElement.clientWidth || window.innerWidth;
    H = window.innerHeight;
    const mob = W < PHONE_MAX;
    sphere?.resize(W, H, Math.min(window.devicePixelRatio || 1, mob ? 1.75 : 2));
    r0 = (p.startDiameter * Math.min(W, H)) / 2;

    /* Measure the word at rest: no transform, and the stylesheet's own size first. The next
       frame writes the transform back, so forget the one it last wrote. */
    written.delete(wordEl!);
    wordEl!.style.transform = "none";
    wordEl!.style.fontSize = "";
    const cs = getComputedStyle(wordEl!);
    let F = Math.min(INTRO.maxFontPx, parseFloat(cs.fontSize) || INTRO.maxFontPx);
    let cap = measureCap(F, cs);
    let wordW = wordEl!.offsetWidth;
    const room = W - 2 * Math.max(INTRO.minMarginPx, W * 0.042);
    const lockupW = cap * (p.ballCaps + p.gapCaps) + wordW;
    if (lockupW > room) {
      F *= room / lockupW;
      wordEl!.style.fontSize = `${F.toFixed(2)}px`;
      cap = measureCap(F, cs);
      wordW = wordEl!.offsetWidth;
    } else {
      wordEl!.style.fontSize = `${F}px`;
    }

    /* Ball, gap and word centred as one lockup, on the capitals' middle line, which is the
       screen's middle line, so the ball's move is a straight line across. */
    const ballD = cap * p.ballCaps;
    const gap = cap * p.gapCaps;
    const left = (W - (ballD + gap + wordW)) / 2;
    word.capOff = base.offsetTop - cap / 2;
    word.x0 = left + ballD + gap;
    word.y0 = H / 2 - word.capOff;
    wordEl!.style.left = `${word.x0.toFixed(2)}px`;
    wordEl!.style.top = `${word.y0.toFixed(2)}px`;
    spot.x = left + ballD / 2;
    spot.y = H / 2;
    spot.r = ballD / 2;
    spot.gap = gap;

    /* The dock. The brand's baseline is found the same way as the word's: a text range gives
       the top of the font's content area, and the baseline sits the same share of the font
       size below it at any size. */
    dock = null;
    if (mark && brandText && brandText.firstChild) {
      const range = document.createRange();
      range.selectNodeContents(letters[0]);
      const wordTop = range.getBoundingClientRect().top;
      const baseY = base.getBoundingClientRect().top;
      const k = (baseY - wordTop) / F;
      range.selectNodeContents(brandText);
      const bt = range.getBoundingClientRect();
      const fb = parseFloat(getComputedStyle(brandText).fontSize) || 17;
      const m = mark.getBoundingClientRect();
      if (m.width > 0 && bt.width > 0) {
        const lens = {
          x: m.left + (MARK_LENS.cx / 128) * m.width,
          y: m.top + (MARK_LENS.cy / 128) * m.height,
          r: (MARK_LENS.r / 128) * m.width,
        };
        const capMid = bt.top + k * fb - (cap * fb) / F / 2;
        dock = { x: lens.x, y: lens.y, r: lens.r, s: fb / F, gap: bt.left - (lens.x + lens.r), off: capMid - lens.y };
      }
    }
  }

  /** The fill and the timeline, from the numbers and the ball as built. */
  function retime() {
    const n = sphere ? sphere.tiles.length : 0;
    T0 = fillSchedule(n, p);
    tl = introTimeline(letters.length, n ? T0[n - 1] + p.fillFade : 0, p);
  }

  /* ---- one frame of the sequence at time t. Returns how many screens have started. */
  function draw(t: number): number {
    if (!sphere) return 0;
    /* the ball: centred and large, then the move to its place left of the word */
    const k = moveProgress(t, tl);
    let r = logLerp(r0, spot.r, k);
    let cx = lerp(W / 2, spot.x, k);
    let cy = lerp(H / 2, spot.y, k);
    /* the handover: the ball onto the Mark (the same sphere, its screens filled), the word to the brand's text */
    let S = 1;
    let gap = spot.gap;
    let off = 0;
    if (dock && t > tl.glideStart) {
      const g = glideProgress(t, tl);
      r = logLerp(spot.r, dock.r, g);
      cx = lerp(spot.x, dock.x, g);
      cy = lerp(spot.y, dock.y, g);
      S = logLerp(1, dock.s, g);
      gap = lerp(spot.gap, dock.gap, g);
      off = lerp(0, dock.off, g);
    }
    sphere.placeBall(r, cx, cy);
    let lit = 0;
    for (let i = 0; i < T0.length; i++) {
      if (t >= T0[i]) lit++;
      sphere.setTileOpacity(i, smoothstep(T0[i], T0[i] + p.fillFade, t));
    }
    sphere.render();

    /* The word rides with the ball: a fixed gap off its right edge, on its middle line. At rest
       this is exactly where layout() put it, so the offset is zero once the ball has landed. */
    const X = cx + r + gap - word.x0;
    const Y = cy + off - word.y0 - S * word.capOff;
    put(wordEl!, "transform", `translate3d(${X.toFixed(2)}px, ${Y.toFixed(2)}px, 0) scale(${S.toFixed(4)})`);

    /* The handoff: as the lockup settles on the nav brand, the photo ball and the word dissolve
       into the brand itself (the Mark is this ball with its screens filled white, the text is this word), one
       opacity rising as the other falls, on the intro's own clock. */
    const h = handoffProgress(t, tl);
    put(canvas, "opacity", (1 - h).toFixed(3));
    put(wordEl!, "opacity", (1 - h).toFixed(3));
    if (brand) put(brand, "opacity", h.toFixed(3));
    for (let i = 0; i < letters.length; i++) {
      const lp = letterProgress(t, i, tl);
      put(letters[i], "opacity", lp.toFixed(3));
      put(letters[i], "transform", `translateX(${(-(1 - lp) * INTRO.letterSlideEm).toFixed(3)}em)`);
    }

    /* the curtain's ground: a dissolve, or an iris from the ball's landing spot */
    const gp = groundLift(t, tl);
    if (p.handover === "iris") {
      const far = Math.hypot(Math.max(spot.x, W - spot.x), Math.max(spot.y, H - spot.y)) + 40;
      const R = gp <= 0 ? 0 : logLerp(Math.max(1, spot.r), far, gp);
      put(
        ground!,
        "mask-image",
        gp <= 0 ? "none" : `radial-gradient(circle at ${spot.x.toFixed(1)}px ${spot.y.toFixed(1)}px, transparent ${R.toFixed(1)}px, #000 ${(R + 24).toFixed(1)}px)`,
      );
    } else {
      put(ground!, "opacity", (1 - gp).toFixed(3));
    }
    return lit;
  }

  /* ---- the loop: one frame callback for the life of a run, and none after it */
  function kick() {
    if (!raf && !disposed) raf = requestAnimationFrame(frame);
  }
  function frame(now: number) {
    raf = 0;
    if (disposed || phase === "out") return;
    /* A scroll from anywhere (scrollbar, keyboard, a script) ends the intro. Read, not listened to. */
    if (Math.abs(window.scrollY - y0) > 2) return skip("scroll");
    if (phase === "wait") {
      if (!tune && now - claimAt > INTRO.readyWithin * 1000 * (dev ? 4 : 1)) return skip("not ready in time");
      raf = requestAnimationFrame(frame);
      return;
    }
    /* The clock advances at most 50 ms a frame: a hidden tab or a long first frame (textures
       uploading) slows the sequence for a moment instead of jumping it. */
    const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0;
    lastNow = now;
    if (!paused) clock += dt * rate;
    const fz = window.__freezeT;
    const frozen = typeof fz === "number" && Number.isFinite(fz);
    const t = frozen ? fz : clock;
    if (needLayout) layout();
    if (t !== lastT) {
      lastT = t;
      const ph: Phase = t >= tl.glideStart ? "hand" : "play";
      if (ph !== phase) {
        phase = ph;
        el.dataset.phase = phase;
      }
      const lit = draw(t);
      control?.onFrame?.({ t, lit, screens: T0.length });
    }
    if (!frozen && !paused && t >= tl.end) return arrive();
    /* Held by the tuner: the loop sleeps until seek() or play() wakes it. */
    if (paused) return;
    raf = requestAnimationFrame(frame);
  }

  function begin() {
    if (disposed || phase !== "wait") return;
    startedAt = performance.now();
    /* The frames set the nav brand's opacity from here on; its stylesheet fade would lag them. */
    if (brand) brand.style.transition = "none";
    phase = "play";
    el.dataset.phase = phase;
    try {
      sessionStorage.setItem(INTRO_SESSION_KEY, "1");
    } catch {
      /* private mode or blocked storage: it plays again next visit, which is harmless */
    }
    retime();
    layout();
    clock = 0;
    lastNow = 0;
    paused = false;
    setState("playing");
    kick();
  }

  /* ---- the two ways out: arrive (the handoff has already dissolved everything) or skip (a fast
     fade). */
  function fadeOut(ms: number) {
    /* Skipped while the page was still hidden: the ground keeps taking taps until it has gone.
       On a touch screen the tap's click is aimed after the touch ends, and with the ground let
       go at once it would land on whatever link was hidden under the reader's thumb. */
    if (phase === "wait" || phase === "play") ground!.style.pointerEvents = "auto";
    phase = "out";
    el.dataset.phase = phase;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    releaseBrand();
    const tr = `opacity ${ms}ms cubic-bezier(.16, 1, .3, 1)`;
    for (const n of [ground!, canvas, wordEl!]) {
      n.style.transition = tr;
      n.style.opacity = "0";
    }
    window.clearTimeout(endTimer);
    endTimer = window.setTimeout(tune ? rest : finish, ms + 40);
  }
  /** The nav brand back to its stylesheet: visible, with its own fade, once the curtain is out. */
  function releaseBrand() {
    if (!brand) return;
    written.delete(brand);
    brand.style.removeProperty("opacity");
    brand.style.removeProperty("transition");
  }
  /** Arrived: the handoff has already dissolved the lockup into the brand, so there is nothing
      left to fade. The curtain is let go at once, and nothing on screen changes. */
  function arrive() {
    endedBy = "arrived";
    window.__pvIntroEnded = { by: endedBy, t: clock };
    phase = "out";
    el.dataset.phase = phase;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    releaseBrand();
    if (tune) {
      for (const n of [ground!, canvas, wordEl!]) n.style.opacity = "0";
      rest();
    } else {
      finish();
    }
  }
  function skip(by: string) {
    if (disposed || phase === "out") return;
    endedBy = by;
    window.__pvIntroEnded = { by, t: clock };
    fadeOut(INTRO.skipFade * 1000);
  }

  /* ---- the tuner's verbs. A run on `/?tune` ends at rest: curtain faded, ball kept. */
  function rest() {
    ground!.style.pointerEvents = "";
    if (state !== "unavailable") setState("ended");
  }
  /** Bring the faded curtain back, every style to be written afresh by the next frame. */
  function revive() {
    window.clearTimeout(endTimer);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    written.clear();
    for (const n of [ground!, canvas, wordEl!]) {
      n.style.transition = "";
      n.style.opacity = "";
    }
    ground!.style.pointerEvents = "";
    ground!.style.removeProperty("mask-image");
    ground!.style.removeProperty("-webkit-mask-image");
    if (brand) brand.style.transition = "none";
    el.setAttribute("data-on", "");
  }
  function replay(next?: IntroParams) {
    if (disposed) return;
    if (next) p = { ...next };
    window.scrollTo({ top: 0, behavior: "instant" });
    y0 = 0;
    const fromPage = phase === "out";
    revive();
    /* From the page (a loop, or Replay after a run), the curtain fades back over it instead of
       cutting to black: the first frame writes the ground's opacity back to 1 under this
       transition. */
    if (fromPage) {
      ground!.style.transition = "opacity 450ms cubic-bezier(.4, 0, .2, 1)";
      ground!.style.opacity = "0";
      void ground!.offsetWidth;
      window.setTimeout(() => {
        if (!disposed) ground!.style.removeProperty("transition");
      }, 520);
    }
    phase = "wait";
    el.dataset.phase = phase;
    needLayout = true;
    if (!sphere || p.screenDeg !== sphereDeg) {
      /* already building this size: it starts with the new numbers when it is ready */
      if (!sphere && state === "loading" && pendingDeg === p.screenDeg) return;
      setState("loading");
      buildSphere();
      return;
    }
    begin();
  }
  /** New numbers. Held, the frame redraws in place with them, so a size or a gap can be judged
      on the landed lockup; otherwise the run starts again. */
  function update(next: IntroParams) {
    if (disposed) return;
    if (state === "paused" && sphere && next.screenDeg === sphereDeg) {
      p = { ...next };
      retime();
      needLayout = true;
      lastT = -1;
      kick();
      return;
    }
    replay(next);
  }
  function seek(t: number) {
    if (disposed || !sphere) return;
    if (phase === "out" || phase === "wait") {
      revive();
      phase = "play";
      el.dataset.phase = phase;
    }
    paused = true;
    clock = Math.max(0, t);
    lastT = -1;
    lastNow = 0;
    setState("paused");
    kick();
  }
  function play() {
    if (disposed || !sphere) return;
    if (phase === "out" || phase === "wait" || clock >= tl.glideEnd) return replay();
    paused = false;
    lastNow = 0;
    setState("playing");
    kick();
  }
  function pause() {
    if (state !== "playing") return;
    paused = true;
    setState("paused");
  }

  /* ---- input: any of these ends the intro. A key held with Cmd, Ctrl or Alt is a browser or
     system shortcut (a screenshot, a new tab), not the reader reaching for the page. Nothing
     done inside the tuner counts. */
  const inTuner = (e: Event) => tune && e.target instanceof Element && e.target.closest(".lp-tune") !== null;
  const onKey = (e: KeyboardEvent) => {
    if (inTuner(e)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Shift" || e.key === "Meta" || e.key === "Control" || e.key === "Alt") return;
    skip("key");
  };
  const onAny = (e: Event) => {
    if (inTuner(e)) return;
    skip(e.type);
  };
  const onResize = () => {
    needLayout = true;
    if (paused) {
      lastT = -1;
      kick();
    }
  };
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("pointerdown", onAny, true);
  window.addEventListener("wheel", onAny, { passive: true });
  window.addEventListener("touchstart", onAny, { passive: true });
  window.addEventListener("resize", onResize);
  skipBtn.addEventListener("click", onAny);

  /* ---- assets. The stills wait for the hero's own still, so they never queue ahead of it. */
  const heroImg = root.querySelector<HTMLImageElement>(".lp-rm-hero");
  const heroReady = new Promise<void>((done) => {
    if (!heroImg || heroImg.complete) return done();
    heroImg.addEventListener("load", () => done(), { once: true });
    heroImg.addEventListener("error", () => done(), { once: true });
  });
  const fontReady = document.fonts
    ? document.fonts
        .load(`560 100px ${getComputedStyle(wordEl).fontFamily}`)
        .then(() => document.fonts.ready)
        .then(() => undefined, () => undefined)
    : Promise.resolve();

  function buildSphere() {
    const id = ++building;
    if (sphere) {
      try {
        sphere.dispose(true);
      } catch {
        /* a lost context frees nothing; it is gone either way */
      }
      sphere = null;
    }
    /* A canvas has one context, and an earlier ball (or an abandoned build) has already taken
       and lost this one. */
    if (id > 1) {
      canvas.remove();
      canvas = makeCanvas();
    }
    const deg = p.screenDeg;
    pendingDeg = deg;
    createCameraSphere({
      canvas,
      stills,
      screenDeg: deg,
      maxDpr: W < PHONE_MAX ? 1.75 : 2,
      onContextLost: () => skip("context lost"),
    })
      .then(async (s) => {
        await fontReady;
        if (disposed || id !== building || phase !== "wait") {
          s.dispose(true);
          return;
        }
        sphere = s;
        sphereDeg = deg;
        begin();
      })
      .catch(() => {
        reason = "the camera stills or three.js failed to load";
        skip("sphere failed");
        setState("unavailable");
      });
  }

  heroReady.then(() => {
    if (!disposed && phase === "wait") buildSphere();
  });

  raf = requestAnimationFrame(frame);

  window.__pvIntro = {
    get phase() {
      return phase;
    },
    get t() {
      return typeof window.__freezeT === "number" ? window.__freezeT : clock;
    },
    get startedAt() {
      return startedAt;
    },
    get timeline() {
      return tl;
    },
    toggles,
    control,
  };

  /* ---- teardown. `keepGate` leaves `data-on` so a remount (strict mode) can take over. */
  let ended = false;
  function teardown(keepGate: boolean) {
    if (ended) return;
    ended = true;
    disposed = true;
    if (raf) cancelAnimationFrame(raf);
    window.clearTimeout(endTimer);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("pointerdown", onAny, true);
    window.removeEventListener("wheel", onAny);
    window.removeEventListener("touchstart", onAny);
    window.removeEventListener("resize", onResize);
    skipBtn.removeEventListener("click", onAny);
    try {
      sphere?.dispose(true);
    } catch {
      /* a lost context frees nothing; it is gone either way */
    }
    sphere = null;
    canvas.remove();
    wordEl!.textContent = "";
    wordEl!.removeAttribute("style");
    ground!.removeAttribute("style");
    releaseBrand();
    el.removeAttribute("data-phase");
    if (!keepGate) el.removeAttribute("data-on");
    delete window.__pvIntro;
    onControl?.(null);
  }
  function finish() {
    teardown(false);
  }
  return () => teardown(true);
}

export default function SphereIntro() {
  const curtainRef = useRef<HTMLDivElement | null>(null);
  const skipRef = useRef<HTMLButtonElement | null>(null);
  const controlRef = useRef<IntroControl | null>(null);
  /* Set once, on `/?tune`, never per frame. */
  const [tuning, setTuning] = useState(false);

  useEffect(() => {
    const el = curtainRef.current;
    const skipBtn = skipRef.current;
    if (!el || !skipBtn || !el.hasAttribute("data-on")) return;
    const stop = runIntro(el, skipBtn, (c) => {
      controlRef.current = c;
    });
    if (controlRef.current) setTuning(true);
    return stop;
  }, []);

  return (
    <>
      {/* `suppressHydrationWarning`: the gate script below sets `data-on` on this element
          before React hydrates it, and React must leave that attribute alone. */}
      <div ref={curtainRef} className="lp-intro" aria-hidden="true" suppressHydrationWarning>
        <div className="lp-intro-ground" />
        <div className="lp-intro-word" />
      </div>
      <script dangerouslySetInnerHTML={{ __html: INTRO_GATE_SCRIPT }} />
      <button ref={skipRef} type="button" className="lp-intro-skip">
        Skip intro
      </button>
      {tuning && <IntroTuner control={controlRef} />}
    </>
  );
}
