"use client";

import { useEffect } from "react";
import { deckFor, readVisitor, SAVED_BOARD_KEY, type CtaDoor } from "@/lib/marketing/ctaDeck";
import { glyphs, planTurn, TURN_MS, type TurnPlan } from "@/lib/marketing/ctaTurn";

/**
 * The landing page's button, which offers a different place every few seconds.
 *
 * THE BUTTONS ARE SERVER-RENDERED, AND THIS ONLY CHANGES THEM. `app/(site)/page.tsx` prints
 * plain links saying "See London in 3D", which is what a crawler, a browser with no script
 * and the first paint get. This component renders nothing: after mount it finds the links
 * marked `data-rotor` and writes their words and their `href`. It sets no React state.
 *
 * EVERY BUTTON SAYS THE SAME THING. The ones on screen turn together, and the nav's is always
 * on screen, so two buttons in one view never disagree. One off screen takes the new words
 * with no turn, so it is already right when it scrolls in. The only exception is the narrow
 * button in a phone's nav: given a phrase it cannot hold, it moves on to one it can. The
 * footer's link takes the visitor's first phrase and never moves.
 *
 * THE TURN RUNS ON THE COMPOSITOR. It is Web Animations on transform and opacity, so it adds
 * nothing to the page's one rAF loop and no scroll listener (`LandingStage.tsx` owns those
 * and stops when the page is at rest). The button's width is fixed in `landing.css`, so
 * no phrase moves the button beside it and no turn costs a layout. Between turns the words
 * are one plain text node again, with the browser's own kerning and subpixel placement.
 *
 * IT STOPS WHEN IT SHOULD. While the pointer or the keyboard is on any of the buttons, so the
 * words cannot change under a click and the others do not move on without it; while the tab
 * is hidden; and until the opening intro has lifted. With reduced motion there is no turn and
 * no rotation at all: the buttons take the visitor's first phrase once and stay there.
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
  /** Which buttons turn at the next change; the others change with no turn. */
  onScreen(): string[];
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

/** Read where every character stands, before any button is written to. */
function planFor(rotor: Rotor, door: CtaDoor, cache: Map<string, Measured>): TurnPlan {
  const from = rotor.words;
  const box = rotor.label.clientWidth;
  const a = measure(rotor, from, cache);
  const b = measure(rotor, door.words, cache);
  const aLeft = (box - a.width) / 2;
  const bLeft = (box - b.width) / 2;
  return planTurn(
    from,
    door.words,
    a.centres.map((x) => x + aLeft),
    b.centres.map((x) => x + bLeft),
    aLeft + a.width,
    bLeft + b.width,
  );
}

/** Build the cells, run the turn, then hand back one plain text node. */
async function turn(rotor: Rotor, door: CtaDoor, plan: TurnPlan): Promise<void> {
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

    /**
     * The door at this place in the list. A button with no room for it moves on from what it
     * says now to the next it can hold, so it never sits still waiting for a short phrase.
     */
    const doorAt = (r: Rotor, place: number): CtaDoor | undefined => {
      if (fits(r, deck[place])) return deck[place];
      const now = deck.findIndex((d) => d.words === r.words);
      for (let n = 1; n <= deck.length; n++) {
        const door = deck[(now + n) % deck.length];
        if (fits(r, door)) return door;
      }
      return undefined;
    };

    const settleFoot = () => {
      for (const a of links) {
        if (a.dataset.rotor === "foot") {
          a.textContent = first.words;
          a.href = first.href;
        }
      }
    };

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      void document.fonts?.ready.then(() => {
        for (const r of rotors.values()) {
          const door = doorAt(r, 0);
          if (door) {
            say(r, door);
            rest(r);
          }
        }
        settleFoot();
      });
      return;
    }

    const onScreen = new Set<Rotor>();
    const seen = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const r = [...rotors.values()].find((x) => x.a === e.target);
        if (!r) continue;
        if (e.isIntersecting) onScreen.add(r);
        else onScreen.delete(r);
      }
    });
    for (const r of rotors.values()) seen.observe(r.a);

    let held = false;
    let pointerOn = false;
    let focusOn = false;
    let timer = 0;
    let turning = false;
    let index = 0;
    let stopped = false;

    const handle: CtaHandle = {
      deck,
      turns: 0,
      onScreen: () => [...onScreen].map((r) => r.a.dataset.rotor ?? ""),
      hold(on) {
        held = on;
        if (!on) schedule(0);
      },
    };
    window.__pvCta = handle;

    const paused = () => held || document.hidden || pointerOn || focusOn;

    function schedule(ms: number): void {
      window.clearTimeout(timer);
      if (!stopped) timer = window.setTimeout(tick, ms);
    }

    async function tick(): Promise<void> {
      if (turning) return;
      if (paused()) return schedule(500);
      // The next place in the list that changes a button. All the reading happens here,
      // before the first write, so two buttons turning cost no layout between them.
      const moves: { r: Rotor; door: CtaDoor; plan: TurnPlan | null }[] = [];
      for (let n = 0; n < deck.length && moves.length === 0; n++) {
        for (const r of rotors.values()) {
          const door = doorAt(r, index);
          if (door && door.words !== r.words) {
            moves.push({ r, door, plan: onScreen.has(r) ? planFor(r, door, cache) : null });
          }
        }
        index = (index + 1) % deck.length;
      }
      if (moves.length === 0) return;
      turning = true;
      await Promise.all(
        moves.map(async ({ r, door, plan }) => {
          if (plan) return turn(r, door, plan);
          say(r, door);
          rest(r);
        }),
      );
      turning = false;
      handle.turns += 1;
      schedule(REST_MS);
    }

    const onEnter = () => (pointerOn = true);
    const onLeave = () => (pointerOn = false);
    const onFocus = () => (focusOn = true);
    const onBlur = () => (focusOn = false);
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
      settleFoot();
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
