"use client";

import { useEffect, type RefObject } from "react";

/**
 * The board hand-off — the console's one authored moment.
 *
 * WHY THIS IS SCRIPTED AND NOT A STYLESHEET. It was a stylesheet first. A CSS
 * entrance on `.tn-cw` looked correct in the file and did nothing in the
 * product: instrumenting `animationstart` across a real board switch counted
 * ZERO events. `applyPreset` mints new widget instances, but React reconciles
 * them onto the existing card nodes, so a declarative entrance plays on first
 * load and is never seen again — on the single interaction the whole thing
 * exists to explain. The Web Animations API re-triggers per switch, which is
 * what the motion actually needs.
 *
 * WHAT IT SAYS. Switching a board is the biggest act in this product: a preset
 * is the whole workspace, so one click swaps both rails, six widgets and the
 * map's layer set, and today all of it lands in a single frame with nothing
 * connecting it to the tab that caused it. The cards re-form from their own
 * rail's edge — side rails from the side they live on, the bottom strip from
 * below — so the rails read as standing furniture receiving new instruments
 * rather than as a page being replaced.
 *
 * WHAT IT COSTS AT REST. Nothing. It runs on a board change, it is finite, and
 * every animation is transform and opacity, so it stays off the main thread's
 * layout work. #158 took this route from 60.8% CPU at rest to 9.0% and this
 * must not spend that back: there is no rAF loop, no interval and no
 * per-frame React state here.
 */

/** Distance in px, by the rail the card lives in. Small on purpose: a card that
 *  flies in from off-screen is a slide deck; a card that resolves into place is
 *  an instrument being set down. */
const TRAVEL: Record<string, [number, number]> = {
  left: [-14, 0],
  right: [14, 0],
  bottom: [0, 12],
};
/** Any rail added later gets this rather than nothing. The first version of the
 *  CSS listed only left and right, and the Intel board turned out to carry a
 *  third rail whose four cards then snapped in beside two that resolved. */
const TRAVEL_DEFAULT: [number, number] = [0, 10];

/** Matches --tn-mo-ease in console-motion.css. Confident arrival, no bounce:
 *  bounce on a monitoring console reads as a toy, and it overshoots values that
 *  are measurements. */
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

/** MAX_CARDS_PER_RAIL is 4 (lib/console/presets.ts), so the total stagger is
 *  capped by the data model rather than by a guess. A rail that somehow holds
 *  more arrives with the fourth instead of compounding. */
const MAX_STAGGER_STEPS = 3;

/** Tags this hook's own animations so a re-entrance cancels only its
 *  predecessor and leaves the wall's FLIP animations alone. */
const ENTRANCE_ID = "tn-board-entrance";

function num(cs: CSSStyleDeclaration, name: string, fallback: number) {
  const v = parseFloat(cs.getPropertyValue(name));
  return Number.isFinite(v) ? v : fallback;
}

export function useBoardEntrance(
  rootRef: RefObject<HTMLElement | null>,
  activePresetId: string | null,
) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // Older browsers, and jsdom under test, have no WAAPI. The board is fully
    // visible without it — this only ever adds a transition, never a hidden
    // resting state — so there is nothing to fall back to.
    if (typeof root.animate !== "function") return;

    // Timing comes from the stylesheet, so console-motion.css stays the one
    // place motion is tuned. Reading --tn-mo here is what makes
    // `prefers-reduced-motion` govern the scripted path as well as the CSS one,
    // without a second copy of the rule to keep in step.
    //
    // The `mo <= 0` guard below is not reachable today: the only thing that
    // moves that multiplier is the reduced-motion block, which sets 0.55. It is
    // kept because it is the whole implementation of an off switch — a settings
    // toggle would write 0 to this one variable and need no other change here —
    // and because starting a zero-length animation on every card is worse than
    // starting none.
    const cs = getComputedStyle(root);
    const mo = num(cs, "--tn-mo", 1);
    const travelScale = num(cs, "--tn-mo-travel", 1);
    if (mo <= 0) return;

    const duration = num(cs, "--tn-mo-focal-ms", 420) * mo;
    const step = num(cs, "--tn-mo-step-ms", 45) * mo;

    // Rails AND the wall. A board is one or the other — `composeWall` builds the
    // camera boards, `.tn-rail-col` the rest — and querying only the rails is
    // how the first version left every wall tile with no entrance while the
    // board beside it had one. A wall has no rail edge to come from, so its
    // tiles resolve in place, and the stagger runs in DOM order, which on a wall
    // is reading order.
    const groups: Array<{ el: HTMLElement; rail: string }> = [
      ...[...root.querySelectorAll<HTMLElement>(".tn-rail-col")].map((el) => ({
        el,
        rail: el.dataset.segment ?? "",
      })),
      ...[...root.querySelectorAll<HTMLElement>(".tn-grid")].map((el) => ({ el, rail: "wall" })),
    ];

    const running: Animation[] = [];
    for (const { el: col, rail } of groups) {
      const [tx, ty] = TRAVEL[rail] ?? TRAVEL_DEFAULT;
      const cards = col.querySelectorAll<HTMLElement>(".tn-cw");
      cards.forEach((card, i) => {
        // Cancel a PREVIOUS ENTRANCE still in flight — boards get switched
        // faster than 420ms by anyone comparing two of them, and without this
        // the second entrance composites onto the first and the card arrives
        // from the wrong place at the wrong opacity.
        //
        // Matched by id, NOT by cancelling everything on the card. A wall tile
        // can be carrying a FLIP animation from lib/terminal/flip.ts, which owns
        // the drag-release snap; cancelling that from here would break a feature
        // this one has no business touching.
        card.getAnimations().forEach((a) => { if (a.id === ENTRANCE_ID) a.cancel(); });
        const a = card.animate(
          [
            {
              opacity: 0,
              transform: `translate3d(${tx * travelScale}px, ${ty * travelScale}px, 0)`,
            },
            { opacity: 1, transform: "none" },
          ],
          {
            duration,
            delay: Math.min(i, MAX_STAGGER_STEPS) * step,
            easing: EASE,
            // `backwards` holds the offset through the delay so a staggered card
            // does not sit at its resting position and then jump back to start.
            // NOT `both`: nothing should be left holding a forced style once the
            // entrance is over.
            fill: "backwards",
          },
        );
        a.id = ENTRANCE_ID;
        running.push(a);
      });
    }

    // A board switched again mid-flight, or the workspace unmounting, must not
    // leave animations holding a transform on a card the next board will reuse.
    return () => running.forEach((a) => a.cancel());
  }, [rootRef, activePresetId]);
}
