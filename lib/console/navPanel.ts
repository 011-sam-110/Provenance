"use client";
// The Apple-style nav panel's brain: which scene's panel is open (if any), and
// the pure timing/roving-focus arithmetic around it. This module owns nothing
// that touches `window`/`document` at module scope — same contract as
// lib/console/mapRail.ts — so it is inert under the node vitest environment
// and every rule here is held by a plain unit test with fake timers instead
// of a real one.
//
// WHY A MODULE STORE, MIRRORING mapRailStore. The toggle button
// (`.tnx-hdr-nav-toggle`) and the Escape handler both need to open/close the
// panel from outside whichever component happens to own the JSX that renders
// it, and BoardTabs' hover/focus handlers need the SAME store so hovering one
// tab and then Tab-ing to another agree on what "already open" means. A
// module singleton is the only thing all three call sites can share without
// threading a prop down through TerminalHeader → BoardTabs → NavPanel and
// back up again for the toggle button.
//
// WHAT IS DELIBERATELY NOT HERE. The actual `setTimeout` calls for
// HOVER_OPEN_DELAY_MS / CLOSE_GRACE_MS live in TerminalHeader.tsx as
// component-local `useRef` timers, not in this module — a pure store has no
// business owning a timer that outlives a render, and doing it in the
// component means the timer is trivially cancelled on unmount. This file only
// answers "how long should that timer be" (nextOpenDelay) and "what happens
// when it fires" (open/close), so a test can hold both without a fake clock
// driving a React effect.

import { useSyncExternalStore } from "react";

/** mouseenter on a closed tab → open, after this many ms. Debounces a fast
 *  mouse pass-through across the tab row so brushing past WORLD on the way to
 *  INTEL does not flash WORLD's panel open first. */
export const HOVER_OPEN_DELAY_MS = 100;
/** Pointer leaves the whole navshell (tabs row + panel together) → close,
 *  after this many ms, cancelled by any mouseenter on the navshell before it
 *  fires. Long enough that crossing the gap from a tab down into the panel
 *  below it is never read as "left." */
export const CLOSE_GRACE_MS = 300;
/** CSS `max-height` open/close transition length. Exported so a test can
 *  assert the constant is what's wired into the stylesheet, and so a
 *  `transitionend` fallback timer (see NavPanel.tsx) has one number to trust. */
export const HEIGHT_TRANSITION_MS = 220;
/** CSS content opacity cross-fade length, used both for the open/close fade
 *  and for retargeting the panel's content between two open scenes. */
export const CROSSFADE_MS = 150;

export interface NavPanelState {
  openId: string | null;
}

/** The closed state, as ONE stable object — reused both as the initial
 *  `state` and as `useSyncExternalStore`'s server snapshot below. A fresh
 *  `{ openId: null }` literal on every `getServerSnapshot()` call breaks
 *  useSyncExternalStore's referential-stability contract (React warns
 *  "should be cached to avoid an infinite loop") — the exact trap
 *  `useSceneChrome`'s own doc comment calls out for `DEFAULT_SCENE_CHROME`,
 *  and the reason this module returns the same frozen reference here too. */
const CLOSED: NavPanelState = Object.freeze({ openId: null });

let state: NavPanelState = CLOSED;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export const navPanelStore = {
  get(): NavPanelState {
    return state;
  },
  /** Open, or retarget if a different scene's panel is already open. Opening
   *  the ALREADY-open scene is a no-op (no emit) — the store contract every
   *  other module store here follows: a redundant call must not wake every
   *  subscriber. No debounce lives here; callers decide the delay via
   *  `nextOpenDelay()` and their own timer. */
  open(sceneId: string) {
    if (state.openId === sceneId) return;
    state = { openId: sceneId };
    emit();
  },
  close() {
    if (state.openId === null) return;
    state = CLOSED;
    emit();
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

export function useNavPanel(): NavPanelState {
  return useSyncExternalStore(navPanelStore.subscribe, navPanelStore.get, () => CLOSED);
}

/**
 * How long to wait before honouring a hover-open request for `sceneId`.
 *
 * 0 when a panel is ALREADY open (any scene, including this one) — this is
 * the whole "moving the pointer between tabs re-sizes without closing" rule:
 * once the bar has committed to being open, every other tab retargets
 * instantly. HOVER_OPEN_DELAY_MS only guards the CLOSED → open transition,
 * where a fast pass-through across the row should not flash a panel at all.
 *
 * Pure so a test can hold the 0-vs-100 branch without a real timer.
 */
export function nextOpenDelay(current: NavPanelState, sceneId: string): number {
  return current.openId === null ? HOVER_OPEN_DELAY_MS : 0;
}

/**
 * Roving-focus step along the board-tab row, wrapping at both ends. Mirrors
 * `railStep` in lib/console/mapRail.ts exactly — same modulo trick, same
 * reason: ArrowRight off the end wraps to the first tab, ArrowLeft off the
 * start wraps to the last one, and `dir` is +1/-1 so the same function serves
 * both arrow keys.
 *
 * `from` not found in `order` (should not happen, but a defensive fallback
 * beats a thrown error from a keyboard handler) returns `order[0]`.
 */
export function boardStep(order: readonly string[], from: string, dir: 1 | -1): string {
  const i = order.indexOf(from);
  if (i === -1) return order[0];
  const n = order.length;
  return order[(i + dir + n) % n];
}
