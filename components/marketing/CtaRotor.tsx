"use client";

import { useEffect } from "react";
import { deckFor, readVisitor, SAVED_BOARD_KEY, type CtaDoor } from "@/lib/marketing/ctaDeck";
import { glyphs, planTurn, TURN_MS } from "@/lib/marketing/ctaTurn";

/**
 * The landing page's button, which offers a different place every few seconds.
 *
 * THE BUTTONS ARE SERVER-RENDERED, AND THIS ONLY CHANGES THEM. `app/(site)/page.tsx` prints
 * plain links saying "See London in 3D", which is what a crawler, a browser with no script
 * and the first paint get. This component renders nothing: after mount it finds the links
 * marked `data-rotor` and writes their words and their `href`. It sets no React state.
 *
 * ONE BUTTON TURNS AT A TIME. The hero's while it is on screen, else the close's, else the
 * one in the nav. A word changing in two places at once reads as noise, and a frozen button
 * keeps a link that still works. The footer's link takes the visitor's first phrase and
 * never moves.
 *
 * THE TURN RUNS ON THE COMPOSITOR. It is Web Animations on transform and opacity, so it adds
 * nothing to the page's one rAF loop and no scroll listener (`LandingStage.tsx` owns those
 * and stops when the page is at rest). The button's width is fixed in `landing.css`, so
 * no phrase moves the button beside it and no turn costs a layout. Between turns the words
 * are one plain text node again, with the browser's own kerning and subpixel placement.
 *
 * IT STOPS WHEN IT SHOULD. While the pointer or the keyboard is on the button, so the words
 * cannot change under a click; while the tab is hidden; and until the opening intro has
 * lifted. With reduced motion there is no turn and no rotation at all: the buttons take the
 * visitor's first phrase once and stay there.
 */

/** How long a phrase rests before the next one turns in. */
const REST_MS = 2600;
/** The first turn, once the page is showing. */
const FIRST_MS = 900;
const EASE_TURN = "cubic-bezier(.38,0,.22,1)";
const EASE_SLIDE = "cubic-bezier(.3,0,.1,1)";
/** Close, for a character this small: further back and a turn reads as a letter getting thin. */
const NEAR = "perspective(64px)";

interface Rotor {
  a: HTMLAnchorElement;
  label: HTMLElement;
  words: string;
}

interface Measured {
  /** The middle of each character, from the left of the phrase. */
  centres: number[];
  width: number;
}

/** The handle tests/e2e/landing-cta.spec.ts drives. Named like `window.__pvLanding`. */
export interface CtaHandle {
  deck: readonly CtaDoor[];
  turns: number;
  /** Which button is turning now. */
  active(): string;
  /** Stop on the current phrase, or carry on. */
  hold(on: boolean): void;
}

declare global {
  interface Window {
    __pvCta?: CtaHandle;
  }
}

