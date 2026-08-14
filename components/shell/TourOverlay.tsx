"use client";
// The guided-tour overlay — a self-contained chapter menu + spotlight walkthrough
// (no third-party tour library).
//
// Two views, both driven by tourStore:
//   MENU  a centred card offering the full walkthrough or any single chapter.
//   RUN   the steps of that scope, one at a time: dim the app, ring the target
//         element, and float a coach-mark beside it.
//
// ── THE PART THAT IS NOT A NORMAL TOUR ───────────────────────────────────────
// Most of this console's controls are behind a click — the Source Catalog rail
// mounts collapsed, the widget ? / 🔔 / ⋯ popovers are local state, the palette and
// settings are overlays. So before a step is shown, its `setup` actions OPEN the
// surface it lives in, and its chapter's `cleanup` closes it again on the way out.
// Both action kinds are conditional ("click only if it is not already open"), which
// is what makes stepping backwards safe.
//
// A step whose target still cannot be found after setup degrades to a centred
// framing card rather than vanishing — the explanation is worth more than the ring,
// and silently dropping steps is exactly how the previous tour shrank to seven.
//
// Fully keyboard-driven: Esc closes, ←/→ and Enter walk, Tab is trapped in the card.
// Pure step data, chapter maths and the action vocabulary live in lib/console/tour.ts.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { tourStore, useTourView } from "@/lib/shell/tour";
import {
  TOUR_CHAPTERS,
  buildRun,
  cleanupBetween,
  allCleanup,
  clampStep,
  isFramingStep,
  isLastStep,
  targetsOf,
  type FlatStep,
  type TourAction,
} from "@/lib/console/tour";

interface Box { left: number; top: number; width: number; height: number }

const PAD = 8; // breathing room around the spotlit target + viewport edges
const CARD_GAP = 14; // gap between the target and the coach-mark card

/* ── Actions ──────────────────────────────────────────────────────────────── */

/**
 * Run one conditional click. Both kinds are no-ops when the surface is already in
 * the wanted state, which is what lets a step's setup be replayed on the way back.
 */
function runAction(a: TourAction): boolean {
  const present = document.querySelector(a.want) != null;
  const shouldClick = a.kind === "ensure" ? !present : present;
  if (!shouldClick) return false;
  const trigger = document.querySelector<HTMLElement>(a.click);
  if (!trigger) return false;
  trigger.click();
  return true;
}

/** Run a list of actions; resolves once the DOM has had a frame to react. */
function runActions(actions: readonly TourAction[] | undefined): Promise<void> {
  let clicked = false;
  for (const a of actions ?? []) clicked = runAction(a) || clicked;
  if (!clicked) return Promise.resolve();
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}

const wait = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());

/* ── Measuring ────────────────────────────────────────────────────────────── */

/**
 * Is this selector RENDERED — not merely in the document?
 *
 * The distinction is the whole ballgame at a phone width. The legend, the world
 * clocks, the stage's move grip and the footer's keyboard hints are all still in
 * the DOM at 390px and all `display: none`, so a presence check kept their steps
 * in the run and the visitor was told about four controls their screen does not
 * have. Matching the predicate to what `findTarget` will actually measure drops
 * those steps instead, which is what resolving-against-the-real-page is for.
 */
function isRendered(selector: string): boolean {
  const el = document.querySelector(selector);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 || r.height > 0;
}

/** The first of a step's targets that is on screen AND has a size. */
function findTarget(flat: FlatStep): HTMLElement | null {
  for (const sel of targetsOf(flat.step)) {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    return el;
  }
  return null;
}

