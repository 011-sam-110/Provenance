"use client";
// STARTING AN AREA DRAW — one implementation, two buttons.
//
// It lives here rather than in either caller because the two entry points must not
// drift, and the thing that would drift is the part that is easy to leave out.
//
// ── `onFinish` IS LOAD-BEARING, NOT DECORATION ───────────────────────────────
// lib/map/aoi.ts's DrawOptions says it plainly: omit `onFinish` and the finished
// ring becomes the console's AOI SCOPE — a filter over every scoped widget.
// Supply it and the scope is left completely alone and the ring is handed back.
// An Inspector area is the second thing: it carries its own sources and draws
// alongside the globe, and it must never silently become a global filter.
//
// That distinction used to be recoverable — the map rail's "Restrict results to
// an area" flyout could clear a scope someone had set by accident. That flyout is
// gone. So `startDraw(map)` with no options is now a one-way door, and the only
// way back is the ✕ this branch adds to the context switcher. A copy-pasted second
// call site that dropped the callback would be a bug nobody could undo, which is
// exactly why there is no second call site.
//
// ── THE MAP COMES FROM `getMapInstance()`, NOT `window.__map` ────────────────
// AreasPanel read the window handle, and WorldMap's own comment calls that a
// "debug handle". It is set on mount and NEVER CLEARED on unmount, while
// `setMapInstance(null)` is — with the stated reason that "a removed map must
// never be handed to a capture". Arming a gesture on a torn-down map is the same
// hazard. lib/map/instance.ts is the accessor that tells the truth.

import { aoiLabel, startDraw } from "@/lib/map/aoi";
import { getMapInstance } from "@/lib/map/instance";
import { AREA_CAP, inspectorStore } from "@/lib/shell/inspector";

/**
 * Pure: is there room for another area?
 *
 * WHY THE CALLERS ASK BEFORE DRAWING. `inspectorStore.add` is
 * `[area, ...rest].slice(0, AREA_CAP)`, so at the cap a new area does not fail —
 * it pushes the OLDEST one out, silently, along with every source configured on
 * it. Refusing up front and saying why is the only version of this that does not
 * destroy work the user cannot get back.
 */
export function atAreaCap(areaCount: number): boolean {
  return areaCount >= AREA_CAP;
}

/** Derived from AREA_CAP, never retyped — the same rule WIDGET_LIMIT_MESSAGE follows. */
export const AREA_CAP_MESSAGE = `You already have ${AREA_CAP} areas. Remove one before drawing another.`;
export const NO_MAP_MESSAGE = "The map is not on screen, so there is nothing to draw an area on.";
export const DRAW_BUSY_MESSAGE = "A drawing is already running. Finish it, or press Escape first.";

export type StartAreaDraw = { ok: true } | { ok: false; message: string };

/**
 * Arm the polygon tool so the finished ring is saved as an Inspector area and the
 * rail is pointed at it. Returns why it could not, rather than failing silently.
 *
 * The rail is pointed at the new area because that is what anyone does next after
 * drawing one. It is only a WRITE TARGET — every area draws whatever its own set
 * says, whichever one this selects — so it cannot surprise anyone.
 */
export function startAreaDraw(areaCount: number): StartAreaDraw {
  if (atAreaCap(areaCount)) return { ok: false, message: AREA_CAP_MESSAGE };
  const map = getMapInstance();
  if (!map) return { ok: false, message: NO_MAP_MESSAGE };
  const armed = startDraw(map, {
    onFinish: (ring) => {
      const id = inspectorStore.add(ring, aoiLabel(ring));
      if (id) inspectorStore.edit(id);
    },
  });
  return armed ? { ok: true } : { ok: false, message: DRAW_BUSY_MESSAGE };
}

/**
 * The UI wrapper: arm the tool, and SAY SO when it refuses.
 *
 * A click that arms nothing and reports nothing is the dead control this codebase
 * keeps writing comments about, and both refusals here are states the user can be
 * in without knowing it — the stage can be a fullscreened widget, and a draw
 * armed from the other entry point is invisible from this one.
 */
export function drawArea(areaCount: number): void {
  const r = startAreaDraw(areaCount);
  if (r.ok || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("tn-toast", { detail: r.message }));
}