/** Where each character of `text` stands, read from the text as this button draws it, kerning and all. */
function measure(rotor: Rotor, text: string, cache: Map<string, Measured>): Measured {
  const key = `${rotor.a.dataset.rotor}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const probe = document.createElement("span");
  probe.className = "lp-rotor-probe";
  probe.textContent = text;
  rotor.label.appendChild(probe);
  const node = probe.firstChild as Text;
  const origin = probe.getBoundingClientRect();
  const range = document.createRange();
  const centres: number[] = [];
  let at = 0;
  for (const g of glyphs(text)) {
    range.setStart(node, at);
    range.setEnd(node, at + g.length);
    const rect = range.getBoundingClientRect();
    centres.push(rect.left + rect.width / 2 - origin.left);
    at += g.length;
  }
  const out = { centres, width: origin.width };
  probe.remove();
  cache.set(key, out);
  return out;
}

function say(rotor: Rotor, door: CtaDoor): void {
  rotor.words = door.words;
  rotor.a.href = door.href;
  rotor.a.setAttribute("aria-label", door.words);
}

function rest(rotor: Rotor): void {
  rotor.label.textContent = rotor.words;
  rotor.label.removeAttribute("data-turning");
}

function face(className: string, text: string): HTMLSpanElement {
  const s = document.createElement("span");
  s.className = className;
  // A space has no width as an inline-block's only content, and the turn needs none.
  s.textContent = text === " " ? "" : text;
  return s;
}

/** Build the cells, run the turn, then hand back one plain text node. */
async function turn(rotor: Rotor, door: CtaDoor, cache: Map<string, Measured>): Promise<void> {
  const from = rotor.words;
  const box = rotor.label.clientWidth;
  const a = measure(rotor, from, cache);
  const b = measure(rotor, door.words, cache);
  const aLeft = (box - a.width) / 2;
  const bLeft = (box - b.width) / 2;
  const plan = planTurn(
    from,
    door.words,
    a.centres.map((x) => x + aLeft),
    b.centres.map((x) => x + bLeft),
    aLeft + a.width,
    bLeft + b.width,
  );

  const fragment = document.createDocumentFragment();
  const running: Animation[] = [];
  for (const c of plan.cells) {
    const cell = document.createElement("span");
    cell.className = "lp-rc";
    cell.setAttribute("aria-hidden", "true");
    fragment.appendChild(cell);
    running.push(
      cell.animate(
        [{ transform: `translate3d(${c.fromX}px,0,0)` }, { transform: `translate3d(${c.toX}px,0,0)` }],
        { duration: plan.totalMs, easing: EASE_SLIDE, fill: "both" },
      ),
    );
    if (!c.turns) {
      cell.appendChild(face("lp-rf", c.from));
      continue;
    }
    const spin = document.createElement("span");
    spin.className = "lp-rs";
    // The old character shows until it turns edge-on. Its back is the new character, the
    // right way round once the turn passes 90 degrees, and the front takes over at 270.
    const oldFront = face("lp-rf", c.from);
    const newBack = face("lp-rf lp-rb", c.to);
    const newFront = face("lp-rf", c.to);
    spin.append(oldFront, newBack, newFront);
    cell.appendChild(spin);
    const timing = { duration: TURN_MS, delay: c.delayMs, easing: EASE_TURN, fill: "both" as const };
    running.push(
      spin.animate(
        [{ transform: `${NEAR} rotateY(0deg)` }, { transform: `${NEAR} rotateY(360deg)` }],
        timing,
      ),
      // Both swap at 180 degrees, while each is facing away. They run on the turn's own
      // clock and easing, so no timer can land late and flash the old character at 270.
      oldFront.animate([{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0, offset: 0.5 }, { opacity: 0 }], timing),
      newFront.animate([{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1, offset: 0.5 }, { opacity: 1 }], timing),
    );
  }

  rotor.label.setAttribute("data-turning", "");
  rotor.label.textContent = "";
  rotor.label.appendChild(fragment);
  // The link and its name change as the turn starts, so a click during it goes where the
  // button is about to say.
  say(rotor, door);
  await Promise.all(running.map((r) => r.finished.catch(() => undefined)));
  rest(rotor);
}

function readSavedBoard(): boolean {
  try {
    return window.localStorage.getItem(SAVED_BOARD_KEY) != null;
  } catch {
    return false;
  }
}

export default function CtaRotor() {
  useEffect(() => {
    const links = [...document.querySelectorAll<HTMLAnchorElement>("a[data-rotor]")];
    const rotors = new Map<string, Rotor>();
    for (const a of links) {
      const label = a.querySelector<HTMLElement>(".lp-rotor");
      if (label) rotors.set(a.dataset.rotor!, { a, label, words: label.textContent ?? "" });
    }
    const hero = rotors.get("hero");
    if (!hero) return;

    let timeZone: string | undefined;
    try {
      timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      timeZone = undefined;
    }
    const deck = deckFor(readVisitor(timeZone, navigator.language), { savedBoard: readSavedBoard() });
    const first = deck[0];

    // A phrase that does not fit a button is skipped by that button, which is how the
    // narrow one in a phone's nav keeps to the short ones.
    const cache = new Map<string, Measured>();
    const fits = (r: Rotor, door: CtaDoor) => measure(r, door.words, cache).width <= r.label.clientWidth;

    // Everything but the hero takes the visitor's first phrase now, without a turn.
    const settle = () => {
      for (const r of rotors.values()) {
        if (r === hero && !reduced) continue;
        const door = fits(r, first) ? first : deck.find((d) => fits(r, d));
        if (door) {
          say(r, door);
          rest(r);
        }
      }
      for (const a of links) {
        if (a.dataset.rotor === "foot") {
          a.textContent = first.words;
          a.href = first.href;
        }
      }
    };

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      void document.fonts?.ready.then(settle);
      return;
    }

    const onScreen = new Set<Rotor>();
    const seen = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const r = [...rotors.values()].find((x) => x.a === e.target);
          if (!r) continue;
          if (e.isIntersecting) onScreen.add(r);
          else onScreen.delete(r);
        }
      },
      { threshold: 0.9 },
    );
    const close = rotors.get("close");
    const nav = rotors.get("nav");
    seen.observe(hero.a);
    if (close) seen.observe(close.a);

    const activeRotor = (): Rotor => {
      if (onScreen.has(hero)) return hero;
      if (close && onScreen.has(close)) return close;
      return nav ?? hero;
    };

    let held = false;
    let pointerOn: HTMLAnchorElement | null = null;
    let focusOn: HTMLAnchorElement | null = null;
    let timer = 0;
    let turning = false;
    let index = 0;
    let stopped = false;

    const handle: CtaHandle = {
      deck,
      turns: 0,
      active: () => activeRotor().a.dataset.rotor ?? "",
      hold(on) {
        held = on;
        if (!on) schedule(0);
      },
    };
    window.__pvCta = handle;

    const paused = (r: Rotor) => held || document.hidden || pointerOn === r.a || focusOn === r.a;

    function schedule(ms: number): void {
      window.clearTimeout(timer);
      if (!stopped) timer = window.setTimeout(tick, ms);
    }

    async function tick(): Promise<void> {
      if (turning) return;
      const r = activeRotor();
      if (paused(r)) return schedule(500);
      // The next door this button can hold that is not what it says already.
      let door: CtaDoor | undefined;
      for (let n = 0; n < deck.length && !door; n++) {
        const candidate = deck[(index + n) % deck.length];
        if (candidate.words !== r.words && fits(r, candidate)) {
          door = candidate;
          index = (index + n + 1) % deck.length;
        }
      }
      if (!door) return;
      turning = true;
      await turn(r, door, cache);
      turning = false;
      handle.turns += 1;
      schedule(REST_MS);
    }

    const onEnter = (e: Event) => (pointerOn = e.currentTarget as HTMLAnchorElement);
    const onLeave = () => (pointerOn = null);
    const onFocus = (e: Event) => (focusOn = e.currentTarget as HTMLAnchorElement);
    const onBlur = () => (focusOn = null);
    for (const r of rotors.values()) {
      r.a.addEventListener("pointerenter", onEnter);
      r.a.addEventListener("pointerleave", onLeave);
      r.a.addEventListener("focus", onFocus);
      r.a.addEventListener("blur", onBlur);
    }

    // The curtain of the opening intro hides the button. Nothing turns behind it.
    const intro = document.querySelector<HTMLElement>(".lp-intro");
    const curtainUp = () => !intro || !intro.hasAttribute("data-on") || intro.dataset.phase === "out";
    let watcher: MutationObserver | null = null;

    const begin = () => {
      if (stopped) return;
      settle();
      // A visitor for whom the served words are already right rests on them first.
      schedule(hero.words === first.words ? REST_MS : FIRST_MS);
    };

    // Character positions are only true in the real font.
    void (document.fonts?.ready ?? Promise.resolve()).then(() => {
      if (curtainUp()) return begin();
      watcher = new MutationObserver(() => {
        if (!curtainUp()) return;
        watcher?.disconnect();
        begin();
      });
      watcher.observe(intro!, { attributes: true, attributeFilter: ["data-on", "data-phase"] });
    });

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      seen.disconnect();
      watcher?.disconnect();
      delete window.__pvCta;
      for (const r of rotors.values()) {
        r.a.removeEventListener("pointerenter", onEnter);
        r.a.removeEventListener("pointerleave", onLeave);
        r.a.removeEventListener("focus", onFocus);
        r.a.removeEventListener("blur", onBlur);
        rest(r);
      }
    };
  }, []);

  return null;
}
