"use client";

import { useSyncExternalStore } from "react";
import { bboxOfRing, pointInRing } from "@/lib/shell/scope";
import { MAX_STREAMS, streamKey, type StreamRef } from "@/lib/console/widgets/camslot.model";
import type { LatLon } from "@/lib/console/widgets/camslot.arm";

// ── The camera basket ────────────────────────────────────────────────────────
//
// What this replaces, and why the replacement is a different shape rather than a
// tidier version of the same thing.
//
// ARMING chose the DESTINATION FIRST. You pressed a ⊕ hidden inside one widget's
// hover-only control bar, and from then on every camera you clicked went into that
// one slot. Three things went wrong with it, and all three were reported by the
// person using it rather than found in review:
//
//  • The destinations are indistinguishable. Four camera walls on the Streets
//    board all render the header "CAMERA WALL", so "arm the right one" is a
//    question the screen does not answer.
//  • The mode is invisible unless you pressed the button yourself. Coming back to
//    a console that is already armed, nothing tells you why clicking a pin behaves
//    differently from yesterday.
//  • It has no answer for "everything in this area". Arming appends to one slot;
//    it cannot say "make me a wall out of Soho".
//
// PICKING chooses the destination LAST. Cameras accumulate in a basket that is
// drawn on screen the whole time it is non-empty, and only when the user presses
// "Send to wall" do they say where. A click, a shift-drag box and a drawn polygon
// all feed the same basket, so the three gestures need one mental model instead of
// three, and "make a wall out of this area" is the same button as "make a wall out
// of these two cameras I clicked".
//
// MODULE STATE, not React state — this constraint is inherited from arming and has
// not gone away. `wireInteractions` in WorldMap is a `useCallback(…, [])` invoked
// once at mount, and the thumbnail manager's `onPick` is built inside the init
// effect: anything either closes over is frozen at mount. On top of that StageHost
// unmounts <WorldMap/> entirely when a widget is focused, so component state would
// not survive a round trip through a focused widget either. State read at EVENT
// time is the only shape that works for both.
//
// NOT PERSISTED, deliberately. A basket is a gesture in progress, not a
// preference. Restoring one at next login would greet the user with a tray full of
// cameras they have no memory of choosing, and — worse — `boards.ts` builds its
// "customised" signature from widget config, so anything that leaks into config
// lights the edited dot on boards nobody touched.

/** A camera the user has chosen but not yet placed. */
export interface PickedCamera {
  /** What actually goes into a slot. */
  ref: StreamRef;
  /** `streamKey(ref)` — identity for dedup. Stored rather than recomputed so the
   *  basket can be deduped without importing the model into a hot loop. */
  key: string;
  /** What to call it in the tray, and what to seed a new wall's name from. */
  label: string;
  lat: number;
  lon: number;
  /** Poll cadence in seconds, where the source states one. Feeds `cadenceCap` at
   *  send time. Optional, and optional on purpose: a missing cadence must degrade
   *  to a stated fallback rather than to a confident wrong number. */
  refreshSeconds?: number;
  /** Owning network, e.g. "TfL". Shown in the tray so a user can tell a road
   *  camera from a Windy webcam before committing to it. */
  source?: string;
}

/**
 * The basket holds at most one wall's worth.
 *
 * A slot caps at `MAX_STREAMS`, so a basket that could grow past it would be
 * promising a wall it cannot build. Refusing at the same number lets the tray say
 * "this area has 143 cameras, a wall holds 60" while the box is being filled —
 * which is a fact the user can act on — instead of discovering the truncation
 * after they press send.
 */
export const MAX_PICKS = MAX_STREAMS;

export interface MergeResult {
  next: PickedCamera[];
  added: number;
  duplicates: number;
  /** Rows dropped because the basket is full. */
  refused: number;
}

/**
 * Fold new picks into the basket: dedup by stream key, keep insertion order, stop
 * at the cap.
 *
 * REFUSES rather than evicting. Dropping the oldest to make room for the newest
 * would silently unpick a camera the user chose deliberately, and they would only
 * notice it missing from the finished wall.
 *
 * Pure — `tests/unit/camslot-pick.test.ts` drives it directly.
 */
