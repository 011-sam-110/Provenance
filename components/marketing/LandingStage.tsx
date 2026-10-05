"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import {
  bandAt,
  bandMetrics,
  clamp,
  createFocusEaser,
  docks,
  ease,
  easeOut,
  formatCoord,
  globeAt,
  LENS_TAGS,
  lensPlaceAt,
  lerp,
  marks,
  mixRGB,
  paint,
  pinHeights,
  prepareGlobeData,
  seg,
  smooth,
  stateKey,
  staticFlatMap,
  staticGlobe,
  timeline,
  type Box,
  type GlobeData,
  type GlobeSnapshot,
  type GlobeSpec,
  type GlobeState,
  type LandGeoJson,
  type Stage,
} from "@/lib/marketing/landingGlobe";

/**
 * The landing page's one stage: a fixed canvas between the section grounds and the copy,
 * and the loop that drives it.
 *
 * HOW THIS OBEYS THE ONE-SCROLL-SUBSCRIBER RULE. `CLAUDE.md` allows `/` a single scroll
 * subscriber and forbids React state per frame. This component IS that subscriber. It adds
 * exactly one passive `scroll` listener, and the listener does one thing: it wakes the rAF
 * loop. The loop smooths one scroll value, asks `globeAt` for the globe's state, paints the
 * canvas only when that state changed, and writes CSS custom properties for every section
 * effect (the iris, the card track, the console opening, the nav's ink). It sets no React
 * state at all. Pins are CSS `position: sticky`. When the scroll value has settled and
 * nothing is easing, the loop stops, so an idle page draws nothing. It also stops while the
 * tab is hidden.
 *
 * Do not add a second listener for a new effect. Compute it in `applyUI` from the same `y`.
 *
 * WHY THE DATA IS A FILE AND NOT A REQUEST. See the header of `lib/marketing/landingGlobe.ts`.
 * The two fetches below are static files. The landing page makes no `/api/*` call.
 *
 * REDUCED MOTION is a different page, not a slower one. `app/landing.css` lays every section
 * out in normal flow under `prefers-reduced-motion: reduce`, and this component then draws
 * each globe once into an in-flow canvas and starts no loop and no scroll listener.
 */

const SNAPSHOT_URL = "/marketing/globe-snapshot.json";
const LAND_URL = "/geo/countries-110m.geojson";
const STILL_HERO = "/marketing/landing/still-hero.webp";
const STILL_WHOLE = "/marketing/landing/still-whole.webp";

/** Below this width the page is the phone layout. `app/landing.css` breaks at the same px. */
const PHONE_MAX = 760;

/** A small handle for the review screenshots and the e2e tests. Read only. */
interface LandingDebug {
  /** True once the snapshot and the stills this mode needs have arrived. */
  readonly ready: boolean;
  /** How many times the canvas has been painted. It must not move while the page is at rest. */
  readonly draws: number;
  /** How long the last paint took, ms. */
  readonly drawMs: number;
  readonly reducedMotion: boolean;
  /** Named scroll positions, one per moment of the page. */
  marks(): Record<string, number>;
  /** Scroll to a named moment. Returns the scroll position, or -1 for an unknown name. */
  go(name: string): number;
}
declare global {
  interface Window {
    __pvLanding?: LandingDebug;
  }
}

/* The raw files, fetched once per page life. A remount (React strict mode, or the visitor
   switching reduced motion on) reuses the same promise instead of fetching 500 KB again. */
let rawData: Promise<[GlobeSnapshot, LandGeoJson]> | null = null;
function loadRaw(): Promise<[GlobeSnapshot, LandGeoJson]> {
  if (!rawData) {
    const get = <T,>(url: string): Promise<T> =>
      fetch(url).then((r) => {
        if (!r.ok) throw new Error(`${url} answered ${r.status}`);
        return r.json() as Promise<T>;
      });
    const p = Promise.all([get<GlobeSnapshot>(SNAPSHOT_URL), get<LandGeoJson>(LAND_URL)]);
    /* A failed load must not be remembered, or the globe stays empty until a reload. */
    p.catch(() => {
      if (rawData === p) rawData = null;
    });
    rawData = p;
  }
  return rawData;
}