function boxOf(el: HTMLElement): Box {
  const r = el.getBoundingClientRect();
  return { left: r.left - PAD, top: r.top - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
}

/**
 * Place the card near the box per placement, clamped to the viewport, and never
 * ON the box — a coach-mark covering the thing it is describing is the one
 * placement bug that makes a spotlight pointless. When the preferred side has no
 * room, it flips to the opposite side before falling back to clamping.
 */
function placeCard(
  box: Box | null,
  placement: string | undefined,
  cardW: number,
  cardH: number,
): { left: number; top: number } {
  const vw = window.innerWidth, vh = window.innerHeight;
  const clamp = (v: number, max: number) => Math.max(PAD, Math.min(v, max - PAD));
  if (!box) return { left: clamp((vw - cardW) / 2, vw - cardW), top: clamp((vh - cardH) / 2, vh - cardH) };

  const fits = {
    bottom: box.top + box.height + CARD_GAP + cardH <= vh,
    top: box.top - CARD_GAP - cardH >= 0,
    right: box.left + box.width + CARD_GAP + cardW <= vw,
    left: box.left - CARD_GAP - cardW >= 0,
  };
  const opposite: Record<string, keyof typeof fits> = { top: "bottom", bottom: "top", left: "right", right: "left" };

  let place = (placement ?? "bottom") as keyof typeof fits;
  if (!fits[place] && fits[opposite[place]]) place = opposite[place];

  let left: number, top: number;
  if (place === "right") { left = box.left + box.width + CARD_GAP; top = box.top; }
  else if (place === "left") { left = box.left - cardW - CARD_GAP; top = box.top; }
  else if (place === "top") { left = box.left + box.width / 2 - cardW / 2; top = box.top - cardH - CARD_GAP; }
  else { left = box.left + box.width / 2 - cardW / 2; top = box.top + box.height + CARD_GAP; }
  return { left: clamp(left, vw - cardW), top: clamp(top, vh - cardH) };
}

/* ── The overlay ──────────────────────────────────────────────────────────── */

export default function TourOverlay() {
  const view = useTourView();
  const [run, setRun] = useState<FlatStep[]>([]);
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const prevIndexRef = useRef(0);

  const running = view.open && view.mode === "run";

  // Build the run ONCE per scope. Rebuilding mid-walk would renumber the steps
  // under the visitor every time a setup action opened a panel.
  useEffect(() => {
    if (!running) { setRun([]); return; }
    const next = buildRun(TOUR_CHAPTERS, isRendered, view.chapter);
    setRun(next);
    setIndex(0);
    prevIndexRef.current = 0;
  }, [running, view.chapter]);

  const flat: FlatStep | undefined = run[index];

  // Prepare the step: close whatever the last chapter opened, open what this step
  // needs, bring the target into view, then measure it.
  useEffect(() => {
    if (!running || !flat) return;
    let cancelled = false;

    (async () => {
      const from = prevIndexRef.current;
      prevIndexRef.current = index;
      if (from !== index) await runActions(cleanupBetween(TOUR_CHAPTERS, run, from, index));
      if (cancelled) return;

      await runActions(flat.step.setup);
      if (cancelled) return;
      await wait(flat.step.settleMs ?? 0);
      if (cancelled) return;

      const el = findTarget(flat);
      if (el) {
        // "auto", not "smooth": the measurement below has to happen after the
        // scroll has landed, and a smooth scroll is still moving when it does.
        el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
      }
      requestAnimationFrame(() => {
        if (cancelled) return;
        const target = findTarget(flat);
        setBox(target ? boxOf(target) : null);
        // A surface opened by setup (the palette, the settings drawer) focuses its
        // own input on mount, which would take the arrow keys away from the tour.
        cardRef.current?.focus();
      });
    })();

    return () => { cancelled = true; };
  }, [running, flat, index, run]);

  // Keep the ring on the target through resizes and scrolls of the surfaces below.
  useEffect(() => {
    if (!running || !flat) return;
    const update = () => { const el = findTarget(flat); setBox(el ? boxOf(el) : null); };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [running, flat]);

  // Position the card once it (and the target box) are measured.
  useLayoutEffect(() => {
    if (!view.open) return;
    const el = cardRef.current;
    if (!el) return;
    setPos(placeCard(running ? box : null, flat?.step.placement, el.offsetWidth, el.offsetHeight));
  }, [view.open, running, flat, box]);

  /** Close for good, putting every surface the tour opened back as it was. */
  const stop = useCallback(() => {
    void runActions(allCleanup(TOUR_CHAPTERS));
    tourStore.stop();
  }, []);

  /** Back to the chapter picker, cleaning up on the way. */
  const toMenu = useCallback(() => {
    void runActions(allCleanup(TOUR_CHAPTERS));
    setBox(null);
    tourStore.openMenu();
  }, []);

  const go = useCallback((delta: number) => {
    setIndex((i) => {
      const next = i + delta;
      // Walking off the end of a single-chapter run returns to the menu; off the
      // end of the full run finishes.
      if (next >= run.length) { if (view.chapter) toMenu(); else stop(); return i; }
      return clampStep(next, run.length);
    });
  }, [run.length, view.chapter, stop, toMenu]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); stop(); return; }
    if (!running) return;
    if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); go(1); return; }
    if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); return; }
    if (e.key === "Tab") {
      const focusables = cardRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])");
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      const activeEl = document.activeElement;
      if (e.shiftKey && (activeEl === first || activeEl === cardRef.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && activeEl === last) { e.preventDefault(); first.focus(); }
    }
  };

  // Focus the card whenever the view changes, so the keyboard is on the overlay.
  useEffect(() => { if (view.open) cardRef.current?.focus(); }, [view.open, view.mode]);

  if (!view.open) return null;

  /* ── Chapter menu ──────────────────────────────────────────────────────── */
  if (view.mode === "menu") {
    return (
      <div className="tn-tour" role="dialog" aria-modal="true" aria-labelledby="tn-tour-title" onKeyDown={onKeyDown}>
        <div className="tn-tour-veil is-plain" onClick={stop} aria-hidden />
        <div
          className="tn-tour-card is-menu"
          ref={cardRef}
          tabIndex={-1}
          style={pos ? { left: pos.left, top: pos.top, visibility: "visible" } : { visibility: "hidden" }}
        >
          <div className="tn-tour-meta">
            <span className="tn-tour-count">Guided tour</span>
            <button type="button" className="tn-tour-skip" onClick={stop}>Skip</button>
          </div>
          <h2 id="tn-tour-title" className="tn-tour-title">A quick walk around the console</h2>
          <p className="tn-tour-body">
            Eight short chapters covering every control on this screen. Take the lot, or jump
            straight to the part you need — you can leave at any point.
          </p>

          {/* The estimate is deliberately generous rather than flattering. An
              earlier draft said "about 4 minutes" for a run of sixty-odd steps,
              which is four seconds a step — under-promising by roughly 3x on a
              tour whose own sixth chapter is about not overstating things. */}
          <button type="button" className="tn-tour-btn is-primary is-block" onClick={() => tourStore.runAll()}>
            Take the full tour
            <span className="tn-tour-btn-sub">{TOUR_CHAPTERS.length} chapters · 10–15 minutes</span>
          </button>

          <ul className="tn-tour-chapters">
            {TOUR_CHAPTERS.map((c, i) => (
              <li key={c.id}>
                <button type="button" className="tn-tour-chapter" onClick={() => tourStore.runChapter(c.id)}>
                  <span className="tn-tour-chapter-icon" aria-hidden>{c.icon}</span>
                  <span className="tn-tour-chapter-main">
                    <span className="tn-tour-chapter-title">{i + 1}. {c.title}</span>
                    <span className="tn-tour-chapter-sum">{c.summary}</span>
                  </span>
                  <span className="tn-tour-chapter-n" aria-hidden>{c.steps.length}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  /* ── A step ────────────────────────────────────────────────────────────── */
  if (!flat) return null;
  const last = isLastStep(index, run.length);
  const plain = !box;

  return (
    <div className="tn-tour" role="dialog" aria-modal="true" aria-labelledby="tn-tour-title" aria-describedby="tn-tour-body" onKeyDown={onKeyDown}>
      {/* Clicking the dimmed area ADVANCES rather than closing. On a walkthrough
          this long, "click anywhere to continue" is the gesture people reach for,
          and closing on a stray click would throw away a chapter of progress.
          Skip, Esc and Done are the ways out, and all three are on screen. */}
      <div className={`tn-tour-veil${plain ? " is-plain" : ""}`} onClick={() => go(1)} aria-hidden />
      {box && (
        <div className="tn-tour-ring" aria-hidden
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }} />
      )}
      {/* `data-framing` says whether this step is MEANT to have no spotlight (a
          centred title card) or has simply failed to find its target. Without it,
          verify-tour.mjs has to keep a hard-coded list of framing-step titles —
          which goes stale the first time one is reworded, and then reports a
          healthy tour as broken. Exactly the rot this rewrite exists to remove. */}
      {/* A reactive step with nothing to ring is expected, not broken: the banner
          and the pin navigator are genuinely absent until something happens. They
          are marked framing so the verification walk does not report a healthy run
          as a miss — the cost being that a reactive step CAN hide a dead selector,
          which is why `reactive` is restricted to controls that come and go. */}
      <div className="tn-tour-card" ref={cardRef} tabIndex={-1}
        data-framing={isFramingStep(flat.step) || (flat.step.reactive === true && !box) ? "true" : "false"}
        style={pos ? { left: pos.left, top: pos.top, visibility: "visible" } : { visibility: "hidden" }}>
        <div className="tn-tour-meta">
          <span className="tn-tour-count">
            <span className="tn-tour-chip" aria-hidden>{flat.chapterIcon}</span>
            {flat.chapterTitle}
            <span className="tn-tour-of">
              {" · "}
              {view.chapter ? "" : `chapter ${flat.chapterNumber}/${flat.chapterCount} · `}
              step {flat.stepNumber}/{flat.stepCount}
            </span>
          </span>
          <button type="button" className="tn-tour-skip" onClick={stop}>Skip</button>
        </div>

        <h2 id="tn-tour-title" className="tn-tour-title">{flat.step.title}</h2>
        <p id="tn-tour-body" className="tn-tour-body">{flat.step.body}</p>

        {/* Dots track the CHAPTER, not the whole run: forty dots would read as a
            progress bar nobody wants to be at the start of. */}
        <div className="tn-tour-dots" aria-hidden>
          {Array.from({ length: flat.stepCount }, (_, i) => (
            <span key={i} className={`tn-tour-dot${i === flat.stepNumber - 1 ? " is-on" : ""}`} />
          ))}
        </div>

        <div className="tn-tour-actions">
          <button type="button" className="tn-tour-link" onClick={toMenu}>Chapters</button>
          <span className="tn-tour-sp" />
          <button type="button" className="tn-tour-btn" onClick={() => go(-1)} disabled={index === 0}>Back</button>
          <button type="button" className="tn-tour-btn is-primary" onClick={() => go(1)}>
            {last ? (view.chapter ? "Finish chapter" : "Done") : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
