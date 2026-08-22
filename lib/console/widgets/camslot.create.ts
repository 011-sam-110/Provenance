"use client";

import { shellLayoutStore } from "@/lib/console/store";
import { MAX_STREAMS, sanitizeCamslotConfig, type StreamRef } from "@/lib/console/widgets/camslot.model";

// ── Making a camera wall, from anywhere ──────────────────────────────────────
//
// Four separate surfaces now need to mint a camslot: the ghost "+" tile at the end
// of the wall, the stage bar's button, the empty-board rescue panel, and the map's
// "send these to the wall". Before this file each of them would have hand-rolled
// `shellLayoutStore.add("camslot", …)`, and the four would have drifted — a
// different default dwell here, a forgotten sanitise there, and only one of them
// bothering to make the new card visible.
//
// THE VISIBILITY PROBLEM IS THE POINT OF THIS MODULE, not a nicety bolted onto it.
// `addWidget` places a new card at `findFreeSpot`, and the Streets board is tiled
// by `arrangeWall` to cover all twelve columns for the full row budget — so there
// is no free cell, and the scan falls through to `{ x: 0, y: rowsUsed }`: the first
// row BELOW the board. Measured on the live board at 1440x900, adding a camera wall
// from the command palette put it at `top: 856px` in a 900px viewport. Nothing
// scrolled to it, nothing flashed, and the palette stayed open over the top. The
// user's report was "I add a camera wall and nothing happens", and they were right
// to say so — 44px of a 174px card, below the world-clock strip, is not feedback.
//
// So creating and revealing are ONE call here. A caller cannot get the first
// without the second and quietly reintroduce the bug.

/** A camera wall's opening cell. Wider than the generic 4x7 because a camera tile
 *  showing a 16:9 frame at four columns is smaller than the controls on its own
 *  header — this is the smallest size at which a new empty slot reads as a place
 *  a picture will go. */
/** The cell footprint a new wall takes. Exported because the grid draws a ghost
 *  tile in the cell this card WILL occupy, and a second copy of these numbers
 *  would let the preview drift away from the thing it previews. */
export const CAMSLOT_SIZE = { w: 4, h: 9 };

export interface CreateCamslotOptions {
  /** Shown as the card's title. A place, not a description — "Soho", "Trafalgar
   *  Square". Omitted for a blank slot, which titles itself "Camera wall". */
  name?: string;
  /** What to put in it. Sanitised here, so a caller may pass anything it scraped. */
  streams?: StreamRef[];
  /** Dwell per view when it holds more than one. Defaults to the model's own. */
  intervalMs?: number;
  /** Scroll the new card into view and flash it. Defaults ON, and the default is
   *  the whole reason this function exists — pass `false` only when the caller has
   *  already guaranteed the card is on screen. */
  reveal?: boolean;
}

export interface CreateCamslotResult {
  ok: boolean;
  id?: string;
  /** Set when `ok` is false, ready to show the user. */
  reason?: string;
}

/**
 * Add a camera wall to the open board and put it where the user can see it.
 *
 * Returns rather than throws on capacity, because every caller is a click handler
 * and all of them owe the user a sentence rather than a stack trace.
 */
export function createCamslot(opts: CreateCamslotOptions = {}): CreateCamslotResult {
  const config = sanitizeCamslotConfig({
    streams: (opts.streams ?? []).slice(0, MAX_STREAMS),
    intervalMs: opts.intervalMs,
    name: opts.name,
  });

  const res = shellLayoutStore.add("camslot", {
    config: config as unknown as Record<string, unknown>,
    width: CAMSLOT_SIZE.w,
  });

  if (!res.ok) {
    return { ok: false, reason: "This board is full — remove a widget to add another." };
  }

  if (opts.reveal !== false) revealWidget(res.id);
  return { ok: true, id: res.id };
}

/** How long the new card wears its highlight. Long enough to find with your eye
 *  after a scroll, short enough not to become part of the card's appearance. */
const FLASH_MS = 1400;

/** How long to keep looking for the new card before giving up. React commits when
 *  it commits — a fixed number of frames is a guess, and the guess was wrong. */
const REVEAL_DEADLINE_MS = 600;

/**
 * Scroll a freshly added card into view and mark it, once.
 *
 * WAITING TWO ANIMATION FRAMES DOES NOT WORK, and this is the second version of
 * this function for that reason. `shellLayoutStore.add` emits synchronously but
 * React commits on its own schedule, so `querySelector` inside a fixed number of
 * frames finds nothing. Measured on the live board: a MutationObserver watching
 * every `[data-grid-id]` in the workspace recorded the marker being applied ZERO
 * times across repeated adds — the reveal was silently doing nothing at all, which
 * is precisely the failure it exists to prevent, hiding inside the fix for it.
 *
 * So it polls per frame until the node exists, with a deadline. Bounded, so a card
 * that never arrives costs 600ms of empty frames rather than a hang, and the widget
 * itself has been created correctly either way.
 *
 * THE MARKER IS A DATA ATTRIBUTE, NOT A CLASS, and that is not a style preference.
 * `className` is a prop React owns on these nodes; the board re-renders on the very
 * store write that created the card, and any class added imperatively is liable to
 * be reconciled away. React does not touch attributes it never rendered, so
 * `data-just-added` survives.
 */
export function revealWidget(id: string): void {
  if (typeof window === "undefined") return;

  const selector = `[data-grid-id="${CSS.escape(id)}"]`;

  const mark = (el: HTMLElement) => {
    // `block: "nearest"` rather than "center": the board is a scroll container
    // inside a fixed console band, and centring a card at the bottom of a short
    // board scrolls past the cards the user was already looking at. "Nearest"
    // moves the minimum needed to bring it fully in, which for a card already on
    // screen is nothing at all.
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    el.setAttribute("data-just-added", "");
    window.setTimeout(() => el.removeAttribute("data-just-added"), FLASH_MS);
  };

  const found = document.querySelector<HTMLElement>(selector);
  if (found) { mark(found); return; }

  // WATCH FOR IT RATHER THAN GUESSING WHEN IT ARRIVES. The first version waited a
  // fixed two animation frames and never fired; the second polled with
  // requestAnimationFrame and fired, but late and erratically — rAF is throttled to
  // roughly one callback a second in a tab that is not visible, which is also every
  // tab a headless test runs in. A MutationObserver fires on the insertion itself,
  // so this is correct whether or not frames are being served.
  const obs = new MutationObserver(() => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return;
    obs.disconnect();
    window.clearTimeout(giveUp);
    mark(el);
  });
  obs.observe(document.body, { childList: true, subtree: true });

  // Bounded, so a card that never arrives costs one disconnect rather than an
  // observer that lives for the rest of the session. The widget itself has already
  // been created correctly either way.
  const giveUp = window.setTimeout(() => obs.disconnect(), REVEAL_DEADLINE_MS);
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