export function mergePicks(
  existing: readonly PickedCamera[],
  incoming: readonly PickedCamera[],
  cap: number = MAX_PICKS,
): MergeResult {
  const next = [...existing];
  const seen = new Set(existing.map((p) => p.key));
  let added = 0;
  let duplicates = 0;
  let refused = 0;

  for (const row of incoming) {
    if (seen.has(row.key)) { duplicates += 1; continue; }
    if (next.length >= cap) { refused += 1; continue; }
    seen.add(row.key);
    next.push(row);
    added += 1;
  }

  return { next: added > 0 ? next : [...existing], added, duplicates, refused };
}

/**
 * Everything inside a drawn ring.
 *
 * The ring's bounding box is a cheap reject before the O(vertices) test, the same
 * order `withinScope` uses — a polygon over Soho against 19,000 loaded cameras
 * runs the ray cast on the handful the bbox admits rather than all of them.
 *
 * Non-finite coordinates are DROPPED, never coerced. `lat ?? 0` would place a
 * camera in the Gulf of Guinea, and a ring drawn there would then "contain" every
 * broken row in the feed.
 */
export function camerasInRing<T extends LatLon>(
  rows: readonly T[],
  ring: readonly [number, number][],
): T[] {
  if (ring.length < 3) return [];
  const [west, south, east, north] = bboxOfRing(ring);
  const out: T[] = [];
  for (const r of rows) {
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;
    if (r.lon < west || r.lon > east || r.lat < south || r.lat > north) continue;
    if (pointInRing(r.lon, r.lat, ring)) out.push(r);
  }
  return out;
}

export interface PickNoteOpts {
  /** How many the gesture actually found, before the basket's cap. Distinct from
   *  `added + duplicates + refused` only when a caller filtered first. */
  found?: number;
  /** True when the gesture was a drawn area rather than a click or a box. */
  fromArea?: boolean;
}

/**
 * One sentence for what a gesture did to the basket.
 *
 * Every branch says something. A gesture that produced no visible consequence is
 * the failure this whole interception layer exists to prevent — "the map moved a
 * bit" is not an answer to a click, and neither is silence when everything you
 * just boxed was already picked.
 *
 * The refusal branch names BOTH numbers, because "60 picked" alone reads as
 * success when fourteen cameras were dropped on the floor.
 */
export function describePicked(res: MergeResult, opts: PickNoteOpts = {}): string {
  const where = opts.fromArea ? " in this area" : "";
  const n = (c: number, s: string, p = `${s}s`) => `${c} ${c === 1 ? s : p}`;

  if (res.added === 0 && res.duplicates === 0 && res.refused === 0) {
    return `No cameras${where}.`;
  }
  if (res.added === 0 && res.refused > 0) {
    return `The basket is full at ${MAX_PICKS} — ${n(res.refused, "camera")} not picked. Send or clear what you have first.`;
  }
  if (res.added === 0) {
    return res.duplicates === 1
      ? "That one is already picked."
      : `All ${res.duplicates} were already picked.`;
  }

  const parts = [`Picked ${n(res.added, "camera")}${where}.`];
  if (res.duplicates > 0) parts.push(`${n(res.duplicates, "was", "were")} already in the basket.`);
  if (res.refused > 0) {
    parts.push(`${res.refused} more would not fit — a basket holds ${MAX_PICKS}.`);
  }
  return parts.join(" ");
}

/** What the map is currently doing with a click on a camera. */
export type PickMode = "off" | "picking";

interface PickState {
  mode: PickMode;
  picks: PickedCamera[];
  /** Vertices of the ring the picks came from, when they came from one. Kept so
   *  the tray can name the selection and offer to widen the search inside the same
   *  area without asking the user to draw it again. */
  ring: [number, number][] | null;
  /** How many cameras the last area query actually found, which can exceed
   *  `picks.length` once the cap bites. Printing `picks.length` as the area's total
   *  would be the coverage lie the rest of this codebase exists to avoid. */
  foundInArea: number;
}

