"use client";

import { getMapInstance } from "@/lib/map/instance";
import { aoiDrawStore, startDraw } from "@/lib/map/aoi";
import { loadedCamerasStore } from "@/lib/cameras/loaded";
import { loadedWebcamsStore } from "@/lib/webcams/loaded";
import { webcamRef, orderByDistanceFrom } from "@/lib/console/widgets/camslot.arm";
import {
  MAX_PICKS, camerasInRing, describePicked, pickKey, pickStore,
  type PickedCamera,
} from "@/lib/console/widgets/camslot.pick";

// ── Draw an area, get a camera wall ──────────────────────────────────────────
//
// The gesture Sam asked for: "there is no way to use the polygon area selector and
// send all cameras in that sector to the camera wall."
//
// NOTHING NEW IS DRAWN HERE. `lib/map/aoi.ts` already had a polygon tool with the
// hard parts solved — document-capture clicks so a vertex landing on a marker does
// not also open its dossier, a 4px drag slop so repositioning the map does not drop
// a point, and custody of double-click-zoom so the gesture that closes the ring
// does not also zoom. All this module does is ask for the ring instead of letting
// it become the console's AOI scope, and turn it into picks.
//
// WHY IT MUST NOT SET THE SCOPE. "Build me a wall out of Soho" and "hide everything
// outside Soho" are different requests. The AOI scope is read by about a dozen
// widgets and by the export path; setting it as a side effect of picking cameras
// would silently filter all of them. Hence `startDraw(map, { onFinish })`.
//
// WHAT IT COVERS, AND WHAT IT CANNOT. Road cameras come from `loadedCamerasStore`,
// which holds the whole /api/cameras array client-side; webcams from
// `loadedWebcamsStore`, which holds an unranked ~2% sample of Windy. Both are
// populated ONLY while their layer is on. So there are two failure modes that look
// identical on screen and must not: "your ring is empty" and "we were not looking".
// Every return below distinguishes them.
//
// It deliberately does NOT fan out to /api/webcam-search on finish. The route
// refuses spans over 30° lat / 60° lon outright, Windy's request ceiling is still
// unmeasured, and the standing rule in this codebase is that a map gesture is never
// an implicit search. Widening the search is offered to the user as a button; it is
// not done to them.

export type AreaPickOutcome =
  | { kind: "started" }
  | { kind: "no-map" }
  | { kind: "busy" }
  | { kind: "not-ready" };

// ── Whose draw is it? ────────────────────────────────────────────────────────
//
// `aoiDrawStore` says a ring is being drawn. It does not say what for, and two
// controls now start one: "Restrict results to area" and "Draw an area". Both
// render a live vertex counter and a Cancel button while a draw is running, so
// without this flag BOTH appeared at once — measured on the live stage bar, two
// stacked "0/3 POINTS / CANCEL" panels, one of which was describing a gesture the
// user had not asked for. Whichever one the user reads, half the time it is
// telling them the wrong thing about what closing the ring will do.
let forPick = false;
const flagListeners = new Set<() => void>();
function emitFlag() { for (const fn of flagListeners) fn(); }

function setForPick(v: boolean) {
  if (forPick === v) return;
  forPick = v;
  emitFlag();
}

export const areaPickStore = {
  /** True only while the draw in progress was started by the camera picker. */
  get(): boolean { return forPick; },
  subscribe(fn: () => void) { flagListeners.add(fn); return () => { flagListeners.delete(fn); }; },
};

// A cancelled or abandoned draw never reaches onFinish, so the flag has to be
// cleared from the draw store going idle rather than from the finish path alone.
// Subscribed once at module load: aoi.ts is imported by the map and by both
// controls, so there is no later moment that is reliably "after everything".
aoiDrawStore.subscribe(() => {
  if (!aoiDrawStore.get().active) setForPick(false);
});

/**
 * Begin an area pick. Returns as soon as drawing starts — the picks land later,
 * when the user closes the ring.
 *
 * Turns picking mode on as a side effect, deliberately: someone who has just drawn
 * a ring around Soho is picking cameras whether or not they pressed the toggle
 * first, and making them press it afterwards to see the tray would be a riddle.
 */
