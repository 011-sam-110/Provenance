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

/**
 * Scroll a freshly added card into view and mark it, once.
 *
 * Deferred by two animation frames, not called inline: `shellLayoutStore.add`
 * emits synchronously, but React has not committed the new node yet, so a
 * `querySelector` on the same tick finds nothing. One frame gets the commit, the
 * second gets the grid's own layout pass — measured against the settle animation,
 * a single frame lands mid-flight and scrolls to a stale box.
 *
 * Silent when the node never appears. The alternative — retrying, or throwing —
 * would turn "the board is in a state I did not anticipate" into either a hang or
 * a crash inside a click handler, and the widget itself has already been created
 * correctly either way.
 */
export function revealWidget(id: string): void {
  if (typeof window === "undefined") return;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-grid-id="${CSS.escape(id)}"]`);
      if (!el) return;

      // `block: "nearest"` rather than "center": the board is a scroll container
      // inside a fixed console band, and centring a card at the bottom of a short
      // board scrolls past the cards the user was already looking at. "Nearest"
      // moves the minimum needed to bring it fully in, which for an on-screen
      // card is nothing at all.
      el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });

      el.classList.add("is-just-added");
      window.setTimeout(() => el.classList.remove("is-just-added"), FLASH_MS);
    });
  });
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