let state: PickState = { mode: "off", picks: [], ring: null, foundInArea: 0 };
const listeners = new Set<() => void>();
function emit() { for (const fn of listeners) fn(); }

export const pickStore = {
  get(): PickState { return state; },

  /** Turn picking on or off. Turning it off keeps the basket — the user may be
   *  panning the map between selections, and throwing their work away for a mode
   *  toggle would be a trap. `clear()` is the only thing that empties it. */
  setMode(mode: PickMode) {
    if (state.mode === mode) return;
    state = { ...state, mode };
    emit();
  },

  add(rows: readonly PickedCamera[]): MergeResult {
    const res = mergePicks(state.picks, rows);
    if (res.added > 0) { state = { ...state, picks: res.next }; emit(); }
    return res;
  },

  /** Record an area selection: its picks, its ring, and the honest total. */
  addFromArea(rows: readonly PickedCamera[], ring: readonly [number, number][], found: number): MergeResult {
    const res = mergePicks(state.picks, rows);
    state = { ...state, picks: res.next, ring: [...ring], foundInArea: found };
    emit();
    return res;
  },

  remove(key: string) {
    if (!state.picks.some((p) => p.key === key)) return;
    state = { ...state, picks: state.picks.filter((p) => p.key !== key) };
    emit();
  },

  clear() {
    if (state.picks.length === 0 && state.ring === null) return;
    state = { ...state, picks: [], ring: null, foundInArea: 0 };
    emit();
  },

  /**
   * Keep only these picks, dropping the rest.
   *
   * For a PARTIAL send: a wall took eight of the twelve you had and refused four
   * because of its cadence cap. Clearing the basket there would destroy those four
   * at the same moment the message says "use a second wall" — advice the user could
   * no longer follow, because the cameras it referred to are gone. They stay.
   *
   * The area context is dropped regardless, and that is deliberate. Once part of a
   * ring's contents has been placed, the leftovers are no longer "what is in this
   * area": keeping `foundInArea` would leave the tray printing "this area has 143
   * cameras" above a basket of four, which is true about the area and false about
   * the thing the sentence appears to describe.
   */
  retain(keys: readonly string[]) {
    const keep = new Set(keys);
    const picks = state.picks.filter((p) => keep.has(p.key));
    if (picks.length === state.picks.length && state.ring === null) return;
    state = { ...state, picks, ring: null, foundInArea: 0 };
    emit();
  },

  /** Everything off: used when the board changes under the basket. */
  reset() {
    state = { mode: "off", picks: [], ring: null, foundInArea: 0 };
    emit();
  },

  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
};

/** Nothing is picked before hydration, by definition — so the server snapshot is a
 *  stable frozen empty rather than a fresh object, which would loop the store. */
const SERVER_STATE: PickState = { mode: "off", picks: [], ring: null, foundInArea: 0 };

export function usePicks(): PickState {
  return useSyncExternalStore(pickStore.subscribe, pickStore.get, () => SERVER_STATE);
}

/**
 * A name for a wall built from a set of picks.
 *
 * Prefers the shared leading words of the labels, because the camera feeds already
 * caption themselves by place — "London: Trafalgar Square" and "London: Oxford
 * Circus" agree on "London", and that is a better name than anything a centroid
 * lookup would invent. Falls back to counting, never to guessing: naming a drawn
 * polygon "Southern England" from its centre is a claim this product cannot
 * support.
 */
export function nameForPicks(picks: readonly PickedCamera[], areaLabel?: string): string {
  if (areaLabel) return areaLabel;
  if (picks.length === 0) return "";
  if (picks.length === 1) return picks[0].label;

  const prefix = picks[0].label.split(/[:,–—-]/)[0]?.trim();
  if (prefix && prefix.length >= 3 && picks.every((p) => p.label.startsWith(prefix))) {
    return prefix;
  }
  return `${picks.length} cameras`;
}

/** Dedup key for a camera row, exported so callers building `PickedCamera` do not
 *  each reach for the model. */
export function pickKey(ref: StreamRef): string { return streamKey(ref); }
