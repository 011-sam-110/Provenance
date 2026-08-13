// The guided product tour — a spotlight walkthrough of the console for first-time
// visitors, replayable on demand. This file is the PURE data + logic half: the
// ordered step list (each pointing at a stable CSS target) plus the first-visit
// gating and index maths. The overlay that draws the spotlight + coach-mark lives
// in components/shell/TourOverlay.tsx; the persisted "seen" flag + active state
// live in lib/shell/tour.ts. Keeping the steps + gating here makes them unit-testable
// with no DOM (mirrors the other pure-logic-with-a-fixture-test modules).

import { BRAND } from "@/lib/brand";

export interface TourStep {
  id: string;
  /** CSS selector for the element to spotlight. "" ⇒ a centred, target-less card. */
  target: string;
  /** Short heading for the coach-mark. */
  title: string;
  /** One or two plain-English sentences — what it is and why it's useful. */
  body: string;
  /** Preferred coach-mark placement relative to the target (the overlay clamps to the viewport). */
  placement?: "top" | "bottom" | "left" | "right" | "center";
}

/**
 * Bump when the tour changes materially — a higher version re-invites returning
 * visitors exactly once (they've "seen" an older tour, not this one).
 */
export const TOUR_VERSION = 1;

/**
 * The walkthrough, in order. Targets are stable class hooks already on the chrome
 * (or added alongside a feature): the map stage, the widget column, a widget's new
 * ? affordance, the board switcher, ⌘K, Settings. Target-less steps ("") open and
 * close the run with a calm framing card.
 */
export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    target: "",
    title: `Welcome to ${BRAND.name}`,
    body: "A live map of what's happening on Earth right now — flights, quakes, ships, conflict, markets and more. Here's a 40-second tour. You can skip any time.",
    placement: "center",
  },
  {
    id: "map",
    target: ".tn-cw-stage",
    title: "The globe is the stage",
    body: "Every layer you switch on paints here. Drag to spin it, scroll to zoom, and flip between a 3D globe and a flat 2D map from the map controls.",
    placement: "center",
  },
  {
    id: "widgets",
    target: ".tn-cw-col-left",
    title: "Widgets watch the data",
    body: "Each panel monitors one live source. Resize it, pop it out full-screen, duplicate it, or arm it to alert you — all from its header.",
    placement: "right",
  },
  {
    id: "help",
    target: ".tn-cw-help",
    title: "Not sure what a panel is?",
    body: "Every widget has a ? — click it for a plain note on what it shows and where the data comes from. No jargon.",
    placement: "bottom",
  },
  {
    id: "boards",
    target: ".tn-preset-pill",
    title: "Switch the whole board",
    body: "Pick a board to re-skin the workspace in one click. Each is a persona — Situation Room, Earth Systems, Markets & Cyber — and it swaps both the panels and the map layers.",
    placement: "bottom",
  },
  {
    id: "palette",
    target: ".tn-palette-trigger",
    title: "Command bar (⌘K)",
    body: "Press ⌘K (Ctrl-K) for the fast path: add any widget, toggle a map layer, or fly to any place on Earth just by typing its name.",
    placement: "bottom",
  },
  {
    id: "settings",
    target: ".tn-settings-trigger",
    title: "Make it yours",
    body: "Theme, language, a shareable link, and alert channels (browser, Telegram, Discord) all live in Settings.",
    placement: "bottom",
  },
  {
    id: "done",
    target: "",
    title: "That's the tour",
    body: `Explore freely — nothing here needs a login or a key. Replay this any time from ⌘K → “Take the tour”, and if ${BRAND.name} is useful you can support it with the ☕ button up top.`,
    placement: "center",
  },
];

/**
 * True when a visitor should be auto-shown the tour: they've never completed it,
 * or they last saw an older version. `seenVersion` is null on a first-ever visit.
 */
export function shouldAutoRunTour(seenVersion: number | null, current: number = TOUR_VERSION): boolean {
  return seenVersion == null || seenVersion < current;
}

/**
 * Drop steps whose target isn't on the page (e.g. a widget column hidden at a
 * narrow width), so the run never spotlights nothing. `hasTarget` is injected so
 * this stays pure/testable; target-less framing steps ("") always survive.
 */
export function resolveTourSteps(steps: TourStep[], hasTarget: (selector: string) => boolean): TourStep[] {
  return steps.filter((s) => s.target === "" || hasTarget(s.target));
}

/** Clamp a step index into [0, len-1]; 0 for an empty run. */
export function clampStep(index: number, len: number): number {
  if (len <= 0) return 0;
  return Math.min(Math.max(index, 0), len - 1);
}

/** True when `index` is the final step of a `len`-length run (the "Done" affordance). */
export function isLastStep(index: number, len: number): boolean {
  return len > 0 && index >= len - 1;
}