/**
 * Inline styles, written only when the value changed and remembered so they can all be taken
 * back. The engine styles server-rendered elements it does not own; a cleanup that left its
 * heights and custom properties behind would break the reduced-motion layout after a switch.
 */
function createWriter() {
  const cache = new Map<HTMLElement, Map<string, string>>();
  return {
    set(el: HTMLElement, k: string, v: number | string) {
      let m = cache.get(el);
      if (!m) cache.set(el, (m = new Map()));
      const s = typeof v === "number" ? String(Math.round(v * 1000) / 1000) : v;
      if (m.get(k) === s) return;
      m.set(k, s);
      el.style.setProperty(k, s);
    },
    clear() {
      for (const [el, m] of cache) for (const k of m.keys()) el.style.removeProperty(k);
      cache.clear();
    },
  };
}

/** `el`'s box relative to the positioned ancestor `anc`. Transforms do not move it. */
function rel(el: HTMLElement, anc: HTMLElement): Box {
  let x = 0;
  let y = 0;
  let e: HTMLElement | null = el;
  while (e && e !== anc) {
    x += e.offsetLeft;
    y += e.offsetTop;
    e = e.offsetParent as HTMLElement | null;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

/* ------------------------------------------------------------------ reduced motion: draw each globe once */

function startStatic(root: HTMLElement): () => void {
  let disposed = false;
  let data: GlobeData | null = null;
  let raw: [GlobeSnapshot, LandGeoJson] | null = null;
  let mob = window.innerWidth < PHONE_MAX;
  let timer = 0;

  const globes = Array.from(root.querySelectorAll<HTMLCanvasElement>(".lp-rm-globe"));
  const flat = root.querySelector<HTMLCanvasElement>(".lp-rm-flat");

  function drawStatic(cv: HTMLCanvasElement, make: (w: number, h: number) => GlobeSpec) {
    const r = cv.getBoundingClientRect();
    if (r.width < 2) return;
    const d = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(r.width * d);
    cv.height = Math.round(r.height * d);
    const c = cv.getContext("2d");
    if (c) paint(c, r.width, r.height, d, [], [make(r.width, r.height)], data);
  }
  function drawAll() {
    if (disposed || !raw) return;
    const m = window.innerWidth < PHONE_MAX;
    if (!data || m !== mob) {
      mob = m;
      data = prepareGlobeData(raw[0], raw[1], mob);
    }
    for (const cv of globes) {
      const k = cv.dataset.rm;
      const kind = k === "0" ? 0 : k === "1" ? 1 : k === "2" ? 2 : k === "3" ? 3 : "all";
      drawStatic(cv, (w, h) => staticGlobe(kind, w, h));
    }
    if (flat) drawStatic(flat, (w, h) => staticFlatMap(w, h, mob));
  }

  /* The canvases take their size from the layout, so redraw when a box changes: a resize, a
     rotation, or the web font arriving. Debounced, because a drag resize fires per frame. */
  const ro = new ResizeObserver(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(drawAll, 150);
  });
  for (const cv of globes) ro.observe(cv);
  if (flat) ro.observe(flat);

  loadRaw()
    .then((r) => {
      raw = r;
      drawAll();
    })
    .catch(() => {
      /* Without the snapshot the page still reads: the copy, the stills and the photographs. */
    });

  window.__pvLanding = {
    get ready() {
      return !!data;
    },
    draws: 0,
    drawMs: 0,
    reducedMotion: true,
    marks: () => ({}),
    go: () => -1,
  };

  return () => {
    disposed = true;
    window.clearTimeout(timer);
    ro.disconnect();
    delete window.__pvLanding;
  };
}

/* ------------------------------------------------------------------ motion: one listener, one loop */

function startMotion(root: HTMLElement, canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext("2d");
  const q = <T extends HTMLElement = HTMLElement>(sel: string, el: ParentNode = root) => el.querySelector<T>(sel);
  const qq = <T extends HTMLElement = HTMLElement>(sel: string, el: ParentNode = root) => Array.from(el.querySelectorAll<T>(sel));

  const nav = q(".lp-nav");
  const hero = q(".lp-hero");
  const split = q(".lp-split");
  const splitStage = q(".lp-split > .lp-stage");
  const photos = q(".lp-photos");
  const band = q(".lp-band");
  const dive = q(".lp-dive");
  const diveStage = q(".lp-dive > .lp-stage");
  const closeSec = q(".lp-close");
  const footer = q(".lp-footer");
  const frame = q(".lp-frame");
  const readout = q(".lp-readout");
  const tag = q(".lp-lens-tag");
  const tagT = q(".lp-lens-tag-t");
  const tagChip = tag ? q(".lp-chip", tag) : null;
  const track = q(".lp-track");
  const screen = q(".lp-screen");
  /* Dormant-safe: if the markup this engine was written against is not there, do nothing. */
  if (
    !ctx || !nav || !hero || !split || !splitStage || !photos || !band || !dive || !diveStage ||
    !closeSec || !footer || !frame || !readout || !tag || !tagT || !tagChip || !track || !screen
  ) {
    return () => {};
  }

  const sepEls = qq(".lp-sep");
  const photoEls = qq(".lp-photo");
  const photoImgs = photoEls.map((p) => q<HTMLImageElement>("img", p));
  const caps = qq(".lp-cap");
  const cards = qq(".lp-card");
  const cardImgs = cards.map((c) => q<HTMLImageElement>("img", c));
  const cardLayers = cards.map((c) => c.dataset.layer || "all");

  const docEl = document.documentElement;
  const writer = createWriter();
  const easer = createFocusEaser();
  const readout0 = readout.textContent;
  const tag0 = tagT.textContent;

  let disposed = false;
  let W = 0;
  let H = 0;
  let dpr = 1;
  let mob = window.innerWidth < PHONE_MAX;
  let stage: Stage | null = null;
  let data: GlobeData | null = null;
  let raw: [GlobeSnapshot, LandGeoJson] | null = null;
  let heroImg: HTMLImageElement | null = null;
  let wholeImg: HTMLImageElement | null = null;
  let heroT0 = 0;
  let heroIn = 0;
  /* The scroll position at which the footer's first line reaches the foot of the nav. */
  let footInk = Infinity;

  /* ---- layout: measure the page once per resize, never per frame */
  const docTop = (el: HTMLElement) => el.getBoundingClientRect().top + window.scrollY;
  function layout() {
    if (disposed) return;
    W = docEl.clientWidth || window.innerWidth;
    H = window.innerHeight;
    mob = W < PHONE_MAX;
    dpr = Math.min(window.devicePixelRatio || 1, mob ? 1.75 : 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);

    const bm = bandMetrics(W, mob, cards.length);
    writer.set(track!, "--cw", bm.cw + "px");
    writer.set(track!, "--gap", bm.gap + "px");
    writer.set(track!, "--start", bm.start + "px");
    /* The exact scroll budget of each pinned section. landing.css reserves the same heights
       in viewport units, so these writes move nothing the visitor can see. */
    const ph = pinHeights(H, bm.travel);
    writer.set(split!, "height", ph.split + "px");
    writer.set(photos!, "height", ph.photos + "px");
    writer.set(band!, "height", ph.band + "px");
    writer.set(dive!, "height", ph.dive + "px");

    const L = timeline(
      {
        W,
        H,
        splitTop: docTop(split!),
        splitH: split!.offsetHeight,
        photosTop: docTop(photos!),
        bandTop: docTop(band!),
        bandH: band!.offsetHeight,
        diveTop: docTop(dive!),
        closeTop: docTop(closeSec!),
        scrollH: docEl.scrollHeight,
      },
      bm,
    );
    const K = docks(W, H, mob, rel(frame!, splitStage!), rel(screen!, diveStage!), footer!.offsetHeight);
    stage = { H, mob, L, K, cardLayers, heroImg, wholeImg, heroIn };
    const footFirst = footer!.firstElementChild as HTMLElement | null;
    footInk = footFirst ? docTop(footFirst) - nav!.offsetHeight - 8 : Infinity;

    /* The labels under the four separated globes. */
    sepEls.forEach((el, i) => {
      const d = K.seps[i];
      if (!d) return;
      writer.set(el, "--px", Math.round(d.cx) + "px");
      writer.set(el, "--py", Math.round(d.cy + d.R + (mob ? 8 : 14)) + "px");
    });
    lastKey = "";
    lastTag = "";
  }

  /* ---- section effects: CSS custom properties, written only when they change */
  let active = 0;
  let lastTone = "";
  let lastOver = "";
  let lastStep = "";
  let lastTag = "";
  let tagW = 0;
  let lastCoord = "";
  function applyUI(S: Stage, y: number, st: GlobeState) {
    const { L, K } = S;
    const set = writer.set;
    set(hero!, "--hp", clamp(y / (H * 0.8)));

    /* Split: the inset scene hands over to the four separations. */
    const p2 = seg(y, L.T2, L.T2 + L.P2);
    const out2 = 1 - smooth(seg(p2, 0.88, 0.98));
    set(split!, "--s1o", smooth(seg(p2, 0.12, 0.2)));
    set(split!, "--s2", smooth(seg(p2, 0.27, 0.42)) * out2);
    set(split!, "--s", smooth(seg(p2, 0.4, 0.5)) * out2);
    if (st.specs.length === 1 && y < L.T2 + L.P2) {
      const g = st.specs[0];
      const co = formatCoord(g.lat, g.l0);
      if (co !== lastCoord) {
        lastCoord = co;
        readout!.textContent = co;
      }
    }

    /* Photographs: the first iris grows out of the globe disc, the next two out of the lens. */
    const c = K.centre;
    const l = K.lens;
    const rr = [
      y < L.T3 ? 0 : y < L.A1 ? c.R - 4 : lerp(c.R - 4, L.cover, ease(seg(y, L.A1, L.B1))),
      y < L.I2s ? 0 : lerp(l.R, L.cover, ease(seg(y, L.I2s, L.I2e))),
      y < L.I3s ? 0 : lerp(l.R, L.cover, ease(seg(y, L.I3s, L.I3e))),
    ];
    const ps = [seg(y, L.T3, L.I2e), seg(y, L.I2s, L.I3e), seg(y, L.I3s, L.L1 + H * 0.4)];
    const capIn = [
      seg(y, L.A1 + (L.B1 - L.A1) * 0.5, L.B1),
      seg(y, L.I2s + (L.I2e - L.I2s) * 0.45, L.I2e),
      seg(y, L.I3s + (L.I3e - L.I3s) * 0.45, L.I3e),
    ];
    const capOut = [seg(y, L.I2s, L.I2s + 0.22 * H), seg(y, L.I3s, L.I3s + 0.22 * H), 0];
    for (let i = 0; i < photoEls.length && i < 3; i++) {
      const el = photoEls[i];
      const o = i ? l : c;
      /* Once the iris covers the viewport the clip is dropped, so the photograph is an
         ordinary layer again and the compositor stops clipping a full-screen image. */
      const open = rr[i] >= L.cover;
      if (el.classList.contains("is-open") !== open) el.classList.toggle("is-open", open);
      set(el, "--r", rr[i].toFixed(1) + "px");
      set(el, "--x", o.cx.toFixed(1) + "px");
      set(el, "--y", o.cy.toFixed(1) + "px");
      const img = photoImgs[i];
      if (img) set(img, "--ps", lerp(1.14, 1, ps[i]));
      const cap = caps[i];
      if (cap) {
        set(cap, "--ca", easeOut(capIn[i]) * (1 - capOut[i]));
        set(cap, "--cy", ((1 - easeOut(capIn[i])) * 28 - capOut[i] * 18).toFixed(1) + "px");
      }
    }

    /* The lens tag names the layer the lens is showing. */
    const g0 = st.specs[0];
    const tk = lensPlaceAt(L, y);
    if (tk !== lastTag) {
      lastTag = tk;
      tagT!.textContent = LENS_TAGS[tk].label;
      tagChip!.style.setProperty("--c", `var(--${LENS_TAGS[tk].fam})`);
      tagW = tag!.offsetWidth;
    }
    const tagOn = !!g0 && y >= L.A1 && y < L.L1 + 0.2 * H;
    set(tag!, "--o", tagOn ? g0.bez : 0);
    if (tagOn) {
      set(tag!, "--x", (mob ? g0.cx + g0.R - tagW : g0.cx - tagW / 2).toFixed(1) + "px");
      set(tag!, "--y", (g0.cy + g0.R + 14).toFixed(1) + "px");
    }

    /* Band: the track is scrubbed sideways by vertical scroll, one card in focus. */
    const bt = bandAt(L, y);
    set(track!, "--tx", bt.tx.toFixed(1) + "px");
    for (let i = 0; i < cardImgs.length; i++) {
      const img = cardImgs[i];
      if (img) set(img, "--par", (((L.band.cardC[i] + bt.tx + L.band.winL - W / 2) / W) * -36).toFixed(1) + "px");
    }
    if (bt.best !== active) {
      cards[active]?.classList.remove("is-active");
      active = bt.best;
    }
    const bandOn = y > L.T4 - H * 0.6 && y < L.bandEnd + H * 0.5;
    const card = cards[active];
    if (card && card.classList.contains("is-active") !== bandOn) card.classList.toggle("is-active", bandOn);

    /* Dive: the flat act, then the zoom, then the street. */
    const qd = y - L.T5;
    const pf = clamp(qd / L.Lf);
    const pz = seg(qd, L.Lf, L.Lf + L.Lz);
    const gp = seg(qd, L.Lf + L.Lz, L.P5);
    const fu = ease(seg(pf, 0.04, 0.5));
    const night = smooth(seg(pz, 0.15, 0.5));
    const so = ease(seg(pz, 0.45, 0.78));
    set(dive!, "--uh", clamp(fu * 1.5));
    set(dive!, "--hl", ease(seg(pf, 0.55, 0.78)));
    set(dive!, "--fo", smooth(seg(pz, 0, 0.2)));
    set(dive!, "--so", so);
    set(dive!, "--sc", smooth(seg(pz, 0.8, 1)));
    set(dive!, "--gp", gp);
    const screenOpen = so >= 1;
    if (screen!.classList.contains("is-open") !== screenOpen) screen!.classList.toggle("is-open", screenOpen);
    /* Night falls on the section's own ground: frost, through cobalt, to space. */
    set(
      dive!,
      "background-color",
      "rgb(" + (night < 0.5 ? mixRGB([238, 242, 247], [18, 58, 155], night * 2) : mixRGB([18, 58, 155], [5, 7, 13], night * 2 - 1)) + ")",
    );
    set(dive!, "--sx", smooth(seg(y, L.T5 + L.P5, L.T5 + L.P5 + H * 0.5)));
    const step = gp < 0.34 ? "1" : gp < 0.7 ? "2" : "3";
    if (step !== lastStep) {
      lastStep = step;
      dive!.dataset.step = step;
    }
    set(closeSec!, "--rp", smooth(seg(y, L.T6 - H * 0.9, L.T6 - H * 0.2)));

    /* The nav has no bar. It takes the ink of the field under it. */
    const probe = y + 32;
    const tone =
      y < H * 0.55 ? "space"
      : probe < L.T2 ? "clear"
      : y < L.A1 + (L.B1 - L.A1) * 0.45 ? "cobalt"
      : probe < L.T4 ? "photo"
      : probe < L.T5 ? "amber"
      : night < 0.5 ? "frost"
      : "space";
    if (tone !== lastTone) {
      lastTone = tone;
      nav!.dataset.tone = tone;
    }
    /* THE FOOTER IS THE ONE PLACE WHERE RUNNING TEXT PASSES UNDER THE NAV. It carries the
       licence, the snapshot sentence and every credit, so on a phone it is taller than the
       screen, and at the end of the page its first lines sat behind the brand and the button
       with only the scrim between them (seen at 390 wide). From the moment the first line
       reaches the nav, landing.css makes the scrim a solid band. The ground under the nav is
       plain space by then, so the change itself shows nothing. On a wide screen the footer
       fits under the nav and this never fires. */
    const over = y >= footInk ? "footer" : "";
    if (over !== lastOver) {
      lastOver = over;
      if (over) nav!.dataset.over = over;
      else delete nav!.dataset.over;
    }
  }

  /* ---- the one loop */
  let cur = window.scrollY;
  let raf = 0;
  let last = 0;
  let lastKey = "";
  let draws = 0;
  let drawMs = 0;
  function tick(now: number) {
    raf = 0;
    if (disposed || !stage) return;
    /* A hidden tab gets no frames. `visibilitychange` wakes the loop when it comes back. */
    if (document.hidden) {
      last = 0;
      return;
    }
    const target = window.scrollY;
    const dt = last ? Math.min(64, now - last) : 16;
    last = now;
    /* One smoothed scroll value, time constant 100 ms. It is the only easing the scroll gets,
       so a wheel notch and a trackpad glide both read as one move. */
    cur += (target - cur) * (1 - Math.exp(-dt / 100));
    if (Math.abs(target - cur) < 0.4) cur = target;
    if (heroT0 && heroIn < 1) heroIn = easeOut(clamp((now - heroT0) / 700));
    stage.heroIn = heroIn;

    const st = globeAt(stage, cur);
    let moving = false;
    if (st.specs.length === 1) moving = easer.apply(st.specs[0], dt, st.mode);
    else easer.reset();
    applyUI(stage, cur, st);

    /* Paint only when what would be painted changed. This, not the listener, is what keeps
       an idle page at zero draws. */
    const key = stateKey(st.rend, st.specs, !!data);
    if (key !== lastKey) {
      const t0 = performance.now();
      paint(ctx!, W, H, dpr, st.rend, st.specs, data);
      drawMs = performance.now() - t0;
      lastKey = key;
      draws++;
    }
    if (cur !== target || moving || (heroT0 && heroIn < 1)) raf = requestAnimationFrame(tick);
    else last = 0;
  }
  function wake() {
    if (!raf && !disposed) raf = requestAnimationFrame(tick);
  }

  /* ---- assets */
  function loadImg(src: string, done: (im: HTMLImageElement) => void): HTMLImageElement {
    const im = new Image();
    im.decoding = "async";
    im.onload = () => {
      if (disposed) return;
      done(im);
      lastKey = "";
      wake();
    };
    im.src = src;
    return im;
  }
  const pending: HTMLImageElement[] = [];
  pending.push(
    loadImg(STILL_HERO, (im) => {
      heroImg = im;
      if (stage) stage.heroImg = im;
      heroT0 = performance.now();
    }),
  );
  /* The closing still is 18,000 px down the page, so it waits for the load event. */
  const loadWhole = () => {
    if (disposed || wholeImg || pending.length > 1) return;
    pending.push(
      loadImg(STILL_WHOLE, (im) => {
        wholeImg = im;
        if (stage) stage.wholeImg = im;
      }),
    );
    layout();
    wake();
  };

  /* ---- listeners. `scroll` is the ONLY scroll listener on the page. */
  window.addEventListener("scroll", wake, { passive: true });
  let rw = window.innerWidth;
  let rh = window.innerHeight;
  let rz = 0;
  const onResize = () => {
    /* A phone's URL bar sliding away changes the height and nothing else. Re-measuring on
       that would move every scroll position under the reader's thumb. */
    if (window.innerWidth === rw && Math.abs(window.innerHeight - rh) < 120) return;
    window.clearTimeout(rz);
    rz = window.setTimeout(() => {
      const was = mob;
      rw = window.innerWidth;
      rh = window.innerHeight;
      layout();
      if (raw && was !== mob) data = prepareGlobeData(raw[0], raw[1], mob);
      wake();
    }, 120);
  };
  window.addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", wake);
  if (document.readyState === "complete") loadWhole();
  else window.addEventListener("load", loadWhole);
  /* The web font changes the height of the footer and the width of the lens tag. */
  if (document.fonts?.ready) {
    void document.fonts.ready.then(() => {
      layout();
      wake();
    });
  }

  layout();
  wake();
  loadRaw()
    .then((r) => {
      if (disposed) return;
      raw = r;
      data = prepareGlobeData(r[0], r[1], mob);
      lastKey = "";
      wake();
    })
    .catch(() => {
      /* Without the snapshot the page still reads: the discs, the stills and the photographs draw. */
    });

  window.__pvLanding = {
    get ready() {
      return !!(data && heroImg && wholeImg);
    },
    get draws() {
      return draws;
    },
    get drawMs() {
      return drawMs;
    },
    reducedMotion: false,
    marks: () => (stage ? marks(stage) : {}),
    go(name) {
      const y = stage ? marks(stage)[name] : undefined;
      if (y === undefined) return -1;
      window.scrollTo(0, Math.round(y));
      return Math.round(y);
    },
  };

  return () => {
    disposed = true;
    if (raf) cancelAnimationFrame(raf);
    window.clearTimeout(rz);
    window.removeEventListener("scroll", wake);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("load", loadWhole);
    document.removeEventListener("visibilitychange", wake);
    for (const im of pending) im.onload = null;
    /* Hand the page back exactly as the server rendered it. */
    writer.clear();
    for (const el of photoEls) el.classList.remove("is-open");
    for (const el of cards) el.classList.remove("is-active");
    screen.classList.remove("is-open");
    nav.dataset.tone = "space";
    delete nav.dataset.over;
    dive.dataset.step = "1";
    readout.textContent = readout0;
    tagT.textContent = tag0;
    tagChip.style.setProperty("--c", `var(--${LENS_TAGS.london.fam})`);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    delete window.__pvLanding;
  };
}

export default function LandingStage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const root = canvas?.closest<HTMLElement>(".lp-root");
    if (!canvas || !root) return;
    /* ONE effect owns the engine. The media query is read here, not in React state, so a
       visitor who turns reduced motion on mid-visit gets the static page without a render. */
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let stop = mq.matches ? startStatic(root) : startMotion(root, canvas);
    const onChange = () => {
      stop();
      stop = mq.matches ? startStatic(root) : startMotion(root, canvas);
    };
    mq.addEventListener("change", onChange);
    return () => {
      mq.removeEventListener("change", onChange);
      stop();
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} className="lp-globe" data-testid="landing-globe" aria-hidden="true" />
      <div className="lp-lens-tag" aria-hidden="true">
        <span className="lp-chip" style={{ "--c": `var(--${LENS_TAGS.london.fam})` } as CSSProperties}>
          <i />
        </span>
        <span className="lp-lens-tag-t">{LENS_TAGS.london.label}</span>
      </div>
    </>
  );
}