export function startAreaPick(): AreaPickOutcome {
  const map = getMapInstance();
  if (!map) return { kind: "no-map" };

  pickStore.setMode("picking");
  setForPick(true);
  const ok = startDraw(map, { onFinish: (ring) => { setForPick(false); pickRing(ring); } });
  if (!ok) setForPick(false);
  return ok ? { kind: "started" } : { kind: "not-ready" };
}

export interface RingPickResult {
  /** Sentence for the user. Always populated, always says something. */
  message: string;
  /** How many cameras the ring actually contained, before the basket's cap. */
  found: number;
  added: number;
}

/**
 * Everything inside a finished ring goes in the basket.
 *
 * Exported separately from `startAreaPick` so it can be driven directly by a test
 * or by a ring that came from somewhere other than the draw tool — and so the
 * containment rules stay in `camerasInRing`, which is pure and node-tested, rather
 * than trapped inside an event handler.
 */
export function pickRing(ring: readonly [number, number][]): RingPickResult {
  const rows = loadedCamerasStore.get();
  const webcams = loadedWebcamsStore.get();

  if (rows.length === 0 && webcams.length === 0) {
    // Neither layer is on. Saying "no cameras in that area" here would be a
    // confident wrong answer to a question we never actually asked.
    const message = "No camera pins are loaded, so an area has nothing to select. Turn on the Cameras or Webcams layer and draw it again.";
    toast(message);
    return { message, found: 0, added: 0 };
  }

  const cams = camerasInRing(rows, ring);
  const cover = camerasInRing(webcams, ring);
  const found = cams.length + cover.length;

  if (found === 0) {
    const message = "No cameras inside that area.";
    toast(message);
    return { message, found: 0, added: 0 };
  }

  const centre = ringCentre(ring);
  // Nearest the middle of what they drew, first — so a ring holding more than a
  // wall can carry loses its outer edge rather than an arbitrary slice.
  const ordered = orderByDistanceFrom(
    [
      ...cams.map((c) => ({
        lat: c.lat, lon: c.lon,
        picked: {
          ref: { k: "cam" as const, id: c.id },
          key: pickKey({ k: "cam", id: c.id }),
          label: c.name || c.id,
          lat: c.lat, lon: c.lon,
          refreshSeconds: c.refreshSeconds,
          source: c.source,
        } satisfies PickedCamera,
      })),
      ...cover.map((w) => ({
        lat: w.lat, lon: w.lon,
        picked: {
          ref: webcamRef(w.id, w.label),
          key: pickKey(webcamRef(w.id, w.label)),
          label: w.label || w.id,
          lat: w.lat, lon: w.lon,
          refreshSeconds: WEBCAM_REFRESH_SECONDS,
          source: "Windy",
        } satisfies PickedCamera,
      })),
    ],
    centre,
  );

  const res = pickStore.addFromArea(ordered.map((o) => o.picked), ring, found);
  let message = describePicked(res, { found, fromArea: true });

  // The cap is the one case where the honest number and the visible number differ,
  // so it is stated rather than left for the user to infer from a chip count.
  if (found > MAX_PICKS) {
    message += ` This area has ${found} cameras and a wall holds ${MAX_PICKS} — the ${MAX_PICKS} nearest its centre were taken.`;
  }
  toast(message);
  return { message, found, added: res.added };
}

/** Mirrors camslot.tsx and WorldMap — Windy's image tokens last ~10 minutes. */
const WEBCAM_REFRESH_SECONDS = 600;

/** The mean of a ring's vertices. Good enough to rank distance within one ring,
 *  which is all it is used for — it is NOT a centroid and must not be shown to
 *  anyone as "the middle of this area". */
function ringCentre(ring: readonly [number, number][]): { lat: number; lon: number } {
  let lat = 0, lon = 0;
  for (const [x, y] of ring) { lon += x; lat += y; }
  const n = Math.max(1, ring.length);
  return { lat: lat / n, lon: lon / n };
}

function toast(message: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("tn-toast", { detail: message }));
}
